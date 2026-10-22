export interface PreviewSize { readonly width: number; readonly height: number }
export interface PreviewPoint { readonly x: number; readonly y: number }
export interface PreviewTransform extends PreviewPoint { readonly scale: number }
export interface PreviewFit extends PreviewSize { readonly viewport: PreviewSize; readonly maxScale: number }

export const INITIAL_PREVIEW_TRANSFORM: PreviewTransform = Object.freeze({ scale: 1, x: 0, y: 0 })
export const PREVIEW_DRAG_THRESHOLD = 4
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value)) || 0

export function fitPreviewImage(natural: PreviewSize, viewport: PreviewSize): PreviewFit | null {
  if (![natural.width, natural.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return null
  const ratio = Math.min(1, viewport.width / natural.width, viewport.height / natural.height)
  return { width: natural.width * ratio, height: natural.height * ratio, viewport,
    maxScale: Math.max(2, Math.min(32, 1 / ratio)) }
}

export function clampPreviewTransform(fit: PreviewFit, transform: PreviewTransform): PreviewTransform {
  const scale = clamp(finite(transform.scale, 1), 1, fit.maxScale)
  const maxX = Math.max(0, (fit.width * scale - fit.viewport.width) / 2)
  const maxY = Math.max(0, (fit.height * scale - fit.viewport.height) / 2)
  return { scale, x: clamp(finite(transform.x, 0), -maxX, maxX), y: clamp(finite(transform.y, 0), -maxY, maxY) }
}

export function previewZoomAt(fit: PreviewFit, current: PreviewTransform, targetScale: number, anchor: PreviewPoint = { x: 0, y: 0 }): PreviewTransform {
  const before = clampPreviewTransform(fit, current)
  const scale = clamp(finite(targetScale, before.scale), 1, fit.maxScale)
  const ratio = scale / before.scale
  return clampPreviewTransform(fit, { scale,
    x: anchor.x - (anchor.x - before.x) * ratio,
    y: anchor.y - (anchor.y - before.y) * ratio })
}

export function previewPanFrom(fit: PreviewFit, origin: PreviewTransform, delta: PreviewPoint): PreviewTransform {
  return clampPreviewTransform(fit, { scale: origin.scale, x: origin.x + delta.x, y: origin.y + delta.y })
}

export function previewNeighbours(items: readonly { readonly url: string }[], index: number): string[] {
  return [...new Set(items.slice(Math.max(0, index - 2), index + 3).map(item => item.url))].filter(url => url !== items[index]?.url)
}
