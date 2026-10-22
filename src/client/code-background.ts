import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { heroVisualById, heroVisualOf } from '../shared/heroes.ts'
import { CODE_BACKGROUND_DEFAULTS } from '../shared/code-background.ts'
import type { AmphoreusClientModel } from './state.ts'
import type { SelectedSessionList } from './session-adapter.ts'
import type { SeatWatch } from './seat-watch.ts'
import { createCodeRipple, type CodeRippleOptions } from './code-ripple-engine.ts'
import { mountCodeBackgroundSurface } from './visual-shell.ts'
import css from './code-background.module.css'

const installations = new WeakMap<Document, () => void>()

export interface CodeBackgroundInputs {
  readonly model: Pick<AmphoreusClientModel, 'getSnapshot' | 'subscribe'>
  readonly sessions: ObservableSnapshot<SelectedSessionList>
  readonly seat: Pick<SeatWatch, 'getSnapshot' | 'subscribe'>
  readonly isDark: () => boolean
  readonly subscribeTheme: (listener: () => void) => () => void
}

export function installCodeBackground(inputs: CodeBackgroundInputs): () => void {
  installations.get(document)?.()
  let disposed = false
  let surface: HTMLElement | undefined
  let renderer: ReturnType<typeof createCodeRipple> | undefined
  let previous = ''

  const remove = (): void => {
    renderer?.dispose()
    renderer = undefined
    surface?.remove()
    surface = undefined
    previous = ''
    document.body.removeAttribute('data-amphoreus-code-background')
  }
  const sync = (): void => {
    if (disposed) return
    const state = inputs.model.getSnapshot().state
    const prefs = state?.effectiveConfig.codeBackground ?? CODE_BACKGROUND_DEFAULTS
    if (!prefs.enabled || prefs.intensity <= 0) { remove(); return }
    const current = inputs.sessions.getSnapshot().current
    const binding = current === undefined ? undefined : state?.bindings.find(item => item.sessionId === current)
    const hero = (binding === undefined ? undefined : heroVisualOf(binding.skillName))
      ?? heroVisualById(inputs.seat.getSnapshot() ?? 'cyrene') ?? heroVisualById('cyrene')!
    const options: CodeRippleOptions = {
      color: hero.palette.accent, dark: inputs.isDark(), intensity: prefs.intensity,
      interactive: prefs.interactive, static: state?.effectiveConfig.grammar.ambient === false,
    }
    const signature = JSON.stringify(options)
    if (signature === previous && renderer !== undefined) return
    previous = signature
    surface ??= mountCodeBackgroundSurface(css.root ?? '')
    surface.dataset.codeBackgroundSeat = hero.heroId
    surface.style.setProperty('--amph-code-color', hero.palette.accent)
    document.body.setAttribute('data-amphoreus-code-background', 'on')
    if (renderer === undefined) renderer = createCodeRipple(surface, options)
    else renderer.update(options)
  }
  const unsubscribes = [inputs.model.subscribe(sync), inputs.sessions.subscribe(sync), inputs.seat.subscribe(sync), inputs.subscribeTheme(sync)]
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const unsubscribe of unsubscribes) unsubscribe()
    remove()
    if (installations.get(document) === dispose) installations.delete(document)
  }
  installations.set(document, dispose)
  sync()
  return dispose
}
