import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lockImagePreviewScroll } from '../src/client/image-preview-scroll.ts'

function documentFixture(initial = '', initialPriority = '') {
  let value = initial, priority = initialPriority
  const style = {
    getPropertyValue: () => value, getPropertyPriority: () => priority,
    setProperty: (_key: string, next: string, nextPriority = '') => { value = next; priority = nextPriority },
    removeProperty: () => { value = ''; priority = ''; return '' },
  }
  return { document: { body: { style } } as unknown as Document, style }
}

test('nested preview locks release in either order and restore the preexisting style exactly', () => {
  const { document, style } = documentFixture('clip', 'important')
  const first = lockImagePreviewScroll(document), second = lockImagePreviewScroll(document)
  first()
  assert.equal(style.getPropertyValue(), 'hidden')
  second()
  assert.equal(style.getPropertyValue(), 'clip')
  assert.equal(style.getPropertyPriority(), 'important')
  second()
  assert.equal(style.getPropertyValue(), 'clip')
})

test('cleanup preserves a different owner’s later overflow change', () => {
  const { document, style } = documentFixture()
  const unlock = lockImagePreviewScroll(document)
  style.setProperty('overflow', 'scroll')
  unlock()
  assert.equal(style.getPropertyValue(), 'scroll')
})
