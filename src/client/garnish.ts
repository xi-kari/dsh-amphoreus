/**
 * DOM garnish layer: two decorations that official components render deep
 * inside their own DOM, where no slot exists.
 *
 * 1. Hero headline: 「探索未至之境」 → a time-of-day greeting to the
 *    Trailblazer (早上好／下午好／晚上好，开拓者). The locale runtime rejects
 *    second registrations per namespace, so the swap happens on the rendered
 *    text node; the observer re-applies it whenever the hero remounts.
 * 2. Workspace folder icons → chimera stickers. Each workspace header row's
 *    folder SVG is replaced by a chimera sticker chosen by a stable hash of
 *    the workspace title, so a given folder always keeps its chimera. 本插件遮蔽
 *    sidebar.workspaces 后，目录图标替换自然失效；席位组自带徽记。
 *
 * Both effects only touch presentation, never handlers or state, and both
 * disconnect + undo cleanly on dispose. When assets are not configured the
 * layer does nothing (assetsConfigured gate).
 */
import { CHIMERA_STICKERS, stickerAssetUrl } from '../shared/heroes.ts'
import { seatGreetingFor } from './greetings.ts'
import type { SeatWatch } from './seat-watch.ts'

/** Neutral greeting for an hour of day (exported for unit tests). */
export function greetingFor(hour: number): string {
  return seatGreetingFor(null, hour)
}

/** Stable chimera pick per workspace title (exported for unit tests). */
export function chimeraFor(title: string): string {
  let hash = 0
  for (const ch of title) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return CHIMERA_STICKERS[hash % CHIMERA_STICKERS.length]!
}

const HEADLINE_TEXTS = new Set(['探索未至之境', 'Into the Unknown'])
const GARNISH_MARK = 'amphoreusGarnish'

interface HeadlineRecord {
  original: string | null
  applied: string
  holder: HTMLElement | null
  previousMark: string | undefined
}

interface FolderRecord {
  image: HTMLImageElement
  previousMark: string | undefined
  icons: Array<{ node: SVGElement; display: string; priority: string }>
}

function restoreMark(holder: HTMLElement | null, expected: string, previous: string | undefined): void {
  if (holder?.dataset[GARNISH_MARK] !== expected) return
  if (previous === undefined) delete holder.dataset[GARNISH_MARK]
  else holder.dataset[GARNISH_MARK] = previous
}

function isHeroHeadline(node: Node): boolean {
  const holder = node.parentElement
  const group = holder?.parentElement
  return holder?.tagName === 'SPAN' && group !== undefined && group !== null
    && /(^|\s|_)titleGroup(\s|$|_)/u.test(group.className)
    && group.firstElementChild === holder && group.closest("[data-content-phase='hero']") !== null
}

function swapHeadline(root: ParentNode, now: () => Date, seat: () => string | null, records: Map<Node, HeadlineRecord>): void {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    if (text !== undefined && HEADLINE_TEXTS.has(text) && isHeroHeadline(node)) {
      const holder = node.parentElement
      const previous = records.get(node)
      const record = { original: node.textContent, applied: seatGreetingFor(seat(), now().getHours()),
        holder, previousMark: previous === undefined ? holder?.dataset[GARNISH_MARK] : previous.previousMark }
      records.set(node, record)
      node.textContent = record.applied
      if (holder !== null) holder.dataset[GARNISH_MARK] = 'headline'
    }
  }
}

function refreshHeadlines(now: () => Date, seat: () => string | null, records: Map<Node, HeadlineRecord>): void {
  for (const [node, record] of records) {
    if (!node.isConnected || node.textContent !== record.applied) {
      if (!node.isConnected && node.textContent === record.applied) node.textContent = record.original
      restoreMark(record.holder, 'headline', record.previousMark)
      records.delete(node)
      continue
    }
    record.applied = seatGreetingFor(seat(), now().getHours())
    node.textContent = record.applied
  }
}

function isFolderIconHost(el: Element): boolean {
  // Workspace header rows keep the folder svg inside a span whose class list
  // carries the CSS-module `folder` token (hashed as `<hash>_folder`).
  return el instanceof HTMLElement && /(^|\s|_)folder(\s|$|[A-Z_])/.test(el.className)
}

function swapFolderIcons(root: ParentNode, records: Map<HTMLElement, FolderRecord>): void {
  const spans = (root as Element | Document).querySelectorAll?.('span[class*="folder"]') ?? []
  for (const span of spans) {
    if (!isFolderIconHost(span) || !(span instanceof HTMLElement)) continue
    if (span.dataset[GARNISH_MARK] === 'chimera') continue
    const svg = span.querySelector('svg')
    if (svg === null) continue
    const row = span.closest('[class]')?.parentElement
    const title = (row?.textContent ?? span.parentElement?.textContent ?? '').trim() || 'workspace'
    const img = document.createElement('img')
    img.src = stickerAssetUrl(chimeraFor(title))
    img.alt = ''
    img.setAttribute('aria-hidden', 'true')
    img.style.cssText = 'width:20px;height:20px;object-fit:contain;display:block;filter:drop-shadow(0 1px 2px rgba(59,45,107,.25));'
    const icons = [...span.querySelectorAll<SVGElement>('svg')].map(node => ({ node,
      display: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') }))
    records.set(span, { image: img, previousMark: span.dataset[GARNISH_MARK], icons })
    span.dataset[GARNISH_MARK] = 'chimera'
    // Hide the pair of folder svgs (open/close) rather than removing them, so
    // React reconciliation never trips over a missing child.
    for (const icon of icons) icon.node.style.setProperty('display', 'none')
    span.prepend(img)
    void svg
  }
}

export interface GarnishOptions {
  readonly assetsConfigured: () => boolean
  /** Current seat (body data attribute mirror); the greeting follows it. Omitted → neutral copy. */
  readonly seat?: Pick<SeatWatch, 'getSnapshot' | 'subscribe'>
  readonly now?: () => Date
}

/** Install both decorations; returns a disposer. */
export function installGarnish(options: GarnishOptions): () => void {
  const now = options.now ?? (() => new Date())
  const seat = (): string | null => options.seat?.getSnapshot() ?? null
  const headlines = new Map<Node, HeadlineRecord>()
  const folders = new Map<HTMLElement, FolderRecord>()
  let disposed = false
  const releaseFolder = (holder: HTMLElement, record: FolderRecord): void => {
    record.image.remove()
    for (const { node, display, priority } of record.icons) {
      if (node.style.getPropertyValue('display') !== 'none' || node.style.getPropertyPriority('display') !== '') continue
      if (display === '') node.style.removeProperty('display')
      else node.style.setProperty('display', display, priority)
    }
    restoreMark(holder, 'chimera', record.previousMark)
  }
  const apply = (root: ParentNode): void => {
    swapHeadline(root, now, seat, headlines)
    if (options.assetsConfigured()) swapFolderIcons(root, folders)
  }
  apply(document.body)
  const observer = new MutationObserver(mutations => {
    if (disposed) return
    for (const [node, record] of headlines) if (!node.isConnected) {
      if (node.textContent === record.applied) node.textContent = record.original
      restoreMark(record.holder, 'headline', record.previousMark)
      headlines.delete(node)
    }
    for (const [holder, record] of folders) if (!holder.isConnected) {
      releaseFolder(holder, record)
      folders.delete(holder)
    }
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE) apply(added as Element)
        else if (added.nodeType === Node.TEXT_NODE && added.parentNode !== null) swapHeadline(added.parentNode, now, seat, headlines)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // Re-greet across a day boundary without a remount (hourly check is plenty),
  // and immediately whenever the seat changes.
  const refresh = (): void => { if (!disposed) refreshHeadlines(now, seat, headlines) }
  const timer = window.setInterval(refresh, 60 * 60 * 1000)
  const unsubscribeSeat = options.seat?.subscribe(refresh) ?? (() => {})
  return () => {
    if (disposed) return
    disposed = true
    unsubscribeSeat()
    observer.disconnect()
    window.clearInterval(timer)
    for (const [node, record] of headlines) {
      if (node.textContent === record.applied) node.textContent = record.original
      restoreMark(record.holder, 'headline', record.previousMark)
    }
    for (const [holder, record] of folders) releaseFolder(holder, record)
    headlines.clear()
    folders.clear()
  }
}
