import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore } from 'react'
import { WIDGET_PREF_DEFAULTS } from '../shared/api.ts'
import { heroVisualById, heroVisualOf } from '../shared/heroes.ts'
import { BRAND_ICON_DATA_URL } from './brand-icon.ts'
import type { GrammarLayer } from './grammar-layer.ts'
import { mascotUrlFor } from './grammar-vars.ts'
import { formatMascotData } from './mascot-format.ts'
import { MascotWidget } from './mascot-widget.tsx'
import type { PortalStore } from './portal-store.ts'
import type { SelectedSessionList } from './session-adapter.ts'
import { GLOBAL_SEAT_HERO } from './seat-model.ts'
import type { AmphoreusClientModel } from './state.ts'

export interface MascotPanelInjected {
  readonly model: AmphoreusClientModel
  readonly grammar: Pick<GrammarLayer, 'getSnapshot' | 'subscribe'>
  readonly sessionList: ObservableSnapshot<SelectedSessionList>
  readonly portal: Pick<PortalStore, 'getSnapshot' | 'subscribe'>
}

export type MascotPanelProps = PropsRuntime<'shell.overlay'> & PropsLocale<'amphoreus'> & MascotPanelInjected

export function MascotPanel({ model, grammar, sessionList, portal, t }: MascotPanelProps) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const visual = useSyncExternalStore(grammar.subscribe, grammar.getSnapshot)
  const current = useSyncExternalStore(sessionList.subscribe, sessionList.getSnapshot).current
  const portalOpen = useSyncExternalStore(portal.subscribe, portal.getSnapshot).open
  const state = snapshot.state
  const binding = current === undefined ? undefined : state?.bindings.find(item => item.sessionId === current)
  const boundHero = binding === undefined ? undefined : heroVisualOf(binding.skillName)
  const hero = visual.heroId === null
    ? boundHero?.heroId === GLOBAL_SEAT_HERO ? boundHero : undefined
    : heroVisualById(visual.heroId)
  if (!state || !hero || !visual.prefs.enabled || visual.prefs.mascot === 'off' || portalOpen) return null
  const prefs = state.effectiveConfig.widget ?? WIDGET_PREF_DEFAULTS
  if (!prefs.enabled) return null
  if (current !== undefined && !state.bindings.some(binding => binding.sessionId === current && binding.skillName === hero.skill)) return null
  const seat = state.seats.find(item => item.skillName === hero.skill)
  const label = seat?.userDisplayName ?? state.suite?.cards.find(card => card.name === hero.skill)?.displayName ?? seat?.displayName ?? hero.skill
  const widget = state.widget
  const data = widget ? formatMascotData(widget, { skillName: hero.skill, currentSessionId: current, bindings: state.bindings, t }) : undefined
  const error = [snapshot.error, state.widgetError ? t('widget.unavailable') : undefined, widget?.storageStatus === 'failed' ? t('widget.storageFailed') : undefined].filter(Boolean).join(' · ')
  return <MascotWidget key={`${hero.skill}:${current ?? ''}`} heroKey={hero.skill} heroLabel={label}
    imageUrl={mascotUrlFor({ ...visual, heroId: hero.heroId }) ?? BRAND_ICON_DATA_URL} {...(data === undefined ? {} : { data })}
    loading={snapshot.refreshing || widget?.balance.status === 'refreshing'} error={error || null}
    allowTopDock={prefs.allowTopDock} showTurnBubble={prefs.showTurnBubble} autoHideSeconds={prefs.autoHideSeconds}
    reactive={visual.prefs.mascot === 'reactive'} t={key => t(key)} onRefresh={() => model.refreshWidget()} />
}
