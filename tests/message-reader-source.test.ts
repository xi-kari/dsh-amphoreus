import assert from 'node:assert/strict'
import test from 'node:test'
import { extractReaderCode } from '../src/client/message-reader-source.ts'

test('extracts fenced source with its language, full info, and opening line', () => {
  assert.deepEqual(extractReaderCode('# Example\n\n```ts title="demo"\nconst value = 1  \n```\n'), [
    { id: 'code-3', language: 'ts', info: 'ts title="demo"', code: 'const value = 1  \n', startLine: 3 },
  ])
})

test('preserves CRLF, mixed newlines, indentation, and trailing whitespace verbatim', () => {
  assert.deepEqual(extractReaderCode('before\r\n```txt\r\n  first \t\r\nsecond\n\r\n```\r\n'), [
    { id: 'code-2', language: 'txt', info: 'txt', code: '  first \t\r\nsecond\n\r\n', startLine: 2 },
  ])
})

test('long fences contain shorter fences and require a matching closing marker', () => {
  assert.deepEqual(extractReaderCode('  `````md\n# code heading\n```js\n~~~\nvalue\n```\n  `````` \t\n~~~text\nother\n~~~~\n'), [
    { id: 'code-1', language: 'md', info: 'md', code: '# code heading\n```js\n~~~\nvalue\n```\n', startLine: 1 },
    { id: 'code-8', language: 'text', info: 'text', code: 'other\n', startLine: 8 },
  ])
})

test('keeps an unclosed fence through EOF without inventing a final newline', () => {
  assert.deepEqual(extractReaderCode('intro\n~~~sh\nprintf value  '), [
    { id: 'code-2', language: 'sh', info: 'sh', code: 'printf value  ', startLine: 2 },
  ])
  assert.deepEqual(extractReaderCode('```'), [
    { id: 'code-1', language: '', info: '', code: '', startLine: 1 },
  ])
})

test('rejects backticks in a backtick fence info string but permits them after tildes', () => {
  assert.deepEqual(extractReaderCode('```js `invalid`\nvalue'), [])
  assert.deepEqual(extractReaderCode('~~~text `literal`\nvalue\n~~~'), [
    { id: 'code-1', language: 'text', info: 'text `literal`', code: 'value\n', startLine: 1 },
  ])
})

test('does not treat indented code, quoted fences, list markers, or short markers as openings', () => {
  assert.deepEqual(extractReaderCode('    ```js\n    value\n    ```\n> ~~~\n> value\n> ~~~\n- ```\n``\n~~'), [])
})

test('accepts three leading spaces and an empty block without adding content', () => {
  assert.deepEqual(extractReaderCode('   ```  \n   ```'), [
    { id: 'code-1', language: '', info: '', code: '', startLine: 1 },
  ])
})

test('does not close on a fence followed by text or four-space indentation', () => {
  assert.deepEqual(extractReaderCode('```txt\n``` nope\n    ```\nend\n```'), [
    { id: 'code-1', language: 'txt', info: 'txt', code: '``` nope\n    ```\nend\n', startLine: 1 },
  ])
})

test('keeps identifiers stable when source grows after a completed fence', () => {
  const source = '```txt\nfirst\n```\n'
  assert.deepEqual(extractReaderCode(`${source}\nparagraph\n~~~js\nsecond`)[0], extractReaderCode(source)[0])
  assert.deepEqual(extractReaderCode(''), [])
})
