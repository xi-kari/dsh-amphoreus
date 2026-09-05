import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { registerSeatPrompt, seatPromptAssembly } from '../src/host/seat-prompt.ts'
import type { BindingRecord, AmphoreusStores } from '../src/host/store.ts'
import type { SuiteSnapshot } from '../src/host/suite/types.ts'

const binding: BindingRecord = {
  sessionId: 'session-role', skillName: 'amphoreus-anaxa', boundAt: 100,
  source: 'seat-new', injection: { state: 'pending' },
}

function prompt() {
  return {
    sections: [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'harness:source', text: 'Checkout source guidance.' },
      { name: 'web:surface', text: 'GUI instructions.' },
      { name: 'deployment:persona', text: 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}. Keep existing project contracts.' },
      { name: 'tool:read', text: 'Read tool contract.' },
    ],
    contexts: [{ name: 'sandbox:policy', text: 'Runtime policy.' }],
    tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' as const, properties: {} } }],
    variables: { model: 'deepseek-v4-pro', cwd: 'D:/Project' },
  }
}

test('seat prompt replaces only two default identity declarations and retains runtime contracts', () => {
  const original = prompt()
  const before = structuredClone(original)
  const changed = seatPromptAssembly(original, binding, '那刻夏')
  assert.match(changed.sections[0]!.text, /那刻夏.*amphoreus-anaxa/)
  assert.match(changed.sections[0]!.text, /从第一条回复/)
  assert.match(changed.sections[0]!.text, /模型或运行环境时如实说明/)
  assert.equal(changed.sections[3]!.text, 'Your working directory is {{cwd}}. Keep existing project contracts.')
  assert.deepEqual(changed.sections.filter(section => !['harness:identity', 'deployment:persona'].includes(section.name)), before.sections.filter(section => !['harness:identity', 'deployment:persona'].includes(section.name)))
  assert.strictEqual(changed.contexts, original.contexts)
  assert.strictEqual(changed.tools, original.tools)
  assert.strictEqual(changed.variables, original.variables)
  assert.deepEqual(original, before)
})

test('custom deployment persona remains intact and identity is added if the harness opener is absent', () => {
  const original = prompt()
  original.sections = [{ name: 'deployment:persona', text: 'Project-specific role and constraints.' }]
  const changed = seatPromptAssembly(original, binding, '那刻夏')
  assert.equal(changed.sections[0]!.name, 'amphoreus:seat-identity')
  assert.equal(changed.sections[1]!.text, 'Project-specific role and constraints.')
})

test('seat references use explicit skill-root paths and a dispatch speaks only for its own seat', () => {
  const references = { skill: '/skills/amphoreus-anaxa/SKILL.md', persona: '/skills/amphoreus-anaxa/persona.md', common: '/skills/amphoreus/references/common.md' }
  const changed = seatPromptAssembly(prompt(), { ...binding, source: 'dispatch' }, '那刻夏', references)
  const identity = changed.sections[0]!.text
  for (const path of Object.values(references)) assert.ok(identity.includes(path))
  assert.match(identity, /与当前工作目录是两个位置/)
  assert.match(identity, /不根据本会话只显示你一人而推断其他席位缺席/)
  assert.doesNotMatch(seatPromptAssembly(prompt(), binding, '那刻夏', references).sections[0]!.text, /独立派发会话/)
})

test('assembly hook uses the active binding and downstream assembly, leaving ordinary and unavailable seats unchanged', async () => {
  let callback!: (...args: any[]) => Promise<ReturnType<typeof prompt>>
  let active: BindingRecord | undefined
  let current: SuiteSnapshot | undefined = {
    cards: new Map([['amphoreus-anaxa', { displayName: '那刻夏', userInvocable: true }]]),
  } as unknown as SuiteSnapshot
  let disposed = false
  const ctx = { on: (name: string, handler: typeof callback) => {
    assert.equal(name, 'system-prompt/assemble')
    callback = handler
    return () => { disposed = true }
  } } as unknown as Context
  const dispose = registerSeatPrompt(ctx, {
    stores: { main: { table: () => ({ get: () => active }) } } as unknown as AmphoreusStores,
    current: () => current,
  })
  const original = prompt()
  assert.strictEqual(await callback(prompt(), {}, async () => original), original)
  const context = { agent: { session: { id: binding.sessionId } } }
  assert.strictEqual(await callback(prompt(), context, async () => original), original)
  active = binding
  assert.match((await callback(prompt(), context, async () => original)).sections[0]!.text, /那刻夏/)
  active = { ...binding, skillName: 'amphoreus-unavailable' }
  assert.strictEqual(await callback(prompt(), context, async () => original), original)
  active = binding
  current = undefined
  assert.strictEqual(await callback(prompt(), context, async () => original), original)
  dispose()
  assert.equal(disposed, true)
})
