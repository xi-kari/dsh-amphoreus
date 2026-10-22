import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitPreviewImage, previewZoomAt, previewPanFrom, clampPreviewTransform, previewNeighbours, INITIAL_PREVIEW_TRANSFORM } from '../src/client/image-preview-geometry.ts'

test('fit geometry is derived from intrinsic image and untransformed viewport sizes', () => {
  const fit = fitPreviewImage({ width: 1600, height: 900 }, { width: 800, height: 600 })!
  assert.equal(fit.width, 800)
  assert.equal(fit.height, 450)
  assert.equal(fit.maxScale, 2)
  assert.equal(fitPreviewImage({ width: 0, height: 900 }, { width: 800, height: 600 }), null)
  assert.equal(fitPreviewImage({ width: 1600, height: 900 }, { width: 0, height: 600 }), null)
})

test('anchor zoom preserves the image point under the pointer and returns exactly to fit', () => {
  const fit = fitPreviewImage({ width: 2400, height: 1800 }, { width: 800, height: 600 })!
  const anchor = { x: 100, y: 50 }
  const first = previewZoomAt(fit, INITIAL_PREVIEW_TRANSFORM, 2, anchor)
  assert.deepEqual(first, { scale: 2, x: -100, y: -50 })
  const next = previewZoomAt(fit, first, 3, anchor)
  assert.deepEqual(next, { scale: 3, x: -200, y: -100 })
  assert.equal((anchor.x - first.x) / first.scale, (anchor.x - next.x) / next.scale)
  assert.deepEqual(previewZoomAt(fit, next, 1, anchor), INITIAL_PREVIEW_TRANSFORM)
  for (let index = 0; index < 20; index++) {
    assert.deepEqual(previewZoomAt(fit, previewZoomAt(fit, INITIAL_PREVIEW_TRANSFORM, 2, anchor), 1, anchor), INITIAL_PREVIEW_TRANSFORM)
  }
  assert.equal(fit.width, 800)
  assert.equal(fit.maxScale, 3)
})

test('drag deltas always use the immutable gesture origin rather than compounding', () => {
  const fit = fitPreviewImage({ width: 2400, height: 1800 }, { width: 800, height: 600 })!
  const origin = { scale: 3, x: 10, y: 20 }
  assert.deepEqual(previewPanFrom(fit, origin, { x: 10, y: 5 }), { scale: 3, x: 20, y: 25 })
  assert.deepEqual(previewPanFrom(fit, origin, { x: 20, y: 10 }), { scale: 3, x: 30, y: 30 })
  assert.deepEqual(origin, { scale: 3, x: 10, y: 20 })
})

test('pan and zoom remain bounded after resize and malformed values cannot create invalid transforms', () => {
  const fit = fitPreviewImage({ width: 1600, height: 900 }, { width: 320, height: 400 })!
  assert.deepEqual(clampPreviewTransform(fit, { scale: 2, x: 1000, y: -1000 }), { scale: 2, x: 160, y: 0 })
  assert.deepEqual(clampPreviewTransform(fit, { scale: NaN, x: Infinity, y: -Infinity }), INITIAL_PREVIEW_TRANSFORM)
  assert.equal(previewZoomAt(fit, INITIAL_PREVIEW_TRANSFORM, 99).scale, fit.maxScale)
  assert.deepEqual(previewPanFrom(fit, INITIAL_PREVIEW_TRANSFORM, { x: 100, y: 100 }), INITIAL_PREVIEW_TRANSFORM)
})

test('neighbour preloading is bounded to two images on each side and excludes the active URL', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: String(index), url: `/image-${index}.png` }))
  assert.deepEqual(previewNeighbours(items, 5), ['/image-3.png', '/image-4.png', '/image-6.png', '/image-7.png'])
  assert.deepEqual(previewNeighbours(items, 0), ['/image-1.png', '/image-2.png'])
  assert.deepEqual(previewNeighbours([{ id: 'a', url: '/a.png' }, { id: 'b', url: '/a.png' }], 0), [])
})
