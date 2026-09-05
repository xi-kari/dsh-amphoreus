/**
 * Grammar layer controller: turns (current seat × user prefs × colour scheme)
 * into `--amph-*` custom properties on <body> plus a handful of `data-amph-*`
 * attributes on <html>, and starts the seam stamper while enabled. Everything
 * is an effect — disabling the layer (or disposing the plugin) removes every
 * variable, attribute and observer, leaving the stock UI untouched.
 */
import { GRAMMAR_DEFAULTS, type GrammarPrefs } from '../shared/api.ts'
import { GRAMMAR_VARIABLE_NAMES, grammarVariables, seatGrammarOf, type SeatGrammar } from '../shared/grammar.ts'
import { heroVisualById } from '../shared/heroes.ts'
import { motifDataUri } from '../shared/motifs.ts'
import { startGrammarSeamStamper } from './grammar-seams.ts'
import './grammar.css'

export const GRAMMAR_ATTRIBUTE = 'data-amph-grammar'

export interface GrammarSnapshot {
  readonly heroId: string | null
  readonly dark: boolean
  readonly prefs: GrammarPrefs
  readonly grammar: SeatGrammar
}

export interface GrammarLayerInputs {
  /** Current seat mirror (body data attribute). */
  readonly seat: { getSnapshot(): string | null; subscribe(listener: () => void): () => void }
  readonly isDark: () => boolean
  readonly subscribeTheme: (listener: () => void) => () => void
  readonly prefs: () => GrammarPrefs | undefined
  readonly subscribePrefs: (listener: () => void) => () => void
}

/** Pure: the variable map the layer writes for a snapshot (exported for tests / iframe bridge). */
export function grammarVariablesFor(snapshot: GrammarSnapshot): Record<string, string> {
  const visual = snapshot.heroId === null ? undefined : heroVisualById(snapshot.heroId)
  const accent = visual?.palette.accent ?? '#8a681c'
  const accent2 = visual?.palette.accent2 ?? '#37305e'
  const vars = grammarVariables(snapshot.grammar, snapshot.dark, accent, accent2)
  const prefs = snapshot.prefs
  const blur = Number(snapshot.grammar.glass.blurPx) * prefs.blurScale
  const frost = Math.min(1, Math.max(0.42, snapshot.grammar.glass.frost * prefs.frostScale))
  vars['--amph-glass-blur'] = `${Math.round(blur * 10) / 10}px`
  vars['--amph-glass-frost'] = String(Math.round(frost * 100) / 100)
  vars['--amph-motif-opacity'] = String(Math.round(snapshot.grammar.motif.opacity * prefs.motifScale * 1000) / 1000)
  vars['--amph-scrim-boost'] = String(prefs.scrimBoost)
  const motif = visual?.motif ?? 'ripples'
  vars['--amph-motif-url'] = motifDataUri(motif, {
    color: snapshot.dark ? accent2 : accent,
    opacity: 1,
    size: snapshot.grammar.motif.sizePx,
  })
  return vars
}

export const GRAMMAR_WRITTEN_VARIABLES: readonly string[] = [
  ...GRAMMAR_VARIABLE_NAMES,
  '--amph-scrim-boost',
  '--amph-motif-url',
]

export interface GrammarLayer {
  getSnapshot(): GrammarSnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createGrammarLayer(inputs: GrammarLayerInputs): GrammarLayer {
  const html = document.documentElement
  const body = document.body
  const listeners = new Set<() => void>()
  let disposeSeams: (() => void) | undefined
  let snapshot = compute()
  let disposed = false

  function compute(): GrammarSnapshot {
    const heroId = inputs.seat.getSnapshot()
    return {
      heroId,
      dark: inputs.isDark(),
      prefs: inputs.prefs() ?? GRAMMAR_DEFAULTS,
      grammar: seatGrammarOf(heroId),
    }
  }

  const clear = (): void => {
    for (const name of GRAMMAR_WRITTEN_VARIABLES) body.style.removeProperty(name)
    html.removeAttribute(GRAMMAR_ATTRIBUTE)
    html.removeAttribute('data-amph-seat')
    html.removeAttribute('data-amph-ambient')
    html.removeAttribute('data-amph-mascot')
    html.removeAttribute('data-amph-display')
    html.removeAttribute('data-amph-motif-stage')
    disposeSeams?.()
    disposeSeams = undefined
  }

  const apply = (): void => {
    if (disposed) return
    snapshot = compute()
    if (!snapshot.prefs.enabled) {
      clear()
      publish()
      return
    }
    const vars = grammarVariablesFor(snapshot)
    for (const [name, value] of Object.entries(vars)) body.style.setProperty(name, value)
    html.setAttribute(GRAMMAR_ATTRIBUTE, snapshot.dark ? 'dark' : 'light')
    html.setAttribute('data-amph-seat', snapshot.heroId ?? 'global')
    html.setAttribute('data-amph-ambient', snapshot.prefs.ambient ? snapshot.grammar.ambient : 'none')
    html.setAttribute('data-amph-mascot', snapshot.prefs.mascot)
    html.setAttribute('data-amph-display', snapshot.grammar.typography.display)
    if (snapshot.grammar.motif.placement === 'stage' || snapshot.grammar.motif.placement === 'both') html.setAttribute('data-amph-motif-stage', '')
    else html.removeAttribute('data-amph-motif-stage')
    disposeSeams ??= startGrammarSeamStamper()
    publish()
  }

  const publish = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const unsubscribes = [
    inputs.seat.subscribe(apply),
    inputs.subscribeTheme(apply),
    inputs.subscribePrefs(apply),
  ]
  apply()

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const unsubscribe of unsubscribes) unsubscribe()
      clear()
      listeners.clear()
    },
  }
}
