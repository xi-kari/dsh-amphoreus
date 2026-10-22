import assert from 'node:assert/strict'
import test from 'node:test'
import { createGlassRefractionMap, GLASS_REFRACTION_MAX_PIXELS, GLASS_REFRACTION_MAX_SIDE } from '../src/client/glass-refraction-map.ts'

function rgba(map: ReturnType<typeof createGlassRefractionMap>, x: number, y: number): number[] {
  return Array.from(map.pixels.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4))
}

test('the center and the area outside rounded corners remain neutral', () => {
  const map = createGlassRefractionMap(100, 100, 20)
  assert.deepEqual(rgba(map, 50, 50), [128, 128, 128, 255])
  assert.deepEqual(rgba(map, 0, 0), [128, 128, 128, 255])
  assert.deepEqual(rgba(map, 99, 0), [128, 128, 128, 255])
  assert.equal(map.pixels.length, 100 * 100 * 4)
})

test('opposite edges encode opposite normal signs and the inner lobe reverses direction', () => {
  const map = createGlassRefractionMap(100, 100, 0, 16)
  const left = rgba(map, 1, 50), right = rgba(map, 98, 50)
  const top = rgba(map, 50, 1), bottom = rgba(map, 50, 98)
  assert.ok(left[0]! < 128 && right[0]! > 128)
  assert.equal(left[0]! + right[0]!, 256)
  assert.equal(left[1], 128); assert.equal(right[1], 128)
  assert.ok(top[1]! < 128 && bottom[1]! > 128)
  assert.equal(top[1]! + bottom[1]!, 256)
  assert.equal(top[0], 128); assert.equal(bottom[0], 128)
  assert.ok(rgba(map, 12, 50)[0]! > 128)
  assert.ok(rgba(map, 87, 50)[0]! < 128)
  assert.deepEqual(rgba(map, 20, 50), [128, 128, 128, 255])
})

test('rounded corner normals displace both channels symmetrically', () => {
  const map = createGlassRefractionMap(100, 100, 20, 16)
  const corner = rgba(map, 6, 6), reflected = rgba(map, 93, 93)
  assert.ok(corner[0]! < 128 && corner[1]! < 128)
  assert.equal(corner[0], corner[1])
  assert.equal(reflected[0], reflected[1])
  assert.equal(corner[0]! + reflected[0]!, 256)
})

test('map allocation is bounded and ordinary aspect ratios are preserved within one pixel', () => {
  for (const [width, height] of [[2000, 500], [500, 2000], [3840, 2160], [1000, 1000], [200, 100]]) {
    const map = createGlassRefractionMap(width!, height!, 24)
    assert.ok(map.width <= GLASS_REFRACTION_MAX_SIDE && map.height <= GLASS_REFRACTION_MAX_SIDE)
    assert.ok(map.width * map.height <= GLASS_REFRACTION_MAX_PIXELS)
    assert.equal(map.pixels.length, map.width * map.height * 4)
    const aspect = width! / height!
    assert.ok(Math.abs(map.width - map.height * aspect) <= Math.max(1, aspect))
  }
  const square = createGlassRefractionMap(1000, 1000, 24)
  assert.equal(square.width, 256)
  assert.equal(square.height, 256)
})

test('zero, tiny, nonfinite and huge dimensions never cause unbounded allocation', () => {
  for (const [width, height] of [[0, 0], [-1, -20], [Number.NaN, Infinity], [.001, .000001], [Number.MAX_VALUE, 1], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
    const map = createGlassRefractionMap(width!, height!, Number.NaN, Number.NaN)
    assert.ok(Number.isInteger(map.width) && map.width >= 1 && map.width <= 384)
    assert.ok(Number.isInteger(map.height) && map.height >= 1 && map.height <= 384)
    assert.ok(map.pixels.length <= 65_536 * 4)
    assert.equal(map.pixels.length, map.width * map.height * 4)
    for (let index = 0; index < map.pixels.length; index += 4) {
      assert.ok(map.pixels[index]! >= 1 && map.pixels[index + 1]! >= 1)
      assert.equal(map.pixels[index + 2], 128)
      assert.equal(map.pixels[index + 3], 255)
    }
  }
})

test('radius clamps to half the shorter side and a zero-width band is neutral', () => {
  assert.deepEqual(createGlassRefractionMap(100, 60, 1e300).pixels, createGlassRefractionMap(100, 60, 30).pixels)
  assert.deepEqual(createGlassRefractionMap(100, 60, -20).pixels, createGlassRefractionMap(100, 60, 0).pixels)
  assert.deepEqual(createGlassRefractionMap(100, 60, Number.NaN).pixels, createGlassRefractionMap(100, 60, 0).pixels)
  const flat = createGlassRefractionMap(100, 60, 20, 0)
  for (let index = 0; index < flat.pixels.length; index += 4) assert.deepEqual(Array.from(flat.pixels.slice(index, index + 4)), [128, 128, 128, 255])
  assert.deepEqual(createGlassRefractionMap(100, 60, 20, Number.NaN).pixels, createGlassRefractionMap(100, 60, 20).pixels)
})

test('edge-band displacement rejoins neutral smoothly at its inner boundary', () => {
  const map = createGlassRefractionMap(160, 100, 0, 32)
  assert.ok(Math.abs(rgba(map, 0, 50)[0]! - 128) <= 1)
  assert.ok(Math.abs(rgba(map, 31, 50)[0]! - 128) <= 1)
  assert.deepEqual(rgba(map, 32, 50), [128, 128, 128, 255])
})
