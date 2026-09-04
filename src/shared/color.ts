export type Rgb = readonly [number, number, number]

export const BLACK: Rgb = [0, 0, 0]
export const WHITE: Rgb = [255, 255, 255]

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function channel(value: number): number {
  return Math.round(clamp(value, 0, 255))
}

export function parseHex(hex: string): Rgb {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(hex)
  if (short !== null) {
    return [
      Number.parseInt(short[1]! + short[1]!, 16),
      Number.parseInt(short[2]! + short[2]!, 16),
      Number.parseInt(short[3]! + short[3]!, 16),
    ]
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex)
  if (long !== null) {
    return [
      Number.parseInt(long[1]!, 16),
      Number.parseInt(long[2]!, 16),
      Number.parseInt(long[3]!, 16),
    ]
  }
  throw new Error(`invalid hex color: ${hex}`)
}

export function toHex(value: Rgb): string {
  return `#${value.map(component => channel(component).toString(16).padStart(2, '0')).join('')}`
}

export function rgba(value: Rgb, alpha: number): string {
  const boundedAlpha = Math.round(clamp(alpha, 0, 1) * 100) / 100
  return `rgba(${channel(value[0])}, ${channel(value[1])}, ${channel(value[2])}, ${boundedAlpha})`
}

export function rgb(value: Rgb): string {
  return `rgb(${channel(value[0])}, ${channel(value[1])}, ${channel(value[2])})`
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

export function composite(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  return mix(background, foreground, alpha)
}

export function luminance(value: Rgb): number {
  const linear = value.map(component => {
    const srgb = channel(component) / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

export function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function ensureContrast(
  foreground: Rgb,
  background: Rgb,
  target: number,
  toward: Rgb,
  step = 0.08,
  maxSteps = 12,
): Rgb {
  if (contrast(foreground, background) >= target) return foreground
  let candidate = foreground
  for (let index = 1; index <= maxSteps; index += 1) {
    candidate = mix(foreground, toward, Math.min(1, index * step))
    if (contrast(candidate, background) >= target) return candidate
  }
  return candidate
}
