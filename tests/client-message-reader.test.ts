import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import { extractReaderCode } from '../src/client/message-reader-source.ts'
import { lockImagePreviewScroll } from '../src/client/image-preview-scroll.ts'

function flatten(tree: any): any[] { return Array.isArray(tree) ? tree.flatMap(flatten) : tree && typeof tree === 'object' ? [tree, ...flatten(tree.props?.children)] : [] }
function harness(entry = 'ReaderPanel', initial: Record<string, any> = {}) {
  const exports: Record<string, any> = {}, states: any[] = [], effects: any[] = [], memo: any[] = [], writes: string[] = [], requests: ((value: boolean) => void)[] = []
  let cursor = 0, pending: (() => void)[] = [], tree: any, closed = 0, overflow = 'clip', mutations = 0
  let headings = [{ textContent: 'Overview', tagName: 'H1', getBoundingClientRect: () => ({ top: 180 }), scrollIntoView: () => { throw new Error('Do not scroll ancestor documents') } },
    { textContent: 'Details', tagName: 'H2', getBoundingClientRect: () => ({ top: 320 }), scrollIntoView: () => { throw new Error('Do not scroll ancestor documents') } }]
  const scrolled: number[] = []
  let props: any = { text: '# Overview\n\nText.\n\n## Details\n\n```ts\n  const value = 1;  \n```\n', title: 'Reader test', open: true, onClose: () => { closed++ }, t: (key: string) => key, ...initial }
  const document = { body: { style: { getPropertyValue: () => overflow, getPropertyPriority: () => '', setProperty: (_: string, value: string) => { overflow = value }, removeProperty: () => { overflow = ''; return '' } } } }
  const jsx = (type: any, props: any, key: any) => ({ type, props, key })
  const useState = (initial: any) => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], (value: any) => { mutations++; states[i] = typeof value === 'function' ? value(states[i]) : value }] }
  const useRef = (value: any) => { const i = cursor++; return states[i] ??= { current: value } }
  const useMemo = (fn: () => any, deps: any[]) => { const i = cursor++, old = memo[i]; if (old && deps.length === old.deps.length && deps.every((value, k) => Object.is(value, old.deps[k]))) return old.value; const value = fn(); memo[i] = { deps, value }; return value }
  const useEffect = (fn: () => any, deps: any[]) => { const i = cursor++, old = effects[i]; if (old && deps.length === old.deps.length && deps.every((value, k) => Object.is(value, old.deps[k]))) return; pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() } }) }
  const code = transpileModule(readFileSync(new URL('../src/client/message-reader.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, document, window: { matchMedia: () => ({ matches: true }) },
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
      if (name === 'react') return { useState, useRef, useMemo, useEffect, useId: () => 'reader-test' }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal: 'native-modal', MarkdownText: 'native-markdown', CodeBlock: 'native-code', writeClipboard: (text: string) => { writes.push(text); return new Promise<boolean>(resolve => requests.push(resolve)) } }
      if (name.endsWith('message-reader-source.ts')) return { extractReaderCode }
      if (name.endsWith('image-preview-scroll.ts')) return { lockImagePreviewScroll }
      if (name.endsWith('segmented-choice.tsx')) return { SegmentedChoice: 'choice' }
      return { default: new Proxy({}, { get: (_, key) => key }) }
    },
  })
  function render(next: Record<string, any> = {}) {
    props = { ...props, ...next }; cursor = 0; pending = []; tree = exports[entry](props)
    for (const node of flatten(tree)) if (node.props.ref) node.props.ref.current = { querySelectorAll: () => headings, scrollTop: 40,
      getBoundingClientRect: () => ({ top: 100 }), scrollTo: ({ top }: { top: number }) => scrolled.push(top) }
    const ready = pending; pending = []; ready.forEach(fn => fn()); return tree
  }
  const find = (predicate: (node: any) => boolean) => { const result = flatten(tree).find(predicate); assert.ok(result); return result }
  const button = (label: string) => find(node => node.type === 'button' && (node.props['aria-label'] === label || node.props.children === label))
  const select = (value: string) => { find(node => node.type === 'choice').props.onChange(value); render(); render() }
  render(); render()
  return { render, find, button, select, writes, requests, scrolled, get tree() { return tree }, get closed() { return closed }, get overflow() { return overflow }, get mutations() { return mutations },
    setHeadings: (next: typeof headings) => { headings = next }, cleanup: () => { for (const effect of effects) effect?.cleanup?.() } }
}

test('reader opens through the native modal, keeps original Markdown, and releases its scroll lock', () => {
  const h = harness()
  assert.equal(h.tree.type, 'native-modal')
  assert.equal(h.tree.props.shortcutModal, 'amphoreus-message-reader')
  assert.equal(h.overflow, 'hidden')
  assert.equal(h.find(n => n.type === 'native-markdown').props.streaming, false)
  h.select('source')
  assert.match(h.find(n => n.props['data-reader-source'] !== undefined).props.children, /  const value = 1;  /)
  h.button('reader.close').props.onClick(); assert.equal(h.closed, 1)
  h.render({ open: false }); assert.equal(h.tree, null); assert.equal(h.overflow, 'clip')
  h.cleanup()
})

test('copy waits for clipboard settlement, exposes failure, and can retry the exact unchanged source', async () => {
  const original = '# A\r\n\r\n  source  \r\n'
  const h = harness('ReaderPanel', { text: original })
  const first = h.button('reader.copyBody').props.onClick(); h.render()
  assert.equal(h.writes[0], original)
  assert.equal(h.find(n => n.props.role === 'status').props.children, 'reader.copying')
  h.requests.shift()!(false); await first; h.render()
  assert.equal(h.find(n => n.props.role === 'alert').props.children, 'reader.copyFailed')
  const retry = h.button('reader.copyBody').props.onClick(); h.requests.shift()!(true); await retry; h.render()
  assert.equal(h.find(n => n.props.role === 'status').props.children, 'reader.copied')
  assert.deepEqual(h.writes, [original, original])
  h.cleanup()
})

test('a clipboard completion from an older document or an unmounted reader cannot publish status', async () => {
  const h = harness()
  const first = h.button('reader.copyBody').props.onClick()
  h.render({ text: '# Replacement' }); h.render()
  h.requests.shift()!(true); await first; h.render()
  assert.equal(flatten(h.tree).some(n => n.props.children === 'reader.copied'), false)
  const next = h.button('reader.copyBody').props.onClick(); h.cleanup()
  const before = h.mutations; h.requests.shift()!(true); await next
  assert.equal(h.mutations, before)
})

test('code tools keep native highlighting, toggle wrap and line numbers, and copy source without a numbered gutter', async () => {
  const h = harness(); h.select('code')
  const code = () => h.find(n => n.type === 'native-code')
  assert.equal(code().props.showHeader, false)
  assert.equal(code().props.streaming, false)
  assert.equal(code().props.code, '  const value = 1;  \n')
  h.button('reader.lineNumbers').props.onClick(); h.render()
  assert.equal(code().props.lineNumbers, true)
  h.button('reader.wrap').props.onClick(); h.render()
  assert.equal(code().props.wrap, false)
  h.button('reader.collapse').props.onClick(); h.render()
  assert.equal(h.find(n => n.props['data-reader-code-content'] !== undefined).props.hidden, true)
  h.button('reader.expand').props.onClick(); h.render()
  const copied = h.button('reader.copyCode').props.onClick(); h.requests.shift()!(true); await copied
  assert.deepEqual(h.writes, ['  const value = 1;  \n'])
  h.cleanup()
})

test('heading navigation is scoped to reader content and font controls remain bounded', () => {
  const h = harness()
  h.button('Details').props.onClick(); assert.deepEqual(h.scrolled, [248])
  for (let i = 0; i < 20; i++) { h.button('reader.larger').props.onClick(); h.render() }
  assert.equal(h.button('reader.larger').props.disabled, true)
  h.button('reader.resetSize').props.onClick(); h.render()
  assert.equal(h.button('reader.larger').props.disabled, false)
  h.cleanup()
})

test('the assistant action reads only the exact recorded message and never a live partial or reasoning text', () => {
  const nodes = [{ kind: 'assistant', messageId: 'other', blocks: [{ kind: 'text', text: 'other message' }] },
    { kind: 'assistant', messageId: 'target', blocks: [{ kind: 'reasoning', text: 'private reasoning' }, { kind: 'text', text: 'visible response' }, { kind: 'tool-call', name: 'read' }] }]
  const useChat = (select: (snapshot: any) => any) => select({ legacy: { nodes, partial: { text: 'live partial' } } })
  const h = harness('MessageReaderAction', { messageId: 'target', useChat })
  h.button('reader.open').props.onClick(); h.render()
  const panel = h.find(n => typeof n.type === 'function' && n.type.name === 'ReaderPanel')
  assert.equal(panel.props.open, true); assert.equal(panel.props.text, 'visible response')
  assert.equal(h.render({ messageId: 'missing' }), null)
  h.cleanup()
})
