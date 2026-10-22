import { useRef, useState } from 'react'
import type { BackgroundMode, CustomWallpaperInfo } from '../shared/api.ts'
import { WALLPAPER_ACCEPT } from '../shared/wallpaper-media.ts'
import type { AmphoreusKey } from './locales.ts'
import { SegmentedChoice } from './segmented-choice.tsx'
import { ImagePreview, type ImagePreviewItem } from './image-preview.tsx'
import css from './settings.module.css'
import previewCss from './wallpaper-panel.module.css'

export function BackgroundPanel({ mode, custom, presetUrl, busy, t, onMode, onUpload, onRemove }: {
  readonly mode: BackgroundMode
  readonly custom: CustomWallpaperInfo | undefined
  readonly presetUrl?: string | undefined
  readonly busy: boolean
  readonly t: (key: AmphoreusKey, params?: Record<string, unknown>) => string
  readonly onMode: (mode: BackgroundMode) => void
  readonly onUpload: (file: File) => void
  readonly onRemove: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewItems: ImagePreviewItem[] = mode === 'preset' && presetUrl
    ? [{ id: 'preset', url: presetUrl, label: t('settings.background.preset') }]
    : mode === 'custom' && custom !== undefined && custom.kind !== 'video'
      ? [{ id: 'custom', url: custom.url, label: t('settings.backgroundPreview') }] : []
  return <section className={css.panel} aria-labelledby="amphoreus-background" data-amph-background-panel="">
    <div className={css.sectionHeading}><div>
      <h2 id="amphoreus-background">{t('settings.backgroundHeading')}</h2>
      <p id="amphoreus-background-hint">{t('settings.backgroundHint')}</p>
    </div></div>
    <SegmentedChoice label={t('settings.backgroundHeading')} value={mode} disabled={busy}
      choices={(['none', 'preset', 'custom'] as const).map(value => ({ value, label: t(`settings.background.${value}`) }))}
      onChange={onMode} />
    {mode === 'preset' && presetUrl && <div className={previewCss.presetPreview}>
      <button type="button" className={css.secondaryButton} onClick={() => setPreviewId('preset')}>{t('imagePreview.preset')}</button>
    </div>}
    <div className={css.backgroundCustom}>
      {mode !== 'custom' ? null : custom === undefined
        ? <p className={css.hintLine}>{t('settings.backgroundEmpty')}</p>
        : custom.kind === 'video' ? <video className={css.backgroundPreview} src={custom.url} controls muted playsInline preload="metadata" aria-label={t('settings.backgroundPreview')} />
        : <button type="button" className={previewCss.backgroundThumbnail} aria-label={t('imagePreview.open', { name: t('settings.backgroundPreview') })} onClick={() => setPreviewId('custom')}>
          <img src={custom.url} alt={t('settings.backgroundPreview')} />
          <span>{t('imagePreview.enlarge')}</span>
        </button>}
      <input ref={input} className={css.wpFile} type="file" accept={WALLPAPER_ACCEPT}
        aria-label={t('settings.backgroundUpload')} disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file !== undefined) onUpload(file)
        }} />
      <div className={css.backgroundActions}>
        <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => input.current?.click()}>{t('settings.backgroundUpload')}</button>
        {custom !== undefined && <button type="button" className={css.linkButton} disabled={busy} onClick={onRemove}>{t('settings.backgroundRemove')}</button>}
      </div>
    </div>
    <ImagePreview items={previewItems} activeId={previewId} onActiveIdChange={setPreviewId} onClose={() => setPreviewId(null)} t={t} />
  </section>
}
