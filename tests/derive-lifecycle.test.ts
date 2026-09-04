import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import type { DeriveOptions, DeriveResult } from '../src/host/derive.ts'
import { INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'

function config(assetsRoot: string): AmphoreusConfig {
  return {
    skillRoots: [], dataDir: '', assetsRoot, commonPath: '', relationsPath: '', sectionAliases: {}, providerName: '', providerSource: '', providerRank: 0, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: true, global: 'fixed', globalIndex: 0, sidebarIndex: 1, perSeat: true, darkMask: 0.18, lightMask: 0.03, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: [] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: '', ref: '', keepBackups: 3 }, trustedHosts: [],
  }
}

function stores(): AmphoreusStores {
  let global = structuredClone(INITIAL_GLOBAL)
  const empty = new Map()
  return {
    main: { global: { get: () => global, set: async value => { global = value } }, table: () => ({ entries: () => empty.entries() }) },
    canvas: { table: () => ({ entries: () => empty.entries() }) },
    close: async () => {},
  } as unknown as AmphoreusStores
}

async function serverFor(webApi: AmphoreusWebApi) {
  const server = createServer((request, response) => { void webApi.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function result(written: number, failed: DeriveResult['failed'] = []): DeriveResult {
  return { written, skipped: 0, failed, startedAt: 1, finishedAt: 2 }
}

test('derive route preserves 415/403/400 order, returns 202 immediately, gates 409, and orders SSE lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-derive-lifecycle-'))
  const assetsRoot = join(root, 'assets')
  const cacheDir = join(root, 'cache')
  await mkdir(assetsRoot, { recursive: true })
  let options: DeriveOptions | undefined
  let deriveCalls = 0
  let finish!: (value: DeriveResult) => void
  const operation = new Promise<DeriveResult>(resolve => { finish = resolve })
  const derive = async (value: DeriveOptions): Promise<DeriveResult> => {
    deriveCalls += 1
    options = value
    return operation
  }
  const runtimeConfig = config('')
  const webApi = new AmphoreusWebApi({} as Context, {
    config: runtimeConfig,
    stores: stores(),
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: 'derive-lifecycle-nonce',
    assetsCacheDir: cacheDir,
    deriveAssets: derive,
    probeMagick: async () => 'Version: synthetic',
  })
  const { server, origin } = await serverFor(webApi)
  const controller = new AbortController()
  const events: Array<{ event: string; data: unknown }> = []
  let eventTask: Promise<void> = Promise.resolve()
  try {
    const sse = await fetch(`${origin}/amphoreus/api/events`, { signal: controller.signal })
    assert.equal(sse.status, 200)
    const reader = sse.body!.getReader()
    eventTask = (async () => {
      const decoder = new TextDecoder()
      let buffered = ''
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return
        buffered += decoder.decode(chunk.value, { stream: true })
        let boundary
        while ((boundary = buffered.indexOf('\n\n')) >= 0) {
          const block = buffered.slice(0, boundary)
          buffered = buffered.slice(boundary + 2)
          const event = /^event: (.+)$/mu.exec(block)?.[1]
          const data = /^data: (.+)$/mu.exec(block)?.[1]
          if (event !== undefined && data !== undefined) events.push({ event, data: JSON.parse(data) })
        }
      }
    })().catch(error => {
      if (!controller.signal.aborted) throw error
    })
    await waitFor(() => events.some(value => value.event === 'snapshot'))

    const wrongMethod = await fetch(`${origin}/amphoreus/api/assets/derive`)
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('allow'), 'POST')
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', body: '{}' })).status, 415)
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403)
    const headers = { 'content-type': 'application/json', 'x-amphoreus-nonce': 'derive-lifecycle-nonce' }
    const noRoot = await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{}' })
    assert.equal(noRoot.status, 400)
    assert.deepEqual(await noRoot.json(), { error: 'assetsRoot is not configured' })

    runtimeConfig.assetsRoot = assetsRoot
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{broken' })).status, 400)
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{"force":false,"extra":true}' })).status, 400)
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(4 * 1024) }) })).status, 413)
    const accepted = await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{"force":true}' })
    assert.equal(accepted.status, 202)
    assert.deepEqual(await accepted.json(), { started: true })
    assert.equal(webApi.state().assets.running, true)
    await waitFor(() => options !== undefined)
    assert.equal(options?.force, true)
    assert.equal(options?.assetsRoot, assetsRoot)
    assert.equal(options?.cacheDir, cacheDir)
    assert.equal(Object.hasOwn(options!, 'magick'), false)
    assert.equal(deriveCalls, 1)

    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' })).status, 403)
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{broken' })).status, 409)
    const conflict = await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{}' })
    assert.equal(conflict.status, 409)
    assert.equal(deriveCalls, 1)
    options!.onProgress?.({ kind: 'covers', done: 1, total: 13, current: 'cyrene cover-34.webp' })
    options!.onProgress?.({ kind: 'covers', done: 2, total: 13, current: 'tribbie cover-34.webp' })
    await mkdir(join(cacheDir, 'aglaea'), { recursive: true })
    await writeFile(join(cacheDir, 'aglaea', 'cover-34.webp'), 'derived')
    finish(result(1))
    await waitFor(() => webApi.state().assets.lastDerive !== null && webApi.state().assets.running === false)

    const state = webApi.state().assets
    assert.equal(state.derivedCount, 1)
    assert.deepEqual(state.derived, ['aglaea/cover-34.webp'])
    assert.equal(state.lastDerive?.written, 1)
    assert.equal(state.lastDerive?.failed, 0)
    assert.equal(state.lastDerive?.error, undefined)
    await waitFor(() => events.filter(value => value.event === 'state-change').length >= 2)
    const lifecycle = events.filter(value => value.event === 'state-change' || value.event === 'derive-progress')
    assert.deepEqual(lifecycle.map(value => value.event), ['state-change', 'derive-progress', 'derive-progress', 'state-change'])
    assert.deepEqual(lifecycle.filter(value => value.event === 'derive-progress').map(value => (value.data as { done: number }).done), [1, 2])

    const previousResult = state.lastDerive
    options = undefined
    const defaultForce = await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{}' })
    assert.equal(defaultForce.status, 202)
    await waitFor(() => options !== undefined && webApi.state().assets.lastDerive !== previousResult)
    assert.equal(options?.force, false)
    assert.equal(deriveCalls, 2)
  } finally {
    controller.abort()
    await eventTask
    server.close()
    await once(server, 'close')
    await rm(root, { recursive: true, force: true })
  }
})

test('a fatal background failure permits a later run and a scan failure still reaches terminal state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-derive-retry-'))
  const assetsRoot = join(root, 'assets')
  const cacheAsFile = join(root, 'cache-file')
  await mkdir(assetsRoot, { recursive: true })
  await writeFile(cacheAsFile, 'not a directory')
  let calls = 0
  const derive = async (): Promise<DeriveResult> => {
    calls += 1
    if (calls === 1) throw new Error('first fatal failure')
    return result(2)
  }
  const webApi = new AmphoreusWebApi({} as Context, {
    config: config(assetsRoot),
    stores: stores(),
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: 'derive-retry-nonce',
    assetsCacheDir: cacheAsFile,
    deriveAssets: derive,
    probeMagick: async () => 'Version: synthetic',
  })
  const { server, origin } = await serverFor(webApi)
  const headers = { 'content-type': 'application/json', 'x-amphoreus-nonce': 'derive-retry-nonce' }
  try {
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{}' })).status, 202)
    await waitFor(() => webApi.state().assets.lastDerive?.error?.includes('first fatal failure') === true)
    assert.equal(webApi.state().assets.running, false)

    const firstResult = webApi.state().assets.lastDerive
    assert.equal((await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{}' })).status, 202)
    await waitFor(() => webApi.state().assets.lastDerive !== firstResult)
    assert.equal(calls, 2)
    assert.equal(webApi.state().assets.running, false)
    assert.equal(webApi.state().assets.lastDerive?.written, 2)
    assert.equal(webApi.state().assets.lastDerive?.failed, 1)
    assert.match(webApi.state().assets.lastDerive?.error ?? '', /assets cache is not a directory/)
  } finally {
    server.close()
    await once(server, 'close')
    await rm(root, { recursive: true, force: true })
  }
})

test('partial and thrown derivations both clear running and update lastDerive without rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-derive-failures-'))
  const assetsRoot = join(root, 'assets')
  const cacheDir = join(root, 'cache')
  await mkdir(assetsRoot, { recursive: true })
  const headers = { 'content-type': 'application/json', 'x-amphoreus-nonce': 'derive-failure-nonce' }
  try {
    for (const fixture of [
      {
        derive: async () => result(3, [{ file: 'x', error: 'one file failed' }]),
        written: 3,
        error: 'one file failed',
      },
      {
        derive: async () => { throw new Error('fatal derive failure') },
        written: 0,
        error: 'fatal derive failure',
      },
    ]) {
      const webApi = new AmphoreusWebApi({} as Context, {
        config: config(assetsRoot),
        stores: stores(),
        resolver: { current: () => undefined } as unknown as SuiteResolver,
        nonce: 'derive-failure-nonce',
        assetsCacheDir: cacheDir,
        deriveAssets: fixture.derive,
        probeMagick: async () => 'Version: synthetic',
      })
      const { server, origin } = await serverFor(webApi)
      try {
        const response = await fetch(`${origin}/amphoreus/api/assets/derive`, { method: 'POST', headers, body: '{}' })
        assert.equal(response.status, 202)
        await waitFor(() => webApi.state().assets.lastDerive !== null && webApi.state().assets.running === false)
        assert.equal(webApi.state().assets.lastDerive?.written, fixture.written)
        assert.equal(webApi.state().assets.lastDerive?.failed, 1)
        assert.match(webApi.state().assets.lastDerive?.error ?? '', new RegExp(fixture.error))
      } finally {
        server.close()
        await once(server, 'close')
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
