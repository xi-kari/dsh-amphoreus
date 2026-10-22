export function createNoise2D(seed = 0x2f6b1d3): (x: number, y: number) => number {
  const perm = new Uint8Array(512)
  const source = Array.from({ length: 256 }, (_, index) => index)
  for (let index = 255; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const swap = seed % (index + 1)
    const value = source[index]!
    source[index] = source[swap]!
    source[swap] = value
  }
  for (let index = 0; index < 512; index++) perm[index] = source[index & 255]!
  const gx = [1, -1, 1, -1, 1, -1, 0, 0]
  const gy = [1, 1, -1, -1, 0, 0, 1, -1]
  const f2 = (Math.sqrt(3) - 1) / 2
  const g2 = (3 - Math.sqrt(3)) / 6
  return (x, y) => {
    const skew = (x + y) * f2
    const i = Math.floor(x + skew), j = Math.floor(y + skew)
    const unskew = (i + j) * g2
    const x0 = x - i + unskew, y0 = y - j + unskew
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1
    const x1 = x0 - i1 + g2, y1 = y0 - j1 + g2
    const x2 = x0 - 1 + 2 * g2, y2 = y0 - 1 + 2 * g2
    const ii = i & 255, jj = j & 255
    let total = 0
    let falloff = .5 - x0 * x0 - y0 * y0
    if (falloff > 0) {
      const gradient = perm[ii + perm[jj]!]! & 7
      falloff *= falloff
      total += falloff * falloff * (gx[gradient]! * x0 + gy[gradient]! * y0)
    }
    falloff = .5 - x1 * x1 - y1 * y1
    if (falloff > 0) {
      const gradient = perm[ii + i1 + perm[jj + j1]!]! & 7
      falloff *= falloff
      total += falloff * falloff * (gx[gradient]! * x1 + gy[gradient]! * y1)
    }
    falloff = .5 - x2 * x2 - y2 * y2
    if (falloff > 0) {
      const gradient = perm[ii + 1 + perm[jj + 1]!]! & 7
      falloff *= falloff
      total += falloff * falloff * (gx[gradient]! * x2 + gy[gradient]! * y2)
    }
    return 70 * total
  }
}

export function heartDistance(x: number, y: number): number {
  const side = Math.abs(x)
  const lobe = Math.hypot(side - .46, y - .35) - .5
  const flank = side * .773 - (y + 1) * .634
  const shoulder = (side - .847) * .634 + (y - .033) * .774
  return Math.min(lobe, Math.max(flank, shoulder, y - .35))
}

export function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

export interface RippleGrid {
  readonly width: number
  readonly height: number
  readonly ratio: number
  readonly cellW: number
  readonly cellH: number
  readonly cols: number
  readonly rows: number
  readonly simCols: number
  readonly simRows: number
  readonly lambdaX: number
  readonly lambdaY: number
}

const MAX_PIXELS = 3_000_000
const MAX_CELLS = 18_000

export function rippleGrid(widthCss: number, heightCss: number, dpr: number): RippleGrid {
  const size = (value: number) => Number.isFinite(value) ? Math.min(MAX_PIXELS, Math.max(1, value)) : 1
  const cssWidth = size(widthCss), cssHeight = size(heightCss)
  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? Math.max(Number.EPSILON, Math.min(dpr, 1.5)) : 1
  const ratio = Math.min(pixelRatio, Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight)), MAX_PIXELS / Math.max(cssWidth, cssHeight))
  const width = Math.max(1, Math.floor(cssWidth * ratio))
  const height = Math.max(1, Math.floor(cssHeight * ratio))
  const simulationCells = (cellW: number) => (Math.ceil(width / cellW) + 2) * (2 * Math.ceil(height / (cellW * 2)) + 2)
  let low = Math.max(1, Math.round(9 * ratio))
  let high = Math.max(low, width, height)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (simulationCells(middle) <= MAX_CELLS) high = middle
    else low = middle + 1
  }
  const cellW = low, cellH = cellW * 2
  const cols = Math.ceil(width / cellW), rows = Math.ceil(height / cellH)
  const reach = 170 / 60 * ratio
  return {
    width, height, ratio, cellW, cellH, cols, rows, simCols: cols + 2, simRows: rows * 2 + 2,
    lambdaX: (reach / cellW) ** 2, lambdaY: (reach * 2 / cellH) ** 2,
  }
}

export function stepRipple(
  height: Float32Array, previous: Float32Array, next: Float32Array, damping: Float32Array,
  cols: number, rows: number, lambdaX: number, lambdaY: number,
): number {
  let peak = 0
  for (let row = 1; row < rows - 1; row++) {
    let index = row * cols + 1
    for (let col = 1; col < cols - 1; col++, index++) {
      const value = height[index]!
      const result = (2 * value - previous[index]!
        + lambdaX * (height[index - 1]! + height[index + 1]! - 2 * value)
        + lambdaY * (height[index - cols]! + height[index + cols]! - 2 * value)) * damping[index]!
      next[index] = result
      if (result > peak) peak = result
      else if (-result > peak) peak = -result
    }
  }
  return peak
}

export function disturbRipple(
  height: Float32Array, cols: number, rows: number, centerX: number, centerY: number, amount: number,
): void {
  const top = Math.max(1, Math.floor(centerY - 8)), bottom = Math.min(rows - 2, Math.ceil(centerY + 8))
  const left = Math.max(1, Math.floor(centerX - 8)), right = Math.min(cols - 2, Math.ceil(centerX + 8))
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const distance = (col - centerX) ** 2 + (row - centerY) ** 2
      const index = row * cols + col
      height[index] = height[index]! + amount * (Math.exp(-distance / 3.92) - .25 * Math.exp(-distance / 15.68))
    }
  }
}
