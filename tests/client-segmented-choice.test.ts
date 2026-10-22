import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'

function harness() {
  const exports: Record<string, any> = {}
  const source = readFileSync(new URL('../src/client/segmented-choice.tsx', import.meta.url), 'utf8')
  const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  vm.runInNewContext(code, { exports, require: (name: string) => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : { default: {} }, getComputedStyle: (element: any) => ({ direction: element.direction }) })
  return exports
}

test('segmented choices wrap both directions, honor RTL and leave Tab and unrelated keys untouched', () => {
  const { rovingChoiceIndex: move } = harness()
  assert.equal(move('ArrowLeft', 0, 3), 2)
  assert.equal(move('ArrowRight', 2, 3), 0)
  assert.equal(move('ArrowRight', 0, 3, true), 2)
  assert.equal(move('ArrowUp', 0, 3), 2)
  assert.equal(move('End', 0, 3), 2)
  assert.equal(move('Home', 2, 3), 0)
  assert.equal(move('Tab', 0, 3), undefined)
  assert.equal(move('Enter', 0, 3), undefined)
  assert.equal(move('Home', 0, 0), undefined)
})

test('radio group has one tab stop and keyboard selection moves focus without scrolling', () => {
  const { SegmentedChoice } = harness()
  const changed: string[] = []
  const group = SegmentedChoice({ label: 'Background', value: 'none', choices: ['none', 'preset', 'custom'].map(value => ({ value, label: value })), onChange: (value: string) => changed.push(value) })
  const buttons = group.props.children
  assert.equal(group.props.role, 'radiogroup')
  assert.deepEqual(Array.from(buttons, (item: any) => item.props.tabIndex), [0, -1, -1])
  let focused = -1
  let prevented = false
  const event = {
    key: 'ArrowLeft', currentTarget: { direction: 'ltr', parentElement: { querySelectorAll: () => [0, 1, 2].map(index => ({ focus: (options: any) => { assert.equal(options.preventScroll, true); focused = index } })) } },
    preventDefault: () => { prevented = true },
  }
  buttons[0].props.onKeyDown(event)
  assert.equal(prevented, true)
  assert.equal(focused, 2)
  assert.deepEqual(changed, ['custom'])
  event.key = 'Tab'
  prevented = false
  buttons[0].props.onKeyDown(event)
  assert.equal(prevented, false)
  assert.equal(changed.length, 1)
})
