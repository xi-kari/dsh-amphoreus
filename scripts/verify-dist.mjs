import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORM_MODULES } from '../tsdown.config.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_OUTPUTS = [
  'lib/index.js',
  'lib/client.js',
  'lib/derive.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
]
const EXPECTED_TOP_LEVEL_JS = ['client.js', 'derive.js', 'index.js']
const ALLOWED_TARBALL_PATH = /^(?:LICENSE|NOTICE|README\.md|cordis\.patch\.yml|package\.json|lib\/(?:index|client|derive)\.js(?:\.map)?|lib\/types\/.+\.d\.ts|workbench\/(?:app\.js|styles\.css|mark\.svg)|scripts\/derive-assets\.mjs)$/u
const FORBIDDEN_MEDIA = /\.(?:png|jpe?g|webp|gif|zip|svgz)$/iu
const FORBIDDEN_PACKAGE_PATH = /^(?:src|tests|reference|docs)\/|(?:^|\/)(?:SKILL\.md|persona\.md|common\.md|relations\.md|HANDOFF\.md|\.npmrc|package-lock\.json)$/u

let checks = 0
const failures = []

function check(condition, reason) {
  checks += 1
  if (!condition) failures.push(reason)
}

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
}

function packageNameOf(specifier) {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
      throw new Error(`invalid scoped package specifier ${JSON.stringify(specifier)}`)
    }
    return `${parts[0]}/${parts[1]}`
  }
  if (parts[0] === '') throw new Error(`invalid package specifier ${JSON.stringify(specifier)}`)
  return parts[0]
}

function hostSpecifiers(source, file) {
  const fromImports = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/gu)].map(match => match[1])
  const sideEffectImports = [...source.matchAll(/\bimport\s*["']([^"']+)["']/gu)].map(match => match[1])
  const dynamicImports = [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)].map(match => match[1])
  const allDynamicImports = [...source.matchAll(/\bimport\s*\(/gu)]
  check(
    allDynamicImports.length === dynamicImports.length,
    `${file} contains a non-literal dynamic import()`,
  )
  return [...fromImports, ...sideEffectImports, ...dynamicImports]
}

function verifyHostPurity(file, manifest) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  for (const specifier of hostSpecifiers(read(file), file)) {
    if (specifier.startsWith('node:') || specifier.startsWith('.')) continue
    const packageName = packageNameOf(specifier)
    check(
      declared.has(packageName),
      `${file} imports undeclared package ${JSON.stringify(packageName)} via ${JSON.stringify(specifier)}`,
    )
  }
}

function verifyClient(client, manifest) {
  const literalRequires = [
    ...client.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map(match => match[1])
  const allRequires = [...client.matchAll(/\brequire\s*\(/gu)]
  check(
    allRequires.length === literalRequires.length,
    'lib/client.js contains a non-literal require()',
  )
  for (const specifier of literalRequires) {
    check(
      PLATFORM_MODULES.includes(specifier),
      `lib/client.js requires non-platform module ${JSON.stringify(specifier)}`,
    )
  }

  check(
    client.startsWith('window.__ModuleLoader__.load({'),
    'lib/client.js does not start with the ModuleLoader wrapper',
  )
  const loaderId = /window\.__ModuleLoader__\.load\(\{\s*id:\s*["']([^"']+)["']/u.exec(client)?.[1]
  check(loaderId !== undefined, 'lib/client.js loader id is missing')
  check(
    loaderId === manifest.name,
    `lib/client.js loader id ${JSON.stringify(loaderId)} does not match package name ${JSON.stringify(manifest.name)}`,
  )

  const withoutSourceMap = client
    .trimEnd()
    .replace(/\/\/# sourceMappingURL=.*$/u, '')
    .trimEnd()
  check(withoutSourceMap.endsWith('});'), 'lib/client.js does not close the ModuleLoader wrapper')
  const normalizedFooter = withoutSourceMap.replace(/\s+/gu, ' ')
  check(
    normalizedFooter.includes('return module.exports; } });'),
    'lib/client.js footer does not return module.exports and close the factory/loader',
  )
}

function packDryRun() {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm pack --dry-run --ignore-scripts --json']
    : ['pack', '--dry-run', '--ignore-scripts', '--json']
  const output = execFileSync(
    command,
    args,
    {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    },
  )
  const jsonStart = output.indexOf('[')
  if (jsonStart < 0) throw new Error('npm pack output did not contain a JSON array')
  const parsed = JSON.parse(output.slice(jsonStart))
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'object' || parsed[0] === null) {
    throw new Error('npm pack returned no package description')
  }
  return parsed[0]
}

function verifyTarball() {
  const packed = packDryRun()
  check(Array.isArray(packed.files), 'npm pack package description has no files array')
  const files = Array.isArray(packed.files) ? packed.files : []
  check(files.length > 0, 'npm pack produced an empty file list')
  for (const entry of files) {
    const originalPath = typeof entry?.path === 'string' ? entry.path : ''
    check(originalPath !== '', 'npm pack returned a file without a path')
    if (originalPath === '') continue
    const path = originalPath.replaceAll('\\', '/')
    check(ALLOWED_TARBALL_PATH.test(path), `tarball path is not allowed: ${path}`)
    check(!FORBIDDEN_MEDIA.test(path), `tarball contains forbidden media: ${path}`)
    check(!FORBIDDEN_PACKAGE_PATH.test(path), `tarball contains forbidden source/private path: ${path}`)
    check(
      !path.startsWith('scripts/') || path === 'scripts/derive-assets.mjs',
      `tarball contains non-runtime script: ${path}`,
    )
  }
  check(
    Number.isFinite(packed.unpackedSize) && packed.unpackedSize < 2_000_000,
    `tarball unpackedSize ${String(packed.unpackedSize)} is not below 2000000`,
  )
}

function main() {
  const manifest = JSON.parse(read('package.json'))
  check(typeof manifest.name === 'string' && manifest.name !== '', 'package.json name is missing')

  for (const relativePath of REQUIRED_OUTPUTS) {
    check(existsSync(resolve(ROOT, relativePath)), `required output is missing: ${relativePath}`)
  }
  const topLevelJs = readdirSync(resolve(ROOT, 'lib'))
    .filter(name => extname(name) === '.js')
    .sort()
  check(
    JSON.stringify(topLevelJs) === JSON.stringify(EXPECTED_TOP_LEVEL_JS),
    `lib/*.js must be exactly ${EXPECTED_TOP_LEVEL_JS.join(', ')}; got ${topLevelJs.join(', ')}`,
  )

  verifyHostPurity('lib/index.js', manifest)
  verifyHostPurity('lib/derive.js', manifest)
  verifyClient(read('lib/client.js'), manifest)
  verifyTarball()

  if (failures.length > 0) {
    for (const reason of failures) console.error(`verify-dist: FAIL ${reason}`)
    process.exitCode = 1
    return
  }
  console.log(`verify-dist: OK ${checks} checks`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`verify-dist: FAIL ${message}`)
  process.exitCode = 1
}
