import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const garnish = readFileSync(new URL('../src/client/garnish.ts', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('TC11 assembles exact dependencies, singleton controllers, and slot order', () => {
  const injectMatch = /export const inject = \[([^\]]+)\]/u.exec(client)
  assert.notEqual(injectMatch, null)
  assert.deepEqual([...(injectMatch?.[1].matchAll(/'([^']+)'/gu) ?? [])].map(match => match[1]), [
    'slots',
    'locale',
    'theme',
    'sessions',
    'uiConversation',
    'workspaces',
    'uiWorkspace',
    'remote',
    'remote.session',
  ])

  const slots = [...client.matchAll(/ctx\.slots\.inject\('([^']+)'/gu)].map(match => match[1])
  assert.deepEqual(slots, [
    'sidebar.brand.mark',
    'sidebar.brand.name',
    'conversation.hero.brand.mark',
    'settings.section',
    'sidebar.workspaces',
    'conversation.session.header.actions',
    'conversation.session.header.utilities',
    'sidebar.footer.action',
    'shell.overlay',
    'conversation.view',
    'conversation.input.dock',
  ])
  assert.equal(client.includes('children'), false)

  const ordered = [
    "ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'amphoreus: dictionaries')",
    'const model = new AmphoreusClientModel()',
    "ctx.effect(() => registerGlobalTheme(ctx, model), 'amphoreus: global theme')",
    'const seatLayer = createSeatLayer(ctx, model)',
    'const seatTheme = registerSeatTheme(',
    'const portal = createPortalStore()',
    "ctx.slots.inject('sidebar.brand.mark'",
    'installGarnish({ assetsConfigured })',
    "ctx.slots.inject('settings.section'",
    "ctx.slots.inject('sidebar.workspaces'",
    "ctx.slots.inject('conversation.session.header.actions'",
    "ctx.slots.inject('conversation.session.header.utilities'",
    "ctx.slots.inject('sidebar.footer.action'",
    "ctx.slots.inject('shell.overlay'",
    "ctx.slots.inject('conversation.view'",
    "ctx.slots.inject('conversation.input.dock'",
  ].map(marker => {
    const index = client.indexOf(marker)
    assert.notEqual(index, -1, marker)
    return index
  })
  assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right))

  for (const [pattern, expected] of [
    [/const model = new AmphoreusClientModel\(\)/gu, 1],
    [/const themeBridge = \{/gu, 1],
    [/const magazineBridge = \{/gu, 1],
    [/const seatLayer = createSeatLayer\(ctx, model\)/gu, 1],
    [/const seatTheme = registerSeatTheme\(/gu, 1],
    [/const portal = createPortalStore\(\)/gu, 1],
    [/const enterSeatQueue = createEnterSeatQueue\(\)/gu, 1],
    [/const workspaces = createWorkspacesSource\(/gu, 1],
    [/const seatDeps: HandoffDeps = \{/gu, 1],
    [/const sessionsFace = /gu, 1],
    [/setSeat: seatTheme\.hint/gu, 2],
    [/magazine: magazineBridge/gu, 2],
    [/theme: themeBridge/gu, 2],
  ] as const) {
    assert.equal(client.match(pattern)?.length ?? 0, expected, String(pattern))
  }
})

test('all DeepSeek client imports are type-only and required SlotMap merges remain present', () => {
  const statements = [...client.matchAll(/^import[\s\S]*?from\s+['"](@deepseek-ai\/[^'"]+)['"]$/gmu)]
  assert.ok(statements.length > 0)
  for (const statement of statements) {
    assert.match(statement[0], /^import type\b/u, statement[1])
  }
  for (const moduleName of [
    '@deepseek-ai/dsh-api-workspace-controller/client',
    '@deepseek-ai/dsh-client-ui-session/client',
    '@deepseek-ai/dsh-client-ui-workspace/client',
    '@deepseek-ai/dsh-client-ui-layout/client',
  ]) {
    assert.equal(client.includes(moduleName), true, moduleName)
  }
})

test('garnish records the shadowed folder branch and keeps the appendChild exception contained', () => {
  assert.match(garnish, /遮蔽\s*\n \*\s+sidebar\.workspaces 后，目录图标替换自然失效；席位组自带徽记。/u)
  assert.match(garnish, /function swapFolderIcons\(/u)
  const clientDir = new URL('../src/client/', import.meta.url)
  for (const name of readdirSync(clientDir).filter(name => /\.(?:ts|tsx)$/u.test(name))) {
    const source = readFileSync(new URL(name, clientDir), 'utf8')
    if (name !== 'garnish.ts') assert.doesNotMatch(source, /document\.body\.appendChild/u, name)
  }
})

test('README distinguishes seat bindings from official directories and reports completed M3', () => {
  assert.equal(readme.match(/^## 席位与目录$/gmu)?.length, 1)
  const start = readme.indexOf('## 席位与目录')
  const end = readme.indexOf('\n## ', start + 1)
  const section = readme.slice(start, end)
  assert.match(section, /承办绑定维度/u)
  assert.match(section, /DSH 官方工作区维度/u)
  assert.match(section, /先预生成会话 ID 并写入席位绑定/u)
  assert.match(section, /fork 出的子会话继承父席/u)
  assert.match(section, /昔涟席代表全体会议与全局视觉层/u)

  const status = readme.split(/\r?\n/u).find(line => line.includes('`M3` 总空间派发')) ?? ''
  assert.match(status, /现已完成/u)
  assert.doesNotMatch(status, /尚待|待后续/u)
  assert.doesNotMatch(readme, /仍待后续章节兑现：`M3`/u)
})
