import { useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { heroVisualOf, stickerAssetUrl } from '../shared/heroes.ts'
import { seatColorOf } from './seat-model.ts'
import type { AmphoreusClientModel } from './state.ts'
import css from './nameplate.module.css'

export type SeatNameplateProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'amphoreus'>
  & { model: AmphoreusClientModel }

export function SeatNameplate({ sessionId, model, t }: SeatNameplateProps) {
  const snap = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const binding = snap.state?.bindings.find(item => item.sessionId === sessionId)
  if (binding === undefined) return null

  const card = snap.state?.suite?.cards.find(item => item.name === binding.skillName)
  const seat = snap.state?.seats.find(item => item.skillName === binding.skillName)
  const displayName = seat?.userDisplayName ?? card?.displayName ?? seat?.displayName ?? binding.skillName
  const duty = card?.duties[0]
  const color = seatColorOf(binding.skillName)
  const visual = heroVisualOf(binding.skillName)
  const sticker = snap.state?.effectiveConfig.assetsConfigured === true && visual !== undefined
    ? stickerAssetUrl(visual.assets.sticker)
    : null
  const face = binding.face
  const tooltip = [
    binding.skillName,
    `${t('nameplate.bound')}：${t(`nameplate.source.${binding.source}`)}`,
    t(`nameplate.injection.${binding.injection.state}`)
      + (binding.injection.reason ? `（${binding.injection.reason}）` : ''),
    face !== undefined && card?.faces.includes(face) === true ? `面：${face}` : undefined,
  ].filter(Boolean).join('｜')

  return (
    <span
      className={css.plate}
      style={{ '--amph-seat-accent': color.accent, '--amph-seat-hue': color.hue ?? 0 } as CSSProperties}
      title={tooltip}
    >
      {sticker !== null
        ? <img className={css.mark} src={sticker} alt="" />
        : <i className={css.markGeneric} aria-hidden />}
      <span className={css.text}>{displayName}{duty ? ` · ${duty}` : ''}</span>
    </span>
  )
}
