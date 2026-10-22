import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import { WIDGET_PREF_DEFAULTS } from '../src/shared/api.ts'
import { en, zh } from '../src/client/locales.ts'

function flatten(tree: any): any[] { return Array.isArray(tree) ? tree.flatMap(flatten) : tree && typeof tree === 'object' ? [tree, ...flatten(tree.props?.children)] : [] }
function harness() {
  const exports: Record<string, any> = {}
  const state: any[] = []; let cursor = 0
  const code = transpileModule(readFileSync(new URL('../src/client/widget-settings-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  }).outputText
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'react') return { useEffect: () => {}, useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value: any) => { state[index] = value }] } }
    return { default: new Proxy({}, { get: (_, name) => name }) }
  } })
  return { ...exports, render: (props: any) => { cursor = 0; return exports.WidgetSettingsPanel(props) } }
}

test('auto-hide settings accept only bounded integer seconds without inventing a value for blank input', () => {
  const { widgetAutoHideSeconds: parse } = harness()
  assert.equal(parse(''), undefined)
  assert.equal(parse('invalid'), undefined)
  assert.equal(parse('Infinity'), undefined)
  assert.equal(parse('-1'), 0)
  assert.equal(parse('301'), 300)
  assert.equal(parse('8.5'), 9)
})

test('actual settings controls preserve disabled values, send patches, commit seconds and reset to defaults', () => {
  const { render } = harness()
  const patches: any[] = []
  const t = (key: keyof typeof zh, params: Record<string, unknown> = {}) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key])
  const props = { prefs: WIDGET_PREF_DEFAULTS, busy: false, refreshMs: 60000, t, onPatch: (patch: any) => patches.push(patch) }
  let tree = render(props)
  const find = (fn: (node: any) => boolean) => { const result = flatten(tree).find(fn); assert.ok(result); return result }
  find(node => node.props.id === 'amphoreus-widget-allowTopDock').props.onChange({ currentTarget: { checked: true } })
  assert.equal(patches[0].allowTopDock, true)
  find(node => node.props.id === 'amphoreus-widget-seconds').props.onChange({ currentTarget: { value: '301' } })
  tree = render(props)
  find(node => node.props.id === 'amphoreus-widget-seconds').props.onBlur()
  assert.equal(patches[1].autoHideSeconds, 300)
  find(node => node.type === 'button').props.onClick()
  assert.equal(patches[2], null)
  assert.ok(flatten(tree).some(node => node.props.children === '余额查询周期约 60 秒；手动刷新可立即查询。'))
  tree = render({ ...props, prefs: { ...WIDGET_PREF_DEFAULTS, enabled: false } })
  assert.equal(find(node => node.props.id === 'amphoreus-widget-enabled').props.disabled, false)
  assert.equal(find(node => node.props.id === 'amphoreus-widget-allowTopDock').props.disabled, true)
  assert.equal(find(node => node.props.id === 'amphoreus-widget-seconds').props.disabled, true)
})

test('widget strings exist in both languages and settings invokes the model persistence method', () => {
  const keys = Object.keys(zh).filter(key => key.startsWith('mascot.') || key.startsWith('widget.') || key.startsWith('settings.widget')) as (keyof typeof zh)[]
  assert.ok(keys.length > 30)
  for (const key of keys) { assert.ok(zh[key]); assert.ok(en[key]) }
  const source = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
  assert.match(source, /<WidgetSettingsPanel/u)
  assert.match(source, /model\.setWidgetPrefs\(patch\)/u)
  assert.match(source, /state\.widget\?\.refreshMs/u)
})
