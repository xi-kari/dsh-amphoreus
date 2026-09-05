import type { AmphoreusState, AssetsCheckReport, CustomWallpaperPlacement, DeriveKind, DeriveProgress, GrammarPrefs } from '../shared/api.ts'

export interface AmphoreusClientSnapshot {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly state?: AmphoreusState
  readonly error?: string
  readonly refreshing: boolean
  readonly deriveProgress?: DeriveProgress
}

const INITIAL: AmphoreusClientSnapshot = { phase: 'loading', refreshing: false }
const DERIVE_KINDS: readonly DeriveKind[] = ['covers', 'chronicle', 'cards', 'stickers', 'wallpapers', 'home']

export function parseDeriveProgress(value: unknown): DeriveProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.kind !== 'string' || !DERIVE_KINDS.includes(record.kind as DeriveKind)) return undefined
  if (!Number.isSafeInteger(record.done) || !Number.isSafeInteger(record.total)) return undefined
  const done = record.done as number
  const total = record.total as number
  if (done < 0 || total <= 0 || done > total) return undefined
  if (typeof record.current !== 'string' || record.current === '' || record.current.length > 500) return undefined
  if (record.error !== undefined && (typeof record.error !== 'string' || record.error.length > 2_000)) return undefined
  return {
    kind: record.kind as DeriveKind,
    done,
    total,
    current: record.current,
    ...(record.error === undefined ? {} : { error: record.error as string }),
  }
}

export class AmphoreusClientModel {
  readonly #listeners = new Set<() => void>()
  #snapshot: AmphoreusClientSnapshot = INITIAL
  #eventSource: EventSource | undefined
  #refreshTimer: number | undefined
  #refreshRequest = 0
  #pendingDeriveProgress: DeriveProgress | undefined
  #abort = new AbortController()
  #closed = false

  getSnapshot = (): AmphoreusClientSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async start(): Promise<void> {
    await this.refresh()
    if (this.#closed) return
    this.#eventSource = new EventSource('/amphoreus/api/events')
    const changed = (): void => this.scheduleRefresh()
    const deriveProgress = (event: MessageEvent<string>): void => {
      let value: unknown
      try {
        value = JSON.parse(event.data)
      } catch {
        return
      }
      const progress = parseDeriveProgress(value)
      if (progress === undefined) return
      this.#pendingDeriveProgress = progress
      if (this.#snapshot.state?.assets?.running !== true) return
      this.#publish({ ...this.#snapshot, deriveProgress: progress })
    }
    this.#eventSource.addEventListener('snapshot', changed)
    this.#eventSource.addEventListener('state-change', changed)
    this.#eventSource.addEventListener('derive-progress', deriveProgress)
    this.#eventSource.onerror = () => {
      if (this.#snapshot.phase === 'ready') this.#publish({ ...this.#snapshot, error: '实时连接正在重试' })
    }
  }

  async refresh(): Promise<void> {
    if (this.#closed) return
    const request = ++this.#refreshRequest
    this.#publish({ ...this.#snapshot, refreshing: true })
    try {
      const response = await fetch('/amphoreus/api/state', { credentials: 'include', cache: 'no-store', signal: this.#abort.signal })
      if (!response.ok) throw new Error(`状态请求失败（HTTP ${response.status}）`)
      const state = await response.json() as AmphoreusState
      if (this.#closed || request !== this.#refreshRequest) return
      const deriveProgress = this.#pendingDeriveProgress ?? this.#snapshot.deriveProgress
      if (state.assets?.running !== true) this.#pendingDeriveProgress = undefined
      this.#publish({
        phase: 'ready',
        state,
        refreshing: false,
        ...(state.assets?.running === true && deriveProgress !== undefined ? { deriveProgress } : {}),
      })
    } catch (error) {
      if (this.#closed || this.#abort.signal.aborted || request !== this.#refreshRequest) return
      this.#publish({
        phase: this.#snapshot.state === undefined ? 'error' : 'ready',
        ...(this.#snapshot.state === undefined ? {} : { state: this.#snapshot.state }),
        error: error instanceof Error ? error.message : String(error),
        refreshing: false,
      })
    }
  }

  async reparse(): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/reparse', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: '{}',
    })
    if (!response.ok) throw new Error(`重新解析失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  async setMagazineMode(mode: 'light' | 'full' | null): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ magazineMode: mode }),
    })
    if (!response.ok) throw new Error(`杂志模式保存失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  /** Patch the durable grammar knobs (null resets to defaults); refreshes state afterwards. */
  async setGrammar(patch: Partial<GrammarPrefs> | null): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ grammar: patch }),
    })
    if (!response.ok) throw new Error(`视觉语法保存失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  /** Upload (replace) a seat's custom wallpaper: any image/video the browser can hand us, no size cap. */
  async uploadCustomWallpaper(heroId: string, file: File): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch(`/amphoreus/api/custom-wallpaper/${encodeURIComponent(heroId)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-amphoreus-nonce': nonce },
      body: file,
    })
    if (response.status === 415) throw new Error('不支持的文件类型：请用 PNG / JPG / WebP / GIF / AVIF / MP4 / WebM')
    if (!response.ok) throw new Error(`壁纸上传失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  async removeCustomWallpaper(heroId: string): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch(`/amphoreus/api/custom-wallpaper/${encodeURIComponent(heroId)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-amphoreus-nonce': nonce },
    })
    if (!response.ok && response.status !== 404) throw new Error(`壁纸移除失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  /** Patch placement/playback for one seat's custom wallpaper (null clears to defaults). */
  async setCustomWallpaperPlacement(heroId: string, patch: Partial<CustomWallpaperPlacement> | null): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ customWallpapers: { [heroId]: patch } }),
    })
    if (!response.ok) throw new Error(`壁纸位置保存失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  async deriveAssets(force = false): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    this.#pendingDeriveProgress = undefined
    const response = await fetch('/amphoreus/api/assets/derive', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ force }),
    })
    if (!response.ok) throw new Error(`素材派生启动失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  // @anchor client-model-methods

  /** Host self-check of a candidate assets folder (or of the effective root when omitted). */
  async checkAssets(root?: string): Promise<AssetsCheckReport> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/assets/check', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify(root === undefined || root.trim() === '' ? {} : { root: root.trim() }),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => undefined) as { error?: string } | undefined
      throw new Error(detail?.error ?? `素材自检失败（HTTP ${response.status}）`)
    }
    const body = await response.json() as { report: AssetsCheckReport }
    if (root === undefined || root.trim() === '') await this.refresh()
    return body.report
  }

  /** Persist the runtime assets root (null drops the override back to cordis.patch.yml); refreshes state afterwards. */
  async setAssetsRoot(root: string | null): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/assets/root', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ root: root === null ? null : root.trim() }),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => undefined) as { error?: string } | undefined
      throw new Error(detail?.error ?? `素材目录保存失败（HTTP ${response.status}）`)
    }
    await this.refresh()
  }

  /** Remember that the first-run wizard was dismissed (it never auto-opens again). */
  async dismissSetup(): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ setupDismissedAt: Date.now() }),
    })
    if (!response.ok) throw new Error(`向导状态保存失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  close(): void {
    this.#closed = true
    this.#abort.abort()
    this.#eventSource?.close()
    if (this.#refreshTimer !== undefined) window.clearTimeout(this.#refreshTimer)
    this.#listeners.clear()
  }

  private scheduleRefresh(): void {
    if (this.#closed) return
    if (this.#refreshTimer !== undefined) window.clearTimeout(this.#refreshTimer)
    this.#refreshTimer = window.setTimeout(() => {
      this.#refreshTimer = undefined
      void this.refresh()
    }, 120)
  }

  #publish(snapshot: AmphoreusClientSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }
}
