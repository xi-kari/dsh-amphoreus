/**
 * Root discovery tests for src/host/suite/roots.ts. expandRootPath is pure
 * over an injected RootEnv; the resolve/select functions run against real
 * temp directories holding fictional card names only.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  expandRootPath, resolveRoots, probeRoot, selectPrimaryRoot, type RootEnv,
} from '../src/host/suite/roots.ts'

const FAKE_HOME = process.platform === 'win32' ? 'C:\\fake\\home' : '/fake/home'
const FAKE_DSH = process.platform === 'win32' ? 'C:\\fake\\dsh-home' : '/fake/dsh-home'

function fakeEnv(env: Record<string, string | undefined> = {}): RootEnv {
  return { env, homedir: () => FAKE_HOME, dshHome: FAKE_DSH }
}

// --- expandRootPath ----------------------------------------------------------

test('expandRootPath: tilde forms resolve against homedir', () => {
  const a = expandRootPath('~/.claude/skills', fakeEnv())
  assert.equal(a.kind, 'ok')
  if (a.kind === 'ok') assert.equal(a.expanded, join(FAKE_HOME, '.claude/skills'))
  const b = expandRootPath('~\\.codex\\skills', fakeEnv())
  assert.equal(b.kind, 'ok')
  if (b.kind === 'ok') assert.equal(b.expanded, join(FAKE_HOME, '.codex\\skills'))
  const bare = expandRootPath('~', fakeEnv())
  assert.equal(bare.kind, 'ok')
  if (bare.kind === 'ok') assert.equal(bare.expanded, FAKE_HOME)
})

test('expandRootPath: $DSH_HOME / ${DSH_HOME} / %DSH_HOME% use the resolved home, not raw env', () => {
  // Even when the raw env var points elsewhere, the injected resolved value wins.
  const renv = fakeEnv({ DSH_HOME: 'D:\\wrong\\raw\\value' })
  for (const form of ['$DSH_HOME/skills', '${DSH_HOME}/skills', '%DSH_HOME%/skills']) {
    const result = expandRootPath(form, renv)
    assert.equal(result.kind, 'ok')
    if (result.kind === 'ok') assert.ok(result.expanded.startsWith(FAKE_DSH), `${form} → ${result.expanded}`)
  }
})

test('expandRootPath: %VAR% and $VAR from env; USERPROFILE/HOME fall back to homedir', () => {
  const withVar = expandRootPath('%MY_ROOT%\\skills', fakeEnv({ MY_ROOT: 'D:\\roots' }))
  assert.equal(withVar.kind, 'ok')
  if (withVar.kind === 'ok') assert.equal(withVar.expanded, 'D:\\roots\\skills')
  const profile = expandRootPath('%USERPROFILE%\\.codex\\skills', fakeEnv())
  assert.equal(profile.kind, 'ok')
  if (profile.kind === 'ok') assert.equal(profile.expanded, join(FAKE_HOME, '.codex\\skills'))
})

test('expandRootPath: unset variable and empty entry are rejected', () => {
  const unset = expandRootPath('${UNDEFINED_X}/skills', fakeEnv())
  assert.equal(unset.kind, 'var-unset')
  if (unset.kind === 'var-unset') assert.equal(unset.variable, 'UNDEFINED_X')
  assert.equal(expandRootPath('   ', fakeEnv()).kind, 'empty')
})

test('expandRootPath: relative paths resolve against DSH home, never cwd', () => {
  const rel = expandRootPath('./relative', fakeEnv())
  assert.equal(rel.kind, 'ok')
  if (rel.kind === 'ok') assert.equal(rel.expanded, resolve(FAKE_DSH, './relative'))
  // `~user` is unsupported → literal, hence relative → resolves under DSH home.
  const user = expandRootPath('~someone/skills', fakeEnv())
  assert.equal(user.kind, 'ok')
  if (user.kind === 'ok') assert.ok(user.expanded.startsWith(FAKE_DSH + sep))
})

// --- filesystem-backed: resolveRoots / probeRoot / selectPrimaryRoot ---------

/** Build a fictional suite skeleton under dir: router + n cards. */
function writeSuite(dir: string, options: { router?: 'ok' | 'bad-name' | 'no-frontmatter' | 'absent'; cards?: string[] } = {}): void {
  const { router = 'ok', cards = [] } = options
  if (router !== 'absent') {
    mkdirSync(join(dir, 'amphoreus'), { recursive: true })
    const front = router === 'ok'
      ? '---\nname: amphoreus\ndescription: 试验路由\n---\n'
      : router === 'bad-name'
        ? '---\nname: amphoreus-wrong\ndescription: 试验路由\n---\n'
        : ''
    writeFileSync(join(dir, 'amphoreus', 'SKILL.md'), `${front}# 路由正文\n`)
  }
  for (const card of cards) {
    mkdirSync(join(dir, card), { recursive: true })
    writeFileSync(join(dir, card, 'SKILL.md'), `---\nname: ${card}\ndescription: 试验卡\n---\n正文\n`)
  }
}

test('resolveRoots + selectPrimaryRoot end to end', async t => {
  const base = mkdtempSync(join(tmpdir(), 'amph-roots-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const rootA = join(base, 'root-a')
  const rootB = join(base, 'root-b')
  mkdirSync(rootA)
  mkdirSync(rootB)
  writeSuite(rootA, { cards: ['amphoreus-testcard-a'] })
  writeSuite(rootB, { cards: ['amphoreus-testcard-b'] })

  const renv: RootEnv = { env: {}, homedir: () => base, dshHome: base }
  const resolved = await resolveRoots(
    [rootA, rootB, rootA, join(base, 'missing'), '${UNDEFINED_X}/x', ''],
    renv,
  )
  // Duplicate rootA deduped; missing kept (watcher may see it appear); two dropped.
  assert.deepEqual(resolved.roots.map(r => r.index), [0, 1, 3])
  assert.deepEqual(
    resolved.diagnostics.map(d => d.code).sort(),
    ['root-missing', 'root-unexpandable', 'root-unexpandable'],
  )

  const selection = await selectPrimaryRoot(resolved.roots)
  assert.equal(selection.primaryKind, 'router')
  assert.equal(selection.primary!.index, 0)
  assert.deepEqual(selection.standby.map(r => r.index), [1])
})

test('probeRoot distinguishes valid, missing, and invalid router cards', async t => {
  const base = mkdtempSync(join(tmpdir(), 'amph-probe-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [name, router] of [['ok', 'ok'], ['bad', 'bad-name'], ['nofm', 'no-frontmatter'], ['none', 'absent']] as const) {
    const dir = join(base, name)
    mkdirSync(dir)
    writeSuite(dir, { router })
  }
  const rootOf = (name: string) => ({ index: 0, configured: name, expanded: join(base, name), canonical: join(base, name) })
  assert.equal((await probeRoot(rootOf('ok'))).kind, 'router-valid')
  assert.equal((await probeRoot(rootOf('bad'))).kind, 'router-invalid')
  assert.equal((await probeRoot(rootOf('nofm'))).kind, 'router-invalid')
  assert.equal((await probeRoot(rootOf('none'))).kind, 'router-missing')
  assert.equal((await probeRoot(rootOf('never-created'))).kind, 'not-a-directory')
})

test('selectPrimaryRoot: cards-only fallback when no root has a router card', async t => {
  const base = mkdtempSync(join(tmpdir(), 'amph-fallback-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const empty = join(base, 'empty')
  const cardsOnly = join(base, 'cards-only')
  mkdirSync(empty)
  mkdirSync(cardsOnly)
  writeSuite(cardsOnly, { router: 'absent', cards: ['amphoreus-testcard-a'] })

  const rootOf = (dir: string, index: number) => ({ index, configured: dir, expanded: dir, canonical: dir })
  const selection = await selectPrimaryRoot([rootOf(empty, 0), rootOf(cardsOnly, 1)])
  assert.equal(selection.primaryKind, 'cards-only')
  assert.equal(selection.primary!.canonical, cardsOnly)
  assert.ok(selection.diagnostics.some(d => d.code === 'router-missing'))
})

test('selectPrimaryRoot: bad router frontmatter demotes the root but keeps its cards usable', async t => {
  const base = mkdtempSync(join(tmpdir(), 'amph-demote-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'root')
  mkdirSync(root)
  writeSuite(root, { router: 'bad-name', cards: ['amphoreus-testcard-a'] })

  const selection = await selectPrimaryRoot([{ index: 0, configured: root, expanded: root, canonical: root }])
  assert.equal(selection.primaryKind, 'cards-only')
  assert.ok(selection.diagnostics.some(d => d.code === 'router-frontmatter-invalid'))
})

test('selectPrimaryRoot: nothing valid anywhere → no primary', async t => {
  const base = mkdtempSync(join(tmpdir(), 'amph-none-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const empty = join(base, 'empty')
  mkdirSync(empty)
  const selection = await selectPrimaryRoot([{ index: 0, configured: empty, expanded: empty, canonical: empty }])
  assert.equal(selection.primary, undefined)
  assert.equal(selection.primaryKind, undefined)
})
