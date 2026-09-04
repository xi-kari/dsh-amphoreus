import { crc32, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  readonly name: string
  readonly method: 0 | 8
  readonly compressedSize: number
  readonly size: number
  readonly localHeaderOffset: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_FIXED_SIZE = 22
const CENTRAL_FIXED_SIZE = 46
const LOCAL_FIXED_SIZE = 30
const MAX_EOCD_SEARCH = 65_557
const MAX_ZIP_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 4_096
const MAX_COMPRESSION_RATIO = 200
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const ENTRY_CRC = new WeakMap<ZipEntry, number>()
const ENTRY_FLAGS = new WeakMap<ZipEntry, number>()
const ENTRY_SOURCE = new WeakMap<ZipEntry, Buffer>()

function assertRange(buffer: Buffer, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`invalid zip ${label} bounds`)
  }
}

function decodeName(bytes: Buffer, utf8Required: boolean): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    if (utf8Required) throw new Error('invalid UTF-8 zip entry name')
    return bytes.toString('latin1')
  }
}

function validateEntrySizes(compressedSize: number, size: number): void {
  if (!Number.isSafeInteger(compressedSize) || !Number.isSafeInteger(size) || compressedSize < 0 || size < 0) {
    throw new Error('invalid zip entry size')
  }
  if (compressedSize > MAX_ZIP_BYTES || size > MAX_ENTRY_BYTES) throw new Error('zip entry exceeds size limit')
  if (size > 0 && size / Math.max(1, compressedSize) > MAX_COMPRESSION_RATIO) {
    throw new Error('zip entry exceeds compression ratio limit')
  }
}

function validateFlags(flags: number, method: number): void {
  const allowed = 0x800 | 0x8 | (method === 8 ? 0x6 : 0)
  if ((flags & ~allowed) !== 0) throw new Error(`unsupported zip flags 0x${flags.toString(16)}`)
}

function findEocd(buffer: Buffer): number {
  if (buffer.length < EOCD_FIXED_SIZE) throw new Error('zip end of central directory not found')
  const minimum = Math.max(0, buffer.length - MAX_EOCD_SEARCH)
  for (let offset = buffer.length - EOCD_FIXED_SIZE; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + EOCD_FIXED_SIZE + commentLength !== buffer.length) continue
    const disk = buffer.readUInt16LE(offset + 4)
    const centralDisk = buffer.readUInt16LE(offset + 6)
    const diskEntries = buffer.readUInt16LE(offset + 8)
    const entryCount = buffer.readUInt16LE(offset + 10)
    const centralSize = buffer.readUInt32LE(offset + 12)
    const centralOffset = buffer.readUInt32LE(offset + 16)
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) continue
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) continue
    if (entryCount > MAX_ENTRIES || centralSize < entryCount * CENTRAL_FIXED_SIZE) continue
    if (centralOffset + centralSize !== offset) continue
    if (entryCount > 0 && (centralOffset + 4 > buffer.length || buffer.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE)) continue
    return offset
  }
  throw new Error('zip end of central directory not found')
}

export function listZip(buffer: Buffer): ZipEntry[] {
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('zip exceeds size limit')
  const eocd = findEocd(buffer)
  assertRange(buffer, eocd, EOCD_FIXED_SIZE, 'end record')
  const disk = buffer.readUInt16LE(eocd + 4)
  const centralDisk = buffer.readUInt16LE(eocd + 6)
  const diskEntries = buffer.readUInt16LE(eocd + 8)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error('multi-disk zip is unsupported')
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 is unsupported')
  if (entryCount > MAX_ENTRIES) throw new Error('zip has too many entries')
  assertRange(buffer, centralOffset, centralSize, 'central directory')
  const centralEnd = centralOffset + centralSize
  if (centralEnd !== eocd) throw new Error('invalid zip central directory bounds')

  const entries: ZipEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(buffer, cursor, CENTRAL_FIXED_SIZE, 'central header')
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('invalid zip central header signature')
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const diskStart = buffer.readUInt16LE(cursor + 34)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    if ((flags & 0x1) !== 0) throw new Error('encrypted zip entries are unsupported')
    validateFlags(flags, method)
    if (diskStart !== 0) throw new Error('multi-disk zip is unsupported')
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip method ${method}`)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error('ZIP64 is unsupported')
    validateEntrySizes(compressedSize, size)
    const variableSize = nameLength + extraLength + commentLength
    assertRange(buffer, cursor + CENTRAL_FIXED_SIZE, variableSize, 'central entry')
    const nameBytes = buffer.subarray(cursor + CENTRAL_FIXED_SIZE, cursor + CENTRAL_FIXED_SIZE + nameLength)
    const name = decodeName(nameBytes, (flags & 0x800) !== 0)
    if (name === '' || name.includes('\0')) throw new Error('invalid zip entry name')
    const entry: ZipEntry = { name, method, compressedSize, size, localHeaderOffset }
    ENTRY_CRC.set(entry, buffer.readUInt32LE(cursor + 16))
    ENTRY_FLAGS.set(entry, flags)
    ENTRY_SOURCE.set(entry, buffer)
    entries.push(entry)
    cursor += CENTRAL_FIXED_SIZE + variableSize
  }
  if (cursor !== centralEnd) throw new Error('invalid zip central directory size')
  return entries
}

export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('zip exceeds size limit')
  if (ENTRY_SOURCE.get(entry) !== buffer) throw new Error('zip entry does not belong to this archive')
  validateEntrySizes(entry.compressedSize, entry.size)
  assertRange(buffer, entry.localHeaderOffset, LOCAL_FIXED_SIZE, 'local header')
  const offset = entry.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error('invalid zip local header signature')
  const flags = buffer.readUInt16LE(offset + 6)
  const method = buffer.readUInt16LE(offset + 8)
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  if ((flags & 0x1) !== 0) throw new Error('encrypted zip entries are unsupported')
  validateFlags(flags, method)
  const centralFlags = ENTRY_FLAGS.get(entry)
  if (centralFlags !== undefined && flags !== centralFlags) throw new Error('zip entry flags mismatch')
  if (method !== entry.method) throw new Error('zip entry method mismatch')
  if (method !== 0 && method !== 8) throw new Error(`unsupported zip method ${method}`)
  assertRange(buffer, offset + LOCAL_FIXED_SIZE, nameLength + extraLength, 'local entry')
  const nameBytes = buffer.subarray(offset + LOCAL_FIXED_SIZE, offset + LOCAL_FIXED_SIZE + nameLength)
  if (decodeName(nameBytes, (flags & 0x800) !== 0) !== entry.name) throw new Error('zip entry name mismatch')
  const expectedCrc = ENTRY_CRC.get(entry)
  if ((flags & 0x8) === 0) {
    if (buffer.readUInt32LE(offset + 18) !== entry.compressedSize || buffer.readUInt32LE(offset + 22) !== entry.size) {
      throw new Error('zip local entry size mismatch')
    }
    if (expectedCrc !== undefined && buffer.readUInt32LE(offset + 14) !== expectedCrc) throw new Error('zip entry CRC mismatch')
  }
  const dataOffset = offset + LOCAL_FIXED_SIZE + nameLength + extraLength
  assertRange(buffer, dataOffset, entry.compressedSize, 'entry data')
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize)
  if (method === 0 && entry.compressedSize !== entry.size) throw new Error('stored zip entry size mismatch')
  const output = method === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) })
  if (output.length !== entry.size) throw new Error('zip entry size mismatch')
  if (expectedCrc !== undefined && crc32(output) !== expectedCrc) throw new Error('zip entry CRC mismatch')
  return output
}
