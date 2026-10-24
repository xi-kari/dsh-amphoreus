import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, link, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const MAX_CHUNK_BYTES = 4 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u
const GIT_HEAD = /^[0-9a-f]{40}$/u
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u
const ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u

function identity(value) {
  if (value?.package !== 'dsh-amphoreus' || typeof value.version !== 'string' || !VERSION.test(value.version)
    || typeof value.originGitHead !== 'string' || !GIT_HEAD.test(value.originGitHead)) throw new Error('Invalid release package identity.')
  return { package: value.package, version: value.version, originGitHead: value.originGitHead }
}

function partName(version, index) { return `upload-v${version}.part-${String(index).padStart(4, '0')}` }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function isMissing(error) { return error?.code === 'ENOENT' }

async function regularFile(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file: ${path}`)
  return info
}

export function validateManifest(value) {
  const release = identity(value)
  if (value.schemaVersion !== 1 || typeof value.archive !== 'string' || !ARCHIVE_NAME.test(value.archive)
    || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
    || !Number.isSafeInteger(value.chunkBytes) || value.chunkBytes <= 0 || value.chunkBytes > MAX_CHUNK_BYTES
    || !Array.isArray(value.parts) || value.parts.length !== Math.ceil(value.bytes / value.chunkBytes)) {
    throw new Error('Invalid release chunk manifest.')
  }
  const parts = value.parts.map((part, index) => {
    const bytes = Math.min(value.chunkBytes, value.bytes - index * value.chunkBytes)
    if (part?.file !== partName(release.version, index) || part.bytes !== bytes
      || typeof part.sha256 !== 'string' || !SHA256.test(part.sha256)) throw new Error(`Invalid or unordered release part at index ${index}.`)
    return { file: part.file, bytes: part.bytes, sha256: part.sha256 }
  })
  return { schemaVersion: 1, ...release, archive: value.archive, bytes: value.bytes, sha256: value.sha256, chunkBytes: value.chunkBytes, parts }
}

function archiveIdentity(archive) {
  const result = spawnSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Cannot read release package identity: ${result.stderr}`)
  const manifest = JSON.parse(result.stdout)
  return identity({ package: manifest.name, version: manifest.version, originGitHead: manifest.gitHead })
}

export async function splitArchive({ archive, out, release, chunkBytes = MAX_CHUNK_BYTES }) {
  archive = resolve(archive); out = resolve(out)
  const info = await regularFile(archive)
  const identified = identity(release ?? archiveIdentity(archive))
  if (info.size <= 0 || !ARCHIVE_NAME.test(basename(archive)) || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > MAX_CHUNK_BYTES) throw new Error('Invalid archive size, filename, or chunk size.')
  try {
    const directory = await lstat(out)
    if (!directory.isDirectory() || directory.isSymbolicLink() || (await readdir(out)).length !== 0) throw new Error('Chunk output must be a new or empty regular directory.')
  } catch (error) { if (!isMissing(error)) throw error }
  await mkdir(out, { recursive: true })
  const input = await open(archive, 'r')
  const whole = createHash('sha256')
  const parts = []
  try {
    let position = 0
    while (position < info.size) {
      const bytes = Math.min(chunkBytes, info.size - position)
      const body = Buffer.allocUnsafe(bytes)
      let read = 0
      while (read < bytes) {
        const result = await input.read(body, read, bytes - read, position + read)
        if (result.bytesRead === 0) throw new Error('Release archive changed while splitting.')
        read += result.bytesRead
      }
      const file = partName(identified.version, parts.length)
      whole.update(body)
      await writeFile(join(out, file), body, { flag: 'wx' })
      parts.push({ file, bytes, sha256: digest(body) })
      position += bytes
    }
    const after = await input.stat()
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('Release archive changed while splitting.')
  } finally { await input.close() }
  const manifest = validateManifest({ schemaVersion: 1, ...identified, archive: basename(archive), bytes: info.size, sha256: whole.digest('hex'), chunkBytes, parts })
  const manifestPath = join(out, `upload-v${identified.version}.manifest.json`)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return { manifest: manifestPath, ...manifest }
}

export async function assembleArchive({ manifest, parts, out }) {
  manifest = resolve(manifest); parts = resolve(parts); out = resolve(out)
  await regularFile(manifest)
  const description = validateManifest(JSON.parse(await readFile(manifest, 'utf8')))
  const directory = await lstat(parts)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Release parts must be in a regular directory.')
  try { await lstat(out); throw new Error('Refusing to replace an existing assembled archive.') }
  catch (error) { if (!isMissing(error)) throw error }
  await mkdir(dirname(out), { recursive: true })
  const temporary = `${out}.${randomUUID()}.tmp`
  const output = await open(temporary, 'wx')
  let closed = false
  try {
    const whole = createHash('sha256')
    let position = 0
    for (const part of description.parts) {
      const source = join(parts, part.file)
      const info = await regularFile(source)
      if (info.size !== part.bytes) throw new Error(`Release part size mismatch: ${part.file}`)
      const body = await readFile(source)
      if (body.length !== part.bytes || digest(body) !== part.sha256) throw new Error(`Release part integrity mismatch: ${part.file}`)
      whole.update(body)
      let written = 0
      while (written < body.length) {
        const result = await output.write(body, written, body.length - written, position + written)
        if (result.bytesWritten === 0) throw new Error('Unable to write the assembled release.')
        written += result.bytesWritten
      }
      position += body.length
    }
    const sha256 = whole.digest('hex')
    if (position !== description.bytes || sha256 !== description.sha256) throw new Error('Assembled release does not match the original archive.')
    await output.sync()
    await output.close(); closed = true
    await link(temporary, out)
    return { archive: out, bytes: position, sha256 }
  } finally {
    if (!closed) await output.close()
    await unlink(temporary)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    archive: { type: 'string' }, out: { type: 'string' }, manifest: { type: 'string' }, parts: { type: 'string' },
  } })
  if (positionals.length !== 1 || !values.out) throw new Error('Usage: release-chunks.mjs split --archive <tgz> --out <directory> | assemble --manifest <json> --parts <directory> --out <tgz>')
  let result
  if (positionals[0] === 'split' && values.archive) {
    const split = await splitArchive({ archive: values.archive, out: values.out })
    result = { manifest: split.manifest, package: split.package, version: split.version, originGitHead: split.originGitHead, bytes: split.bytes, sha256: split.sha256, parts: split.parts.length }
  } else if (positionals[0] === 'assemble' && values.manifest && values.parts) {
    result = await assembleArchive({ manifest: values.manifest, parts: values.parts, out: values.out })
  } else throw new Error('Missing arguments for split or assemble.')
  console.log(JSON.stringify(result, null, 2))
}
