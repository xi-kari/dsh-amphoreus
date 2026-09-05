import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const appSource = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = appSource.indexOf('\nfunction ', start + marker.length)
  return appSource.slice(start, next === -1 ? undefined : next)
}

function fixture() {
  const state = {
    amph: {
      observations: [
        {
          sessionId: 'source', seq: 7, kind: 'handoff', status: 'open',
          targetSkillName: 'amphoreus-phainon', targetDisplayName: '白厄', payload: '<旧移交>',
        },
        {
          sessionId: 'source', seq: 9, kind: 'handoff', status: 'open',
          targetSkillName: 'amphoreus-phainon', targetDisplayName: '白厄',
          payload: `<${'甲'.repeat(79)}🦋尾>`,
        },
        {
          sessionId: 'source', seq: 11, kind: 'handoff', status: 'accepted',
          targetSkillName: 'amphoreus-phainon', targetDisplayName: '白厄', payload: '<已接受>',
        },
        {
          sessionId: 'source', seq: Number.MAX_SAFE_INTEGER + 1, kind: 'handoff', status: 'open',
          targetSkillName: 'amphoreus-phainon', targetDisplayName: '白厄', payload: '<坏序号>',
        },
      ],
      effectiveConfig: { handoffEnabled: true, magazineMode: 'full' },
    },
    seats: [
      {
        skillName: 'amphoreus-phainon', displayName: '白厄', deployed: true,
        stickerUrl: '/amphoreus/assets/phainon.webp', hue: 42,
      },
    ],
  }
  const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
  const context = {
    state,
    escapeHtml,
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`
    const handoffRpcBusy = new Set()
    ${functionSource('hashHue')}
    ${functionSource('deployedSkill')}
    ${functionSource('openHandoffOf')}
    ${functionSource('handoffSummary')}
    ${functionSource('renderConnectingTail')}
    globalThis.__openHandoffOf = openHandoffOf
    globalThis.__renderConnectingTail = renderConnectingTail
  `, context)
  return {
    state,
    openHandoffOf: context.globalThis.__openHandoffOf as (sessionId: string) => Record<string, unknown> | undefined,
    renderConnectingTail: context.globalThis.__renderConnectingTail as (thread: { dshSessionId: string }) => string,
  }
}

test('the detail tail selects the latest safe open handoff and truncates by Unicode code point', () => {
  const { openHandoffOf, renderConnectingTail } = fixture()
  assert.equal(openHandoffOf('source')?.seq, 9)
  assert.equal(openHandoffOf('other'), undefined)

  const html = renderConnectingTail({ dshSessionId: 'source' })
  assert.match(html, /class="connecting-tail" data-magazine="full"/u)
  assert.match(html, /<h3>白厄<\/h3>/u)
  assert.match(html, /src="\/amphoreus\/assets\/phainon\.webp"/u)
  assert.match(html, new RegExp(`${'甲'.repeat(79)}🦋…`))
  assert.doesNotMatch(html, /尾/u)
  assert.doesNotMatch(html, /�/u)
  assert.match(html, /data-action="accept-handoff"[^>]*data-seq="9"[^>]*>移交<\/button>/u)
  assert.match(html, /data-action="dismiss-handoff"[^>]*>忽略<\/button>/u)
})

test('the tail honors feature and deployment gates without offering an accept action for an absent seat', () => {
  const { state, renderConnectingTail } = fixture()
  state.seats[0]!.deployed = false
  const absent = renderConnectingTail({ dshSessionId: 'source' })
  assert.match(absent, /connecting-tail absent/u)
  assert.match(absent, /角色未部署/u)
  assert.doesNotMatch(absent, /data-action="accept-handoff"/u)
  assert.match(absent, /data-action="dismiss-handoff"/u)

  state.amph.effectiveConfig.handoffEnabled = false
  assert.equal(renderConnectingTail({ dshSessionId: 'source' }), '')
})

test('rendering, card badge, RPC settlement and activation order preserve the TE8 contract', () => {
  assert.equal(appSource.split('移交物').length - 1, 1)
  assert.match(appSource, /class="connecting-summary" title="移交物"/u)
  assert.doesNotMatch(functionSource('renderConnectingTail'), /档位|读取/u)

  const renderThread = functionSource('renderThread')
  const messages = renderThread.indexOf("messages.map(message => threadMessage(thread, message)).join('')")
  const tail = renderThread.indexOf('renderConnectingTail(thread)')
  const scrollEnd = renderThread.indexOf('</div><form class="message-composer"')
  assert.ok(messages >= 0 && messages < tail && tail < scrollEnd)

  const card = functionSource('conversationCard')
  assert.match(card, /openHandoff\?\.seq === card\.answer\.sourceSeq/u)
  assert.match(card, /class="card-handoff-open">待移交/u)

  const actionStart = appSource.indexOf("if (button.dataset.action === 'accept-handoff' || button.dataset.action === 'dismiss-handoff')")
  const actionEnd = appSource.indexOf("if (button.dataset.action === 'enter-seat'", actionStart)
  const action = appSource.slice(actionStart, actionEnd)
  assert.match(action, /optionalSafeInteger\(button\.dataset\.seq\)/u)
  assert.match(action, /openHandoffOf\(sessionId\)/u)
  assert.match(action, /observation\.seq !== seq/u)
  assert.match(action, /deployedSkill\(observation\.targetSkillName\)/u)
  assert.ok(action.indexOf('handoffRpcBusy.add(key)') < action.indexOf("await dshRpc('amphoreus:accept-handoff'"))
  assert.ok(action.indexOf("typeof session?.id !== 'string'") < action.indexOf('state.mapCardSessionSwitches.add(session.id)'))
  assert.ok(action.indexOf('state.mapCardSessionSwitches.add(session.id)') < action.indexOf('await refreshIndex()'))
  assert.ok(action.indexOf('await refreshIndex()') < action.indexOf("post('amphoreus:activate-session', { sessionId: session.id })"))
  assert.match(appSource, /data\.type === 'amphoreus:handoff-accepted' \|\| data\.type === 'amphoreus:handoff-dismissed'\) settleRpc/u)
})

test('connecting-tail CSS has one bounded marker block, token fallbacks, and no new dark selector', () => {
  assert.equal(cssSource.split('/* @e-begin connecting-tail */').length - 1, 1)
  assert.equal(cssSource.split('/* @e-end connecting-tail */').length - 1, 1)
  const start = cssSource.indexOf('/* @e-begin connecting-tail */')
  const end = cssSource.indexOf('/* @e-end connecting-tail */', start)
  const block = cssSource.slice(start, end)
  assert.match(block, /\.connecting-tail \{/u)
  assert.match(block, /\.connecting-tail\.absent/u)
  assert.match(block, /\.card-handoff-open/u)
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/u)
  assert.doesNotMatch(block, /\[data-theme=["']?dark/u)
  for (const line of block.split('\n').filter(candidate => /#[0-9a-fA-F]{3,8}\b/u.test(candidate))) {
    assert.match(line, /var\(--dsw-alias-[a-z0-9-]+,/u)
  }
})
