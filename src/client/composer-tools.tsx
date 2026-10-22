import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useState } from 'react'
import { ReaderPanel } from './message-reader.tsx'
import { draftMetrics } from './composer-tools-model.ts'
import css from './composer-tools.module.css'

export type ComposerToolsProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'amphoreus'>

export function ComposerTools({ useInput, sessionId, t }: ComposerToolsProps) {
  const draft = useInput(snapshot => snapshot.draft)
  const attachmentCount = useInput(snapshot => snapshot.attachmentIds.length)
  const referenceCount = useInput(snapshot => snapshot.occurrences.length)
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState(false)
  const metrics = useMemo(() => draftMetrics(draft, attachmentCount, referenceCount), [draft, attachmentCount, referenceCount])
  useEffect(() => { setExpanded(false); setPreview(false) }, [sessionId])
  const summary = t('composerTools.metrics', { ...metrics })
  return <div className={css.root} data-amph-composer-tools data-expanded={expanded || undefined}>
    {metrics.characters > 0 && <span className={css.count} title={summary} aria-label={summary}>{t('composerTools.characters', { count: metrics.characters })}</span>}
    <button type="button" className={css.button} aria-label={t(expanded ? 'composerTools.shrink' : 'composerTools.expand')}
      title={t(expanded ? 'composerTools.shrink' : 'composerTools.expand')} aria-pressed={expanded}
      onClick={() => setExpanded(value => !value)}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d={expanded ? 'M3 7h4V3m10 4h-4V3M3 13h4v4m10-4h-4v4' : 'M7 3H3v4m10-4h4v4M7 17H3v-4m10 4h4v-4'} />
      </svg>
    </button>
    <button type="button" className={css.button} aria-label={t('composerTools.preview')} title={t('composerTools.preview')}
      disabled={draft.trim() === ''} aria-haspopup="dialog" onClick={() => setPreview(true)}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" /><circle cx="10" cy="10" r="2" />
      </svg>
    </button>
    <ReaderPanel text={draft} title={t('composerTools.preview')} open={preview} onClose={() => setPreview(false)} t={t}
      description={`${summary} · ${t('composerTools.previewHint')}`} />
  </div>
}
