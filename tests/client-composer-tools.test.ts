import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import { draftMetrics } from '../src/client/composer-tools-model.ts'

test('draft statistics count Unicode code points and CRLF without estimating tokens', () => {
  assert.deepEqual(draftMetrics('中文😀\r\nnext\rline\n', 2, 3), { characters: 15, lines: 4, attachments: 2, references: 3 })
  assert.deepEqual(draftMetrics('', 0, 0), { characters: 0, lines: 0, attachments: 0, references: 0 })
})

test('draft preview and expanded writing area leave the native draft, attachments and submission untouched', () => {
  const exports: Record<string, any> = {}, values: any[] = [], effects: any[] = []
  let cursor = 0, pending: (() => void)[] = []
  const input = { draft: '# 正文\n保留原引用', attachmentIds: ['attachment-a'], occurrences: [{ id: 'reference-a' }] }
  const original = structuredClone(input)
  const useState = (initial: any) => {
    const slot = cursor++
    if (!(slot in values)) values[slot] = initial
    return [values[slot], (value: any) => { values[slot] = typeof value === 'function' ? value(values[slot]) : value }]
  }
  const source = transpileModule(readFileSync(new URL('../src/client/composer-tools.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(source, { exports, require: (name: string) => {
    if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    if (name === 'react') return { useState, useMemo: (fn: any) => fn(), useEffect: (fn: any, deps: any[]) => {
      const slot = cursor++, previous = effects[slot]
      if (!previous || deps.some((value, i) => value !== previous[i])) { pending.push(fn); effects[slot] = deps }
    } }
    if (name.endsWith('composer-tools-model.ts')) return { draftMetrics }
    if (name.endsWith('message-reader.tsx')) return { ReaderPanel: 'reader' }
    return { default: new Proxy({}, { get: (_, key) => key }) }
  } })
  const render = (sessionId = 'one') => {
    cursor = 0; pending = []
    const tree = exports.ComposerTools({ useInput: (select: any) => select(input), sessionId, t: (key: string) => key })
    pending.forEach(fn => fn())
    return tree
  }
  const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const get = (tree: any, predicate: (node: any) => boolean) => flatten(tree).find(predicate)
  let tree = render()
  get(tree, node => node.props['aria-label'] === 'composerTools.expand').props.onClick()
  tree = render(); assert.equal(tree.props['data-expanded'], true)
  get(tree, node => node.props['aria-label'] === 'composerTools.preview').props.onClick()
  tree = render()
  assert.equal(get(tree, node => node.type === 'reader').props.open, true)
  assert.equal(get(tree, node => node.type === 'reader').props.text, original.draft)
  assert.deepEqual(input, original)
  render('two'); tree = render('two')
  assert.equal(tree.props['data-expanded'], undefined)
  assert.equal(get(tree, node => node.type === 'reader').props.open, false)
  input.draft = ''
  tree = render('two')
  assert.equal(get(tree, node => node.props['aria-label'] === 'composerTools.preview').props.disabled, true)
})
