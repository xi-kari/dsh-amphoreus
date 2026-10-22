export const GLASS_REFRACTION_MAX_SIDE = 384
export const GLASS_REFRACTION_MAX_PIXELS = 65_536

export interface GlassRefractionMap {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
}

export function createGlassRefractionMap(
  widthCss: number, heightCss: number, radiusCss: number, edgeBandCss = 16,
): GlassRefractionMap {
  const dimension = (value: number) => Number.isFinite(value) && value > 0 ? Math.max(1, value) : 1
  const cssWidth = dimension(widthCss), cssHeight = dimension(heightCss)
  const scale = Math.min(1, GLASS_REFRACTION_MAX_SIDE / Math.max(cssWidth, cssHeight))
  const initialWidth = cssWidth * scale, initialHeight = cssHeight * scale
  const areaScale = Math.min(1, Math.sqrt(GLASS_REFRACTION_MAX_PIXELS / (initialWidth * initialHeight)))
  const width = Math.max(1, Math.floor(initialWidth * areaScale))
  const height = Math.max(1, Math.floor(initialHeight * areaScale))
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 128
    pixels[index + 3] = 255
  }
  const halfWidth = cssWidth / 2, halfHeight = cssHeight / 2
  const halfShort = Math.min(halfWidth, halfHeight)
  const radius = Number.isFinite(radiusCss) ? Math.min(halfShort, Math.max(0, radiusCss)) : 0
  const band = Math.min(halfShort, Number.isFinite(edgeBandCss) ? Math.max(0, edgeBandCss) : 16)
  if (band === 0) return { width, height, pixels }
  const encode = (value: number): number => 128 + Math.sign(value) * Math.round(Math.abs(value))
  for (let row = 0; row < height; row++) {
    const y = (row + .5) / height * cssHeight - halfHeight
    for (let col = 0; col < width; col++) {
      const x = (col + .5) / width * cssWidth - halfWidth
      const qx = Math.abs(x) - (halfWidth - radius), qy = Math.abs(y) - (halfHeight - radius)
      const outsideX = Math.max(qx, 0), outsideY = Math.max(qy, 0)
      const outside = Math.hypot(outsideX, outsideY)
      const distance = outside + Math.min(Math.max(qx, qy), 0) - radius
      const depth = -distance
      if (!(depth > 0 && depth < band)) continue
      const normalX = outside > 0 ? Math.sign(x) * outsideX / outside : qx > qy ? Math.sign(x) : 0
      const normalY = outside > 0 ? Math.sign(y) * outsideY / outside : qx > qy ? 0 : Math.sign(y)
      const phase = depth / band
      const wave = Math.sin(2 * Math.PI * phase) * Math.sin(Math.PI * phase)
      const index = (row * width + col) * 4
      pixels[index] = encode(normalX * wave * 127)
      pixels[index + 1] = encode(normalY * wave * 127)
    }
  }
  return { width, height, pixels }
}
