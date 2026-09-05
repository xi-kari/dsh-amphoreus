import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, useSyncExternalStore } from 'react'
import { BRAND_STICKER, heroVisualById, stickerAssetUrl } from '../shared/heroes.ts'
import type { SeatWatch } from './seat-watch.ts'
import css from './brand.module.css'

export interface BrandMarkInjected {
  /** True when assetsRoot serves local stickers (mini-Cyrene mark). */
  readonly assetsConfigured: () => boolean
  /** Current seat mirror; when present the hero mark shows that seat's own sticker. */
  readonly seat?: Pick<SeatWatch, 'getSnapshot' | 'subscribe'>
}

export type SidebarBrandMarkProps = PropsRuntime<'sidebar.brand.mark'> & BrandMarkInjected
export type HeroBrandMarkProps = PropsRuntime<'conversation.hero.brand.mark'> & BrandMarkInjected
export type SidebarBrandNameProps = PropsRuntime<'sidebar.brand.name'> & PropsLocale<'amphoreus'>

export function SidebarBrandMark({ size, assetsConfigured }: SidebarBrandMarkProps) {
  return <AmphoreusMark size={size} className={css.sidebarMark} assetsConfigured={assetsConfigured} />
}

const NO_SEAT = (): string | null => null
const NO_SUBSCRIBE = (): (() => void) => () => {}

export function HeroBrandMark({ size, className, assetsConfigured, seat }: HeroBrandMarkProps) {
  const heroId = useSyncExternalStore(seat?.subscribe ?? NO_SUBSCRIBE, seat?.getSnapshot ?? NO_SEAT)
  const classes = [css.heroMark, className].filter(Boolean).join(' ')
  const sticker = heroId === null ? undefined : heroVisualById(heroId)?.assets.sticker
  return <AmphoreusMark size={size} className={classes} assetsConfigured={assetsConfigured} {...(sticker === undefined ? {} : { sticker })} />
}

export function SidebarBrandName({ t }: SidebarBrandNameProps) {
  return (
    <span className={css.wordmark}>
      <strong>{t('brand.name')}</strong>
      <span aria-hidden="true">CHRYSOS</span>
    </span>
  )
}

export function AmphoreusMark({ size, className, assetsConfigured, sticker = BRAND_STICKER }: {
  readonly size: number
  readonly className?: string | undefined
  readonly assetsConfigured?: (() => boolean) | undefined
  /** Sticker file (表情包/) to show; defaults to the mini-Cyrene brand mark. */
  readonly sticker?: string
}) {
  // Sticker when local assets serve; abstract mark otherwise
  // (and as an onError fallback so a broken asset never leaves a hole).
  const [broken, setBroken] = useState<string | null>(null)
  if (assetsConfigured?.() === true && broken !== sticker) {
    return (
      <img
        key={sticker}
        className={className}
        src={stickerAssetUrl(sticker)}
        width={size}
        height={size}
        style={{ objectFit: 'contain', display: 'block' }}
        alt=""
        aria-hidden="true"
        onError={() => setBroken(sticker)}
      />
    )
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 2.5c.72 5.14 2.36 9.23 6.4 12.08-4.04 2.85-5.68 6.94-6.4 12.92-.72-5.98-2.36-10.07-6.4-12.92C13.64 11.73 15.28 7.64 16 2.5Z" fill="currentColor" opacity=".92" />
      <path d="M5 8.25c3.64 1.21 6.27 3.24 7.92 6.33C11.27 17.67 8.64 19.7 5 20.91c1.14-3.65 1.14-9.01 0-12.66Z" fill="currentColor" opacity=".38" />
      <path d="M27 8.25c-3.64 1.21-6.27 3.24-7.92 6.33 1.65 3.09 4.28 5.12 7.92 6.33-1.14-3.65-1.14-9.01 0-12.66Z" fill="currentColor" opacity=".38" />
      <circle cx="16" cy="14.58" r="3.15" fill="var(--dsw-alias-brand-primary-invert)" />
      <circle cx="16" cy="14.58" r="1.28" fill="currentColor" />
    </svg>
  )
}
