import type { AmphoreusState, DeriveKind, DeriveProgress } from '../shared/api.ts'

export interface AmphoreusClientSnapshot {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly state?: AmphoreusState
  readonly error?: string
  readonly refreshing: boolean
  readonly deriveProgress?: DeriveProgress
}

const INITIAL: AmphoreusClientSnapshot = { phase: 'loading', refreshing: false }
const DERIVE_KINDS: readonly DeriveKind[] = ['covers', 'chronicle', 'cards', 'stickers', 'wallpapers']

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
