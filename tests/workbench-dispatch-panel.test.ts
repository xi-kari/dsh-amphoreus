import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nfunction ', start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

test('dispatch panel, portal form, face propagation, and pipeline dispatch stay wired', () => {
  assert.match(source, /class="canvas-tab-all \$\{state\.seatId === 'all' \? 'active' : ''\}"/u)
  assert.match(source, /\$\{canvasTabs\}\$\{renderDispatchPanel\(\)\}\$\{view\}/u)
  assert.match(source, /<form class="portal-dispatch" data-portal-dispatch>/u)
  assert.match(source, /maxlength="200" placeholder="直接派发一句任务…"/u)
  assert.match(source, /post\('amphoreus:open-seat', \{ heroId: null, dispatchText: text \}\)/u)

  const chip = functionSource('seatChip')
  assert.match(chip, /data-face=/u)
  assert.match(chip, /stickerOrInitial\(candidate\.skill, 'chip'\)/u)
  const clicks = source.slice(source.indexOf("if (button.dataset.action === 'dispatch-pick'"), source.indexOf("if (button.dataset.action === 'toggle-dispatch-lane'"))
  assert.match(clicks, /face: button\.dataset\.face/u)
  assert.match(clicks, /face: first\.face/u)
  assert.match(clicks, /from: 'panel'/u)
  assert.match(clicks, /from: 'pipeline'/u)
  assert.match(clicks, /station: pipeline\.stations\.indexOf\(first\)/u)
  assert.doesNotMatch(clicks, /fetch\(|\/bindings/u)

  assert.equal(css.match(/@e-begin dispatch-panel/gu)?.length, 1)
  assert.equal(css.match(/@e-end dispatch-panel/gu)?.length, 1)
  assert.match(css, /\.seat-chip\.undeployed, \.station\.undeployed/u)
  assert.doesNotMatch(css.slice(css.indexOf('/* @e-begin dispatch-panel */')), /\[data-theme="dark"\]/u)
})

test('state and enter-seat messages recompute suggestions, defer full replacement, and settle dispatch RPC', () => {
  const stateStart = source.indexOf("if (data.type === 'amphoreus:state')")
  const enterStart = source.indexOf("if (data.type === 'amphoreus:enter-seat'", stateStart)
  const themeStart = source.indexOf("if (data.type === 'amphoreus:theme')", enterStart)
  assert.ok(stateStart >= 0 && enterStart > stateStart && themeStart > enterStart)
  const stateCase = source.slice(stateStart, enterStart)
  assert.match(stateCase, /updateDispatchSuggestions\(state\.dispatch\.text\)/u)
  assert.match(stateCase, /patchDispatchSuggestions\(\)/u)
  assert.match(stateCase, /scheduleViewRefresh\(\)/u)
  const enterCase = source.slice(enterStart, themeStart)
  assert.match(enterCase, /BOOT_MODE === 'tab'/u)
  assert.match(enterCase, /BOOT_MODE === 'portal'/u)
  assert.match(enterCase, /updateDispatchSuggestions\(data\.dispatchText\)/u)
  assert.match(enterCase, /enterSeat\(workspaceId\)/u)
  assert.match(source, /data\.type === 'amphoreus:dispatched' \|\| data\.type === 'amphoreus:handoff-accepted'/u)
})

test('deferred state refresh preserves focused input and renders the latest non-suggestion state after blur', () => {
  const timers: Array<() => void> = []
  const input = {
    value: '整理一下日志',
    selectionStart: 4,
    selectionEnd: 4,
    matches: (selector: string) => selector === 'textarea, input',
  }
  const context = {
    state: {
      draft: null,
      dragging: false,
      canvasGesture: false,
      canvasRefreshAfter: 0,
      nonSuggestionRevision: 1,
    },
    document: { activeElement: input as object | null },
    window: {
      setTimeout: (callback: () => void) => { timers.push(callback); return timers.length },
      clearTimeout: () => {},
    },
    Date,
    renders: [] as number[],
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`
    let deferredViewTimer = 0
    function render() { renders.push(state.nonSuggestionRevision) }
    ${functionSource('canReplaceView')}
    ${functionSource('scheduleViewRefresh')}
    globalThis.__schedule = scheduleViewRefresh
  `, context)
  const schedule = context.globalThis.__schedule as () => void

  schedule()
  context.state.nonSuggestionRevision = 2
  schedule()
  assert.equal(timers.length, 1)
  assert.deepEqual(context.renders, [])
  assert.equal(input.value, '整理一下日志')
  assert.equal(input.selectionStart, 4)
  assert.equal(input.selectionEnd, 4)

  context.document.activeElement = null
  timers[0]?.()
  assert.deepEqual(context.renders, [2])
})
