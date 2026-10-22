export type MascotDock = 'free' | 'left' | 'right' | 'top' | 'bottom'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface MascotPoint { readonly x: number; readonly y: number }
export interface MascotViewport { readonly width: number; readonly height: number; readonly left?: number; readonly top?: number }
export interface MascotPosition { readonly version: 1; readonly x: number; readonly y: number; readonly dock: MascotDock }
export interface MascotObstacle { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface MascotPositionOptions { readonly size?: number; readonly allowTop?: boolean; readonly avoid?: readonly MascotObstacle[] }

export const MASCOT_SIZE = 56
export const MASCOT_DRAG_THRESHOLD = 6
const MARGIN = 12
const docks: readonly MascotDock[] = ['free', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function bounds(viewport: MascotViewport, size = MASCOT_SIZE) {
  const width = Math.max(0, viewport.width - size)
  const height = Math.max(0, viewport.height - size)
  const mx = Math.min(MARGIN, width / 2)
  const my = Math.min(MARGIN, height / 2)
  return { left: (viewport.left ?? 0) + mx, right: (viewport.left ?? 0) + width - mx,
    top: (viewport.top ?? 0) + my, bottom: (viewport.top ?? 0) + height - my }
}

export function defaultMascotPosition(): MascotPosition { return { version: 1, x: 1, y: 1, dock: 'bottom-right' } }

export function deserializeMascotPosition(raw: string | null): MascotPosition {
  try {
    const value: unknown = JSON.parse(raw ?? '')
    if (typeof value !== 'object' || value === null) return defaultMascotPosition()
    const item = value as Partial<MascotPosition>
    if (item.version !== 1 || typeof item.x !== 'number' || !Number.isFinite(item.x) || item.x < 0 || item.x > 1
      || typeof item.y !== 'number' || !Number.isFinite(item.y) || item.y < 0 || item.y > 1
      || !docks.includes(item.dock as MascotDock)) return defaultMascotPosition()
    return { version: 1, x: item.x, y: item.y, dock: item.dock as MascotDock }
  } catch { return defaultMascotPosition() }
}

export function clampMascotPoint(point: MascotPoint, viewport: MascotViewport, size = MASCOT_SIZE): MascotPoint {
  const box = bounds(viewport, size)
  return { x: clamp(Number.isFinite(point.x) ? point.x : box.right, box.left, box.right),
    y: clamp(Number.isFinite(point.y) ? point.y : box.bottom, box.top, box.bottom) }
}

export function resolveMascotPosition(position: MascotPosition, viewport: MascotViewport, options: MascotPositionOptions = {}): MascotPoint {
  const box = bounds(viewport, options.size)
  let x = box.left + position.x * (box.right - box.left)
  let y = box.top + position.y * (box.bottom - box.top)
  if (position.dock.includes('left')) x = box.left
  if (position.dock.includes('right')) x = box.right
  if (position.dock.includes('bottom')) y = box.bottom
  if (options.allowTop && position.dock.includes('top')) y = box.top
  let point = clampMascotPoint({ x, y }, viewport, options.size)
  if (position.dock === 'free') return point
  const size = options.size ?? MASCOT_SIZE
  const obstacles = options.avoid ?? []
  const overlaps = (candidate: MascotPoint, rect: MascotObstacle) => candidate.x < rect.right + MARGIN
    && candidate.x + size > rect.left - MARGIN && candidate.y < rect.bottom + MARGIN && candidate.y + size > rect.top - MARGIN
  for (const rect of obstacles) {
    if (!overlaps(point, rect)) continue
    const candidates = [
      { x: point.x, y: rect.top - size - MARGIN },
      { x: rect.left - size - MARGIN, y: point.y },
      { x: rect.right + MARGIN, y: point.y },
      { x: point.x, y: rect.bottom + MARGIN },
    ].map(candidate => clampMascotPoint(candidate, viewport, size))
    const clear = candidates.find(candidate => obstacles.every(obstacle => !overlaps(candidate, obstacle)))
    if (clear) point = clear
  }
  return point
}

export function positionFromPoint(point: MascotPoint, viewport: MascotViewport, dock: MascotDock, size = MASCOT_SIZE): MascotPosition {
  const box = bounds(viewport, size)
  const value = clampMascotPoint(point, viewport, size)
  return { version: 1, dock,
    x: box.right === box.left ? 1 : (value.x - box.left) / (box.right - box.left),
    y: box.bottom === box.top ? 1 : (value.y - box.top) / (box.bottom - box.top) }
}

export function dockMascot(point: MascotPoint, viewport: MascotViewport, options: MascotPositionOptions = {}): MascotPosition {
  const box = bounds(viewport, options.size)
  const value = clampMascotPoint(point, viewport, options.size)
  const distances = { left: value.x - box.left, right: box.right - value.x, top: value.y - box.top, bottom: box.bottom - value.y }
  const horizontal = distances.left <= distances.right ? 'left' : 'right'
  const vertical = options.allowTop && distances.top < distances.bottom ? 'top' : 'bottom'
  const nearHorizontal = distances[horizontal] <= Math.max(48, viewport.width * .1)
  const nearVertical = distances[vertical] <= Math.max(48, viewport.height * .15)
  const dock: MascotDock = nearHorizontal && nearVertical ? `${vertical}-${horizontal}`
    : nearHorizontal ? horizontal : nearVertical ? vertical : 'free'
  const snap = resolveMascotPosition(positionFromPoint(value, viewport, dock, options.size), viewport, options)
  return positionFromPoint(snap, viewport, dock, options.size)
}

export function keyboardMascotPoint(key: string, point: MascotPoint, viewport: MascotViewport, coarse = false): MascotPoint | undefined {
  const amount = coarse ? 32 : 8
  switch (key) {
    case 'ArrowLeft': return clampMascotPoint({ x: point.x - amount, y: point.y }, viewport)
    case 'ArrowRight': return clampMascotPoint({ x: point.x + amount, y: point.y }, viewport)
    case 'ArrowUp': return clampMascotPoint({ x: point.x, y: point.y - amount }, viewport)
    case 'ArrowDown': return clampMascotPoint({ x: point.x, y: point.y + amount }, viewport)
    default: return undefined
  }
}

export function mascotPanelPoint(point: MascotPoint, panel: { readonly width: number; readonly height: number }, viewport: MascotViewport): MascotPoint {
  const left = (viewport.left ?? 0) + MARGIN
  const top = (viewport.top ?? 0) + MARGIN
  const right = Math.max(left, (viewport.left ?? 0) + viewport.width - panel.width - MARGIN)
  const bottom = Math.max(top, (viewport.top ?? 0) + viewport.height - panel.height - MARGIN)
  const above = point.y - panel.height - 10
  return { x: clamp(point.x + MASCOT_SIZE - panel.width, left, right),
    y: clamp(above >= top ? above : point.y + MASCOT_SIZE + 10, top, bottom) }
}
