import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { AmphoreusKey } from './locales.ts'
import {
  INITIAL_PREVIEW_TRANSFORM, PREVIEW_DRAG_THRESHOLD, clampPreviewTransform, fitPreviewImage,
  previewNeighbours, previewPanFrom, previewZoomAt, type PreviewFit, type PreviewSize, type PreviewTransform,
} from './image-preview-geometry.ts'
import { lockImagePreviewScroll } from './image-preview-scroll.ts'
import css from './image-preview.module.css'

export interface ImagePreviewItem { readonly id: string; readonly url: string; readonly label: string }
export interface ImagePreviewProps {
  readonly items: readonly ImagePreviewItem[]
  readonly activeId: string | null
  readonly onActiveIdChange: (id: string) => void
  readonly onClose: () => void
  readonly t: (key: AmphoreusKey, params?: Record<string, unknown>) => string
}

interface PreviewDrag {
  readonly id: number
  readonly target: HTMLDivElement
  readonly startX: number
  readonly startY: number
  readonly key: string
  readonly origin: PreviewTransform
  moved: boolean
}

function release(drag: PreviewDrag): void {
  try { if (drag.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id) } catch {}
}

function Icon({ path }: { readonly path: string }) {
  return <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d={path} /></svg>
}

export function ImagePreview({ items, activeId, onActiveIdChange, onClose, t }: ImagePreviewProps) {
  const index = items.findIndex(item => item.id === activeId)
  const item = items[index]
  const open = item !== undefined
  const [retry, setRetry] = useState(0)
  const key = item ? `${item.id}\0${item.url}\0${retry}` : ''
  const currentKey = useRef(key)
  currentKey.current = key
  const [loaded, setLoaded] = useState<{ key: string; size?: PreviewSize; failed?: boolean }>({ key: '' })
  const [viewport, setViewport] = useState<PreviewSize>({ width: 0, height: 0 })
  const [saved, setSaved] = useState<{ key: string; value: PreviewTransform }>({ key: '', value: INITIAL_PREVIEW_TRANSFORM })
  const [dragging, setDragging] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const gesture = useRef<PreviewDrag | null>(null)
  const natural = loaded.key === key ? loaded.size : undefined
  const failed = loaded.key === key && loaded.failed === true
  const fit = natural ? fitPreviewImage(natural, viewport) : null
  const view = fit && saved.key === key ? clampPreviewTransform(fit, saved.value) : INITIAL_PREVIEW_TRANSFORM
  const fitRef = useRef<PreviewFit | null>(fit)
  const viewRef = useRef(view)
  fitRef.current = fit
  viewRef.current = view
  const commit = (next: PreviewTransform) => { viewRef.current = next; setSaved({ key, value: next }) }
  const commitRef = useRef(commit)
  commitRef.current = commit

  const cancelDrag = (restore = true) => {
    const active = gesture.current
    if (!active) return
    gesture.current = null
    release(active)
    if (restore) { viewRef.current = active.origin; setSaved({ key: active.key, value: active.origin }) }
    setDragging(false)
  }

  useEffect(() => { if (activeId !== null && !open) onClose() }, [activeId, open, onClose])
  useEffect(() => open ? lockImagePreviewScroll(document) : undefined, [open])
  useEffect(() => {
    if (!open) return
    const images = previewNeighbours(items, index).map(url => { const preload = new Image(); preload.decoding = 'async'; preload.src = url; return preload })
    return () => { for (const preload of images) preload.removeAttribute('src') }
  }, [open, items, index])
  useEffect(() => {
    cancelDrag(false)
    setDragging(false)
    return () => { if (gesture.current) { const active = gesture.current; gesture.current = null; release(active) } }
  }, [key])
  useEffect(() => {
    const node = stage.current
    if (!open || !node) return
    const measure = () => setViewport(previous => previous.width === node.clientWidth && previous.height === node.clientHeight
      ? previous : { width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const currentFit = fitRef.current
      if (!currentFit) return
      cancelDrag(false)
      const rect = node.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1)
      const current = viewRef.current
      commitRef.current(previewZoomAt(currentFit, current, current.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), {
        x: event.clientX - rect.left - node.clientWidth / 2, y: event.clientY - rect.top - node.clientHeight / 2,
      }))
    }
    const blur = () => cancelDrag()
    node.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('blur', blur)
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur) }
  }, [open])

  const zoom = (scale: number) => {
    const geometry = fitRef.current
    if (geometry) { cancelDrag(false); commit(previewZoomAt(geometry, viewRef.current, scale)) }
  }
  const navigate = (next: number) => { const target = items[next]; if (target) { cancelDrag(false); onActiveIdChange(target.id) } }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      if (gesture.current) { event.preventDefault(); event.stopPropagation(); cancelDrag() }
      return
    }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(viewRef.current.scale * 1.25); return }
    if (event.key === '-') { event.preventDefault(); zoom(viewRef.current.scale / 1.25); return }
    if (event.key === '0' || event.key === 'Home') { event.preventDefault(); zoom(1); return }
    if (event.key === 'PageUp') { event.preventDefault(); navigate(index - 1); return }
    if (event.key === 'PageDown') { event.preventDefault(); navigate(index + 1); return }
    const delta = event.shiftKey ? 100 : 40
    if (viewRef.current.scale > 1 && fitRef.current) {
      const movement = { ArrowLeft: { x: delta, y: 0 }, ArrowRight: { x: -delta, y: 0 }, ArrowUp: { x: 0, y: delta }, ArrowDown: { x: 0, y: -delta } }[event.key]
      if (movement) { event.preventDefault(); commit(previewPanFrom(fitRef.current, viewRef.current, movement)) }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(index + (event.key === 'ArrowLeft' ? -1 : 1)) }
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!fitRef.current || viewRef.current.scale <= 1 || !event.isPrimary || event.button !== 0 || gesture.current) return
    gesture.current = { id: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY, key, origin: viewRef.current, moved: false }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { gesture.current = null }
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current, geometry = fitRef.current
    if (!active || !geometry || active.id !== event.pointerId) return
    const delta = { x: event.clientX - active.startX, y: event.clientY - active.startY }
    if (!active.moved && Math.hypot(delta.x, delta.y) < PREVIEW_DRAG_THRESHOLD) return
    event.preventDefault()
    active.moved = true
    setDragging(true)
    commit(previewPanFrom(geometry, active.origin, delta))
  }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    gesture.current = null
    release(active)
    setDragging(false)
  }
  const doubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const geometry = fitRef.current, node = stage.current
    if (!geometry || !node || dragging) return
    event.preventDefault()
    const rect = node.getBoundingClientRect()
    commit(previewZoomAt(geometry, viewRef.current, viewRef.current.scale > 1 ? 1 : geometry.maxScale, {
      x: event.clientX - rect.left - node.clientWidth / 2, y: event.clientY - rect.top - node.clientHeight / 2,
    }))
  }

  if (!item) return null
  return <Modal open headless title={t('imagePreview.title')} className={css.modal ?? ''} shortcutModal="amphoreus-image-preview"
    onClose={onClose} onKeyDownCapture={keyDown}>
    <header className={css.header}>
      <h2>{item.label}</h2>
      <button type="button" data-modal-autofocus className={css.iconButton} aria-label={t('imagePreview.close')} onClick={onClose}><Icon path="m5 5 10 10M15 5 5 15" /></button>
    </header>
    <div className={css.toolbar} aria-label={t('imagePreview.controls')}>
      <div className={css.group}>
        <button type="button" className={css.iconButton} aria-label={t('imagePreview.zoomOut')} disabled={!fit || view.scale <= 1} onClick={() => zoom(view.scale / 1.25)}><Icon path="M4 10h12" /></button>
        <output className={css.zoom} aria-label={t('imagePreview.zoomLevel')} aria-live="off">{Math.round(view.scale * 100)}%</output>
        <button type="button" className={css.iconButton} aria-label={t('imagePreview.zoomIn')} disabled={!fit || view.scale >= fit.maxScale} onClick={() => zoom(view.scale * 1.25)}><Icon path="M4 10h12M10 4v12" /></button>
        <button type="button" className={css.fitButton} disabled={!fit} onClick={() => zoom(1)}>{t('imagePreview.fit')}</button>
      </div>
      {items.length > 1 ? <div className={css.group}>
        <button type="button" className={css.iconButton} aria-label={t('imagePreview.previous')} disabled={index === 0} onClick={() => navigate(index - 1)}><Icon path="m12 4-6 6 6 6" /></button>
        <span className={css.counter} aria-label={t('imagePreview.position', { current: index + 1, total: items.length })}>{index + 1} / {items.length}</span>
        <button type="button" className={css.iconButton} aria-label={t('imagePreview.next')} disabled={index === items.length - 1} onClick={() => navigate(index + 1)}><Icon path="m8 4 6 6-6 6" /></button>
      </div> : null}
    </div>
    <div ref={stage} className={css.stage} data-image-preview-stage="" data-zoomed={view.scale > 1} data-dragging={dragging}
      role="region" tabIndex={0} aria-label={t('imagePreview.canvas')}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={() => cancelDrag()} onLostPointerCapture={() => cancelDrag()} onDoubleClick={doubleClick}>
      <img ref={image} key={key} src={item.url} alt={item.label} className={css.image} draggable={false} hidden={!fit || failed}
        style={{ width: fit?.width ?? 0, height: fit?.height ?? 0, marginLeft: -(fit?.width ?? 0) / 2, marginTop: -(fit?.height ?? 0) / 2,
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        onLoad={event => { if (currentKey.current === key) setLoaded({ key, size: { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight } }) }}
        onError={() => { if (currentKey.current === key) setLoaded({ key, failed: true }) }} />
      {failed ? <div className={css.message}><p role="alert">{t('imagePreview.failed')}</p><button type="button" className={css.fitButton} onClick={() => setRetry(value => value + 1)}>{t('imagePreview.retry')}</button></div>
        : !fit ? <p className={css.message} role="status">{t('imagePreview.loading')}</p> : null}
    </div>
    <p className={css.help}>{t('imagePreview.help')}</p>
  </Modal>
}
