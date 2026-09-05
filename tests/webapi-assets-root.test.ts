import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { DeriveOptions, DeriveResult } from '../src/host/derive.ts'
import { createBootPayload } from '../src/host/firstframe.ts'
import { GlobalSchema, INITIAL_GLOBAL, type AmphoreusGlobal, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import type { AmphoreusState } from '../src/shared/api.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'
import { fixtureConfig } from './fixture-suite.ts'

const NONCE = 'assets-root-nonce'

/** One known required file (the first seat's sticker): the minimal pack signal PUT /api/assets/root demands. */
async function seedPackSignal(assets: string): Promise<void> {
  await mkdir(join(assets, '表情包'), { recursive: true })
  await writeFile(join(assets, '表情包', HERO_VISUALS[0]!.assets.sticker), 's')
}

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Collect SSE events from /amphoreus/api/events until `stop` is called. */
async function subscribe(origin: string): Promise<{ events: Array<{ event: string; data: Record<string, unknown> }>; stop: () => Promise<void> }> {
  const controller = new AbortController()
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const response = await fetch(`${origin}/amphoreus/api/events`, { signal: controller.signal })
  assert.equal(response.status, 200)
  const reader = response.body!.getReader()
  const task = (async () => {
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
        if (event !== undefined && data !== undefined) events.push({ event, data: JSON.parse(data) as Record<string, unknown> })
      }
    }
  })().catch(error => {
    if (!controller.signal.aborted) throw error
  })
  await waitFor(() => events.some(value => value.event === 'snapshot'))
  return { events, stop: async () => { controller.abort(); await task } }
}

function stores(): { stores: AmphoreusStores; global: () => AmphoreusGlobal } {
  let global = structuredClone(INITIAL_GLOBAL)
  const empty = new Map()
  return {
    global: () => global,
    stores: {
      main: {
        global: { get: () => global, set: async (value: AmphoreusGlobal) => { global = value } },
        table: () => ({ entries: () => empty.entries() }),
      },
      canvas: { table: () => ({ entries: () => empty.entries() }) },
      close: async () => {},
    } as unknown as AmphoreusStores,
  }
}

async function listen(api: AmphoreusWebApi): Promise<{ origin: string; close: () => void }> {
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() }
}

/** `nonce: null` sends no nonce header at all (an explicit `undefined` would fall back to the default parameter). */
function send(origin: string, path: string, method: string, body: unknown, nonce: string | null = NONCE): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(nonce === null ? {} : { 'x-amphoreus-nonce': nonce }) },
    body: JSON.stringify(body),
  })
}

test('stored globals accept the wizard prefs and legacy globals still parse', () => {
  assert.equal(GlobalSchema.safeParse(INITIAL_GLOBAL).success, true)
  assert.equal(GlobalSchema.safeParse({ ...INITIAL_GLOBAL, prefs: { ...INITIAL_GLOBAL.prefs, assetsRoot: 'X:/assets', setupDismissedAt: 5 } }).success, true)
  assert.equal(GlobalSchema.safeParse({ ...INITIAL_GLOBAL, prefs: { ...INITIAL_GLOBAL.prefs, setupDismissedAt: 'later' } }).success, false)
})

test('PUT /api/assets/root persists prefs, flips rootSource, refreshes the check, and clears back to config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-assets-root-'))
  try {
    const assets = join(root, 'assets')
    await seedPackSignal(assets)
    const bare = join(root, 'bare')
    await mkdir(join(bare, 'photos'), { recursive: true })
    const cache = join(root, 'assets-cache')
    const fixture = stores()
    const events: unknown[] = []
    const ctx = {
      webServer: { register: () => () => {} },
      on: () => () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    } as unknown as Context
    const api = new AmphoreusWebApi(ctx, {
      config: fixtureConfig(),
      stores: fixture.stores,
      resolver: { current: () => undefined, onSnapshot: () => () => {} } as unknown as SuiteResolver,
      nonce: NONCE,
      assetsCacheDir: cache,
      probeMagick: async () => undefined,
    })
    await api.prepareAssets()
    const initial = api.state()
    assert.equal(initial.assets.root, '')
    assert.equal(initial.assets.rootSource, 'none')
    assert.equal(initial.assets.check, undefined)
    assert.equal(initial.effectiveConfig.assetsConfigured, false)
    assert.equal(initial.effectiveConfig.setupNeeded, true)

    const server = await listen(api)
    try {
      const forbidden = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: assets }, null)
      assert.equal(forbidden.status, 403)
      const wrongMethod = await send(server.origin, '/amphoreus/api/assets/root', 'POST', { root: assets })
      assert.equal(wrongMethod.status, 405)
      const notDir = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: join(root, 'missing') })
      assert.equal(notDir.status, 400)
      assert.match(((await notDir.json()) as { error: string }).error, /does not exist/u)
      const overlap = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: cache })
      assert.equal(overlap.status, 400)
      const blank = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: '   ' })
      assert.equal(blank.status, 400)
      const extra = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: assets, force: true })
      assert.equal(extra.status, 400)
      const noSignal = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: bare })
      assert.equal(noSignal.status, 400, 'a directory without any known asset must not become the served root')
      assert.match(((await noSignal.json()) as { error: string }).error, /does not look like an Amphoreus asset pack/u)
      const inaccessible = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: `${assets}\u0000x` })
      assert.equal(inaccessible.status, 400)
      assert.deepEqual(await inaccessible.json(), { error: 'assetsRoot is not accessible' })
      assert.equal(fixture.global().prefs.assetsRoot, undefined)

      const saved = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: `  ${assets}  ` })
      assert.equal(saved.status, 200)
      const body = await saved.json() as { assets: AmphoreusState['assets'] }
      assert.equal(body.assets.root, assets)
      assert.equal(body.assets.rootSource, 'prefs')
      assert.equal(body.assets.check?.ok, false)
      assert.equal(body.assets.check?.summary.requiredTotal, 58)
      assert.equal(body.assets.check?.summary.requiredOk, 1)
      assert.equal(fixture.global().prefs.assetsRoot, assets)
      const state = api.state()
      assert.equal(state.assets.root, assets)
      assert.equal(state.effectiveConfig.assetsConfigured, true)
      assert.equal(state.effectiveConfig.setupNeeded, true, 'nothing derived yet keeps setupNeeded on')
      assert.equal(state.assets.check?.canonical !== undefined, true)
      assert.doesNotMatch(JSON.stringify(state.assets.check), /"content"/u)

      const stateResponse = await fetch(`${server.origin}/amphoreus/api/state`)
      const remote = await stateResponse.json() as AmphoreusState
      assert.equal(remote.assets.rootSource, 'prefs')
      assert.equal(remote.prefs.assetsRoot, assets)

      const cleared = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: null })
      assert.equal(cleared.status, 200)
      assert.equal(((await cleared.json()) as { assets: AmphoreusState['assets'] }).assets.rootSource, 'none')
      assert.equal(fixture.global().prefs.assetsRoot, undefined)
      assert.equal(api.state().assets.check, undefined)

      const dismissed = await send(server.origin, '/amphoreus/api/prefs', 'PUT', { setupDismissedAt: 1234 })
      assert.equal(dismissed.status, 200)
      assert.equal(fixture.global().prefs.setupDismissedAt, 1234)
      const undismissed = await send(server.origin, '/amphoreus/api/prefs', 'PUT', { setupDismissedAt: null })
      assert.equal(undismissed.status, 200)
      assert.equal(fixture.global().prefs.setupDismissedAt, undefined)
      const badDismiss = await send(server.origin, '/amphoreus/api/prefs', 'PUT', { setupDismissedAt: -1 })
      assert.equal(badDismiss.status, 400)
    } finally {
      server.close()
    }
    assert.equal(events.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('POST /api/assets/check reports a candidate without persisting, 400s on non-directories, and needs the nonce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-assets-check-'))
  try {
    const assets = join(root, 'assets')
    await mkdir(join(assets, '表情包'), { recursive: true })
    await writeFile(join(root, 'plain.txt'), 'x')
    const fixture = stores()
    const api = new AmphoreusWebApi({} as Context, {
      config: fixtureConfig(),
      stores: fixture.stores,
      resolver: { current: () => undefined } as unknown as SuiteResolver,
      nonce: NONCE,
      probeMagick: async () => undefined,
    })
    const server = await listen(api)
    try {
      assert.equal((await send(server.origin, '/amphoreus/api/assets/check', 'POST', { root: assets }, null)).status, 403)
      assert.equal((await send(server.origin, '/amphoreus/api/assets/check', 'POST', { root: assets }, 'wrong')).status, 403)
      assert.equal((await send(server.origin, '/amphoreus/api/assets/check', 'GET', undefined)).status, 405)
      const noRoot = await send(server.origin, '/amphoreus/api/assets/check', 'POST', {})
      assert.equal(noRoot.status, 400)
      assert.deepEqual(await noRoot.json(), { error: 'assetsRoot is not configured' })
      const file = await send(server.origin, '/amphoreus/api/assets/check', 'POST', { root: join(root, 'plain.txt') })
      assert.equal(file.status, 400)
      assert.deepEqual(await file.json(), { error: 'assetsRoot is not a directory' })
      const unknown = await send(server.origin, '/amphoreus/api/assets/check', 'POST', { root: assets, deep: true })
      assert.equal(unknown.status, 400)
      const tooLong = await send(server.origin, '/amphoreus/api/assets/check', 'POST', { root: 'x'.repeat(5000) })
      assert.equal(tooLong.status, 413)

      const ok = await send(server.origin, '/amphoreus/api/assets/check', 'POST', { root: assets })
      assert.equal(ok.status, 200)
      const body = await ok.json() as { report: { ok: boolean; root: string; required: { status: string }[]; home: { count: number }[] } }
      assert.equal(body.report.ok, false)
      assert.equal(body.report.root, assets)
      assert.equal(body.report.required.length, 58)
      assert.equal(body.report.home.length, 14)
      assert.equal(fixture.global().prefs.assetsRoot, undefined, 'check never persists')
      assert.equal(api.state().assets.rootSource, 'none')
    } finally {
      server.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the effective root getter wins over config in state, wallpaper, derive gating, and the first frame', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-assets-getter-'))
  try {
    const configured = join(root, 'from-config')
    const override = join(root, 'from-prefs')
    await mkdir(join(configured, '昔涟壁纸'), { recursive: true })
    await mkdir(join(override, '昔涟壁纸'), { recursive: true })
    await writeFile(join(override, '昔涟壁纸', 'Image_1788022237216_660.png'), 'override-bytes')
    const config = { ...fixtureConfig(), assetsRoot: configured }
    let effective = override
    const fixture = stores()
    const api = new AmphoreusWebApi({} as Context, {
      config,
      stores: fixture.stores,
      resolver: { current: () => undefined } as unknown as SuiteResolver,
      nonce: NONCE,
      assetsRoot: () => effective,
      probeMagick: async () => undefined,
    })
    await api.prepareAssets()
    assert.equal(api.state().assets.root, override)
    assert.equal(api.state().assets.rootSource, 'config', 'no stored pref → source is config even when the getter is injected')
    assert.equal(api.state().assets.check?.root, override)
    const server = await listen(api)
    try {
      const wallpaper = await fetch(`${server.origin}/amphoreus/wallpaper/Image_1788022237216_660.png`)
      assert.equal(wallpaper.status, 200)
      assert.equal(await wallpaper.text(), 'override-bytes')
      effective = ''
      const gone = await fetch(`${server.origin}/amphoreus/wallpaper/Image_1788022237216_660.png`)
      assert.equal(gone.status, 404)
      assert.equal(api.state().effectiveConfig.assetsConfigured, false)
      const derive = await send(server.origin, '/amphoreus/api/assets/derive', 'POST', {})
      assert.equal(derive.status, 400)
      assert.deepEqual(await derive.json(), { error: 'assetsRoot is not configured' })
    } finally {
      server.close()
    }

    const withGetter = createBootPayload({ config, nonce: 'n', current: () => undefined, derivedWallpaper: () => null, assetsRoot: () => '' })
    assert.equal(withGetter.wallpaper.url, undefined, 'first frame follows the getter, not config')
    const withoutGetter = createBootPayload({ config, nonce: 'n', current: () => undefined, derivedWallpaper: () => null })
    assert.match(withoutGetter.wallpaper.url ?? '', /^\/amphoreus\/wallpaper\//u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('without an injected getter the web api reads prefs.assetsRoot over config.assetsRoot', async () => {
  const fixture = stores()
  await fixture.stores.main.global.set({ ...fixture.global(), prefs: { ...fixture.global().prefs, assetsRoot: '  X:/prefs-root  ' } })
  const api = new AmphoreusWebApi({} as Context, {
    config: { ...fixtureConfig(), assetsRoot: 'X:/config-root' },
    stores: fixture.stores,
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: NONCE,
  })
  assert.equal(api.state().assets.root, 'X:/prefs-root')
  assert.equal(api.state().assets.rootSource, 'prefs')
  await fixture.stores.main.global.set({ ...fixture.global(), prefs: { ...fixture.global().prefs, assetsRoot: undefined } })
  assert.equal(api.state().assets.root, 'X:/config-root')
  assert.equal(api.state().assets.rootSource, 'config')
})

test('root changes force the next derive once, are refused while deriving, publish root/check SSE, and a seeded cache clears setupNeeded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-assets-force-'))
  try {
    const first = join(root, 'pack-a')
    const second = join(root, 'pack-b')
    await seedPackSignal(first)
    await seedPackSignal(second)
    const cache = join(root, 'cache')
    await mkdir(join(cache, 'aglaea'), { recursive: true })
    await writeFile(join(cache, 'aglaea', 'cover-34.webp'), 'derived-earlier')
    const fixture = stores()
    await fixture.stores.main.global.set({ ...fixture.global(), prefs: { ...fixture.global().prefs, assetsRoot: first } })
    const runs: Array<{ options: DeriveOptions; finish: (value: DeriveResult) => void }> = []
    const api = new AmphoreusWebApi({} as Context, {
      config: fixtureConfig(),
      stores: fixture.stores,
      resolver: { current: () => undefined } as unknown as SuiteResolver,
      nonce: NONCE,
      assetsCacheDir: cache,
      deriveAssets: options => new Promise<DeriveResult>(finish => { runs.push({ options, finish }) }),
      probeMagick: async () => 'Version: synthetic',
    })
    await api.prepareAssets()
    assert.equal(api.state().assets.rootSource, 'prefs')
    assert.equal(api.state().assets.derivedCount, 1)
    assert.equal(api.state().effectiveConfig.setupNeeded, false, 'a root plus a non-empty derived cache needs no wizard')

    const server = await listen(api)
    const sse = await subscribe(server.origin)
    const derive = (): Promise<Response> => send(server.origin, '/amphoreus/api/assets/derive', 'POST', {})
    const finishRun = async (index: number): Promise<void> => {
      const previous = api.state().assets.lastDerive
      runs[index]!.finish({ written: 0, skipped: 1, failed: [], startedAt: 1, finishedAt: 2 })
      await waitFor(() => api.state().assets.running === false && api.state().assets.lastDerive !== previous)
    }
    try {
      // Re-saving the same effective root is not a change: the following derive stays incremental.
      assert.equal((await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: first })).status, 200)
      assert.equal((await derive()).status, 202)
      await waitFor(() => runs.length === 1)
      assert.equal(runs[0]!.options.force, false)
      assert.equal(runs[0]!.options.assetsRoot, first)

      const busy = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: second })
      assert.equal(busy.status, 409, 'the root is pinned while a derive reads it')
      assert.match(((await busy.json()) as { error: string }).error, /running/u)
      assert.equal(fixture.global().prefs.assetsRoot, first)
      assert.equal((await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: null })).status, 409)
      await finishRun(0)

      const changed = await send(server.origin, '/amphoreus/api/assets/root', 'PUT', { root: second })
      assert.equal(changed.status, 200)
      assert.equal(fixture.global().prefs.assetsRoot, second)
      assert.equal((await derive()).status, 202)
      await waitFor(() => runs.length === 2)
      assert.equal(runs[1]!.options.force, true, 'the cache was produced from another root: the first derive after a change rewrites')
      assert.equal(runs[1]!.options.assetsRoot, second)
      await finishRun(1)
      assert.equal((await derive()).status, 202)
      await waitFor(() => runs.length === 3)
      assert.equal(runs[2]!.options.force, false, 'the force flag is consumed by exactly one derive')
      await finishRun(2)

      assert.equal((await send(server.origin, '/amphoreus/api/assets/check', 'POST', {})).status, 200)
      await waitFor(() => sse.events.some(value => value.event === 'state-change' && value.data.key === 'check'))
      const assetChanges = sse.events
        .filter(value => value.event === 'state-change' && value.data.table === 'assets')
        .map(value => `${String(value.data.key)}:${String(value.data.operation)}`)
      assert.deepEqual(assetChanges.filter(entry => !entry.startsWith('derive:')), ['root:put', 'root:put', 'check:put'])
      assert.equal(assetChanges.filter(entry => entry === 'derive:put').length, 6, 'three derives × (start + finish)')
      assert.ok(sse.events.every(value => value.event !== 'state-change' || value.data.domain === 'amphoreus'))
    } finally {
      await sse.stop()
      server.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
