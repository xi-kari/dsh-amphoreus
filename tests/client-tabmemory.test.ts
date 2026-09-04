import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CONVERSATION_PREF_PREFIX,
  decideSeed,
  readRememberedTab,
  rememberTab,
  seedConversationView,
  WORKBENCH_TAB_KEY,
  WORKBENCH_VIEW_ID,
  type KeyValueStore,
} from '../src/client/tabmemory.ts'

class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

test('no memory and chat default does not seed a preference', () => {
  assert.equal(decideSeed({ remembered: null, defaultView: 'chat', existingPreference: null }), null)
})

test('no memory and workbench default seeds the exact conversation state', () => {
  assert.equal(
    decideSeed({ remembered: null, defaultView: 'workbench', existingPreference: null }),
    '{"draft":"","view":"amphoreus-workbench","viewRequest":null}',
  )
})

test('remembered chat takes precedence over the workbench default', () => {
  assert.equal(decideSeed({ remembered: 'chat', defaultView: 'workbench', existingPreference: null }), null)
})

test('remembered workbench takes precedence over the chat default', () => {
  const store = new MemoryStore()
  const key = `${CONVERSATION_PREF_PREFIX}.new-session`
  store.values.set(WORKBENCH_TAB_KEY, WORKBENCH_VIEW_ID)
  assert.equal(
    decideSeed({ remembered: WORKBENCH_VIEW_ID, defaultView: 'chat', existingPreference: null }),
    '{"draft":"","view":"amphoreus-workbench","viewRequest":null}',
  )
  assert.equal(seedConversationView(store, 'new-session', 'chat'), true)
  assert.equal(store.getItem(key), '{"draft":"","view":"amphoreus-workbench","viewRequest":null}')
})

test('an existing string view is never overwritten', () => {
  const store = new MemoryStore()
  const key = `${CONVERSATION_PREF_PREFIX}.chosen-session`
  const existing = '{"draft":"x","view":"chat","viewRequest":null}'
  store.values.set(WORKBENCH_TAB_KEY, WORKBENCH_VIEW_ID)
  store.values.set(key, existing)

  assert.equal(decideSeed({ remembered: WORKBENCH_VIEW_ID, defaultView: 'workbench', existingPreference: existing }), null)
  assert.equal(seedConversationView(store, 'chosen-session', 'workbench'), false)
  assert.equal(store.getItem(key), existing)
})

test('a null view is filled while all existing fields are preserved', () => {
  const store = new MemoryStore()
  const key = `${CONVERSATION_PREF_PREFIX}.draft-session`
  const existing = '{"draft":"x","view":null,"viewRequest":null}'
  store.values.set(WORKBENCH_TAB_KEY, WORKBENCH_VIEW_ID)
  store.values.set(key, existing)

  const decided = decideSeed({
    remembered: WORKBENCH_VIEW_ID,
    defaultView: 'chat',
    existingPreference: existing,
  })
  assert.notEqual(decided, null)
  const parsed = JSON.parse(decided ?? '') as Record<string, unknown>
  assert.equal(parsed.draft, 'x')
  assert.equal(parsed.view, WORKBENCH_VIEW_ID)
  assert.equal(parsed.viewRequest, null)

  assert.equal(seedConversationView(store, 'draft-session', 'chat'), true)
  assert.deepEqual(JSON.parse(store.getItem(key) ?? ''), {
    draft: 'x',
    view: WORKBENCH_VIEW_ID,
    viewRequest: null,
  })
})

test('invalid JSON and invalid remembered values are ignored without overwriting', () => {
  const store = new MemoryStore()
  const key = `${CONVERSATION_PREF_PREFIX}.invalid-session`
  store.values.set(WORKBENCH_TAB_KEY, 'garbage')
  store.values.set(key, 'not json')

  assert.equal(readRememberedTab(store), null)
  assert.equal(decideSeed({ remembered: WORKBENCH_VIEW_ID, defaultView: 'workbench', existingPreference: 'not json' }), null)
  assert.equal(seedConversationView(store, 'invalid-session', 'workbench'), false)
  assert.equal(store.getItem(key), 'not json')
})

test('rememberTab writes valid choices and tolerates unavailable storage', () => {
  const store = new MemoryStore()
  rememberTab(store, WORKBENCH_VIEW_ID)
  assert.equal(readRememberedTab(store), WORKBENCH_VIEW_ID)
  rememberTab(store, 'chat')
  assert.equal(readRememberedTab(store), 'chat')

  assert.doesNotThrow(() => rememberTab({
    getItem: () => null,
    setItem: () => { throw new Error('unavailable') },
  }, WORKBENCH_VIEW_ID))
})
