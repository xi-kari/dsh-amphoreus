import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampMascotPoint, defaultMascotPosition, deserializeMascotPosition, dockMascot,
  keyboardMascotPoint, positionFromPoint, resolveMascotPosition, mascotPanelPoint,
} from '../src/client/mascot-position.ts'

const viewport = { width: 1000, height: 700 }

test('docked mascots avoid the composer while explicit free positions remain unchanged', () => {
  const narrow = { width: 320, height: 740 }
  const avoid = [{ left: 12, top: 560, right: 308, bottom: 710 }]
  assert.deepEqual(resolveMascotPosition(defaultMascotPosition(), narrow, { avoid }), { x: 252, y: 492 })
  const free = positionFromPoint({ x: 252, y: 672 }, narrow, 'free')
  assert.deepEqual(resolveMascotPosition(free, narrow, { avoid }), { x: 252, y: 672 })
  assert.deepEqual(resolveMascotPosition(defaultMascotPosition(), viewport, { avoid }), { x: 932, y: 632 })
  assert.deepEqual(resolveMascotPosition(defaultMascotPosition(), narrow, {
    avoid: [{ left: 12, top: 460, right: 308, bottom: 710 }],
  }), { x: 252, y: 392 })
})

test('mascot starts in the lower right and normalized memory follows viewport resizing', () => {
  assert.deepEqual(resolveMascotPosition(defaultMascotPosition(), viewport), { x: 932, y: 632 })
  const stored = positionFromPoint({ x: 472, y: 322 }, viewport, 'free')
  assert.deepEqual(resolveMascotPosition(stored, { width: 540, height: 390 }), { x: 242, y: 167 })
  assert.deepEqual(resolveMascotPosition(defaultMascotPosition(), { width: 390, height: 300, left: 0, top: 420 }), { x: 322, y: 652 })
})

test('docking selects four edges and nearby corners, with top docking explicitly optional', () => {
  assert.equal(dockMascot({ x: 20, y: 320 }, viewport).dock, 'left')
  assert.equal(dockMascot({ x: 920, y: 320 }, viewport).dock, 'right')
  assert.equal(dockMascot({ x: 470, y: 620 }, viewport).dock, 'bottom')
  assert.equal(dockMascot({ x: 470, y: 15 }, viewport, { allowTop: true }).dock, 'top')
  assert.equal(dockMascot({ x: 17, y: 20 }, viewport, { allowTop: true }).dock, 'top-left')
  assert.equal(dockMascot({ x: 920, y: 620 }, viewport).dock, 'bottom-right')
  assert.equal(dockMascot({ x: 470, y: 15 }, viewport).dock.includes('top'), false)
  assert.equal(dockMascot({ x: 17, y: 20 }, viewport).dock, 'left')
  assert.equal(dockMascot({ x: 470, y: 320 }, viewport).dock, 'free')
})

test('stale and corrupt saved positions fail closed to the visible default', () => {
  for (const value of [null, '', '{', '{}', '{"version":1,"x":2,"y":0,"dock":"free"}', '{"version":1,"x":0,"y":0,"dock":"bad"}']) {
    assert.deepEqual(deserializeMascotPosition(value), defaultMascotPosition())
  }
  assert.deepEqual(clampMascotPoint({ x: -300, y: 800 }, { width: 320, height: 210 }), { x: 12, y: 142 })
  assert.deepEqual(clampMascotPoint({ x: NaN, y: Infinity }, viewport), { x: 932, y: 632 })
  assert.deepEqual(clampMascotPoint({ x: 100, y: 100 }, { width: 60, height: 60 }), { x: 2, y: 2 })
})

test('keyboard movement clamps all axes, supports coarse moves, and ignores other keys', () => {
  assert.deepEqual(keyboardMascotPoint('ArrowLeft', { x: 100, y: 100 }, viewport), { x: 92, y: 100 })
  assert.deepEqual(keyboardMascotPoint('ArrowDown', { x: 100, y: 100 }, viewport, true), { x: 100, y: 132 })
  assert.deepEqual(keyboardMascotPoint('ArrowRight', { x: 930, y: 100 }, viewport), { x: 932, y: 100 })
  assert.equal(keyboardMascotPoint('Tab', { x: 100, y: 100 }, viewport), undefined)
})

test('the readable popover stays within a narrow or offset visual viewport', () => {
  const panel = mascotPanelPoint({ x: 322, y: 632 }, { width: 296, height: 220 }, { width: 390, height: 700 })
  assert.deepEqual(panel, { x: 82, y: 402 })
  assert.deepEqual(mascotPanelPoint({ x: 12, y: 432 }, { width: 296, height: 200 }, { width: 320, height: 280, top: 420 }), { x: 12, y: 488 })
})
