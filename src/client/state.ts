import type { AmphoreusState, CustomWallpaperPlacement, DeriveKind, DeriveProgress, GrammarPrefs, SeatSoundPrefsPatch, SeatSoundSlot } from '../shared/api.ts'

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
  /** Store (or clear with `null`) one seat's default tiers; refreshes state afterwards. */
  async setSeatPreset(skillName: string, preset: import('../shared/seat-preset.ts').SeatPreset | null): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch(`/amphoreus/api/seats/${encodeURIComponent(skillName)}/preset`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify(preset),
    })
    if (!response.ok) throw new Error(`席位预设保存失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  /** Seat preset directory (agent roster / model catalog); the assembly swaps in the live applier so the pinned settings props stay untouched. */
  presetDirectory: import('./seat-preset-apply.ts').SeatPresetDirectory = {
    listAgentPresets: async () => [],
    modelCatalog: async () => undefined,
    canRestoreDefaultModel: () => false,
  }

  /**
   * Download the stored visual prefs (magazine mode, grammar, wallpaper placements) as a JSON file.
   * A GET probe surfaces auth / HTTP failures as errors first; the download itself is handed to the
   * browser's download manager via a same-origin `<a download>` (the route sends the attachment
   * header) — the platform's session-log export does the same, and no object URL means no
   * revocation race on browsers that resolve `blob:` URLs asynchronously after `click()`.
   */
  async exportVisualScheme(): Promise<void> {
    const response = await fetch('/amphoreus/api/prefs/visual-scheme', { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error(`视觉方案导出失败（HTTP ${response.status}）`)
    const anchor = document.createElement('a')
    anchor.href = '/amphoreus/api/prefs/visual-scheme'
    anchor.download = 'amphoreus-visual-scheme.json'
    anchor.rel = 'noopener'
    anchor.click()
  }

  /** Restore a visual scheme file: replaces the three visual prefs, leaves everything else alone. */
  async importVisualScheme(file: File): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    // Mirrors MAX_SCHEME_BODY_BYTES (64 KiB) on the host so an oversized pick never reaches the network;
    // the server's 413 below stays as the backstop.
    if (file.size > 64 * 1024) throw new Error('视觉方案文件过大（上限 64 KiB）')
    const text = await file.text()
    let scheme: unknown
    try {
      scheme = JSON.parse(text)
    } catch {
      throw new Error('视觉方案文件不是有效 JSON')
    }
    const response = await fetch('/amphoreus/api/prefs/visual-scheme', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify(scheme),
    })
    if (response.status === 400) {
      const detail = await response.json().then(value => (value as { error?: unknown }).error, () => undefined)
      throw new Error(`视觉方案文件无效：${typeof detail === 'string' ? detail : '格式不符'}`)
    }
    if (response.status === 413) throw new Error('视觉方案文件过大（上限 64 KiB）')
    if (!response.ok) throw new Error(`视觉方案导入失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  /** Upload (replace) one seat sound slot; MIME from the File, extension hint from its name (host falls back to it when the browser reports no type). */
  async uploadSeatSound(heroId: string, slot: SeatSoundSlot, file: File): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const ext = /\.([a-z0-9]{1,5})$/iu.exec(file.name)?.[1]?.toLowerCase()
    const response = await fetch(`/amphoreus/api/seat-sound/${encodeURIComponent(heroId)}/${slot}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-amphoreus-nonce': nonce,
        ...(ext === undefined ? {} : { 'x-amphoreus-ext': ext }),
      },
      body: file,
    })
    if (response.status === 415) throw new Error('不支持的音频类型：请用 MP3 / OGG / WAV / WebM / M4A / AAC / FLAC')
    if (response.status === 413) throw new Error('音频文件超过 20 MiB 上限')
    if (!response.ok) throw new Error(`音效上传失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  async removeSeatSound(heroId: string, slot: SeatSoundSlot): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch(`/amphoreus/api/seat-sound/${encodeURIComponent(heroId)}/${slot}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-amphoreus-nonce': nonce },
    })
    if (!response.ok && response.status !== 404) throw new Error(`音效移除失败（HTTP ${response.status}）`)
    await this.refresh()
  }

  /** Patch seat sound prefs (master switch and/or per-seat per-slot knobs; a null seat entry clears it). */
  async setSeatSoundPrefs(patch: SeatSoundPrefsPatch): Promise<void> {
    const nonce = this.#snapshot.state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
    if (nonce === undefined) throw new Error('首帧 nonce 尚未就绪')
    const response = await fetch('/amphoreus/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
      body: JSON.stringify({ seatSounds: patch }),
    })
    if (!response.ok) throw new Error(`音效设置保存失败（HTTP ${response.status}）`)
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
