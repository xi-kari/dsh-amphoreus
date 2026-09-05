import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { createBootPayload } from '../src/host/firstframe.ts'

function config(assetsRoot: string): AmphoreusConfig {
  return {
    skillRoots: [], dataDir: '', assetsRoot, commonPath: '', relationsPath: '', sectionAliases: {}, providerName: '', providerSource: '', providerRank: 0, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: true, global: 'fixed', globalIndex: 2, sidebarIndex: 4, perSeat: true, darkMask: 0.18, lightMask: 0.03, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: [] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: '', ref: '', keepBackups: 3 }, trustedHosts: [],
    memory: { inject: true, autoNote: true, injectLimit: 8, command: 'remember' },
  }
}

test('derived wallpaper wins even without assetsRoot and null falls back to configured originals', () => {
  const derived = createBootPayload({
    config: config(''),
    nonce: 'n',
    current: () => undefined,
    derivedWallpaper: index => `/amphoreus/derived/_global/wallpaper-${index}.webp`,
  })
  assert.equal(derived.wallpaper.url, '/amphoreus/derived/_global/wallpaper-2.webp')
  assert.equal(derived.wallpaper.sidebarUrl, '/amphoreus/derived/_global/wallpaper-4.webp')

  const original = createBootPayload({
    config: config('X:/assets'),
    nonce: 'n',
    current: () => undefined,
    derivedWallpaper: () => null,
  })
  assert.match(original.wallpaper.url ?? '', /^\/amphoreus\/wallpaper\//u)
  assert.match(original.wallpaper.sidebarUrl ?? '', /^\/amphoreus\/wallpaper\//u)
})

test('host apply awaits asset preparation before route and first-frame registration', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const webApi = readFileSync(new URL('../src/host/webapi.ts', import.meta.url), 'utf8')
  const prepare = source.indexOf('await webApi?.prepareAssets()')
  const register = source.indexOf('webApi?.register()')
  const firstFrame = source.indexOf('registerFirstFrame(ctx')
  assert.ok(prepare >= 0 && prepare < register && register < firstFrame)
  assert.match(source, /assetsCacheDir: join\(dataDir, 'assets-cache'\)/u)
  assert.match(source, /derivedWallpaper: index => webApi\?\.derivedWallpaperUrl\(index\) \?\? null/u)
  assert.match(webApi, /register\(\): \(\) => void \{\s*void this\.prepareAssets\(\)\.catch/u)
  assert.match(webApi, /path === '\/amphoreus\/api\/state' \|\| path\.startsWith\('\/amphoreus\/derived\/'\)\) await this\.prepareAssets\(\)/u)
  const route = webApi.slice(webApi.indexOf('async #derivedRoute'), webApi.indexOf('async #serveLocalAsset'))
  const realpaths = [...route.matchAll(/realpath\(candidate\)/gu)].map(match => match.index)
  const opened = route.indexOf('open(beforeResolved')
  assert.equal(realpaths.length, 2)
  assert.ok(realpaths[0]! < opened && opened < realpaths[1]!)
  assert.match(route, /samePath\(beforeResolved, afterResolved\)[\s\S]*openedInfo\.dev !== pathInfo\.dev[\s\S]*openedInfo\.ino !== pathInfo\.ino/u)
})
