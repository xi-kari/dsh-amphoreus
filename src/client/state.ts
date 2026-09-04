import type { AmphoreusState } from '../shared/api.ts'

export interface AmphoreusClientSnapshot {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly state?: AmphoreusState
  readonly error?: string
  readonly refreshing: boolean
}

const INITIAL: AmphoreusClientSnapshot = { phase: 'loading', refreshing: false }

export class AmphoreusClientModel {
  readonly #listeners = new Set<() => void>()
  #snapshot: AmphoreusClientSnapshot = INITIAL
  #eventSource: EventSource | undefined
  #refreshTimer: number | undefined
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
    this.#eventSource.addEventListener('snapshot', changed)
    this.#eventSource.addEventListener('state-change', changed)
    this.#eventSource.onerror = () => {
      if (this.#snapshot.phase === 'ready') this.#publish({ ...this.#snapshot, error: '实时连接正在重试' })
    }
  }

  async refresh(): Promise<void> {
    if (this.#closed) return
    this.#publish({ ...this.#snapshot, refreshing: true })
    try {
      const response = await fetch('/amphoreus/api/state', { credentials: 'include', cache: 'no-store', signal: this.#abort.signal })
      if (!response.ok) throw new Error(`状态请求失败（HTTP ${response.status}）`)
      const state = await response.json() as AmphoreusState
      this.#publish({ phase: 'ready', state, refreshing: false })
    } catch (error) {
      if (this.#closed || this.#abort.signal.aborted) return
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
