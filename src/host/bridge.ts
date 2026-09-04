import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import { dirname } from 'node:path'
import type { AmphoreusConfig } from './config.ts'
import { computeSuiteFingerprint, FingerprintCache } from './suite/fingerprint.ts'
import { parseSuite } from './suite/parse.ts'
import { SuiteReader, type FreshSkillFile } from './suite/reader.ts'
import { defaultRootEnv, resolveRoots, selectPrimaryRoot } from './suite/roots.ts'
import type { Frontmatter, SuiteFingerprint, SuiteSnapshot } from './suite/types.ts'
import { SuiteWatcher } from './suite/watch.ts'

interface CandidateLocator {
  readonly kind: 'amphoreus-skill-file'
  readonly path: string
  readonly sha256: string
  readonly generation: number
}

export interface SkillProviderSource {
  current(): SuiteSnapshot | undefined
  readFresh(path: string, signal?: AbortSignal): Promise<FreshSkillFile | undefined>
  scheduleReparse(reason: string): void
}

export interface ProviderConfig {
  readonly providerName: string
  readonly providerSource: string
  readonly providerRank: number
  readonly forceUserOnly: boolean
}

/** Build the provider independently from Cordis so its catalog contract is unit-testable. */
export function createSkillProvider(source: SkillProviderSource, config: ProviderConfig): SkillProvider {
  return {
    name: config.providerName,
    async list() {
      const snapshot = source.current()
      if (snapshot === undefined) return { candidates: [], complete: false }
      if (!snapshot.features.provider) return []
      const candidates: SkillCandidate[] = []
      if (snapshot.router !== undefined) {
        candidates.push(candidateOf({
          name: snapshot.router.frontmatter.name,
          path: snapshot.router.path,
          sha256: snapshot.router.sha256,
          frontmatter: snapshot.router.frontmatter,
          generation: snapshot.generation,
          config,
          metadata: { amphoreus: { router: true } },
        }))
      }
      const cards = [...snapshot.cards.values()].sort((left, right) => {
        const leftOrdinal = left.ordinal ?? Number.MAX_SAFE_INTEGER
        const rightOrdinal = right.ordinal ?? Number.MAX_SAFE_INTEGER
        return leftOrdinal - rightOrdinal || left.name.localeCompare(right.name, 'en')
      })
      for (const card of cards) {
        candidates.push(candidateOf({
          name: card.name,
          path: card.path,
          sha256: card.sha256,
          frontmatter: card.frontmatter,
          generation: snapshot.generation,
          config,
          metadata: {
            amphoreus: {
              displayName: card.displayName,
              faces: card.faces,
              ...(card.ordinal === undefined ? {} : { ordinal: card.ordinal }),
            },
          },
        }))
      }
      return { candidates, complete: snapshot.level !== 'L3' }
    },
    async get(candidate, options) {
      if (candidate.provider !== config.providerName) return undefined
      const locator = parseLocator(candidate.locator)
      if (locator === undefined) return undefined
      const fresh = await source.readFresh(locator.path, options.signal)
      if (fresh === undefined) return undefined
      if (fresh.sha256 !== locator.sha256) source.scheduleReparse('provider-get-observed-change')
      return definitionOf(fresh, candidate, config)
    },
  }
}

function candidateOf(input: {
  readonly name: string
  readonly path: string
  readonly sha256: string
  readonly frontmatter: Frontmatter
  readonly generation: number
  readonly config: ProviderConfig
  readonly metadata: Readonly<Record<string, unknown>>
}): SkillCandidate {
  return {
    name: input.name,
    description: input.frontmatter.description,
    invocation: invocationOf(input.frontmatter, input.config.forceUserOnly),
    provider: input.config.providerName,
    source: input.config.providerSource,
    rank: input.config.providerRank,
    locator: {
      kind: 'amphoreus-skill-file',
      path: input.path,
      sha256: input.sha256,
      generation: input.generation,
    } satisfies CandidateLocator,
    resourceBase: { kind: 'directory', path: dirname(input.path) },
    path: input.path,
    metadata: input.metadata,
  }
}

function definitionOf(fresh: FreshSkillFile, candidate: SkillCandidate, config: ProviderConfig): SkillDefinition {
  return {
    name: fresh.frontmatter.name,
    description: fresh.frontmatter.description,
    invocation: invocationOf(fresh.frontmatter, config.forceUserOnly),
    source: candidate.source,
    provider: candidate.provider,
    content: fresh.body,
    path: fresh.path,
    ...(candidate.resourceBase === undefined ? {} : { resourceBase: candidate.resourceBase }),
    ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
  }
}

export function invocationOf(frontmatter: Frontmatter, forceUserOnly: boolean): SkillInvocationPolicy {
  return {
    modelInvocable: forceUserOnly ? false : frontmatter.disableModelInvocation !== true,
    userInvocable: frontmatter.userInvocable !== false,
  }
}

function parseLocator(value: unknown): CandidateLocator | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const locator = value as Partial<CandidateLocator>
  if (
    locator.kind !== 'amphoreus-skill-file'
    || typeof locator.path !== 'string'
    || typeof locator.sha256 !== 'string'
    || typeof locator.generation !== 'number'
  ) return undefined
  return locator as CandidateLocator
}

export interface SuiteResolverOptions {
  readonly config: AmphoreusConfig
  readonly dshHome?: string
  readonly now?: () => number
  readonly log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** Owns one atomic current snapshot and its read-only watcher. */
export class SuiteResolver implements SkillProviderSource {
  readonly #config: AmphoreusConfig
  readonly #dshHome: string
  readonly #now: () => number
  readonly #log: NonNullable<SuiteResolverOptions['log']>
  readonly #fingerprintCache = new FingerprintCache()
  #snapshot: SuiteSnapshot | undefined
  #reader: SuiteReader | undefined
  #watcher: SuiteWatcher | undefined
  #generation = 0
  #queue: Promise<void> = Promise.resolve()
  readonly #listeners = new Set<(snapshot: SuiteSnapshot) => void | Promise<void>>()

  constructor(options: SuiteResolverOptions) {
    this.#config = options.config
    this.#dshHome = options.dshHome ?? resolveDshHome()
    this.#now = options.now ?? Date.now
    this.#log = options.log ?? (() => {})
  }

  current(): SuiteSnapshot | undefined {
    return this.#snapshot
  }

  onSnapshot(listener: (snapshot: SuiteSnapshot) => void | Promise<void>): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async start(invalidate: () => void): Promise<void> {
    await this.#enqueue(async () => {
      const roots = await resolveRoots(this.#config.skillRoots, defaultRootEnv(this.#dshHome))
      const selection = await selectPrimaryRoot(roots.roots)
      const diagnostics = [...roots.diagnostics, ...selection.diagnostics]
      if (selection.primary === undefined) {
        this.#generation++
        this.#snapshot = parseSuite({ roots: roots.roots, cards: [], diagnostics }, {
          generation: this.#generation,
          parsedAt: this.#now(),
          sectionAliases: this.#config.sectionAliases,
        })
        await this.#publish(this.#snapshot)
        invalidate()
        return
      }

      this.#reader = await SuiteReader.create(selection.primary.canonical)
      const fingerprint = await computeSuiteFingerprint(selection.primary.canonical, {
        cache: this.#fingerprintCache,
        computedAt: this.#now(),
      })
      await this.#replaceSnapshot(selection.primary, roots.roots, diagnostics, fingerprint)
      invalidate()
      this.#watcher = new SuiteWatcher({
        root: selection.primary.canonical,
        config: {
          mode: this.#config.suiteWatch.mode,
          pollMs: this.#config.suiteWatch.pollMs,
          debounceMs: this.#config.suiteWatch.debounceMs,
        },
        initialFingerprint: fingerprint,
        cache: this.#fingerprintCache,
        onReparse: async next => this.#replaceSnapshot(selection.primary!, roots.roots, diagnostics, next),
        invalidate,
        onModeChange: (mode, detail) => this.#log('info', `suite watcher ${mode}: ${detail}`),
        onError: error => this.#log('warn', `suite watcher: ${String(error)}`),
      })
      await this.#watcher.start()
    })
  }

  async readFresh(path: string, signal?: AbortSignal): Promise<FreshSkillFile | undefined> {
    return this.#reader?.readSkillPath(path, signal)
  }

  scheduleReparse(reason: string): void {
    this.#log('info', `suite reparse scheduled: ${reason}`)
    if (this.#watcher !== undefined) {
      void this.#watcher.forceReparse().catch(error => this.#log('error', `suite reparse failed: ${String(error)}`))
    }
  }

  async forceReparse(): Promise<void> {
    if (this.#watcher !== undefined) await this.#watcher.forceReparse()
  }

  async close(): Promise<void> {
    await this.#watcher?.close()
    await this.#queue
    this.#listeners.clear()
  }

  async #replaceSnapshot(
    root: NonNullable<SuiteSnapshot['root']>,
    roots: readonly NonNullable<SuiteSnapshot['root']>[],
    diagnostics: readonly SuiteSnapshot['diagnostics'][number][],
    fingerprint: SuiteFingerprint,
  ): Promise<void> {
    const reader = await SuiteReader.create(root.canonical)
    const files = await reader.loadSuiteFiles({
      root,
      roots,
      commonPath: this.#config.commonPath,
      relationsPath: this.#config.relationsPath,
      diagnostics,
    })
    const generation = this.#generation + 1
    const parsed = parseSuite(files, {
      generation,
      parsedAt: this.#now(),
      sectionAliases: this.#config.sectionAliases,
    })
    this.#reader = reader
    this.#generation = generation
    this.#snapshot = { ...parsed, fingerprint }
    this.#log('info', `suite parsed generation=${generation} level=${parsed.level} cards=${parsed.cards.size} fingerprint=${fingerprint.label}`)
    await this.#publish(this.#snapshot)
  }

  async #publish(snapshot: SuiteSnapshot): Promise<void> {
    for (const listener of this.#listeners) {
      try {
        await listener(snapshot)
      } catch (error) {
        this.#log('error', `suite listener: ${String(error)}`)
      }
    }
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(operation, operation)
    this.#queue = next.catch(error => this.#log('error', `suite resolver: ${String(error)}`))
    return next
  }
}

export class AmphoreusBridge {
  readonly resolver: SuiteResolver
  readonly provider: SkillProvider
  readonly #config: AmphoreusConfig
  readonly #ctx: Context
  #control: SkillProviderControl | undefined
  #disposeProvider: (() => void) | undefined

  constructor(ctx: Context, config: AmphoreusConfig) {
    this.#ctx = ctx
    this.#config = config
    this.resolver = new SuiteResolver({
      config,
      log: (level, message) => ctx.logger[level](message),
    })
    this.provider = createSkillProvider(this.resolver, config)
  }

  async start(): Promise<void> {
    if (this.#config.registerProvider) {
      this.#disposeProvider = this.#ctx.skills.registerProvider(control => {
        this.#control = control
        control.signal.addEventListener('abort', () => { void this.resolver.close() }, { once: true })
        return this.provider
      })
    }
    await this.resolver.start(() => this.#control?.invalidate())
  }

  async close(): Promise<void> {
    await this.resolver.close()
    this.#disposeProvider?.()
    this.#disposeProvider = undefined
    this.#control = undefined
  }
}
