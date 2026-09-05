/**
 * Grammar layer controller: turns (current seat × user prefs × colour scheme)
 * into `--amph-*` custom properties on <body> plus a handful of `data-amph-*`
 * attributes on <html>, and starts the seam stamper while enabled. Everything
 * is an effect — disabling the layer (or disposing the plugin) removes every
 * variable, attribute and observer, leaving the stock UI untouched.
 */
import { GRAMMAR_DEFAULTS, type GrammarPrefs } from '../shared/api.ts'
import { seatGrammarOf } from '../shared/grammar.ts'
import { startGrammarSeamStamper } from './grammar-seams.ts'
import { GRAMMAR_WRITTEN_VARIABLES, grammarVariablesFor, type GrammarSnapshot } from './grammar-vars.ts'
import './grammar.css'
import './grammar-ambient.css'

export const GRAMMAR_ATTRIBUTE = 'data-amph-grammar'

export interface GrammarLayerInputs {
  /** Current seat mirror (body data attribute). */
  readonly seat: { getSnapshot(): string | null; subscribe(listener: () => void): () => void }
  readonly isDark: () => boolean
  readonly subscribeTheme: (listener: () => void) => () => void
  readonly prefs: () => GrammarPrefs | undefined
  readonly subscribePrefs: (listener: () => void) => () => void
}

export type { GrammarSnapshot } from './grammar-vars.ts'
export { grammarVariablesFor, GRAMMAR_WRITTEN_VARIABLES } from './grammar-vars.ts'

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
    html.removeAttribute('data-amph-feather')
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
    if (snapshot.grammar.feather) html.setAttribute('data-amph-feather', '')
    else html.removeAttribute('data-amph-feather')
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
