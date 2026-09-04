/**
 * Lexical-layer tests for src/host/suite/markdown.ts. All fixtures use
 * fictional card names (amphoreus-testcard-*) and invented Chinese words —
 * no real suite text may appear here (设计底账 05 §1.1 第 1 条).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeContent, splitFrontmatter, parseFrontmatterFields,
  sectionize, parseTable, inlineCodes, normalizeLine,
} from '../src/host/suite/markdown.ts'

// --- normalizeContent -------------------------------------------------------

test('normalizeContent strips BOM and CRLF, keeps U+2022 vs U+00B7 distinct', () => {
  assert.equal(normalizeContent('﻿abc\r\ndef'), 'abc\ndef')
  const dots = '甲•乙 丙·丁'
  assert.equal(normalizeContent(dots), dots)
})

// --- splitFrontmatter -------------------------------------------------------

const OK_CARD = `---
name: amphoreus-testcard-a
description: 试验卡甲
disable-model-invocation: true
---
正文首行
`

test('splitFrontmatter parses a valid block and reports the body start line', () => {
  const result = splitFrontmatter(OK_CARD)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.data.name, 'amphoreus-testcard-a')
  assert.equal(result.body, '正文首行\n')
  assert.equal(result.bodyStartLine, 6)
})

test('splitFrontmatter: first line must be exactly ---', () => {
  assert.equal(splitFrontmatter('--- \nname: x\n---\nbody').kind, 'none')
  assert.equal(splitFrontmatter('name: x\n---\nbody').kind, 'none')
  assert.equal(splitFrontmatter('no newline at all').kind, 'none')
})

test('splitFrontmatter: unterminated block is no frontmatter', () => {
  assert.equal(splitFrontmatter('---\nname: x\nbody without closing').kind, 'none')
})

test('splitFrontmatter: non-object YAML (array, scalar, null) is no frontmatter', () => {
  assert.equal(splitFrontmatter('---\n- a\n- b\n---\nbody').kind, 'none')
  assert.equal(splitFrontmatter('---\nплain\n---\nbody').kind, 'none')
  assert.equal(splitFrontmatter('---\n\n---\nbody').kind, 'none')
})

test('splitFrontmatter: broken YAML reports yaml-error', () => {
  const result = splitFrontmatter('---\nname: [unclosed\n---\nbody')
  assert.equal(result.kind, 'yaml-error')
})

test('splitFrontmatter tolerates CR line endings around the fences', () => {
  const result = splitFrontmatter('---\r\nname: amphoreus-testcard-a\r\ndescription: 卡\r\n---\r\nbody')
  assert.equal(result.kind, 'ok')
})

// --- parseFrontmatterFields -------------------------------------------------

function fields(data: Record<string, unknown>) {
  return parseFrontmatterFields(data)
}

test('parseFrontmatterFields: happy path with loose booleans', () => {
  const result = fields({
    name: 'amphoreus-testcard-a', description: '试验', 'disable-model-invocation': 'Yes', 'user-invocable': 'off', extra: 42,
  })
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.frontmatter.disableModelInvocation, true)
  assert.equal(result.frontmatter.userInvocable, false)
  assert.equal(result.frontmatter.raw.extra, 42)
})

test('parseFrontmatterFields: missing name or description', () => {
  assert.equal(fields({ description: 'x' }).kind, 'missing-field')
  assert.equal(fields({ name: 'amphoreus-a' }).kind, 'missing-field')
  assert.equal(fields({ name: '', description: 'x' }).kind, 'missing-field')
  assert.equal(fields({ name: 42 as unknown, description: 'x' } as Record<string, unknown>).kind, 'missing-field')
})

test('parseFrontmatterFields: invalid skill name shape', () => {
  assert.equal(fields({ name: 'Bad_Name', description: 'x' }).kind, 'bad-name')
  assert.equal(fields({ name: 'amphoreus--double', description: 'x' }).kind, 'bad-name')
  assert.equal(fields({ name: '-leading', description: 'x' }).kind, 'bad-name')
})

test('parseFrontmatterFields: each legacy key rejects the whole card', () => {
  for (const key of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    const result = fields({ name: 'amphoreus-testcard-a', description: 'x', [key]: true })
    assert.equal(result.kind, 'legacy-key')
    if (result.kind === 'legacy-key') assert.equal(result.key, key)
  }
})

test('parseFrontmatterFields: 1/0 numeric and string booleans; junk rejects', () => {
  const one = fields({ name: 'amphoreus-a', description: 'x', 'disable-model-invocation': 1 })
  assert.equal(one.kind, 'ok')
  if (one.kind === 'ok') assert.equal(one.frontmatter.disableModelInvocation, true)
  const zero = fields({ name: 'amphoreus-a', description: 'x', 'user-invocable': '0' })
  assert.equal(zero.kind, 'ok')
  if (zero.kind === 'ok') assert.equal(zero.frontmatter.userInvocable, false)
  assert.equal(fields({ name: 'amphoreus-a', description: 'x', 'disable-model-invocation': 'maybe' }).kind, 'bad-boolean')
  assert.equal(fields({ name: 'amphoreus-a', description: 'x', 'user-invocable': 2 }).kind, 'bad-boolean')
})

test('parseFrontmatterFields: absent invocation keys stay undefined', () => {
  const result = fields({ name: 'amphoreus-a', description: 'x' })
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.frontmatter.disableModelInvocation, undefined)
  assert.equal(result.frontmatter.userInvocable, undefined)
})

// --- sectionize -------------------------------------------------------------

const SECTIONED = `引言散文，不属于任何小节。

## 甲节

甲节正文。

### 甲之子

子节正文。

## 乙节

\`\`\`md
## 围栏里的假标题
\`\`\`

~~~
### 也是假的
~~~

乙节尾行。

## 甲节

同名后者。
`

test('sectionize: H2 tree with H3 children; fenced headings ignored', () => {
  const sections = sectionize(SECTIONED)
  assert.deepEqual(sections.map(s => s.title), ['甲节', '乙节', '甲节'])
  assert.deepEqual(sections[0]!.children.map(s => s.title), ['甲之子'])
  // The H2's own lines span through its children up to the next H2.
  assert.ok(sections[0]!.lines.join('\n').includes('子节正文。'))
  // Fenced pseudo-headings stay inside 乙节's lines instead of splitting it.
  const second = sections[1]!
  assert.ok(second.lines.join('\n').includes('## 围栏里的假标题'))
  assert.ok(second.lines.join('\n').includes('乙节尾行。'))
})

test('sectionize: line numbers are 1-based and offsettable', () => {
  const sections = sectionize('## 甲\n正文\n', 10)
  assert.equal(sections[0]!.startLine, 10)
})

test('sectionize: H3 before any H2 becomes a root section', () => {
  const sections = sectionize('### 孤儿子节\n正文\n## 甲\n')
  assert.deepEqual(sections.map(s => [s.title, s.level]), [['孤儿子节', 3], ['甲', 2]])
})

// --- parseTable -------------------------------------------------------------

test('parseTable: header, rows, dropped bad-arity rows, fullwidth bar not a separator', () => {
  const table = parseTable([
    '前置散文',
    '| 需求 | 承办 |',
    '| --- | :---: |',
    '| 试验甲、试验乙 | 假名一 `amphoreus-testcard-a` |',
    '| 只有一列 |',
    '| 全角｜在单元格里 | 假名二 `amphoreus-testcard-b` |',
    '表后散文',
  ], 1)
  assert.ok(table)
  assert.deepEqual(table.headerCells, ['需求', '承办'])
  assert.equal(table.rows.length, 2)
  assert.equal(table.rows[0]!.line, 4)
  assert.equal(table.rows[1]!.cells[0], '全角｜在单元格里')
  assert.deepEqual(table.dropped.map(d => d.line), [5])
  assert.equal(table.headerLine, 2)
})

test('parseTable: no table returns undefined; header without separator is not a table', () => {
  assert.equal(parseTable(['散文', '| 甲 | 乙 |', '| 数据 | 行 |']), undefined)
  assert.equal(parseTable([]), undefined)
})

// --- inlineCodes / normalizeLine -------------------------------------------

test('inlineCodes extracts every span in order', () => {
  assert.deepEqual(
    inlineCodes('先 `此事移交假名一：<物>`，再 `假名二卡｜读取：<范围>｜档位：浓／标准`。'),
    ['此事移交假名一：<物>', '假名二卡｜读取：<范围>｜档位：浓／标准'],
  )
  assert.deepEqual(inlineCodes('无代码行'), [])
})

test('normalizeLine strips list markers and whole-line bold', () => {
  assert.equal(normalizeLine('- 列表项'), '列表项')
  assert.equal(normalizeLine('* 另一种'), '另一种')
  assert.equal(normalizeLine('  **加粗整行**  '), '加粗整行')
  assert.equal(normalizeLine('中间 **加粗** 不动'), '中间 **加粗** 不动')
})
