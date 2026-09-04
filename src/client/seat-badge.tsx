import { useState, type CSSProperties } from 'react'
import { fallbackHue, heroVisualOf, stickerAssetUrl } from '../shared/heroes.ts'
import css from './seat-badge.module.css'

export interface SeatBadgeProps {
  readonly skill: string | null
  readonly face?: string
  readonly label?: string
  readonly size?: number
  readonly assetsConfigured: boolean
}

function firstCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? '?'
}

/** Shared compact seat visual: local sticker when available, deterministic initial otherwise. */
export function SeatBadge({
  skill,
  face,
  label,
  size = 28,
  assetsConfigured,
}: SeatBadgeProps) {
  const visual = skill === null ? undefined : heroVisualOf(skill)
  const stickerSrc = assetsConfigured && visual !== undefined
    ? stickerAssetUrl(visual.assets.sticker)
    : null
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const showSticker = stickerSrc !== null && brokenSrc !== stickerSrc
  const fallbackLabel = skill === null
    ? '?'
    : firstCharacter(label ?? skill.replace(/^amphoreus-/u, ''))
  const faceLabel = face === undefined || face.trim() === '' ? null : firstCharacter(face)
  const style = {
    '--amphoreus-seat-badge-size': `${size}px`,
  } as CSSProperties
  const fallbackStyle: CSSProperties = {
    background: skill === null
      ? 'var(--dsw-alias-bg-layer-3)'
      : `hsl(${fallbackHue(skill)} 45% 55%)`,
  }

  return (
    <span
      className={css.badge}
      style={style}
      aria-hidden="true"
      {...(skill === null ? { 'data-empty': '' } : {})}
    >
      {showSticker
        ? (
          <img
            className={css.image}
            src={stickerSrc}
            alt=""
            onError={() => setBrokenSrc(stickerSrc)}
          />
        )
        : <span className={css.fallback} style={fallbackStyle}>{fallbackLabel}</span>}
      {faceLabel === null ? null : <span className={css.face}>{faceLabel}</span>}
    </span>
  )
}
