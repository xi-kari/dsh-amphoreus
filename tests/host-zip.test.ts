import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'
import { listZip, readZipEntry, type ZipEntry } from '../src/host/zip.ts'

interface FixtureEntry {
  readonly name: string | Buffer
  readonly data: Buffer
  readonly method: number
  readonly flags?: number
}

function zipFixture(entries: readonly FixtureEntry[], comment = Buffer.alloc(0)): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let localOffset = 0
  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name, 'utf8')
    const compressed = entry.method === 8 ? deflateRawSync(entry.data) : entry.data
    const flags = entry.flags ?? 0x800
    const checksum = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(entry.method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(entry.method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centrals.push(central, name)
    localOffset += local.length + name.length + compressed.length
  }
  const central = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(localOffset, 16)
  eocd.writeUInt16LE(comment.length, 20)
  return Buffer.concat([...locals, central, eocd, comment])
}

test('lists and reads stored and deflated UTF-8 entries', () => {
  const first = Buffer.from('A')
  const second = Buffer.from('deflated payload')
  const zip = zipFixture([
    { name: '00_封面.jpg', data: first, method: 0 },
    { name: '01_第01页.jpg', data: second, method: 8 },
  ])
  const entries = listZip(zip)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map(entry => entry.name), ['00_封面.jpg', '01_第01页.jpg'])
  assert.equal(entries[0]?.method, 0)
  assert.equal(entries[1]?.method, 8)
  assert.deepEqual(readZipEntry(zip, entries[0]!), first)
  assert.deepEqual(readZipEntry(zip, entries[1]!), second)
})

test('uses latin1 only after fatal UTF-8 decoding and preserves a UTF-8 BOM', () => {
  const latinName = Buffer.from([0x30, 0x30, 0x5f, 0xe9, 0x2e, 0x6a, 0x70, 0x67])
  assert.equal(listZip(zipFixture([{ name: latinName, data: Buffer.from('x'), method: 0, flags: 0 }]))[0]?.name, '00_é.jpg')
  assert.throws(() => listZip(zipFixture([{ name: latinName, data: Buffer.from('x'), method: 0, flags: 0x800 }])), /invalid UTF-8/)

  const bomName = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('00_cover.jpg')])
  assert.equal(listZip(zipFixture([{ name: bomName, data: Buffer.from('x'), method: 0 }]))[0]?.name, '\ufeff00_cover.jpg')
})

test('ignores EOCD signatures embedded in the real EOCD comment', () => {
  const comment = Buffer.alloc(30)
  comment.writeUInt32LE(0x06054b50, 0)
  comment.writeUInt16LE(8, 20)
  const zip = zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0 }], comment)
  assert.equal(listZip(zip).length, 1)

  const maximumComment = Buffer.alloc(65_535, 0x61)
  assert.equal(listZip(zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0 }], maximumComment)).length, 1)
})

test('rejects malformed central directory metadata and unsafe features', () => {
  assert.throws(() => listZip(Buffer.alloc(21)), /end of central directory/)

  const encrypted = zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0, flags: 0x801 }])
  assert.throws(() => listZip(encrypted), /encrypted/)

  const unsupported = zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 12 }])
  assert.throws(() => listZip(unsupported), /unsupported zip method 12/)

  const unsupportedFlags = zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0, flags: 0x840 }])
  assert.throws(() => listZip(unsupportedFlags), /unsupported zip flags/)

  const multiDisk = Buffer.from(zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0 }]))
  const multiDiskEocd = multiDisk.length - 22
  multiDisk.writeUInt16LE(1, multiDiskEocd + 4)
  assert.throws(() => listZip(multiDisk), /end of central directory/)

  const zip64 = Buffer.from(zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0 }]))
  const zip64Eocd = zip64.length - 22
  zip64.writeUInt16LE(0xffff, zip64Eocd + 8)
  zip64.writeUInt16LE(0xffff, zip64Eocd + 10)
  assert.throws(() => listZip(zip64), /end of central directory/)

  const diskStart = Buffer.from(zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0 }]))
  const centralOffset = diskStart.readUInt32LE(diskStart.length - 22 + 16)
  diskStart.writeUInt16LE(1, centralOffset + 34)
  assert.throws(() => listZip(diskStart), /multi-disk/)

  const badCentral = Buffer.from(zipFixture([{ name: '00_cover.jpg', data: Buffer.from('x'), method: 0 }]))
  badCentral.writeUInt32LE(0, badCentral.readUInt32LE(badCentral.length - 22 + 16))
  assert.throws(() => listZip(badCentral), /end of central directory/)
})

test('rejects local-header mismatches, corrupt content, size excess, and suspicious ratios', () => {
  const zip = zipFixture([{ name: '00_cover.jpg', data: Buffer.from('A'), method: 0 }])
  const entry = listZip(zip)[0]!

  const badSignature = Buffer.from(zip)
  const badSignatureEntry = listZip(badSignature)[0]!
  badSignature.writeUInt32LE(0, badSignatureEntry.localHeaderOffset)
  assert.throws(() => readZipEntry(badSignature, badSignatureEntry), /local header signature/)

  const corrupt = Buffer.from(zip)
  const corruptEntry = listZip(corrupt)[0]!
  const dataOffset = corruptEntry.localHeaderOffset + 30 + Buffer.byteLength(corruptEntry.name)
  corrupt[dataOffset] = 'B'.charCodeAt(0)
  assert.throws(() => readZipEntry(corrupt, corruptEntry), /CRC mismatch/)

  const unsupported = { ...entry, method: 12 } as unknown as ZipEntry
  assert.throws(() => readZipEntry(zip, unsupported), /does not belong/)

  const oversized = listZip(zip)[0]!
  ;(oversized as unknown as { size: number }).size = 32 * 1024 * 1024 + 1
  assert.throws(() => readZipEntry(zip, oversized), /size limit/)

  const ratio = listZip(zip)[0]!
  ;(ratio as unknown as { compressedSize: number; size: number }).compressedSize = 1
  ;(ratio as unknown as { compressedSize: number; size: number }).size = 201
  assert.throws(() => readZipEntry(zip, ratio), /compression ratio/)
})
