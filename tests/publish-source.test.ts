import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

const guard = fileURLToPath(new URL('../scripts/check-publish.mjs', import.meta.url))
const npmPath = process.env.npm_execpath ?? [
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].find(path => existsSync(path))

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function check(root: string, npmExecPath = npmPath) {
  const env = { ...process.env }
  if (npmExecPath === undefined) delete env.npm_execpath
  else env.npm_execpath = npmExecPath
  return spawnSync(process.execPath, [guard], { cwd: root, env, encoding: 'utf8' })
}

async function prepared(root: string) {
  assert.ok(npmPath, 'Use npm test or a Node installation that includes npm')
  const PackageJson = createRequire(npmPath)('@npmcli/package-json')
  const pkg = await PackageJson.fix(root)
  return (await pkg.prepare()).content
}

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-publish-source-'))
  t.after(async () => {
    const rel = relative(resolve(tmpdir()), resolve(base))
    assert.ok(!isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith('dsh-publish-source-'))
    await rm(base, { recursive: true, force: true })
  })
  const root = join(base, 'ordinary-repo')
  await mkdir(root)
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.name', 'Publish fixture')
  git(root, 'config', 'user.email', 'publish-fixture@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'config', 'core.hooksPath', join(base, 'empty-hooks'))
  await mkdir(join(base, 'empty-hooks'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'publish-source-fixture', version: '1.0.0', description: 'Fixture', license: 'MIT',
  }, null, 2) + '\n')
  await writeFile(join(root, 'README.md'), '# Fixture\n')
  git(root, 'add', 'package.json', 'README.md')
  git(root, 'commit', '--quiet', '-m', 'Fixture')
  return { root, base, head: git(root, 'rev-parse', 'HEAD') }
}

test('publish guard accepts the actual npm-prepared gitHead of a clean ordinary repository without writing files', async t => {
  const { root, head } = await fixture(t)
  const before = await readFile(join(root, 'package.json'))
  assert.equal((await prepared(root)).gitHead, head)
  const result = check(root)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes(`gitHead=${head}`), result.stdout)
  assert.deepEqual(await readFile(join(root, 'package.json')), before)
  assert.equal(git(root, 'status', '--porcelain=v1'), '')
})

test('publish guard follows the actual npm-prepared gitHead in a linked worktree', async t => {
  const { root, base, head } = await fixture(t)
  const worktree = join(base, 'linked-worktree')
  git(root, 'worktree', 'add', '--quiet', '--detach', worktree, head)
  assert.equal((await lstat(join(worktree, '.git'))).isFile(), true)
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), head)
  const before = await readFile(join(worktree, 'package.json'))
  const actual = (await prepared(worktree)).gitHead
  t.diagnostic(`npm prepared linked-worktree gitHead: ${JSON.stringify(actual ?? null)}`)
  const result = check(worktree)
  if (actual === head) {
    assert.equal(result.status, 0, result.stderr)
  } else {
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stderr, /npm prepared gitHead/)
    assert.match(result.stderr, /ordinary git clone/)
  }
  assert.deepEqual(await readFile(join(worktree, 'package.json')), before)
  assert.equal(git(worktree, 'status', '--porcelain=v1'), '')
})

test('publish guard fails closed without the invoking npm location', async t => {
  const { root } = await fixture(t)
  const result = check(root, '')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /npm_execpath is unavailable/)
})
