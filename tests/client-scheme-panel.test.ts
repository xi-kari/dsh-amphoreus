import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { AmphoreusClientModel } from '../src/client/state.ts'
import { en, zh } from '../src/client/locales.ts'

const panel = readFileSync(new URL('../src/client/scheme-panel.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
const state = readFileSync(new URL('../src/client/state.ts', import.meta.url), 'utf8')

const SCHEME_KEYS = [
  'settings.schemeHeading',
  'settings.schemeHint',
  'settings.schemeExport',
  'settings.schemeExporting',
  'settings.schemeImport',
  'settings.schemeImporting',
  'settings.schemeExported',
  'settings.schemeImported',
] as const

test('scheme locale keys exist in both dictionaries with parity and mention the binary exclusion', () => {
  for (const key of SCHEME_KEYS) {
    assert.equal(typeof zh[key], 'string', key)
    assert.equal(typeof en[key], 'string', key)
    assert.notEqual(zh[key], '')
    assert.notEqual(en[key], '')
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.match(zh['settings.schemeHint'], /不含壁纸文件本体/u)
  assert.equal(zh['settings.schemeExport'], '导出视觉方案')
  assert.equal(zh['settings.schemeImport'], '导入视觉方案')
  for (const key of SCHEME_KEYS) assert.match(panel, new RegExp(`'${key.replace('.', '\\.')}'`), key)
})

test('scheme panel is a self-contained section with a hidden JSON file input and no ctx', () => {
  assert.match(panel, /aria-labelledby="amphoreus-scheme"/u)
  assert.match(panel, /<h2 id="amphoreus-scheme">/u)
  assert.match(panel, /const ACCEPT = 'application\/json,\.json'/u)
  assert.match(panel, /className=\{css\.wpFile\}\s+type="file"/u)
  assert.match(panel, /event\.currentTarget\.value = ''/u)
  assert.match(panel, /input\.current\?\.click\(\)/u)
  assert.match(panel, /role="status" aria-live="polite"/u)
  assert.doesNotMatch(panel, /ctx|document\.body\.appendChild|fetch\(/u)
  assert.doesNotMatch(panel, /from '@deepseek-ai\//u)
})

test('settings mounts the scheme panel after the anchor and extends the action union at its tail', () => {
  assert.match(settings, /type SettingsAction = 'reparse'[\s\S]*'derive-force'[^\n]*\| 'scheme-export' \| 'scheme-import'\n/u)
  const anchor = settings.indexOf('{/* @anchor settings-panels */}')
  const workbench = settings.indexOf('aria-labelledby="amphoreus-workbench"')
  const mount = settings.indexOf('<SchemePanel')
  assert.ok(anchor >= 0 && anchor < mount && mount < workbench)
  const slice = settings.slice(mount, workbench)
  assert.match(slice, /run\('scheme-export', \(\) => model\.exportVisualScheme\(\)\)/u)
  assert.match(slice, /run\('scheme-import', \(\) => model\.importVisualScheme\(file\)\)/u)
  assert.match(slice, /errored=\{actionError !== undefined\}/u)
  // The visual→workbench slice of settings.tsx itself still holds no raw inputs (the file input lives in scheme-panel.tsx).
  const visual = settings.indexOf('aria-labelledby="amphoreus-visual"')
  assert.doesNotMatch(settings.slice(visual, workbench), /<input|<textarea/u)
})

test('client model export/import use the visual-scheme route with the shared fetch shape', () => {
  const start = state.indexOf('async exportVisualScheme')
  const end = state.indexOf('close(): void')
  const block = state.slice(start, end)
  assert.match(block, /fetch\('\/amphoreus\/api\/prefs\/visual-scheme', \{ credentials: 'include', cache: 'no-store' \}\)/u)
  assert.match(block, /URL\.createObjectURL\(blob\)[\s\S]*anchor\.download = 'amphoreus-visual-scheme\.json'[\s\S]*URL\.revokeObjectURL\(url\)/u)
  assert.match(block, /async importVisualScheme\(file: File\)/u)
  assert.match(block, /await file\.text\(\)/u)
  assert.match(block, /'视觉方案文件不是有效 JSON'/u)
  assert.match(block, /method: 'PUT',\s+credentials: 'include',\s+headers: \{ 'content-type': 'application\/json', 'x-amphoreus-nonce': nonce \}/u)
  assert.match(block, /response\.status === 400[\s\S]*视觉方案文件无效：/u)
  assert.match(block, /response\.status === 413[\s\S]*过大/u)
  assert.match(block, /await this\.refresh\(\)/u)
})

test('importVisualScheme maps JSON parse failures and HTTP statuses to localized errors, then refreshes', async () => {
  const oldFetch = globalThis.fetch
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let status = 200
  let refreshed = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/amphoreus/api/state') {
      refreshed += 1
      return { ok: true, status: 200, json: async () => ({ revision: 1, nonce: 'n', assets: { running: false } }) } as unknown as Response
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ error: 'grammar.frostScale Number must be less than or equal to 1.4' }),
    } as unknown as Response
  }) as typeof fetch
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout, clearTimeout, __AMPHOREUS_BOOT__: { nonce: 'scheme-nonce' } },
  })
  try {
    const model = new AmphoreusClientModel()
    const file = (text: string) => ({ text: async () => text }) as unknown as File

    await assert.rejects(model.importVisualScheme(file('{not json')), /视觉方案文件不是有效 JSON/u)
    assert.equal(calls.length, 0, 'invalid JSON never reaches the network')

    status = 400
    await assert.rejects(model.importVisualScheme(file('{"version":1,"grammar":{"frostScale":3}}')), /视觉方案文件无效：grammar\.frostScale/u)
    status = 413
    await assert.rejects(model.importVisualScheme(file('{"version":1}')), /过大/u)
    status = 403
    await assert.rejects(model.importVisualScheme(file('{"version":1}')), /HTTP 403/u)
    assert.equal(refreshed, 0, 'failed imports do not refresh')

    status = 200
    await model.importVisualScheme(file('{"version":1,"magazineMode":"full"}'))
    const put = calls.filter(call => call.init?.method === 'PUT').at(-1)
    assert.ok(put !== undefined)
    assert.equal(put.url, '/amphoreus/api/prefs/visual-scheme')
    assert.deepEqual(put.init?.headers, { 'content-type': 'application/json', 'x-amphoreus-nonce': 'scheme-nonce' })
    assert.equal(put.init?.body, '{"version":1,"magazineMode":"full"}')
    assert.equal(refreshed, 1)
    model.close()
  } finally {
    globalThis.fetch = oldFetch
    if (oldWindow === undefined) delete (globalThis as { window?: unknown }).window
    else Object.defineProperty(globalThis, 'window', oldWindow)
  }
})

test('exportVisualScheme downloads the GET body through a temporary object URL', async () => {
  const oldFetch = globalThis.fetch
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const oldCreate = URL.createObjectURL
  const oldRevoke = URL.revokeObjectURL
  const events: string[] = []
  const anchor: Record<string, unknown> = { click: () => { events.push(`click ${String(anchor.href)} ${String(anchor.download)}`) } }
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    events.push(`fetch ${String(input)} ${String(init?.cache)}`)
    return { ok: true, status: 200, blob: async () => ({ size: 12, type: 'application/json' }) } as unknown as Response
  }) as typeof fetch
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor } })
  URL.createObjectURL = () => { events.push('create'); return 'blob:amphoreus/1' }
  URL.revokeObjectURL = url => { events.push(`revoke ${url}`) }
  try {
    const model = new AmphoreusClientModel()
    await model.exportVisualScheme()
    assert.deepEqual(events, [
      'fetch /amphoreus/api/prefs/visual-scheme no-store',
      'create',
      'click blob:amphoreus/1 amphoreus-visual-scheme.json',
      'revoke blob:amphoreus/1',
    ])
    model.close()
  } finally {
    globalThis.fetch = oldFetch
    URL.createObjectURL = oldCreate
    URL.revokeObjectURL = oldRevoke
    if (oldDocument === undefined) delete (globalThis as { document?: unknown }).document
    else Object.defineProperty(globalThis, 'document', oldDocument)
  }
})
