/**
 * First-run setup wizard (shell.overlay, id 'amphoreus-setup'): choose the assets
 * folder → host self-check → one-click derive. Pure presentation over injected
 * callbacks; no context access, no network calls, no document.body writes.
 */
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AssetsCheckReport } from '../shared/api.ts'
import { NS, type AmphoreusKey } from './locales.ts'
import { chooseFolder, digestCheck, type DirectoryListingLike, type SetupStep, type SetupStore } from './setup-store.ts'
import type { AmphoreusClientModel } from './state.ts'
import css from './setup-wizard.module.css'

export interface SetupWizardInjected {
  readonly setup: SetupStore
  readonly model: AmphoreusClientModel
  readonly pickDirectory: () => Promise<string | null>
  readonly listDirectory: (path?: string) => Promise<DirectoryListingLike>
}

export type SetupWizardProps = PropsRuntime<'shell.overlay'> & PropsLocale<'amphoreus'> & SetupWizardInjected

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string
type ChooserMode = 'idle' | 'picking' | 'browse' | 'manual'

const STEPS: readonly { readonly id: SetupStep; readonly label: AmphoreusKey }[] = [
  { id: 'root', label: 'setup.stepRoot' },
  { id: 'check', label: 'setup.stepCheck' },
  { id: 'derive', label: 'setup.stepDerive' },
]

interface SlotsLike {
  register(options: {
    name: 'shell.overlay'
    id: string
    order: number
    locale: typeof NS
    inject: () => SetupWizardInjected
  }, component: typeof SetupWizard): () => void
}

/** Register the wizard as one more shell.overlay entry (called inside the plugin's single overlay inject callback). */
export function registerSetupOverlay(slots: SlotsLike, inject: () => SetupWizardInjected): () => void {
  return slots.register({ name: 'shell.overlay', id: 'amphoreus-setup', order: -10, locale: NS, inject }, SetupWizard)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SetupWizard({ setup, model, pickDirectory, listDirectory, t }: SetupWizardProps) {
  const { open, step } = useSyncExternalStore(setup.subscribe, setup.getSnapshot)
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<ChooserMode>('idle')
  const [listing, setListing] = useState<DirectoryListingLike>()
  const [chooserNote, setChooserNote] = useState<string>()
  const [report, setReport] = useState<AssetsCheckReport>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // Host-side lastDerive.at observed when the derive was requested; completion = a newer host timestamp (no client clock involved).
  const [deriveBaseline, setDeriveBaseline] = useState<number>()
  const lock = useRef(false)

  const state = snapshot.state
  const assets = state?.assets

  useEffect(() => {
    if (!open) return
    setDraft(assets?.root ?? '')
    setMode('idle')
    setListing(undefined)
    setChooserNote(undefined)
    setReport(undefined)
    setError(undefined)
    setDeriveBaseline(undefined)
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // Capture phase + stopPropagation: the wizard paints above other overlays, so Escape must close only it.
      event.stopPropagation()
      setup.close()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
    // Reset only when the dialog opens; the live root is read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, setup])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(message(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const choose = (start?: string): Promise<void> => run(async () => {
    setMode('picking')
    const choice = await chooseFolder({ pickDirectory, listDirectory }, start)
    if (choice.mode === 'native') {
      setMode('idle')
      if (choice.path !== null && choice.path.trim() !== '') setDraft(choice.path.trim())
      return
    }
    if (choice.mode === 'browse') {
      setMode('browse')
      setListing(choice.listing)
      setChooserNote(t('setup.browseHint'))
      return
    }
    setMode('manual')
    setChooserNote(`${t('setup.manualHint')} (${choice.reason})`)
  })

  const browseTo = (path?: string): Promise<void> => run(async () => {
    setListing(await listDirectory(path))
  })

  const check = (root: string): Promise<void> => run(async () => {
    setReport(undefined)
    setup.setStep('check')
    setReport(await model.checkAssets(root))
  })

  const save = (root: string): Promise<void> => run(async () => {
    await model.setAssetsRoot(root)
    setup.setStep('derive')
  })

  const derive = (): Promise<void> => run(async () => {
    setDeriveBaseline(model.getSnapshot().state?.assets.lastDerive?.at ?? -1)
    await model.deriveAssets(false)
  })

  const finish = (): Promise<void> => run(async () => {
    await model.dismissSetup()
    setup.close()
  })

  if (!open) return null

  const trimmed = draft.trim()
  const digest = report === undefined ? undefined : digestCheck(report)
  const running = assets?.running === true
  const lastDerive = assets?.lastDerive ?? null
  const deriveFinished = deriveBaseline !== undefined && !running && lastDerive !== null && lastDerive.at > deriveBaseline
  const magickMissing = assets !== undefined && assets.magick === null
  const progress = running ? snapshot.deriveProgress : undefined
  const stepIndex = STEPS.findIndex(item => item.id === step)

  return (
    <div
      className={css.scrim}
      role="dialog"
      aria-modal="true"
      aria-labelledby="amphoreus-setup-title"
      onClick={event => {
        if (event.target === event.currentTarget) setup.close()
      }}
    >
      <div className={css.panel} ref={panelRef} tabIndex={-1}>
        <button className={css.close} type="button" aria-label={t('setup.close')} onClick={setup.close}>×</button>
        <header className={css.header}>
          <p className={css.eyebrow}>{t('setup.eyebrow')}</p>
          <h2 id="amphoreus-setup-title">{t('setup.title')}</h2>
          <p>{t('setup.intro')}</p>
        </header>
        <ol className={css.steps}>
          {STEPS.map((item, index) => (
            <li key={item.id} aria-current={item.id === step ? 'step' : undefined} data-done={index < stepIndex ? 'true' : 'false'}>
              <span>{index + 1}</span>{t(item.label)}
            </li>
          ))}
        </ol>

        <div className={css.body}>
          {step === 'root' && (
            <RootStep
              t={t}
              draft={draft}
              current={assets?.root ?? ''}
              rootSource={assets?.rootSource ?? 'none'}
              mode={mode}
              listing={listing}
              note={chooserNote}
              busy={busy}
              onDraft={setDraft}
              onPick={() => { void choose(trimmed === '' ? undefined : trimmed) }}
              onBrowse={path => { void browseTo(path) }}
            />
          )}
          {step === 'check' && (
            <CheckStep t={t} root={trimmed} busy={busy} digest={digest} />
          )}
          {step === 'derive' && (
            <DeriveStep
              t={t}
              root={assets?.root ?? trimmed}
              magickMissing={magickMissing}
              running={running}
              progress={progress}
              finished={deriveFinished}
              lastDerive={deriveFinished ? lastDerive : null}
            />
          )}
          {error !== undefined && <p className={css.error} role="alert">{error}</p>}
        </div>

        <div className={css.actions}>
          <button className={css.link} type="button" disabled={busy} onClick={() => { void finish() }}>
            {step === 'derive' && deriveFinished ? t('setup.finish') : t('setup.skip')}
          </button>
          <span className={css.spacer} />
          {step === 'root' && (
            <button className={css.primary} type="button" disabled={busy || trimmed === ''} onClick={() => { void check(trimmed) }}>{t('setup.next')}</button>
          )}
          {step === 'check' && (
            <>
              <button className={css.secondary} type="button" disabled={busy} onClick={() => setup.setStep('root')}>{t('setup.back')}</button>
              <button className={css.secondary} type="button" disabled={busy || trimmed === ''} onClick={() => { void check(trimmed) }}>{busy ? t('setup.checking') : t('setup.recheck')}</button>
              <button className={css.primary} type="button" disabled={busy || report === undefined} onClick={() => { void save(trimmed) }}>{busy ? t('setup.saving') : t('setup.save')}</button>
            </>
          )}
          {step === 'derive' && (
            <>
              <button className={css.secondary} type="button" disabled={busy || running} onClick={() => setup.setStep('root')}>{t('setup.back')}</button>
              <button className={css.primary} type="button" disabled={busy || running || magickMissing} onClick={() => { void derive() }}>{running ? t('setup.deriving') : t('setup.derive')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface RootStepProps {
  readonly t: Translate
  readonly draft: string
  readonly current: string
  readonly rootSource: 'none' | 'config' | 'prefs'
  readonly mode: ChooserMode
  readonly listing: DirectoryListingLike | undefined
  readonly note: string | undefined
  readonly busy: boolean
  readonly onDraft: (value: string) => void
  readonly onPick: () => void
  readonly onBrowse: (path?: string) => void
}

function RootStep({ t, draft, current, rootSource, mode, listing, note, busy, onDraft, onPick, onBrowse }: RootStepProps) {
  return (
    <>
      <span className={css.label}>{t('setup.currentRoot')}</span>
      <p className={css.current}>
        {current === '' ? t('setup.currentRootNone') : <code>{current}</code>}
        {rootSource === 'none' ? null : ` · ${t(rootSource === 'prefs' ? 'setup.rootFromPrefs' : 'setup.rootFromConfig')}`}
      </p>
      <span className={css.label}>{t('setup.pathLabel')}</span>
      <div className={css.pathRow}>
        <input
          className={css.input}
          type="text"
          value={draft}
          placeholder={t('setup.pathPlaceholder')}
          spellCheck={false}
          onChange={event => onDraft(event.currentTarget.value)}
        />
        <button className={css.secondary} type="button" disabled={busy} onClick={onPick}>
          {mode === 'picking' ? t('setup.picking') : t('setup.pick')}
        </button>
      </div>
      {note !== undefined && <p className={css.hint}>{note}</p>}
      {mode === 'browse' && listing !== undefined && (
        <div className={css.browser}>
          <ol className={css.crumbs}>
            {listing.home !== undefined && (
              <li><button className={css.crumbButton} type="button" disabled={busy} onClick={() => onBrowse(listing.home)}>{t('setup.browseHome')}</button></li>
            )}
            {listing.crumbs.map(crumb => (
              <li key={crumb.path}>
                <span aria-hidden="true">/</span>
                <button className={css.crumbButton} type="button" disabled={busy} onClick={() => onBrowse(crumb.path)}>{crumb.name}</button>
              </li>
            ))}
          </ol>
          {listing.entries.length === 0
            ? <p className={css.hint}>{t('setup.browseEmpty')}</p>
            : (
              <ul className={css.entries}>
                {listing.entries.map(entry => (
                  <li key={entry.path}>
                    <button className={css.entryButton} type="button" data-hidden={entry.hidden === true ? 'true' : 'false'} disabled={busy} onClick={() => onBrowse(entry.path)}>{entry.name}</button>
                  </li>
                ))}
              </ul>
            )}
          <div className={css.browserFoot}>
            <span>{listing.truncated === true ? t('setup.browseTruncated') : listing.path}</span>
            <button className={css.link} type="button" disabled={busy} onClick={() => onDraft(listing.path)}>{t('setup.browseUseThis')}</button>
          </div>
        </div>
      )}
    </>
  )
}

interface CheckStepProps {
  readonly t: Translate
  readonly root: string
  readonly busy: boolean
  readonly digest: ReturnType<typeof digestCheck> | undefined
}

function CheckStep({ t, root, busy, digest }: CheckStepProps) {
  return (
    <>
      <span className={css.label}>{t('setup.currentRoot')}</span>
      <p className={css.current}><code>{root}</code></p>
      {digest === undefined
        ? <p className={css.status} aria-busy={busy}>{busy ? t('setup.checking') : t('setup.checkNone')}</p>
        : (
          <>
            <dl className={css.summary}>
              <div><dt>{t('setup.required')}</dt><dd data-complete={digest.complete ? 'true' : 'false'}>{digest.requiredOk}/{digest.requiredTotal}</dd></div>
              <div><dt>{t('setup.optional')}</dt><dd>{digest.optionalOk}/{digest.optionalTotal}</dd></div>
              <div><dt>{t('setup.homeFolders')}</dt><dd>{digest.homePopulated}/{digest.homeTotal}</dd></div>
            </dl>
            <p className={css.status} data-tone={digest.complete ? 'ok' : 'warn'} aria-live="polite">
              {digest.complete ? t('setup.checkOk') : t('setup.checkPartial', { n: String(digest.requiredTotal - digest.requiredOk) })}
            </p>
            {digest.large > 0 && <p className={css.hint}>{t('setup.large', { n: String(digest.large) })}</p>}
            {digest.missingRequired.length > 0 && (
              <>
                <p className={css.hint}>{t('setup.missingHead')}</p>
                <ul className={css.missing}>{digest.missingRequired.map(path => <li key={path}><code>{path}</code></li>)}</ul>
              </>
            )}
          </>
        )}
    </>
  )
}

interface DeriveStepProps {
  readonly t: Translate
  readonly root: string
  readonly magickMissing: boolean
  readonly running: boolean
  readonly progress: { readonly kind: string; readonly done: number; readonly total: number; readonly current: string } | undefined
  readonly finished: boolean
  readonly lastDerive: { readonly written: number; readonly failed: number; readonly error?: string } | null
}

function DeriveStep({ t, root, magickMissing, running, progress, finished, lastDerive }: DeriveStepProps) {
  const percent = progress === undefined || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  return (
    <>
      <span className={css.label}>{t('setup.currentRoot')}</span>
      <p className={css.current}><code>{root}</code></p>
      <p className={css.status}>{t('setup.deriveIntro')}</p>
      {magickMissing && <p className={css.error}>{t('setup.magickMissing')}</p>}
      {running && (
        <div className={css.progress} aria-live="polite" aria-atomic="true">
          {progress === undefined ? t('setup.deriving') : `${progress.kind} ${progress.done}/${progress.total} · ${progress.current}`}
          <div className={css.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
        </div>
      )}
      {finished && lastDerive !== null && (
        <p className={css.status} data-tone={lastDerive.failed > 0 ? 'warn' : 'ok'} aria-live="polite">
          {lastDerive.failed > 0
            ? t('setup.deriveFailed', { failed: String(lastDerive.failed), error: lastDerive.error ?? '' })
            : t('setup.deriveDone', { written: String(lastDerive.written) })}
        </p>
      )}
    </>
  )
}
