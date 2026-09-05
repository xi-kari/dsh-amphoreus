import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { createSeatPresetApplier, parseDefaultModelUser, sameModelSelection, type SeatPresetApplyDeps, type SeatPresetModel, type SeatPresetRemoteResult } from '../src/client/seat-preset-apply.ts'
import { decodeModelChoice, encodeModelChoice, withTier } from '../src/client/seat-preset-tiers.ts'
import { en, zh } from '../src/client/locales.ts'
import { isEmptySeatPreset, normalizeSeatPreset, SEAT_PERMISSION_PRESETS, type SeatPreset } from '../src/shared/seat-preset.ts'

const SESSION = 'session-00000000-0000-0000-0000-000000000041'
const SKILL = 'amphoreus-aglaea'
const DEFAULT_MODEL = { provider: 'deepseek', model: 'deepseek-chat' }
const SEAT_MODEL = { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }

const ok = <T>(value: T): SeatPresetRemoteResult<T> => ({ ok: true, value })
const fail = (code: string, message = code): SeatPresetRemoteResult<never> => ({ ok: false, error: { code, message } })

function harness(preset: SeatPreset | undefined, overrides: Partial<SeatPresetApplyDeps> = {}) {
  const calls: string[] = []
  const warnings: string[] = []
  const deps: SeatPresetApplyDeps = {
    presetOf: skill => skill === SKILL ? preset : undefined,
    selectModel: async request => { calls.push(`selectModel:${request.sessionId}:${request.provider}/${request.model}/${request.reasoningEffort ?? '-'}`); return ok({ selected: request }) },
    modelCatalog: async () => { calls.push('catalog'); return ok({ default: DEFAULT_MODEL, groups: [] }) },
    warn: message => { warnings.push(message) },
    ...overrides,
  }
  const applier = createSeatPresetApplier(deps)
  return { applier, calls, warnings }
}

/**
 * Fake platform for the model tier: `selectModel` rewrites the stored
 * 'agent-default-model' user section exactly like core/agent-default-model's
 * saveSelection (settings.replace → revision + 1 when the raw section changed),
 * and the settings faces describe/replace that document with revision checks.
 */
function platform(initialUser: SeatPresetModel | undefined, options: { readonly selectDelay?: () => Promise<void> } = {}) {
  const doc = { user: initialUser as SeatPresetModel | undefined, revision: 3 }
  const calls: string[] = []
  const write = (next: SeatPresetModel | undefined): void => {
    if (JSON.stringify(next ?? {}) === JSON.stringify(doc.user ?? {})) return
    doc.user = next
    doc.revision += 1
  }
  const deps: Partial<SeatPresetApplyDeps> = {
    selectModel: async request => {
      calls.push(`select:${request.sessionId}:${request.model}`)
      await options.selectDelay?.()
      write({ provider: request.provider, model: request.model, ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }) })
      return ok({ selected: request })
    },
    modelCatalog: async () => { calls.push('catalog'); return ok({ default: doc.user ?? DEFAULT_MODEL, groups: [] }) },
  }
  const faces = {
    describeDefaultModel: async () => { calls.push(`describe@${doc.revision}`); return ok({ user: doc.user, revision: doc.revision }) },
    restoreDefaultModel: async (section: SeatPresetModel | undefined, expectedRevision: number) => {
      calls.push(`restore:${section === undefined ? '{}' : section.model}@${expectedRevision}`)
      if (expectedRevision !== doc.revision) return fail('settings/conflict', `expected ${expectedRevision}, now ${doc.revision}`)
      write(section)
      return ok(undefined)
    },
  }
  return { doc, calls, deps, faces }
}

test('apply: no preset → nothing happens; agent preset runs before model; each tier is independent', async () => {
  const none = harness(undefined)
  await none.applier.apply(SESSION, SKILL)
  assert.deepEqual(none.calls, [])

  const full = harness({ agentPreset: 'standard', model: SEAT_MODEL, permission: 'read-only' })
  full.applier.attach({
    selectAgentPreset: async (sessionId, id) => { full.calls.push(`agentPreset:${sessionId}:${id}`); return ok(id) },
    describeDefaultModel: async () => { full.calls.push('describe'); return ok({ user: DEFAULT_MODEL, revision: 1 }) },
    restoreDefaultModel: async (section, revision) => { full.calls.push(`restore:${section?.provider}/${section?.model}@${revision}`); return ok(undefined) },
  })
  await full.applier.apply(SESSION, SKILL)
  assert.deepEqual(full.calls, [
    `agentPreset:${SESSION}:standard`,
    'describe',
    `selectModel:${SESSION}:deepseek/deepseek-reasoner/high`,
    'describe',
  ], 'a describe that reports an unchanged revision means the platform write was a no-op → nothing to restore')
  assert.deepEqual(full.warnings, [], 'permission is a host tier; nothing to warn about here')
})

test('apply: locked / unavailable agent preset refusals are silent, other refusals warn and the model tier still lands', async () => {
  for (const code of ['agent-preset/locked', 'gateway/invocation-unavailable']) {
    const h = harness({ agentPreset: 'standard', model: SEAT_MODEL })
    h.applier.attach({ selectAgentPreset: async () => fail(code) })
    await h.applier.apply(SESSION, SKILL)
    assert.deepEqual(h.warnings.filter(line => line.includes('agent preset')), [], code)
    assert.ok(h.calls.some(call => call.startsWith('selectModel:')), code)
  }
  const h = harness({ agentPreset: 'ghost' })
  h.applier.attach({ selectAgentPreset: async () => fail('agent-preset/not-found', 'no such preset') })
  await h.applier.apply(SESSION, SKILL)
  assert.equal(h.warnings.length, 1)
  assert.match(h.warnings[0]!, /agent preset "ghost" not applied \(agent-preset\/not-found\): no such preset/u)

  const detached = harness({ agentPreset: 'standard' })
  await detached.applier.apply(SESSION, SKILL)
  assert.deepEqual(detached.calls, [], 'without the remote.agentPresets face the tier is skipped')
})

test('apply: the stored default is described before selectModel and restored after it with the post-select revision; same selection restores nothing', async () => {
  const fake = platform(DEFAULT_MODEL)
  const h = harness({ model: SEAT_MODEL }, fake.deps)
  h.applier.attach(fake.faces)
  await h.applier.apply(SESSION, SKILL)
  assert.deepEqual(fake.calls, ['describe@3', `select:${SESSION}:deepseek-reasoner`, 'describe@4', 'restore:deepseek-chat@4'])
  assert.deepEqual(fake.doc, { user: DEFAULT_MODEL, revision: 5 }, 'the deployment default is back to the prior user section')
  assert.deepEqual(h.warnings, [])

  const same = platform(DEFAULT_MODEL)
  const sameH = harness({ model: DEFAULT_MODEL }, same.deps)
  sameH.applier.attach(same.faces)
  await sameH.applier.apply(SESSION, SKILL)
  assert.deepEqual(same.calls, ['describe@3', `select:${SESSION}:deepseek-chat`, 'describe@3'])
  assert.equal(same.doc.revision, 3)

  // No user layer before (composition default only): restore writes `{}` so the base re-applies instead of materializing a user entry.
  const base = platform(undefined)
  const baseH = harness({ model: SEAT_MODEL }, base.deps)
  baseH.applier.attach(base.faces)
  await baseH.applier.apply(SESSION, SKILL)
  assert.deepEqual(base.calls, ['describe@3', `select:${SESSION}:deepseek-reasoner`, 'describe@4', 'restore:{}@4'])
  assert.deepEqual(base.doc, { user: undefined, revision: 5 })

  const refused = harness({ model: SEAT_MODEL }, { selectModel: async () => fail('gateway/bad-request', 'unroutable') })
  refused.applier.attach({
    describeDefaultModel: async () => { refused.calls.push('describe'); return ok({ user: DEFAULT_MODEL, revision: 1 }) },
    restoreDefaultModel: async () => { refused.calls.push('restore'); return ok(undefined) },
  })
  await refused.applier.apply(SESSION, SKILL)
  assert.deepEqual(refused.calls, ['describe'])
  assert.match(refused.warnings[0]!, /model deepseek\/deepseek-reasoner not applied \(gateway\/bad-request\): unroutable/u)

  const noRestore = harness({ model: SEAT_MODEL })
  await noRestore.applier.apply(SESSION, SKILL)
  assert.deepEqual(noRestore.calls, [`selectModel:${SESSION}:deepseek/deepseek-reasoner/high`], 'no settings read when nothing can be restored')
  assert.equal(noRestore.applier.canRestoreDefaultModel(), false)
  assert.match(noRestore.warnings[0]!, /also made it the deployment default/u)

  const restoreFails = harness({ model: SEAT_MODEL })
  restoreFails.applier.attach({
    describeDefaultModel: async () => ok({ user: DEFAULT_MODEL, revision: restoreFails.calls.some(call => call.startsWith('selectModel')) ? 2 : 1 }),
    restoreDefaultModel: async () => fail('gateway/internal', 'settings provider offline'),
  })
  assert.equal(restoreFails.applier.canRestoreDefaultModel(), true)
  await restoreFails.applier.apply(SESSION, SKILL)
  assert.match(restoreFails.warnings[0]!, /could not be restored to deepseek\/deepseek-chat \(gateway\/internal\)/u)

  // Namespace not registered (describe → undefined): select still lands, restore is impossible → warn once.
  const unregistered = harness({ model: SEAT_MODEL })
  unregistered.applier.attach({ describeDefaultModel: async () => ok(undefined), restoreDefaultModel: async () => { unregistered.calls.push('restore'); return ok(undefined) } })
  await unregistered.applier.apply(SESSION, SKILL)
  assert.deepEqual(unregistered.calls, [`selectModel:${SESSION}:deepseek/deepseek-reasoner/high`])
  assert.match(unregistered.warnings[0]!, /cannot be restored/u)
})

test('apply: a third-party write between select and restore (revision moved by more than one) is left alone with a warning', async () => {
  const fake = platform(DEFAULT_MODEL, {
    selectDelay: async () => { fake.doc.user = { provider: 'other', model: 'user-picked' }; fake.doc.revision += 1 },
  })
  const h = harness({ model: SEAT_MODEL }, fake.deps)
  h.applier.attach(fake.faces)
  await h.applier.apply(SESSION, SKILL)
  assert.deepEqual(fake.calls, ['describe@3', `select:${SESSION}:deepseek-reasoner`, 'describe@5'])
  assert.equal(h.warnings.length, 1)
  assert.match(h.warnings[0]!, /moved from revision 3 to 5/u)
  assert.equal(fake.doc.user?.model, 'deepseek-reasoner', 'the applier never overwrites a write it cannot account for')
})

test('apply: concurrent seat starts (conference dispatch) serialize the model tier so the deployment default ends where it began', async () => {
  const gates: Array<() => void> = []
  const fake = platform(DEFAULT_MODEL, { selectDelay: () => new Promise<void>(resolve => { gates.push(resolve) }) })
  const presets: Record<string, SeatPreset> = {
    'seat-a': { model: { provider: 'deepseek', model: 'A' } },
    'seat-b': { model: { provider: 'deepseek', model: 'B' } },
  }
  const h = harness(undefined, { ...fake.deps, presetOf: skill => presets[skill] })
  h.applier.attach(fake.faces)
  const a = h.applier.apply('session-a', 'seat-a')
  const b = h.applier.apply('session-b', 'seat-b')
  // Let both chains progress as far as they can; only one select may be in flight.
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(gates.length, 1, 'the second seat waits for the first triple to finish')
  gates.shift()!()
  await a
  assert.deepEqual(fake.doc.user, DEFAULT_MODEL, 'default restored before the second seat reads it')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(gates.length, 1)
  gates.shift()!()
  await b
  assert.deepEqual(fake.doc.user, DEFAULT_MODEL, 'deployment default ended where it began, not as seat A or B')
  assert.deepEqual(fake.calls.filter(call => call.startsWith('restore')), ['restore:deepseek-chat@4', 'restore:deepseek-chat@6'])
  assert.deepEqual(h.warnings, [])

  // A failing link never blocks the next one in the same chain.
  const plain = platform(DEFAULT_MODEL)
  let failOnce = true
  const chain = harness(undefined, {
    ...plain.deps,
    presetOf: skill => presets[skill],
    selectModel: async request => {
      if (failOnce) { failOnce = false; throw new Error('transport down') }
      return plain.deps.selectModel!(request)
    },
  })
  chain.applier.attach(plain.faces)
  const failing = chain.applier.apply('session-c', 'seat-a')
  const following = chain.applier.apply('session-d', 'seat-b')
  await assert.rejects(failing, /transport down/u)
  await following
  assert.deepEqual(plain.doc.user, DEFAULT_MODEL)
  assert.deepEqual(plain.calls.filter(call => call.startsWith('select')), ['select:session-d:B'])
})

test('parseDefaultModelUser narrows the redacted user layer and rejects anything else', () => {
  assert.deepEqual(parseDefaultModelUser({ provider: 'deepseek', model: 'deepseek-chat' }), { provider: 'deepseek', model: 'deepseek-chat' })
  assert.deepEqual(parseDefaultModelUser({ provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high', extra: 1 }), { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' })
  assert.equal(parseDefaultModelUser(undefined), undefined)
  assert.equal(parseDefaultModelUser({}), undefined)
  assert.equal(parseDefaultModelUser({ provider: 'x' }), undefined)
  assert.equal(parseDefaultModelUser([1]), undefined)
  assert.equal(parseDefaultModelUser('deepseek'), undefined)
})

test('attach returns a detacher that only removes its own faces', async () => {
  const h = harness({ agentPreset: 'standard' })
  const first = async () => { h.calls.push('first'); return ok('standard') }
  const second = async () => { h.calls.push('second'); return ok('standard') }
  const detachFirst = h.applier.attach({ selectAgentPreset: first })
  h.applier.attach({ selectAgentPreset: second })
  detachFirst()
  await h.applier.apply(SESSION, SKILL)
  assert.deepEqual(h.calls, ['second'], 'detaching the superseded face keeps the live one')
})

test('directory: roster filters broken rows, unavailable namespaces read as empty, catalog failures read as undefined', async () => {
  const h = harness(undefined)
  assert.deepEqual(await h.applier.listAgentPresets(), [])
  h.applier.attach({
    listAgentPresets: async () => ok({ presets: [
      { id: 'standard', isDefault: true, name: 'Standard' },
      { id: 'broken', isDefault: false, broken: 'yaml parse error' },
      { id: 'minimal', isDefault: false },
    ] }),
  })
  assert.deepEqual(await h.applier.listAgentPresets(), [{ id: 'standard', isDefault: true, name: 'Standard' }, { id: 'minimal', isDefault: false }])
  h.applier.attach({ listAgentPresets: async () => fail('gateway/invocation-unavailable') })
  assert.deepEqual(await h.applier.listAgentPresets(), [])
  assert.deepEqual(h.warnings, [])
  h.applier.attach({ listAgentPresets: async () => fail('gateway/internal', 'boom') })
  assert.deepEqual(await h.applier.listAgentPresets(), [])
  assert.equal(h.warnings.length, 1)

  const catalog = harness(undefined, { modelCatalog: async () => ok({ default: DEFAULT_MODEL, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] }] }) })
  const read = await catalog.applier.modelCatalog()
  assert.deepEqual(read?.default, DEFAULT_MODEL)
  assert.equal(read?.groups[0]?.models[0]?.reasoning?.efforts[0]?.id, 'high')
  const gone = harness(undefined, { modelCatalog: async () => fail('gateway/invocation-unavailable') })
  assert.equal(await gone.applier.modelCatalog(), undefined)
  assert.deepEqual(gone.warnings, [])
})

test('tiers: encode/decode round-trips, withTier edits one tier and collapses to null when every tier is default', () => {
  assert.deepEqual(decodeModelChoice(encodeModelChoice('deepseek', 'deepseek-chat')), { provider: 'deepseek', model: 'deepseek-chat' })
  assert.equal(decodeModelChoice(''), undefined)
  assert.equal(decodeModelChoice('deepseek'), undefined)
  assert.deepEqual(withTier(undefined, 'agentPreset', 'standard'), { agentPreset: 'standard' })
  assert.equal(withTier({ agentPreset: 'standard' }, 'agentPreset', ''), null)
  assert.deepEqual(withTier({ agentPreset: 'standard' }, 'permission', 'read-only'), { agentPreset: 'standard', permission: 'read-only' })
  const withModel = withTier({ permission: 'read-only' }, 'model', encodeModelChoice('deepseek', 'deepseek-reasoner'))
  assert.deepEqual(withModel, { model: { provider: 'deepseek', model: 'deepseek-reasoner' }, permission: 'read-only' })
  const withEffort = withTier(withModel!, 'reasoningEffort', 'high')
  assert.deepEqual(withEffort?.model, { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' })
  assert.deepEqual(withTier(withEffort!, 'model', encodeModelChoice('deepseek', 'deepseek-chat'))?.model, { provider: 'deepseek', model: 'deepseek-chat' }, 'a model change drops the effort')
  assert.deepEqual(withTier(withEffort!, 'reasoningEffort', '')?.model, { provider: 'deepseek', model: 'deepseek-reasoner' })
  assert.equal(withTier({ model: { provider: 'deepseek', model: 'deepseek-reasoner' } }, 'model', ''), null)
  assert.deepEqual(withTier({ permission: 'read-only' }, 'reasoningEffort', 'high'), { permission: 'read-only' }, 'effort without a model is ignored')
  assert.equal(withTier(undefined, 'reasoningEffort', 'high'), null)
  assert.equal(isEmptySeatPreset({}), true)
  assert.deepEqual(normalizeSeatPreset({ agentPreset: undefined, model: { provider: 'a', model: 'b', reasoningEffort: undefined }, permission: undefined }), { model: { provider: 'a', model: 'b' } })
  assert.equal(sameModelSelection({ provider: 'a', model: 'b' }, { provider: 'a', model: 'b', reasoningEffort: undefined }), true)
  assert.equal(sameModelSelection({ provider: 'a', model: 'b' }, { provider: 'a', model: 'b', reasoningEffort: 'high' }), false)
  assert.deepEqual([...SEAT_PERMISSION_PRESETS], ['read-only', 'workspace-write', 'danger-full-access'])
})

test('assembly: applier is wired after the pinned seatDeps literal, remote faces arrive via ctx.inject scopes, settings panel is injected without ctx', () => {
  const index = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.match(index, /ctx\.inject\(\['remote\.agentPresets'\], scope => \{/u)
  assert.match(index, /ctx\.inject\(\['remote\.settings'\], scope => \{/u)
  assert.match(index, /scope\.remote\.settings\.describe\(\)/u)
  assert.match(index, /namespace\.ns === 'agent-default-model'/u)
  assert.match(index, /scope\.remote\.settings\.replace\('agent-default-model', \{[\s\S]*?\}, expectedRevision\)/u)
  assert.doesNotMatch(index, /replace\('agent-default-model'[\s\S]*?, undefined\)/u, 'the restore is never an unconditional write')
  const panel = readFileSync(new URL('../src/client/seat-preset-panel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /const restorable = directory\.canRestoreDefaultModel\(\)/u, 'restorable is read at render time, not cached in state')
  assert.doesNotMatch(panel, /restorable:/u)
  assert.match(index, /model\.presetDirectory = seatPresetApplier/u)
  assert.doesNotMatch(index, /'remote\.agentPresets'\s*\]\s*$/mu, 'the frozen inject array must not grow')
  const settings = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
  assert.match(settings, /<SeatPresetPanel[\s\S]*?directory=\{model\.presetDirectory\}[\s\S]*?onSave=\{\(skillName, preset\) => model\.setSeatPreset\(skillName, preset\)\}/u)
  assert.doesNotMatch(settings, /as SettingsAction/u, 'the panel owns its saving state; no value is cast into the pinned action union')
  assert.match(panel, /const \[saving, setSaving\] = useState\(false\)/u)
  const wallpaper = settings.indexOf('<WallpaperPanel')
  const panelAt = settings.indexOf('<SeatPresetPanel')
  const workbench = settings.indexOf('aria-labelledby="amphoreus-workbench"')
  assert.ok(wallpaper < panelAt && panelAt < workbench)
  const component = readFileSync(new URL('../src/client/seat-preset-panel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(component, /\bctx\b/u)
  assert.match(component, /aria-labelledby="amphoreus-seat-presets"/u)
  const css = readFileSync(new URL('../src/client/seat-preset-panel.module.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/iu)
  for (const declaration of css.matchAll(/(?:color|background|border|border-left-color|outline):\s*([^;]+);/gu)) {
    assert.match(declaration[1]!, /var\(--dsw-|var\(--amph-seat-accent, var\(--dsw-|transparent|^0$|solid (?:transparent|var\(--dsw-)/u, declaration[0])
  }
  const presetKeys = Object.keys(zh).filter(key => key.startsWith('settings.preset'))
  assert.ok(presetKeys.length >= 15)
  for (const key of presetKeys) assert.equal(typeof en[key as keyof typeof en], 'string', key)
  assert.equal(zh['settings.presetModelWarning'], '会同时改写全局默认模型')
  const clientDir = new URL('../src/client/', import.meta.url)
  for (const name of readdirSync(clientDir).filter(file => file.startsWith('seat-preset'))) {
    const source = readFileSync(new URL(name, clientDir), 'utf8')
    for (const statement of source.matchAll(/^import[\s\S]*?from\s+['"](@deepseek-ai\/[^'"]+)['"]$/gmu)) assert.match(statement[0], /^import type\b/u, `${name}: ${statement[1]}`)
  }
})
