import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import {
  MASCOT_DRAG_THRESHOLD, MASCOT_SIZE, clampMascotPoint, defaultMascotPosition, deserializeMascotPosition,
  dockMascot, keyboardMascotPoint, mascotPanelPoint, positionFromPoint, resolveMascotPosition,
  type MascotObstacle, type MascotPoint, type MascotPosition, type MascotViewport,
} from './mascot-position.ts'
import css from './mascot-widget.module.css'

export interface MascotMetric {
  readonly text: string
  readonly detail?: string
  readonly status?: string
}
export interface MascotWidgetData {
  readonly balance?: MascotMetric
  readonly observed?: MascotMetric
  readonly usage?: MascotMetric
  readonly turn?: MascotMetric & { readonly id: string }
  readonly history?: readonly { readonly id: string; readonly label: string; readonly detail?: string; readonly amount: string }[]
}

export const MASCOT_WIDGET_STRINGS = {
  'mascot.open': '查看余额与用量',
  'mascot.close': '关闭',
  'mascot.balance': '余额',
  'mascot.observed': '今日余额变化（观测）',
  'mascot.usage': '本机用量',
  'mascot.turn': '本轮费用',
  'mascot.history': '最近记录',
  'mascot.empty': '暂无数据',
  'mascot.loading': '正在更新…',
  'mascot.refresh': '刷新',
  'mascot.refreshError': '更新失败，请重试',
  'mascot.reset': '重置位置',
  'mascot.moveHelp': '拖动调整位置；方向键微调，Shift 加方向键快速移动，Home 重置，Esc 关闭或取消拖动。',
} as const
export type MascotWidgetKey = keyof typeof MASCOT_WIDGET_STRINGS

export interface MascotWidgetProps {
  readonly heroKey: string
  readonly heroLabel: string
  readonly imageUrl: string | null
  readonly data?: MascotWidgetData
  readonly loading?: boolean
  readonly error?: string | null
  readonly onRefresh?: () => void | Promise<void>
  readonly onOpenChange?: (open: boolean) => void
  readonly allowTopDock?: boolean
  readonly showTurnBubble?: boolean
  readonly autoHideSeconds?: number
  readonly reactive?: boolean
  readonly t?: (key: MascotWidgetKey) => string
}

function currentViewport(): MascotViewport {
  const viewport = window.visualViewport
  return { width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0 }
}

function readPosition(key: string): MascotPosition {
  try { return deserializeMascotPosition(localStorage.getItem(key)) } catch { return defaultMascotPosition() }
}

interface Drag {
  readonly pointerId: number
  readonly target: HTMLButtonElement
  readonly startX: number
  readonly startY: number
  readonly origin: MascotPoint
  readonly original: MascotPosition
  point: MascotPoint
  moved: boolean
}

function releaseCapture(drag: Drag): void {
  try { if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId) } catch {}
}

function foregroundOwnsKeyboard(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]') !== null
}

export function MascotWidget(props: MascotWidgetProps) {
  return props.imageUrl === null ? null : <MascotWidgetSurface key={props.heroKey} {...props} />
}

function MascotWidgetSurface({ heroKey, heroLabel, imageUrl, data, loading = false, error, onRefresh, onOpenChange,
  allowTopDock = false, showTurnBubble = true, autoHideSeconds = 8, reactive = true, t: translate }: MascotWidgetProps) {
  const t = (key: MascotWidgetKey) => translate?.(key) ?? MASCOT_WIDGET_STRINGS[key]
  const storageKey = `amphoreus.mascot-position.v1:${encodeURIComponent(heroKey)}`
  const [position, setPosition] = useState(() => readPosition(storageKey))
  const [viewport, setViewport] = useState(currentViewport)
  const [obstacles, setObstacles] = useState<readonly MascotObstacle[]>([])
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragPoint, setDragPoint] = useState<MascotPoint | null>(null)
  const [bubble, setBubble] = useState<MascotWidgetData['turn'] | null>(null)
  const [panelSize, setPanelSize] = useState({ width: 296, height: 260 })
  const [bubbleSize, setBubbleSize] = useState({ width: 240, height: 72 })
  const [brokenImage, setBrokenImage] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const bubbleElement = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const mounted = useRef(true)
  const expanded = useRef(false)
  const openChange = useRef(onOpenChange)
  openChange.current = onOpenChange
  const receivedData = useRef(data !== undefined)
  const lastTurn = useRef(data?.turn?.status === 'pending' || data?.turn?.status === 'running' ? undefined : data?.turn?.id)
  const id = useId()
  const point = dragPoint ?? resolveMascotPosition(position, viewport, { allowTop: allowTopDock, avoid: obstacles })
  const panelPoint = mascotPanelPoint(point, panelSize, viewport)
  const bubblePoint = mascotPanelPoint(point, bubbleSize, viewport)
  const mirrored = point.x + MASCOT_SIZE / 2 < (viewport.left ?? 0) + viewport.width / 2
  const busy = loading || refreshing

  const changeOpen = (value: boolean) => {
    expanded.current = value
    setOpen(value)
    if (value) setBubble(null)
    openChange.current?.(value)
  }
  const persist = (next: MascotPosition) => {
    setPosition(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
  }
  const cancelDrag = () => {
    const active = drag.current
    if (!active) return
    drag.current = null
    suppressClick.current = active.moved
    releaseCapture(active)
    setPosition(active.original)
    setDragPoint(null)
    setDragging(false)
  }

  useEffect(() => {
    mounted.current = true
    const resize = () => { cancelDrag(); setViewport(currentViewport()) }
    window.addEventListener('resize', resize)
    window.addEventListener('blur', cancelDrag)
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', resize)
    return () => {
      mounted.current = false
      window.removeEventListener('resize', resize)
      window.removeEventListener('blur', cancelDrag)
      window.visualViewport?.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('scroll', resize)
      if (drag.current) { releaseCapture(drag.current); drag.current = null }
      if (expanded.current) openChange.current?.(false)
    }
  }, [])

  useEffect(() => {
    let frame = 0
    let protectedNodes: Element[] = []
    const measure = () => {
      frame = 0
      const next = [...document.querySelectorAll('[data-composer-card="true"], [data-amphoreus-handoff]')]
      for (const node of protectedNodes) if (!next.includes(node)) observer.unobserve(node)
      for (const node of next) if (!protectedNodes.includes(node)) observer.observe(node)
      protectedNodes = next
      const rects = protectedNodes.map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      const value = rects.length > 0 ? [{
        left: Math.min(...rects.map(rect => rect.left)), top: Math.min(...rects.map(rect => rect.top)),
        right: Math.max(...rects.map(rect => rect.right)), bottom: Math.max(...rects.map(rect => rect.bottom)),
      }] : []
      setObstacles(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { subtree: true, childList: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    measure()
    return () => {
      observer.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [])

  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return
      if (expanded.current) changeOpen(false)
      setBubble(null)
    }
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || (!drag.current && !expanded.current && !bubble)) return
      if (event.defaultPrevented || foregroundOwnsKeyboard()) return
      event.preventDefault()
      cancelDrag()
      changeOpen(false)
      setBubble(null)
      button.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown) }
  }, [bubble])

  useEffect(() => {
    if (!open) return
    if (!foregroundOwnsKeyboard()) closeButton.current?.focus({ preventScroll: true })
    const node = panel.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setPanelSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open])

  useEffect(() => {
    if (!data) return
    const turn = data?.turn
    if (!receivedData.current) {
      receivedData.current = true
      if (turn?.status !== 'pending' && turn?.status !== 'running') { lastTurn.current = turn?.id; return }
    }
    if (turn?.status === 'pending' || turn?.status === 'running') return
    if (lastTurn.current === turn?.id) return
    lastTurn.current = turn?.id
    if (showTurnBubble && turn && !expanded.current) setBubble(turn)
  }, [data, showTurnBubble])

  useEffect(() => { if (!showTurnBubble) setBubble(null) }, [showTurnBubble])

  useEffect(() => {
    if (!bubble) return
    const node = bubbleElement.current
    const measure = () => {
      if (!node) return
      const rect = node.getBoundingClientRect()
      setBubbleSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (node) observer.observe(node)
    const timer = Number.isFinite(autoHideSeconds) && autoHideSeconds > 0
      ? window.setTimeout(() => setBubble(null), Math.min(autoHideSeconds, 300) * 1000) : undefined
    return () => { observer.disconnect(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [bubble, autoHideSeconds])

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return
    suppressClick.current = false
    drag.current = { pointerId: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY,
      origin: point, original: position, point, moved: false }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { drag.current = null }
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY
    if (!active.moved && Math.hypot(dx, dy) < MASCOT_DRAG_THRESHOLD) return
    event.preventDefault()
    if (!active.moved) { active.moved = true; setDragging(true); changeOpen(false); setBubble(null) }
    active.point = clampMascotPoint({ x: active.origin.x + dx, y: active.origin.y + dy }, currentViewport())
    setDragPoint(active.point)
  }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    drag.current = null
    suppressClick.current = active.moved
    releaseCapture(active)
    if (active.moved) persist(dockMascot(active.point, currentViewport(), { allowTop: allowTopDock }))
    setDragPoint(null)
    setDragging(false)
  }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Home') { event.preventDefault(); cancelDrag(); persist(defaultMascotPosition()); return }
    const next = keyboardMascotPoint(event.key, point, currentViewport(), event.shiftKey)
    if (!next) return
    event.preventDefault()
    cancelDrag()
    persist(positionFromPoint(next, currentViewport(), 'free'))
  }
  const refresh = async () => {
    if (!onRefresh || busy) return
    setRefreshing(true)
    setRefreshFailed(false)
    try { await onRefresh() } catch { if (mounted.current) setRefreshFailed(true) }
    finally { if (mounted.current) setRefreshing(false) }
  }
  const renderMetric = (label: string, metric: MascotMetric | undefined) => <div className={css.metric}>
    <dt>{label}</dt><dd>{metric?.text ?? (busy ? t('mascot.loading') : t('mascot.empty'))}</dd>
    {metric?.detail ? <dd className={css.detail}>{metric.detail}</dd> : null}
  </div>
  const panelStyle: CSSProperties = { left: panelPoint.x, top: panelPoint.y,
    maxWidth: Math.max(0, viewport.width - 24), maxHeight: Math.max(0, viewport.height - 24) }
  const visibleBubble = showTurnBubble && !open ? bubble : null

  return <div ref={root} className={css.root} data-mascot-widget={heroKey} data-dragging={dragging} data-reactive={reactive}
    style={{ left: point.x, top: point.y, width: MASCOT_SIZE, height: MASCOT_SIZE }}>
    <button ref={button} type="button" className={css.mascot} aria-label={`${heroLabel} · ${t('mascot.open')}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined}
      aria-describedby={`${id}-help`} title={`${heroLabel} · ${t('mascot.open')}`}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={keyDown}
      onClick={event => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return }
        suppressClick.current = false
        changeOpen(!open)
      }}>
      {imageUrl && brokenImage !== imageUrl
        ? <img src={imageUrl} className={css.image} data-mirrored={mirrored} alt="" draggable={false} onError={() => setBrokenImage(imageUrl)} />
        : <span className={css.fallback} aria-hidden="true">{Array.from(heroLabel)[0] ?? '?'}</span>}
    </button>
    <span id={`${id}-help`} className={css.srOnly}>{t('mascot.moveHelp')}</span>
    {open ? <div ref={panel} id={`${id}-panel`} className={css.panel} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={panelStyle}>
      <div className={css.heading}>
        <h2 id={`${id}-title`}>{heroLabel}</h2>
        <button ref={closeButton} type="button" className={css.close} aria-label={t('mascot.close')}
          onClick={() => { changeOpen(false); button.current?.focus({ preventScroll: true }) }}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </div>
      <dl className={css.metrics} aria-busy={busy}>
        {renderMetric(t('mascot.balance'), data?.balance)}
        {data?.observed ? renderMetric(t('mascot.observed'), data.observed) : null}
        {renderMetric(t('mascot.usage'), data?.usage)}
        {renderMetric(t('mascot.turn'), data?.turn)}
      </dl>
      {error || refreshFailed ? <p className={css.error} role="alert">{error || t('mascot.refreshError')}</p> : null}
      {data?.history?.length ? <details className={css.history}>
        <summary>{t('mascot.history')}</summary>
        <ol>{data.history.slice(0, 20).map(item => <li key={item.id}>
          <div><span>{item.label}</span><strong>{item.amount}</strong></div>
          {item.detail ? <p>{item.detail}</p> : null}
        </li>)}</ol>
      </details> : null}
      <div className={css.actions}>
        <button type="button" onClick={() => persist(defaultMascotPosition())}>{t('mascot.reset')}</button>
        {onRefresh ? <button type="button" onClick={() => { void refresh() }} disabled={busy}>{busy ? t('mascot.loading') : t('mascot.refresh')}</button> : null}
      </div>
    </div> : null}
    {visibleBubble ? <div ref={bubbleElement} className={css.bubble} style={{ left: bubblePoint.x, top: bubblePoint.y,
      maxWidth: Math.max(0, viewport.width - 24), maxHeight: Math.max(0, viewport.height - 24) }}>
      <div role="status" aria-live="polite" aria-atomic="true">
        <span>{t('mascot.turn')}</span><strong>{visibleBubble.text}</strong>
        {visibleBubble.detail ? <small>{visibleBubble.detail}</small> : null}
      </div>
      <button type="button" className={css.close} aria-label={t('mascot.close')} onClick={() => setBubble(null)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </div> : null}
  </div>
}
