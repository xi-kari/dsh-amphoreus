import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { buildMatchers, extractObservations } from '../src/host/observer.ts'
import { fixtureSnapshot } from './fixture-suite.ts'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const context = vm.createContext({
  escapeHtml: (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)),
})
vm.runInContext(source.slice(source.indexOf('function inlineMarkdown('), source.indexOf('const clampCardText')), context)
const render = (value: string): string => vm.runInContext(`renderMarkdown(${JSON.stringify(value)})`, context)
const receipt = '晨星卡｜读取：common.md、persona.md｜档位：标准'

test('roundtable ledger is collapsed separately from dialogue and still records the receipt', () => {
  const snapshot = fixtureSnapshot()
  for (const input of [
    `「晨星」我有不同的看法。\n\n<details><summary>台账</summary>\n\n${receipt}\n\n</details>`,
    `「晨星」我有不同的看法。\n<details>\n<summary>台账</summary>\n${receipt}\n</details>`,
    `「晨星」我有不同的看法。\n<details><summary>台账</summary>${receipt}</details>`,
  ]) {
    const html = render(input)
    assert.match(html, /<p>「晨星」我有不同的看法。<\/p><details class="audit-ledger"><summary>台账<\/summary>/)
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/)
    assert.doesNotMatch(html, /&lt;\/?(?:details|summary)&gt;/)
    assert.ok(html.includes(receipt))
    const observations = extractObservations(input, buildMatchers(snapshot), snapshot.nameIndex)
    assert.equal(observations.length, 1)
    assert.equal(observations[0]?.kind, 'receipt')
    assert.equal(observations[0]?.rawLine, receipt)
  }
})

test('ledger content keeps markdown while arbitrary HTML and attributes remain escaped', () => {
  const html = render('<details><summary>台账</summary>\n**证据**\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n</details>')
  assert.match(html, /<strong>证据<\/strong>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script|<img/)
  for (const input of [
    '<details open><summary>台账</summary>正文</details>',
    '<details onclick="alert(1)"><summary>台账</summary>正文</details>',
    '<details><summary onclick="alert(1)">台账</summary>正文</details>',
    '<details><summary>其他</summary>正文</details>',
    '<details><summary>台账</summary>未完成',
  ]) assert.doesNotMatch(render(input), /<details\b/)
})

test('backtick and tilde code examples never become live ledger blocks or receipts', () => {
  const snapshot = fixtureSnapshot()
  for (const fence of ['```', '~~~~']) {
    const input = `${fence}html\n<details><summary>台账</summary>\n${receipt}\n</details>\n${fence}`
    assert.doesNotMatch(render(input), /<details\b/)
    assert.match(render(input), /<pre><code>/)
    assert.deepEqual(extractObservations(input, buildMatchers(snapshot), snapshot.nameIndex), [])
  }
  assert.doesNotMatch(render('```html\n<details><summary>台账</summary>隐藏</details>'), /<details\b/)
})

test('a closing-tag example inside a ledger code fence does not end the ledger early', () => {
  const html = render('<details><summary>台账</summary>\n```html\n</details>\n```\n最后一行\n</details>\n正文尾声')
  assert.match(html, /<pre><code>&lt;\/details&gt;<\/code><\/pre>/)
  assert.match(html, /最后一行<\/p><\/div><\/details><p>正文尾声<\/p>/)
})

test('a fence immediately after the summary keeps receipt examples inactive', () => {
  const snapshot = fixtureSnapshot()
  for (const fence of ['```', '~~~~']) {
    const input = `<details><summary>台账</summary>${fence}text\n${receipt}\n${fence}\n</details>`
    assert.match(render(input), /<pre><code>/)
    assert.deepEqual(extractObservations(input, buildMatchers(snapshot), snapshot.nameIndex), [])
  }
})
