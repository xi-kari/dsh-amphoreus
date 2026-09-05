import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { createSeatPresetApplier, sameModelSelection, type SeatPresetApplyDeps, type SeatPresetRemoteResult } from '../src/client/seat-preset-apply.ts'
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

test('apply: no preset → nothing happens; agent preset runs before model; each tier is independent', async () => {
  const none = harness(undefined)
  await none.applier.apply(SESSION, SKILL)
  assert.deepEqual(none.calls, [])

  const full = harness({ agentPreset: 'standard', model: SEAT_MODEL, permission: 'read-only' })
  full.applier.attach({
    selectAgentPreset: async (sessionId, id) => { full.calls.push(`agentPreset:${sessionId}:${id}`); return ok(id) },
    restoreDefaultModel: async selection => { full.calls.push(`restore:${selection.provider}/${selection.model}`); return ok(undefined) },
  })
  await full.applier.apply(SESSION, SKILL)
  assert.deepEqual(full.calls, [
    `agentPreset:${SESSION}:standard`,
    'catalog',
    `selectModel:${SESSION}:deepseek/deepseek-reasoner/high`,
    'restore:deepseek/deepseek-chat',
  ])
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

test('apply: the deployment default model is read before selectModel and restored after it; same selection restores nothing', async () => {
  const h = harness({ model: SEAT_MODEL })
  h.applier.attach({ restoreDefaultModel: async selection => { h.calls.push(`restore:${selection.provider}/${selection.model}/${selection.reasoningEffort ?? '-'}`); return ok(undefined) } })
  await h.applier.apply(SESSION, SKILL)
  assert.deepEqual(h.calls, ['catalog', `selectModel:${SESSION}:deepseek/deepseek-reasoner/high`, 'restore:deepseek/deepseek-chat/-'])

  const same = harness({ model: DEFAULT_MODEL })
  same.applier.attach({ restoreDefaultModel: async () => { same.calls.push('restore'); return ok(undefined) } })
  await same.applier.apply(SESSION, SKILL)
  assert.deepEqual(same.calls, ['catalog', `selectModel:${SESSION}:deepseek/deepseek-chat/-`])

  const refused = harness({ model: SEAT_MODEL }, { selectModel: async () => fail('gateway/bad-request', 'unroutable') })
  refused.applier.attach({ restoreDefaultModel: async () => { refused.calls.push('restore'); return ok(undefined) } })
  await refused.applier.apply(SESSION, SKILL)
  assert.deepEqual(refused.calls, ['catalog'])
  assert.match(refused.warnings[0]!, /model deepseek\/deepseek-reasoner not applied \(gateway\/bad-request\): unroutable/u)

  const noRestore = harness({ model: SEAT_MODEL })
  await noRestore.applier.apply(SESSION, SKILL)
  assert.deepEqual(noRestore.calls, [`selectModel:${SESSION}:deepseek/deepseek-reasoner/high`], 'no catalog read when nothing can be restored')
  assert.equal(noRestore.applier.canRestoreDefaultModel(), false)
  assert.match(noRestore.warnings[0]!, /also made it the deployment default/u)

  const restoreFails = harness({ model: SEAT_MODEL })
  restoreFails.applier.attach({ restoreDefaultModel: async () => fail('gateway/internal', 'settings provider offline') })
  assert.equal(restoreFails.applier.canRestoreDefaultModel(), true)
  await restoreFails.applier.apply(SESSION, SKILL)
  assert.match(restoreFails.warnings[0]!, /could not be restored to deepseek\/deepseek-chat \(gateway\/internal\)/u)
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
  assert.match(index, /scope\.remote\.settings\.replace\('agent-default-model', \{/u)
  assert.match(index, /model\.presetDirectory = seatPresetApplier/u)
  assert.doesNotMatch(index, /'remote\.agentPresets'\s*\]\s*$/mu, 'the frozen inject array must not grow')
  const settings = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
  assert.match(settings, /<SeatPresetPanel[\s\S]*?directory=\{model\.presetDirectory\}[\s\S]*?onSave=\{\(skillName, preset\) => \{ void run\('seat-preset' as SettingsAction, \(\) => model\.setSeatPreset\(skillName, preset\)\) \}\}/u)
  const wallpaper = settings.indexOf('<WallpaperPanel')
  const panel = settings.indexOf('<SeatPresetPanel')
  const workbench = settings.indexOf('aria-labelledby="amphoreus-workbench"')
  assert.ok(wallpaper < panel && panel < workbench)
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
