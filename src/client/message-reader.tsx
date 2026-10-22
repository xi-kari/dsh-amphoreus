import { CodeBlock, MarkdownText, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { AmphoreusKey, NS } from './locales.ts'
import { lockImagePreviewScroll } from './image-preview-scroll.ts'
import { extractReaderCode } from './message-reader-source.ts'
import { SegmentedChoice } from './segmented-choice.tsx'
import css from './message-reader.module.css'

export interface ReaderPanelProps {
  readonly text: string
  readonly title: string
  readonly open: boolean
  readonly onClose: () => void
  readonly t: (key: AmphoreusKey, params?: Record<string, unknown>) => string
  readonly description?: string
}

type ReaderMode = 'read' | 'source' | 'code'
type CopyState = 'pending' | 'success' | 'error'
interface ReaderHeading { readonly title: string; readonly level: number }

export function ReaderPanel({ text, title, open, onClose, t, description }: ReaderPanelProps) {
  const [mode, setMode] = useState<ReaderMode>('read')
  const [fontSize, setFontSize] = useState(16)
  const [headings, setHeadings] = useState<readonly ReaderHeading[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wrapped, setWrapped] = useState(true)
  const [numbered, setNumbered] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [copyState, setCopyState] = useState<CopyState | null>(null)
  const generation = useRef(0)
  const copyPending = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const headingNodes = useRef<readonly HTMLElement[]>([])
  const codeContentId = useId()
  const codes = useMemo(() => open ? extractReaderCode(text) : [], [text, open])
  const selected = codes.find(code => code.id === selectedId) ?? codes[0]
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('reader.copyCode'), copiedLabel: t('reader.copied'), toolbarLabels: {
      codeLabel: t('reader.codeTitle'), wrapLabel: t('reader.wrap'), unwrapLabel: t('reader.unwrap'),
    } },
    footnotes: t('reader.footnotes'),
  }), [t])

  useEffect(() => open ? lockImagePreviewScroll(document) : undefined, [open])
  useEffect(() => {
    generation.current++
    copyPending.current = false
    setCopyState(null)
    return () => { generation.current++; copyPending.current = false }
  }, [text, open])
  useEffect(() => {
    const nodes = open && mode === 'read' && content.current
      ? [...content.current.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')] : []
    headingNodes.current = nodes
    setHeadings(nodes.map(node => ({ title: node.textContent ?? '', level: Number(node.tagName.slice(1)) })))
    return () => { headingNodes.current = [] }
  }, [text, open, mode])

  const copy = async (value: string): Promise<void> => {
    if (copyPending.current) return
    const requestGeneration = generation.current
    copyPending.current = true
    setCopyState('pending')
    let copied = false
    try { copied = await writeClipboard(value) } catch {}
    if (generation.current !== requestGeneration) return
    copyPending.current = false
    setCopyState(copied ? 'success' : 'error')
  }
  const jumpToHeading = (index: number): void => {
    const target = headingNodes.current[index], scroll = viewport.current
    if (!target || !scroll) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const top = Math.max(0, scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12)
    scroll.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
  }
  const changeMode = (value: ReaderMode): void => { setMode(value); setCopyState(null) }
  const sizeStyle = {
    '--dsh-content-font-size': `${fontSize}px`, '--dsh-content-font-delta': `${fontSize - 14}px`,
    '--dsh-content-font-size-secondary': `${Math.max(12, fontSize - 1)}px`,
    '--dsh-content-font-delta-secondary': `${fontSize - 14}px`, '--amph-reader-font-size': `${fontSize}px`,
  } as CSSProperties

  if (!open) return null
  return <Modal open headless title={title} onClose={onClose} className={css.modal ?? ''} shortcutModal="amphoreus-message-reader">
    <header className={css.header}>
      <h2>{title}</h2>
      <button type="button" data-modal-autofocus className={css.iconButton} aria-label={t('reader.close')} onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    {description ? <p className={css.description}>{description}</p> : null}
    <div className={css.toolbar}>
      <SegmentedChoice label={t('reader.mode')} value={mode} choices={[
        { value: 'read', label: t('reader.read') }, { value: 'source', label: t('reader.source') }, { value: 'code', label: t('reader.code') },
      ]} onChange={changeMode} />
      <div className={css.fontControls}>
        <button type="button" className={css.iconButton} aria-label={t('reader.smaller')} disabled={fontSize <= 12} onClick={() => setFontSize(value => Math.max(12, value - 1))}>A−</button>
        <button type="button" className={css.sizeButton} aria-label={t('reader.resetSize')} onClick={() => setFontSize(16)}>
          <output aria-label={t('reader.fontSize', { size: fontSize })}>{fontSize}</output>
        </button>
        <button type="button" className={css.iconButton} aria-label={t('reader.larger')} disabled={fontSize >= 24} onClick={() => setFontSize(value => Math.min(24, value + 1))}>A+</button>
      </div>
      <button type="button" className={css.button} disabled={copyState === 'pending'} onClick={() => copy(text)}>{t('reader.copyBody')}</button>
    </div>
    <p className={css.copyStatus} role={copyState === 'error' ? 'alert' : 'status'}>
      {copyState === 'pending' ? t('reader.copying') : copyState === 'success' ? t('reader.copied') : copyState === 'error' ? t('reader.copyFailed') : null}
    </p>
    <div ref={viewport} className={css.viewport} style={sizeStyle} role="region" aria-label={t('reader.content')} tabIndex={0} data-reader-viewport="">
      {mode === 'read' ? <>
        {headings.length > 0 ? <details className={css.outline}>
          <summary>{t('reader.toc')} <span>{headings.length}</span></summary>
          <nav aria-label={t('reader.toc')}><ol>
            {headings.map((heading, index) => <li key={index} style={{ paddingInlineStart: `${Math.max(0, heading.level - 1) * 8}px` }}>
              <button type="button" onClick={() => jumpToHeading(index)}>{heading.title}</button>
            </li>)}
          </ol></nav>
        </details> : null}
        <div ref={content} className={css.document} data-reader-body=""><MarkdownText text={text} streaming={false} labels={labels} /></div>
      </> : mode === 'source' ? <pre className={css.source} data-reader-source="">{text}</pre>
        : selected ? <div className={css.codePanel}>
          <div className={css.codeToolbar}>
            <select className={css.codeSelect} aria-label={t('reader.code')} value={selected.id} onChange={event => { setSelectedId(event.currentTarget.value); setCollapsed(false); setCopyState(null) }}>
              {codes.map((code, index) => <option key={code.id} value={code.id}>{t('reader.codeNumber', { index: index + 1 })}{code.language ? ` · ${code.language}` : ''} · {t('reader.codeAtLine', { line: code.startLine })}</option>)}
            </select>
            <div className={css.codeActions}>
              <button type="button" className={css.button} aria-pressed={wrapped} aria-label={t('reader.wrap')} title={t(wrapped ? 'reader.unwrap' : 'reader.wrap')} onClick={() => setWrapped(value => !value)}>{t('reader.wrap')}</button>
              <button type="button" className={css.button} aria-pressed={numbered} onClick={() => setNumbered(value => !value)}>{t('reader.lineNumbers')}</button>
              <button type="button" className={css.button} aria-expanded={!collapsed} aria-controls={codeContentId} onClick={() => setCollapsed(value => !value)}>{t(collapsed ? 'reader.expand' : 'reader.collapse')}</button>
              <button type="button" className={css.button} disabled={copyState === 'pending'} onClick={() => copy(selected.code)}>{t('reader.copyCode')}</button>
            </div>
          </div>
          <div id={codeContentId} data-reader-code-content="" hidden={collapsed}>
            <CodeBlock code={selected.code} lang={selected.language || undefined} streaming={false} lineNumbers={numbered}
              showHeader={false} wrap={wrapped} toolbarLabels={labels.code.toolbarLabels}
              copyLabel={t('reader.copyCode')} copiedLabel={t('reader.copied')} />
          </div>
        </div> : <p className={css.empty}>{t('reader.noCode')}</p>}
    </div>
  </Modal>
}

export type MessageReaderActionProps = PropsRuntime<'conversation.chat.assistant-actions'> & PropsLocale<typeof NS>

export function MessageReaderAction({ messageId, useChat, t }: MessageReaderActionProps) {
  const message = useChat<AssistantMessageNode | undefined>(snapshot => snapshot.legacy.nodes.find(
    (node): node is AssistantMessageNode => node.kind === 'assistant' && node.messageId === messageId,
  ))
  const [openedId, setOpenedId] = useState<string | null>(null)
  const text = useMemo(() => message?.kind === 'assistant'
    ? message.blocks.filter(block => block.kind === 'text').map(block => block.text).join('') : '', [message])
  if (text.trim() === '') return null
  return <>
    <button type="button" className={css.openButton} title={t('reader.open')} aria-label={t('reader.open')} onClick={() => setOpenedId(messageId)}>
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5C7 3 4 3 2.5 4v12c2-1 4.5-1 7.5 1 3-2 5.5-2 7.5-1V4C16 3 13 3 10 5Zm0 0v12" /></svg>
    </button>
    <ReaderPanel text={text} title={t('reader.title')} open={openedId === messageId} onClose={() => setOpenedId(null)} t={t} />
  </>
}
