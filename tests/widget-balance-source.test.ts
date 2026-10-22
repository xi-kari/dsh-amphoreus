import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDshWidgetBalanceReader, type WidgetDshAccount } from '../src/host/widget-balance-source.ts'

const metadata = () => ({ version: 'fixture', locale: 'zh-CN', timezoneOffsetSeconds: 28800 })
const signal = () => new AbortController().signal
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const apiBody = (total = '100') => ({ balance_infos: [{ currency: 'CNY', total_balance: total }] })
function account(overrides: Partial<WidgetDshAccount> = {}): WidgetDshAccount {
  return {
    getState: async () => ({ status: 'credential-stored' }),
    getProfile: async () => ({ status: 'ready', value: { id: 'PRIVATE_ACCOUNT_IDENTIFIER' } }),
    getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '10' }, { currency: 'USD', balance: '3' }], bonusWallets: [{ currency: 'CNY', balance: '2' }] }),
    getDeviceIdentity: async () => ({ userId: 'PRIVATE_ACCOUNT_IDENTIFIER' }),
    ...overrides,
  }
}

test('existing DSH account methods are awaited and expose separate wallets without credentials or raw identity', async () => {
  let stateRead = false
  const source = account({
    getState: async () => { await Promise.resolve(); stateRead = true; return { status: 'credential-stored' } },
    getBalance: async client => {
      assert.equal(stateRead, true)
      assert.deepEqual(client, metadata())
      return { status: 'ready', value: [{ currency: 'CNY', balance: '10' }, { currency: 'USD', balance: '3' }], bonusWallets: [{ currency: 'CNY', balance: '2' }] }
    },
  })
  const read = createDshWidgetBalanceReader({ mode: 'account', getAccount: () => source, getCredentials: () => { throw new Error('must not read key') }, clientMetadata: metadata })
  const result = await read(signal())
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.deepEqual(result.wallets, [{ currency: 'CNY', recharge: '10', bonus: '2', total: '12' }, { currency: 'USD', recharge: '3', bonus: '0', total: '3' }])
  assert.equal(JSON.stringify(result).includes('PRIVATE_ACCOUNT_IDENTIFIER'), false)
  assert.match(result.scopeKey!, /^account:[a-f0-9]{64}$/u)
})

test('API-key balance uses only the official read endpoint and suppresses whitespace and secret values in its result', async () => {
  const privateKey = 'FIXTURE_SECRET_KEY'
  let requests = 0
  const read = createDshWidgetBalanceReader({
    getAccount: () => undefined, getCredentials: () => ({ resolve: async ref => { assert.equal(ref, 'DEEPSEEK_API_KEY'); return { value: `  ${privateKey}  ` } } }),
    clientMetadata: metadata,
    fetch: async (url, options) => {
      requests++
      assert.equal(url, 'https://api.deepseek.com/user/balance')
      assert.equal(options?.method, 'GET')
      assert.equal(options?.redirect, 'error')
      assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${privateKey}`)
      return response(apiBody('0E-16'))
    },
  })
  const result = await read(signal())
  assert.equal(result.status, 'ready')
  assert.equal(requests, 1)
  assert.equal(JSON.stringify(result).includes(privateKey), false)
  if (result.status === 'ready') assert.deepEqual(result.wallets, [{ currency: 'CNY', total: '0', recharge: null, bonus: null }])
})

test('a configured key failure never silently switches to the signed-in account', async () => {
  let accountReads = 0
  const read = createDshWidgetBalanceReader({
    getAccount: () => { accountReads++; return account() }, getCredentials: () => ({ resolve: async () => ({ value: 'fixture-key' }) }),
    clientMetadata: metadata, fetch: async () => response({}, 401),
  })
  const result = await read(signal())
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.reason, 'unauthorized')
  assert.equal(accountReads, 0)
})

test('an absent key falls back to account, while a nonofficial key route makes no request', async () => {
  let requests = 0
  const absent = createDshWidgetBalanceReader({ getAccount: () => account(), getCredentials: () => ({ resolve: async () => undefined }), clientMetadata: metadata })
  assert.equal((await absent(signal())).status, 'ready')
  const custom = createDshWidgetBalanceReader({
    getAccount: () => account(), getCredentials: () => ({ resolve: async () => ({ value: 'gateway-key' }) }),
    clientMetadata: metadata, officialApiKeyRoute: () => false,
    fetch: async () => { requests++; throw new Error('must not fetch') },
  })
  assert.deepEqual(await custom(signal()), { status: 'unavailable', reason: 'unsupported-source' })
  assert.equal(requests, 0)
})

test('credential rotation during a balance request discards the old response', async () => {
  let key = 'old-fixture-key'
  let complete!: (response: Response) => void
  const read = createDshWidgetBalanceReader({
    getAccount: () => undefined, getCredentials: () => ({ resolve: async () => ({ value: key }) }), clientMetadata: metadata,
    fetch: async () => await new Promise(resolve => { complete = resolve }),
  })
  const pending = read(signal())
  await new Promise(resolve => setImmediate(resolve))
  key = 'new-fixture-key'
  complete(response(apiBody()))
  assert.deepEqual(await pending, { status: 'failed', source: 'api-key', reason: 'credential-changed' })
})

test('credential rotation while the response body is being read also discards the old response', async () => {
  let key = 'old-fixture-key'
  let finishBody!: (text: string) => void
  const read = createDshWidgetBalanceReader({
    getAccount: () => undefined, getCredentials: () => ({ resolve: async () => ({ value: key }) }), clientMetadata: metadata,
    fetch: async () => {
      const result = response({})
      result.text = async () => await new Promise(resolve => { finishBody = resolve })
      return result
    },
  })
  const pending = read(signal())
  await new Promise(resolve => setImmediate(resolve))
  key = 'new-fixture-key'
  finishBody(JSON.stringify(apiBody()))
  assert.deepEqual(await pending, { status: 'failed', source: 'api-key', reason: 'credential-changed' })
})

test('account identity is checked after profile and balance settle, without using token accessors', async () => {
  const read = createDshWidgetBalanceReader({
    mode: 'account', getCredentials: () => undefined,
    getAccount: () => account({ getDeviceIdentity: async () => ({ userId: 'DIFFERENT_PRIVATE_ACCOUNT' }) }), clientMetadata: metadata,
  })
  assert.deepEqual(await read(signal()), { status: 'failed', source: 'account', reason: 'credential-changed' })
  const unknown = createDshWidgetBalanceReader({
    mode: 'account', getCredentials: () => undefined,
    getAccount: () => account({ getProfile: async () => ({ status: 'ready', value: { id: null } }), getDeviceIdentity: async () => ({}) }), clientMetadata: metadata,
  })
  const result = await unknown(signal())
  assert.equal(result.status, 'ready')
  if (result.status === 'ready') assert.equal(result.scopeKey, null)
})

test('invalid monetary responses and secret-bearing transport errors produce safe failure codes', async () => {
  for (const malformed of [true, false]) {
    const read = createDshWidgetBalanceReader({
      getAccount: () => undefined, getCredentials: () => ({ resolve: async () => ({ value: 'PRIVATE_TEST_KEY' }) }), clientMetadata: metadata,
      fetch: async () => { if (malformed) return response(apiBody('NaN')); throw new Error('transport PRIVATE_TEST_KEY full headers') },
    })
    const result = await read(signal())
    assert.equal(result.status, 'failed')
    if (result.status === 'failed') assert.equal(result.reason, malformed ? 'invalid-response' : 'network')
    assert.equal(JSON.stringify(result).includes('PRIVATE_TEST_KEY'), false)
  }
})

test('signed-out, absent services, and cancellation remain distinct from a real zero balance', async () => {
  const read = createDshWidgetBalanceReader({ getAccount: () => undefined, getCredentials: () => undefined, clientMetadata: metadata })
  assert.deepEqual(await read(signal()), { status: 'unavailable', reason: 'not-configured' })
  const out = createDshWidgetBalanceReader({ getAccount: () => account({ getState: async () => ({ status: 'signed-out' }) }), getCredentials: () => undefined, clientMetadata: metadata })
  assert.deepEqual(await out(signal()), { status: 'unavailable', reason: 'signed-out' })
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(read(cancelled.signal), { name: 'AbortError' })
})

test('account queries have an overall deadline even when a host method never settles', async () => {
  const read = createDshWidgetBalanceReader({
    mode: 'account', getAccount: () => account({ getBalance: async () => await new Promise(() => {}) }),
    getCredentials: () => undefined, clientMetadata: metadata, timeoutMs: 15,
  })
  const keepingProcessAlive = setTimeout(() => {}, 500)
  try {
    const result = await Promise.race([read(signal()), new Promise<'not-settled'>(resolve => setTimeout(() => resolve('not-settled'), 100))])
    assert.notEqual(result, 'not-settled')
    if (typeof result !== 'string') assert.equal(result.status, 'failed')
  } finally { clearTimeout(keepingProcessAlive) }
})
