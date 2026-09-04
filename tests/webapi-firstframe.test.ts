import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { createBootPayload, createFirstFrameRows } from '../src/host/firstframe.ts'
import { parseSuite, type SuiteTextFile } from '../src/host/suite/parse.ts'
import { publicSuite, trustedHost, workbenchPage } from '../src/host/webapi.ts'
import { ProjectionIndex, type HiddenStore } from '../src/host/workbench.ts'
import { GLOBAL_WALLPAPERS } from '../src/shared/heroes.ts'
import { ASSISTANT, RUNTIME_CONTEXT, SKILL_INJECT, TOOL_CALL, TOOL_RESULT, TURN_END_ERROR, TURN_START, USER_PLAIN } from './fixtures/session-events.ts'

test('first-frame rows put boot data first and add wallpaper style/html/script only when enabled', () => {
  const config = fixtureConfig()
  const snapshot = fixtureSnapshot()
  const options = { config, nonce: 'fixture-nonce', current: () => snapshot, wallpaperIndex: 2 }
  const boot = createBootPayload(options)
  assert.equal(boot.revision, snapshot.generation)
  assert.equal(boot.level, 'L0')
  assert.equal(boot.nonce, 'fixture-nonce')
  assert.deepEqual(boot.workbench, { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true })
  assert.equal(boot.wallpaper.url, undefined)
  assert.equal(boot.wallpaper.sidebarUrl, undefined)

  const rows = createFirstFrameRows(options)
  assert.deepEqual(rows.map(row => row.kind), ['global', 'style', 'html', 'script'])
  assert.equal(rows[0]?.kind, 'global')
  assert.equal(rows[0]?.kind === 'global' ? rows[0].name : '', '__AMPHOREUS_BOOT__')
  assert.equal(rows.some(row => row.kind === 'style' && row.text.includes('#amphoreus-wallpaper')), true)
  assert.equal(rows.some(row => row.kind === 'style' && row.text.includes('[data-amphoreus-sidebar-surface]')), true)
  assert.equal(rows.some(row => row.kind === 'style' && row.text.includes('--amphoreus-wallpaper-veil-rgb: 55, 48, 94')), true)
  assert.equal(rows.some(row => row.kind === 'html' && row.html.includes('id="amphoreus-wallpaper"')), true)
  assert.equal(rows.some(row => row.kind === 'html' && row.html.includes('id="amphoreus-sidebar-wallpaper"')), false)
  assert.equal(rows.some(row => row.kind === 'script' && row.text.includes('requestAnimationFrame(mountSidebarSurface)')), true)
  assert.equal(rows.some(row => row.kind === 'script' && row.text.includes('</script')), false)

  const style = rows.find(row => row.kind === 'style')
  const html = rows.find(row => row.kind === 'html')
  const script = rows.find(row => row.kind === 'script')
  assert.equal(style?.kind, 'style')
  assert.equal(html?.kind, 'html')
  assert.equal(script?.kind, 'script')
  if (style?.kind === 'style') {
    assert.equal(style.text.includes('#amphoreus-wallpaper::after'), true)
    assert.equal(style.text.includes('--amphoreus-wallpaper-url: none'), true)
    assert.equal(style.text.includes('data-amphoreus-seat="anaxa"'), true)
    assert.equal(style.text.includes('data-amphoreus-seat="cyrene"'), false)
    assert.equal(style.text.match(/data-amphoreus-seat="/g)?.length, 24)
  }
  if (html?.kind === 'html') {
    assert.equal(html.html.split('class="amphoreus-seat-layer"').length, 3)
    assert.equal(html.html.includes('data-slot="0"'), true)
    assert.equal(html.html.includes('data-slot="1"'), true)
  }
  if (script?.kind === 'script') {
    assert.equal(script.text.includes("startsWith('seat:')"), true)
    assert.ok(script.text.indexOf("localStorage.getItem('dsh-amphoreus:last-seat')") < script.text.indexOf("layer.style.setProperty('--amphoreus-wallpaper-url'"))
  }

  const disabled = createFirstFrameRows({ ...options, config: { ...config, wallpaper: { ...config.wallpaper, enabled: false } } })
  assert.deepEqual(disabled.map(row => row.kind), ['global'])
})

test('workbench page escapes boot json and carries nonce + workbench config', () => {
  const html = workbenchPage({
    nonce: 'n<1',
    revision: 3,
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
  })
  assert.equal(html.includes('globalThis.__AMPHOREUS_BOOT__='), true)
  assert.equal(html.includes('"nonce":"n\\u003c1"'), true)
  assert.equal(html.includes('n<1'), false)
  assert.equal(html.includes('"cardTextLimit":8000'), true)
})

test('first-frame boot emits distinct main and sidebar wallpaper URLs when assetsRoot is configured', () => {
  const config = fixtureConfig()
  const boot = createBootPayload({
    config: { ...config, assetsRoot: 'X:/assets', wallpaper: { ...config.wallpaper, global: 'fixed', globalIndex: 4, sidebarIndex: 5 } },
    nonce: 'n',
    current: () => undefined,
  })
  assert.equal(boot.level, 'loading')
  assert.equal(boot.wallpaper.url, `/amphoreus/wallpaper/${encodeURIComponent(GLOBAL_WALLPAPERS[4]!)}`)
  assert.equal(boot.wallpaper.sidebarUrl, `/amphoreus/wallpaper/${encodeURIComponent(GLOBAL_WALLPAPERS[5]!)}`)
  assert.notEqual(boot.wallpaper.url, boot.wallpaper.sidebarUrl)
})

test('public suite contains UI contracts but excludes card body, card path and section payloads', () => {
  const suite = publicSuite(fixtureSnapshot())
  const json = JSON.stringify(suite)
  assert.equal(suite.cards.length, 1)
  assert.equal(suite.cards[0]?.name, 'amphoreus-testcard-a')
  assert.equal(json.includes('SECRET_CARD_BODY'), false)
  assert.equal(json.includes('amphoreus-testcard-a/SKILL.md'), false)
  assert.equal(json.includes('"body"'), false)
  assert.equal(json.includes('"sections"'), false)
  assert.notEqual(suite.contracts?.receipt?.source, undefined)
})

test('host fence accepts loopback authorities and exact configured hosts only', () => {
  assert.equal(trustedHost('localhost:3080', []), true)
  assert.equal(trustedHost('127.0.0.1:3080', []), true)
  assert.equal(trustedHost('[::1]:3080', []), true)
  assert.equal(trustedHost('devbox.local:3080', ['devbox.local:3080']), true)
  assert.equal(trustedHost('devbox.local:3081', ['devbox.local:3080']), false)
  assert.equal(trustedHost('evil.example', []), false)
  assert.equal(trustedHost(undefined, []), false)
})

test('index route payload has no text', () => {
  const hidden: HiddenStore = {
    get: () => [],
    set: async () => {},
  }
  const index = new ProjectionIndex(hidden)
  index.replay({
    id: 'session-00000000-0000-0000-0000-000000000001',
    events: [TURN_START, RUNTIME_CONTEXT, SKILL_INJECT, USER_PLAIN, TOOL_CALL, ASSISTANT, TOOL_RESULT, TURN_END_ERROR],
  })

  const payload = JSON.stringify(index.list())
  assert.doesNotMatch(payload, /FIXTURE_/u)
  assert.equal(payload.includes('帮我看看这个'), false)
  assert.equal(payload.includes('"text"'), false)
  assert.equal(payload.includes('"arguments"'), false)
  index.flush()
})

function fixtureSnapshot() {
  const root = { index: 0, configured: 'X:/fixture', expanded: 'X:/fixture', canonical: 'X:/fixture' }
  return parseSuite({
    root,
    roots: [root],
    router: text('X:/fixture/amphoreus/SKILL.md', '---\nname: amphoreus\ndescription: fixture\ndisable-model-invocation: true\n---\n## 必读分层\n- `角色未部署｜原因：module_unavailable｜未完成职责：<职责>`\n## 分派表\n| 需求 | 角色与 skill |\n|---|---|\n| 规划 | 晨星 `amphoreus-testcard-a` |\n## 流水线与会诊\n'),
    common: text('X:/fixture/amphoreus/references/common.md', '# common\n## 深度门\n| 深度 | 条件 | 形态 |\n|---|---|---|\n| L0 | 简单 | 单卡 |\n- `角色未部署｜原因：module_unavailable｜未完成职责：<职责>`\n## 风格税\n| 档位 | 范围 | 用途 |\n|---|---|---|\n| 标准 | 中 | 默认 |\n## 移交与流水线\n- `此事移交◯◯：<内容>`\n## 汇报与回执\n- `◯◯卡｜读取：<内容>｜档位：标准／静音`\n'),
    cards: [{
      dir: 'amphoreus-testcard-a',
      skill: text('X:/fixture/amphoreus-testcard-a/SKILL.md', '---\nname: amphoreus-testcard-a\ndescription: fixture amphoreus-testcard-a／晨星；\ndisable-model-invocation: true\n---\nSECRET_CARD_BODY\n## 身份与职能\n- 编号一\n## 输出模板\n- `晨星卡｜读取：common.md｜档位：标准／静音`\n## 协作与移交\n'),
    }],
  }, { parsedAt: 1, generation: 9 })
}

function text(path: string, content: string): SuiteTextFile {
  return { path, content }
}

function fixtureConfig(): AmphoreusConfig {
  return {
    skillRoots: ['X:/fixture'], dataDir: '', assetsRoot: '', commonPath: 'amphoreus/references/common.md', relationsPath: 'amphoreus/references/relations.md',
    sectionAliases: {}, providerName: 'dsh-amphoreus', providerSource: 'amphoreus', providerRank: 300, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: true, global: 'fixed', globalIndex: 4, sidebarIndex: 5, perSeat: true, darkMask: 0.18, lightMask: 0.03, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: ['startup', 'clear'] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
    suiteWatch: { mode: 'off', pollMs: 15000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: 'fixture', ref: 'main', keepBackups: 3 }, trustedHosts: [],
  }
}
