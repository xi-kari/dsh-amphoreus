import { watch as fsWatch } from 'node:fs'
import { computeSuiteFingerprint, FingerprintCache, isSuiteWatchPath, type FingerprintOptions } from './fingerprint.ts'
import type { SuiteFingerprint } from './types.ts'

export type SuiteWatchMode = 'fs' | 'poll' | 'off'
export type ReparseReason = 'filesystem' | 'poll' | 'forced'

export interface SuiteWatchConfig {
  readonly mode: SuiteWatchMode
  readonly pollMs: number
  readonly debounceMs: number
}

interface WatchHandle {
  close(): void
  on?(event: 'error', listener: (error: Error) => void): unknown
}

export type SuiteWatchFactory = (
  root: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => WatchHandle

export interface SuiteWatcherOptions {
  readonly root: string
  readonly config: SuiteWatchConfig
  readonly initialFingerprint?: SuiteFingerprint
  readonly cache?: FingerprintCache
  readonly fingerprint?: Omit<FingerprintOptions, 'cache'>
  readonly watchFactory?: SuiteWatchFactory
  readonly onReparse: (fingerprint: SuiteFingerprint, reason: ReparseReason) => void | Promise<void>
  readonly invalidate: () => void
  readonly onModeChange?: (mode: SuiteWatchMode, detail: string) => void
  readonly onError?: (error: unknown) => void
}

/**
 * Debounced suite watcher. Native recursive watching is preferred; startup or
 * runtime failures fall back to two-sample polling. Reparse completion always
 * precedes provider invalidation.
 */
export class SuiteWatcher {
  readonly #root: string
  readonly #config: SuiteWatchConfig
  readonly #cache: FingerprintCache
  readonly #fingerprintOptions: Omit<FingerprintOptions, 'cache'>
  readonly #watchFactory: SuiteWatchFactory
  readonly #onReparse: SuiteWatcherOptions['onReparse']
  readonly #invalidate: () => void
  readonly #onModeChange: SuiteWatcherOptions['onModeChange']
  readonly #onError: SuiteWatcherOptions['onError']
  #fingerprint: SuiteFingerprint | undefined
  #mode: SuiteWatchMode = 'off'
  #watchHandle: WatchHandle | undefined
  #pollTimer: NodeJS.Timeout | undefined
  #debounceTimer: NodeJS.Timeout | undefined
  #pendingPollDigest: string | undefined
  #closed = false
  #queue: Promise<void> = Promise.resolve()

  constructor(options: SuiteWatcherOptions) {
    this.#root = options.root
    this.#config = options.config
    this.#cache = options.cache ?? new FingerprintCache()
    this.#fingerprintOptions = options.fingerprint ?? {}
    this.#watchFactory = options.watchFactory ?? defaultWatchFactory
    this.#onReparse = options.onReparse
    this.#invalidate = options.invalidate
    this.#onModeChange = options.onModeChange
    this.#onError = options.onError
    this.#fingerprint = options.initialFingerprint
  }

  get mode(): SuiteWatchMode {
    return this.#mode
  }

  get currentFingerprint(): SuiteFingerprint | undefined {
    return this.#fingerprint
  }

  async start(): Promise<void> {
    if (this.#closed) throw new Error('SuiteWatcher is closed')
    this.#fingerprint ??= await this.#compute()
    if (this.#config.mode === 'off') {
      this.#setMode('off', 'watch disabled by configuration')
      return
    }
    if (this.#config.mode === 'poll') {
      this.#startPolling('poll mode selected')
      return
    }
    this.#startNative()
  }

  /** Native callback entry point; public for deterministic tests. */
  notifyPath(filename: string | Buffer | null): void {
    if (this.#closed || this.#mode !== 'fs' || !isSuiteWatchPath(filename)) return
    if (this.#debounceTimer !== undefined) clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined
      void this.#enqueue(async () => {
        await this.#checkAndCommit('filesystem', false)
      })
    }, Math.max(0, this.#config.debounceMs))
    this.#debounceTimer.unref?.()
  }

  /** One polling sample. Two equal changed samples are required before reparse. */
  async pollNow(): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#closed || this.#mode !== 'poll') return
      const next = await this.#compute()
      const current = this.#fingerprint
      if (current === undefined) {
        this.#fingerprint = next
        this.#pendingPollDigest = undefined
        return
      }
      if (next.statDigest === current.statDigest) {
        this.#pendingPollDigest = undefined
        return
      }
      if (this.#pendingPollDigest !== next.statDigest) {
        this.#pendingPollDigest = next.statDigest
        return
      }
      this.#pendingPollDigest = undefined
      await this.#commit(next, 'poll', false)
    })
  }

  /** Manual/sync path: bypass equality and polling stability, then invalidate. */
  async forceReparse(): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#closed) return
      await this.#checkAndCommit('forced', true)
    })
  }

  /** Rebuild a native handle after an atomic directory replacement. */
  async restartNative(): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#closed || this.#config.mode !== 'fs') return
      this.#stopHandles()
      this.#startNative()
    })
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#stopHandles()
    await this.#queue
    this.#setMode('off', 'watcher closed')
  }

  #startNative(): void {
    try {
      const handle = this.#watchFactory(this.#root, (_eventType, filename) => this.notifyPath(filename))
      this.#watchHandle = handle
      handle.on?.('error', error => {
        this.#report(error)
        this.#startPolling('native watcher failed at runtime')
      })
      this.#setMode('fs', 'native recursive watcher active')
    } catch (error) {
      this.#report(error)
      this.#startPolling('native watcher unavailable; using polling')
    }
  }

  #startPolling(detail: string): void {
    this.#watchHandle?.close()
    this.#watchHandle = undefined
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer)
    this.#setMode('poll', detail)
    const interval = Math.max(50, this.#config.pollMs)
    this.#pollTimer = setInterval(() => {
      void this.pollNow().catch(error => this.#report(error))
    }, interval)
    this.#pollTimer.unref?.()
  }

  async #checkAndCommit(reason: ReparseReason, force: boolean): Promise<void> {
    const next = await this.#compute()
    await this.#commit(next, reason, force)
  }

  async #commit(next: SuiteFingerprint, reason: ReparseReason, force: boolean): Promise<void> {
    const current = this.#fingerprint
    if (!force && current?.manifestSha256 === next.manifestSha256) {
      // A touch-only update must advance statDigest so it does not retrigger.
      this.#fingerprint = next
      return
    }
    await this.#onReparse(next, reason)
    this.#fingerprint = next
    this.#invalidate()
  }

  #compute(): Promise<SuiteFingerprint> {
    return computeSuiteFingerprint(this.#root, { ...this.#fingerprintOptions, cache: this.#cache })
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(operation, operation)
    this.#queue = next.catch(error => this.#report(error))
    return next
  }

  #stopHandles(): void {
    if (this.#debounceTimer !== undefined) clearTimeout(this.#debounceTimer)
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer)
    this.#debounceTimer = undefined
    this.#pollTimer = undefined
    this.#watchHandle?.close()
    this.#watchHandle = undefined
    this.#pendingPollDigest = undefined
  }

  #setMode(mode: SuiteWatchMode, detail: string): void {
    if (this.#mode === mode && mode !== 'off') return
    this.#mode = mode
    this.#onModeChange?.(mode, detail)
  }

  #report(error: unknown): void {
    this.#onError?.(error)
  }
}

function defaultWatchFactory(root: string, listener: (eventType: string, filename: string | Buffer | null) => void): WatchHandle {
  return fsWatch(root, { recursive: true }, listener)
}
