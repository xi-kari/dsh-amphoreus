import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AmphoreusMark } from './brand.tsx'
import type { PortalStore } from './portal-store.ts'
import {
  useWorkbenchBridge,
  type SessionsFace,
  type WorkbenchBridgeDeps,
} from './workbench.tsx'
import css from './portal.module.css'

export interface PortalFooterInjected {
  readonly portal: PortalStore
  readonly assetsConfigured: () => boolean
}

export type PortalFooterActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'amphoreus'>
  & PortalFooterInjected

export interface PortalOverlayInjected {
  readonly portal: PortalStore
  readonly model: WorkbenchBridgeDeps['model']
  readonly sessions: SessionsFace
  readonly workspaces: WorkbenchBridgeDeps['workspaces']
  readonly conversationFeed: NonNullable<WorkbenchBridgeDeps['conversationFeed']>
  readonly sessionFace: NonNullable<WorkbenchBridgeDeps['sessionFace']>
  readonly followSession: NonNullable<WorkbenchBridgeDeps['followSession']>
  readonly startSeatSession: WorkbenchBridgeDeps['startSeatSession']
  readonly seatDeps: WorkbenchBridgeDeps['seatDeps']
  readonly setSeat: WorkbenchBridgeDeps['setSeat']
  readonly theme: NonNullable<WorkbenchBridgeDeps['theme']>
  readonly magazine: NonNullable<WorkbenchBridgeDeps['magazine']>
  readonly grammar: NonNullable<WorkbenchBridgeDeps['grammar']>
  readonly openSeat: (
    heroId: string | null,
    extra?: { readonly dispatchText?: string },
  ) => Promise<boolean>
}

export type PortalOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'amphoreus'>
  & PortalOverlayInjected

export function PortalFooterAction({ wide, portal, assetsConfigured, t }: PortalFooterActionProps) {
  const open = useSyncExternalStore(portal.subscribe, portal.getSnapshot).open
  return (
    <button
      className={clsx(css.footerButton, !wide && css.rail)}
      type="button"
      aria-pressed={open}
      aria-label={t('seats.portal')}
      title={t('seats.portal')}
      onClick={portal.toggle}
    >
      <AmphoreusMark size={16} assetsConfigured={assetsConfigured} />
      {wide && <span>{t('seats.portal')}</span>}
    </button>
  )
}

export function PortalOverlay({
  portal,
  model,
  sessions,
  workspaces,
  conversationFeed,
  sessionFace,
  followSession,
  startSeatSession,
  seatDeps,
  setSeat,
  theme,
  magazine,
  grammar,
  openSeat,
  t,
}: PortalOverlayProps) {
  const open = useSyncExternalStore(portal.subscribe, portal.getSnapshot).open
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { onFrameLoad } = useWorkbenchBridge(frameRef, {
    sessions,
    model,
    workspaces,
    conversationFeed,
    sessionFace,
    followSession,
    startSeatSession,
    seatDeps,
    setSeat,
    theme,
    magazine,
    grammar,
  }, {
    onOpenSeat: openSeat,
    onOpenPortal: portal.open,
    onClose: portal.close,
    onOpened: portal.close,
  })

  useEffect(() => {
    if (!open) return
    frameRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      portal.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, portal])

  if (!open) return null
  return (
    <div
      className={css.scrim}
      role="dialog"
      aria-modal="true"
      aria-label={t('seats.portal')}
      onClick={event => {
        if (event.target === event.currentTarget) portal.close()
      }}
    >
      <div className={css.panel}>
        <button className={css.close} type="button" aria-label={t('seats.portalClose')} onClick={portal.close}>×</button>
        <iframe
          ref={frameRef}
          className={css.frame}
          src="/amphoreus/workbench/?mode=portal"
          title={t('seats.portal')}
          onLoad={onFrameLoad}
        />
      </div>
    </div>
  )
}
