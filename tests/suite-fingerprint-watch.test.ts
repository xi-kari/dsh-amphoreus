import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  computeSuiteFingerprint,
  FingerprintCache,
  isSuiteWatchPath,
  suiteManifestPaths,
} from '../src/host/suite/fingerprint.ts'
import { SuiteWatcher } from '../src/host/suite/watch.ts'

test('suite fingerprint: runtime manifest is sorted, content keyed, persona-aware and eval-blind', async t => {
  const root = await createFixture()
  t.after(async () => removeFixture(root))
  const cache = new FingerprintCache()
  const options = { cache, computedAt: 42, gitBin: 'fixture-git-does-not-exist' }

  const paths = await suiteManifestPaths(root)
  assert.deepEqual(paths, [...paths].sort())
  assert.equal(paths.some(path => path.includes('/evals/')), false)
  assert.ok(paths.includes('amphoreus-testcard-a/persona.md'))

  const first = await computeSuiteFingerprint(root, options)
  const second = await computeSuiteFingerprint(root, options)
  assert.equal(first.manifestSha256, second.manifestSha256)
  assert.equal(first.statDigest, second.statDigest)
  assert.equal(first.computedAt, 42)
  assert.match(first.label, /^sha256:[0-9a-f]{12}$/)
  assert.equal(first.fileCount, 7)

  await writeFile(join(root, 'amphoreus', 'evals', 'scenario.md'), 'changed but excluded', 'utf8')
  const afterEval = await computeSuiteFingerprint(root, options)
  assert.equal(afterEval.manifestSha256, first.manifestSha256)
  assert.equal(afterEval.statDigest, first.statDigest)

  const commonPath = join(root, 'amphoreus', 'references', 'common.md')
  const common = await readFile(commonPath, 'utf8')
  const future = new Date(Date.now() + 20_000)
  await utimes(commonPath, future, future)
  assert.equal(await readFile(commonPath, 'utf8'), common)
  const touched = await computeSuiteFingerprint(root, options)
  assert.equal(touched.manifestSha256, first.manifestSha256)
  assert.notEqual(touched.statDigest, first.statDigest)

  await writeFile(join(root, 'amphoreus-testcard-a', 'persona.md'), '# changed fictional persona\n', 'utf8')
  const personaChanged = await computeSuiteFingerprint(root, options)
  assert.notEqual(personaChanged.manifestSha256, touched.manifestSha256)

  await unlink(join(root, 'amphoreus-testcard-a', 'persona.md'))
  const personaMissing = await computeSuiteFingerprint(root, options)
  assert.notEqual(personaMissing.manifestSha256, personaChanged.manifestSha256)
  assert.equal(personaMissing.fileCount, personaChanged.fileCount)
  assert.equal(personaMissing.manifest?.find(entry => entry.rel.endsWith('/persona.md'))?.sha256, 'MISSING')
})

test('suite fingerprint: adding a fictional card adds SKILL and missing persona records', async t => {
  const root = await createFixture()
  t.after(async () => removeFixture(root))
  const before = await computeSuiteFingerprint(root, { gitBin: 'fixture-git-does-not-exist' })
  await mkdir(join(root, 'amphoreus-testcard-b'))
  await writeFile(join(root, 'amphoreus-testcard-b', 'SKILL.md'), '---\nname: amphoreus-testcard-b\ndescription: fixture\n---\n', 'utf8')
  const after = await computeSuiteFingerprint(root, { gitBin: 'fixture-git-does-not-exist' })
  assert.equal(after.fileCount, before.fileCount + 2)
  assert.notEqual(after.manifestSha256, before.manifestSha256)
  assert.equal(after.manifest?.find(entry => entry.rel === 'amphoreus-testcard-b/persona.md')?.sha256, 'MISSING')
})

test('SuiteWatcher poll mode requires a stable second sample, ignores touch-only content identity, and invalidates after reparse', async t => {
  const root = await createFixture()
  t.after(async () => removeFixture(root))
  const cache = new FingerprintCache()
  const initial = await computeSuiteFingerprint(root, { cache, gitBin: 'fixture-git-does-not-exist' })
  const events: string[] = []
  const watcher = new SuiteWatcher({
    root,
    config: { mode: 'poll', pollMs: 60_000, debounceMs: 5 },
    initialFingerprint: initial,
    cache,
    fingerprint: { gitBin: 'fixture-git-does-not-exist' },
    onReparse: async (_fingerprint, reason) => { events.push(`reparse:${reason}`) },
    invalidate: () => { events.push('invalidate') },
  })
  t.after(async () => watcher.close())
  await watcher.start()
  assert.equal(watcher.mode, 'poll')

  const skill = join(root, 'amphoreus-testcard-a', 'SKILL.md')
  await writeFile(skill, `${await readFile(skill, 'utf8')}\nchanged\n`, 'utf8')
  await watcher.pollNow()
  assert.deepEqual(events, [])
  await watcher.pollNow()
  assert.deepEqual(events, ['reparse:poll', 'invalidate'])

  const future = new Date(Date.now() + 30_000)
  await utimes(skill, future, future)
  await watcher.pollNow()
  await watcher.pollNow()
  assert.deepEqual(events, ['reparse:poll', 'invalidate'])

  await watcher.forceReparse()
  assert.deepEqual(events, ['reparse:poll', 'invalidate', 'reparse:forced', 'invalidate'])
})

test('SuiteWatcher falls back from recursive fs watch to poll and filters unrelated paths', async t => {
  const root = await createFixture()
  t.after(async () => removeFixture(root))
  const modeChanges: string[] = []
  const watcher = new SuiteWatcher({
    root,
    config: { mode: 'fs', pollMs: 60_000, debounceMs: 5 },
    fingerprint: { gitBin: 'fixture-git-does-not-exist' },
    watchFactory: () => { throw new Error('recursive watch unavailable') },
    onReparse: () => {},
    invalidate: () => {},
    onModeChange: (mode, detail) => modeChanges.push(`${mode}:${detail}`),
  })
  t.after(async () => watcher.close())
  await watcher.start()
  assert.equal(watcher.mode, 'poll')
  assert.ok(modeChanges.some(entry => entry.startsWith('poll:')))

  assert.equal(isSuiteWatchPath('amphoreus/SKILL.md'), true)
  assert.equal(isSuiteWatchPath('amphoreus-testcard-a/persona.md'), true)
  assert.equal(isSuiteWatchPath('unrelated/SKILL.md'), false)
  assert.equal(isSuiteWatchPath(null), true)
})

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-amphoreus-fingerprint-'))
  await mkdir(join(root, 'amphoreus', 'references'), { recursive: true })
  await mkdir(join(root, 'amphoreus', 'scripts'), { recursive: true })
  await mkdir(join(root, 'amphoreus', 'evals'), { recursive: true })
  await mkdir(join(root, 'amphoreus-testcard-a'), { recursive: true })
  await writeFile(join(root, 'amphoreus', 'SKILL.md'), '---\nname: amphoreus\ndescription: fixture\n---\n', 'utf8')
  await writeFile(join(root, 'amphoreus', 'references', 'common.md'), '# common\n', 'utf8')
  await writeFile(join(root, 'amphoreus', 'references', 'relations.md'), '# relations\n', 'utf8')
  await writeFile(join(root, 'amphoreus', 'references', 'extra.md'), '# extra runtime reference\n', 'utf8')
  await writeFile(join(root, 'amphoreus', 'scripts', 'validate.py'), 'print("fixture")\n', 'utf8')
  await writeFile(join(root, 'amphoreus', 'evals', 'scenario.md'), 'excluded\n', 'utf8')
  await writeFile(join(root, 'amphoreus-testcard-a', 'SKILL.md'), '---\nname: amphoreus-testcard-a\ndescription: fixture\n---\n', 'utf8')
  await writeFile(join(root, 'amphoreus-testcard-a', 'persona.md'), '# fictional persona\n', 'utf8')
  return resolve(root)
}

async function removeFixture(root: string): Promise<void> {
  const resolved = resolve(root)
  const expected = resolve(tmpdir())
  assert.ok(resolved.startsWith(`${expected}\\`) || resolved.startsWith(`${expected}/`))
  assert.match(resolved, /dsh-amphoreus-fingerprint-/)
  await rm(resolved, { recursive: true, force: true })
}
