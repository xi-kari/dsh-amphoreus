import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { AmphoreusClientModel } from '../src/client/state.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import type { SuiteResolver } from '../src/host/bridge.ts'
import {
  amphoreusDomain,
  GlobalSchema,
  INITIAL_GLOBAL,
  type AmphoreusStores,
} from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { fixtureSnapshot } from './fixture-suite.ts'

const NONCE = 'magazine-mode-test'

test('magazine preference is optional and keeps the version-one domain backward compatible', () => {
  assert.equal(amphoreusDomain.version, 1)
  assert.equal(Object.hasOwn(INITIAL_GLOBAL.prefs, 'magazineMode'), false)
  const legacy = GlobalSchema.parse({
    ...INITIAL_GLOBAL,
    prefs: { lastSeat: null, wallpaperCursor: 0, quickPhrases: [] },
  })
  assert.equal(Object.hasOwn(legacy.prefs, 'magazineMode'), false)
  assert.equal(GlobalSchema.parse({
    ...INITIAL_GLOBAL,
    prefs: { ...INITIAL_GLOBAL.prefs, magazineMode: 'full' },
  }).prefs.magazineMode, 'full')
  assert.equal(GlobalSchema.safeParse({
    ...INITIAL_GLOBAL,
    prefs: { ...INITIAL_GLOBAL.prefs, magazineMode: 'off' },
  }).success, false)
})

test('prefs PUT sets, preserves, serializes concurrent fields, and deletes the magazine override', async () => {
  let global = structuredClone(INITIAL_GLOBAL)
  const stores = {
    main: {
      global: {
        get: () => global,
        set: async (value: typeof global) => {
          await new Promise(resolve => setTimeout(resolve, 4))
          global = value
        },
      },
      table: () => ({ entries: () => new Map().entries() }),
    },
    canvas: {
      table: () => ({ entries: () => new Map().entries() }),
    },
    close: async () => {},
  } as unknown as AmphoreusStores
  let suite = undefined as ReturnType<typeof fixtureSnapshot> | undefined
  const api = new AmphoreusWebApi({} as Context, {
    config: fixtureConfig(),
    stores,
    resolver: { current: () => suite } as unknown as SuiteResolver,
    nonce: NONCE,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const put = (body: unknown) => fetch(`${origin}/amphoreus/api/prefs`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
    body: JSON.stringify(body),
  })

  try {
    assert.equal(api.state().effectiveConfig.magazineMode, 'light')
    assert.equal(api.state().effectiveConfig.magazineModeSource, 'config')
    assert.deepEqual({
      handoffEnabled: api.state().effectiveConfig.handoffEnabled,
      receiptParsing: api.state().effectiveConfig.receiptParsing,
      dispatchHints: api.state().effectiveConfig.dispatchHints,
      pipelinesEnabled: api.state().effectiveConfig.pipelinesEnabled,
    }, {
      handoffEnabled: false,
      receiptParsing: false,
      dispatchHints: false,
      pipelinesEnabled: false,
    })
    const parsed = fixtureSnapshot()
    suite = {
      ...parsed,
      features: { ...parsed.features, pipelines: true },
    }
    assert.deepEqual({
      handoffEnabled: api.state().effectiveConfig.handoffEnabled,
      receiptParsing: api.state().effectiveConfig.receiptParsing,
      dispatchHints: api.state().effectiveConfig.dispatchHints,
      pipelinesEnabled: api.state().effectiveConfig.pipelinesEnabled,
    }, {
      handoffEnabled: true,
      receiptParsing: true,
      dispatchHints: true,
      pipelinesEnabled: true,
    })

    const full = await put({ magazineMode: 'full' })
    assert.equal(full.status, 200)
    assert.equal((await full.json() as { prefs: { magazineMode?: string } }).prefs.magazineMode, 'full')
    assert.equal(api.state().effectiveConfig.magazineMode, 'full')
    assert.equal(api.state().effectiveConfig.magazineModeSource, 'prefs')

    const light = await put({ magazineMode: 'light' })
    assert.equal(light.status, 200)
    assert.equal(api.state().effectiveConfig.magazineMode, 'light')
    assert.equal(api.state().effectiveConfig.magazineModeSource, 'prefs')

    const fullAgain = await put({ magazineMode: 'full' })
    assert.equal(fullAgain.status, 200)

    const omitted = await put({ lastSeat: 'aglaea' })
    assert.equal(omitted.status, 200)
    assert.equal(global.prefs.magazineMode, 'full')

    const cleared = await put({ magazineMode: null })
    assert.equal(cleared.status, 200)
    assert.equal(Object.hasOwn((await cleared.json() as { prefs: object }).prefs, 'magazineMode'), false)
    assert.equal(Object.hasOwn(global.prefs, 'magazineMode'), false)
    assert.equal(api.state().effectiveConfig.magazineMode, 'light')
    assert.equal(api.state().effectiveConfig.magazineModeSource, 'config')

    const [modeWrite, phraseWrite] = await Promise.all([
      put({ magazineMode: 'full' }),
      put({ quickPhrases: ['并发保留'] }),
    ])
    assert.equal(modeWrite.status, 200)
    assert.equal(phraseWrite.status, 200)
    assert.equal(global.prefs.magazineMode, 'full')
    assert.deepEqual(global.prefs.quickPhrases, ['并发保留'])
    assert.equal(global.prefs.quickPhrasesInitialized, true)

    await put({ magazineMode: null })
    assert.equal(Object.hasOwn(global.prefs, 'magazineMode'), false)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('client setMagazineMode writes the nonce-gated preference and refreshes state', async () => {
  const oldFetch = globalThis.fetch
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const requests: Array<{ input: string; init?: RequestInit }> = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __AMPHOREUS_BOOT__: { nonce: 'client-magazine-nonce' } },
  })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    requests.push({ input: path, ...(init === undefined ? {} : { init }) })
    if (path === '/amphoreus/api/prefs') return { ok: true, status: 200 } as Response
    return {
      ok: true,
      status: 200,
      json: async () => ({
        nonce: 'client-magazine-nonce',
        effectiveConfig: { magazineMode: 'full', magazineModeSource: 'prefs' },
      }),
    } as Response
  }) as typeof fetch
  const model = new AmphoreusClientModel()
  try {
    await model.setMagazineMode('full')
    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.input, '/amphoreus/api/prefs')
    assert.equal(requests[0]?.init?.method, 'PUT')
    assert.deepEqual(requests[0]?.init?.headers, {
      'content-type': 'application/json',
      'x-amphoreus-nonce': 'client-magazine-nonce',
    })
    assert.equal(requests[0]?.init?.body, '{"magazineMode":"full"}')
    assert.equal(requests[1]?.input, '/amphoreus/api/state')
    assert.equal(model.getSnapshot().state?.effectiveConfig.magazineMode, 'full')
  } finally {
    model.close()
    globalThis.fetch = oldFetch
    if (oldWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Object.defineProperty(globalThis, 'window', oldWindow)
  }
})

test('stable host bridge sends magazine mode initially and again on map-ready', () => {
  const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const workbench = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')

  assert.equal(client.match(/const magazineBridge = \{/g)?.length, 1)
  assert.equal(client.match(/magazine: magazineBridge/g)?.length, 2)
  assert.match(workbench, /const pushMagazineRef = useRef/)
  assert.match(workbench, /const unsubscribe = magazine\.subscribe\(push\)/)
  assert.match(workbench, /pushMagazineRef\.current = push[\s\S]*push\(\)/)
  const ready = workbench.slice(workbench.indexOf("case 'amphoreus:map-ready'"), workbench.indexOf("case 'amphoreus:map-opened'"))
  assert.match(ready, /pushMagazineRef\.current\(\)/)

  assert.equal(app.match(/data\.type === 'amphoreus:magazine-mode'/g)?.length, 1)
  assert.match(app, /data\.mode === 'light' \|\| data\.mode === 'full'/)
  assert.match(app, /document\.documentElement\.dataset\.magazine = data\.mode/)
  const branch = app.slice(
    app.indexOf("if (data.type === 'amphoreus:magazine-mode'"),
    app.indexOf("if (data.type === 'amphoreus:workspaces'"),
  )
  assert.match(branch, /syncMagazineClass\(data\.mode\)/)
  assert.doesNotMatch(branch, /\brender\(|deferCanvasRefresh\(/)
})

function fixtureConfig(): AmphoreusConfig {
  return {
    skillRoots: ['X:/fixture'], dataDir: '', assetsRoot: '', commonPath: 'amphoreus/references/common.md', relationsPath: 'amphoreus/references/relations.md',
    sectionAliases: {}, providerName: 'dsh-amphoreus', providerSource: 'amphoreus', providerRank: 300, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: true, global: 'fixed', globalIndex: 4, sidebarIndex: 5, perSeat: true, darkMask: 0.18, lightMask: 0.03, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: ['startup', 'clear'] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: 'fixture', ref: 'main', keepBackups: 3 }, trustedHosts: [],
    memory: { inject: true, autoNote: true, injectLimit: 8, command: 'remember' },
  }
}
