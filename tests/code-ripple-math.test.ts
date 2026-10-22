import assert from 'node:assert/strict'
import test from 'node:test'
import { createNoise2D, disturbRipple, heartDistance, rippleGrid, smooth, stepRipple } from '../src/client/code-ripple-math.ts'

test('default seeded noise preserves the original field samples', () => {
  const noise = createNoise2D()
  for (const [x, y, expected] of [
    [0, 0, 0], [0.1, 0.2, -0.3037743727969101],
    [10.25, -3.5, 0.5397579449915902], [-25.3, 92.1, -0.49311105671308325],
  ]) assert.ok(Math.abs(noise(x!, y!) - expected!) < 1e-12)
  assert.equal(createNoise2D(42)(0.1, 0.2), createNoise2D(42)(0.1, 0.2))
  assert.notEqual(createNoise2D(42)(0.1, 0.2), createNoise2D(43)(0.1, 0.2))
})

test('the symmetric heart keeps its lobes and lower point while smooth clamps its interval', () => {
  assert.ok(heartDistance(.46, .35) < 0)
  assert.equal(heartDistance(-.46, .35), heartDistance(.46, .35))
  assert.ok(heartDistance(0, .9) > 0)
  assert.ok(Math.abs(heartDistance(0, -1)) < 1e-12)
  assert.ok(heartDistance(2, 0) > 0)
  assert.equal(smooth(2, 6, -1), 0)
  assert.equal(smooth(2, 6, 4), .5)
  assert.equal(smooth(2, 6, 9), 1)
})

test('ripple grids keep pixel and simulation budgets across tiny, desktop, and high DPR displays', () => {
  for (const [width, height, dpr] of [[1, 1, 1], [320, 740, 3], [1920, 1080, 2], [3840, 2160, 4], [8000, 5000, 1.5]]) {
    const grid = rippleGrid(width!, height!, dpr!)
    assert.ok(grid.width * grid.height <= 3_000_000)
    assert.ok(grid.simCols * grid.simRows <= 18_000)
    assert.ok(grid.ratio > 0 && grid.ratio <= 1.5)
    assert.equal(grid.cellH, grid.cellW * 2)
    assert.equal(grid.simCols, grid.cols + 2)
    assert.equal(grid.simRows, grid.rows * 2 + 2)
    assert.ok(grid.cols * grid.cellW >= grid.width)
    assert.ok(grid.rows * grid.cellH >= grid.height)
    assert.ok(grid.lambdaX + grid.lambdaY < .5)
    assert.ok(Object.values(grid).every(Number.isFinite))
  }
})

test('zero and nonfinite dimensions produce a bounded nonempty grid without looping', () => {
  for (const args of [[0, 0, 0], [Number.NaN, Number.NaN, Number.NaN], [-100, -200, -1], [Infinity, 1, Infinity], [Number.MAX_VALUE, 1, Number.MIN_VALUE]]) {
    const grid = rippleGrid(args[0]!, args[1]!, args[2]!)
    assert.ok(Object.values(grid).every(Number.isFinite))
    assert.ok(grid.width >= 1 && grid.height >= 1 && Number.isInteger(grid.width) && Number.isInteger(grid.height))
    assert.ok(grid.width * grid.height <= 3_000_000)
    assert.ok(grid.simCols * grid.simRows <= 18_000)
    assert.ok(grid.ratio > 0 && grid.lambdaX + grid.lambdaY < .5)
  }
})

test('one wave step keeps the original five-point stencil and zero boundary', () => {
  const height = new Float32Array(25), previous = new Float32Array(25), next = new Float32Array(25)
  const damping = new Float32Array(25).fill(.9)
  height[12] = 1
  const peak = stepRipple(height, previous, next, damping, 5, 5, .1, .1)
  assert.ok(Math.abs(peak - 1.44) < 1e-6)
  assert.ok(Math.abs(next[12]! - 1.44) < 1e-6)
  for (const index of [7, 11, 13, 17]) assert.ok(Math.abs(next[index]! - .09) < 1e-6)
  for (const index of [0, 1, 2, 3, 4, 5, 9, 15, 19, 20, 21, 22, 23, 24]) assert.equal(next[index], 0)
  assert.equal(height[12], 1)
  assert.equal(previous[12], 0)
})

test('a disturbance has a positive Gaussian center, negative ring, and bounded support', () => {
  const height = new Float32Array(31 * 31)
  disturbRipple(height, 31, 31, 15, 15, 1)
  assert.equal(height[15 * 31 + 15], .75)
  assert.ok(height[15 * 31 + 20]! < 0)
  assert.equal(height[15 * 31 + 24], 0)
  assert.equal(height[15 * 31 + 20], height[15 * 31 + 10])
  disturbRipple(height, 31, 31, 0, 0, .5)
  assert.equal(height[0], 0)
  assert.equal(height[1], 0)
  assert.equal(height[31], 0)
})

test('a damped pulse propagates finitely then decays without changing the outer boundary', () => {
  const cols = 31, rows = 31, count = cols * rows
  let height = new Float32Array(count), previous = new Float32Array(count), next = new Float32Array(count)
  const damping = new Float32Array(count).fill(Math.exp(-(1 / 60) / 1.5))
  disturbRipple(height, cols, rows, 15, 15, 1)
  let peak = 0, highest = 0
  for (let step = 0; step < 900; step++) {
    peak = stepRipple(height, previous, next, damping, cols, rows, .1, .1)
    highest = Math.max(highest, peak)
    assert.ok(Number.isFinite(peak))
    const spare = previous
    previous = height; height = next; next = spare
  }
  assert.ok(highest > .75 && highest < 10)
  assert.ok(peak < .01)
  assert.ok([...height].every(Number.isFinite))
  assert.equal(height[0], 0)
  assert.equal(height[count - 1], 0)
})
