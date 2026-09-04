import type { BindingRecord, CanvasRecord, MemoryRecord, ObservationRecord, SeatRecord, SuiteEventRecord } from '../host/store.ts'
import type { DiagnosticCode, FeatureSwitches, SuiteLevel } from '../host/suite/types.ts'

export interface PublicCard {
  readonly name: string
  readonly displayName: string
  readonly aliases: readonly string[]
  readonly faces: readonly string[]
  readonly description: string
  readonly ordinal?: number
  readonly duties: readonly string[]
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly hasPersona: boolean
  readonly status: 'ok' | 'name-mismatch'
}

export interface PublicSuite {
  readonly parserVersion: string
  readonly parsedAt: number
  readonly generation: number
  readonly level: SuiteLevel
  readonly features: FeatureSwitches
  readonly root?: { readonly configured: string; readonly canonical: string }
  readonly roots: readonly { readonly index: number; readonly configured: string; readonly canonical: string }[]
  readonly fingerprint?: { readonly manifestSha256: string; readonly label: string; readonly fileCount: number; readonly computedAt: number }
  readonly cards: readonly PublicCard[]
  readonly dispatch: readonly { readonly needs: readonly string[]; readonly roleText: string; readonly skill: string; readonly face?: string }[]
  readonly pipelines: readonly {
    readonly name: string
    readonly source: 'common' | 'router'
    readonly stations: readonly { readonly text: string; readonly skill?: string; readonly face?: string }[]
  }[]
  readonly contracts?: {
    readonly receipt?: { readonly source: string; readonly tiers: readonly string[] }
    readonly absence: { readonly template: string; readonly source?: string; readonly fromFile: boolean }
    readonly handoff: { readonly template: string; readonly verb: string; readonly source?: string; readonly fromFile: boolean }
    readonly firewallWords: readonly string[]
  }
  readonly diagnostics: readonly { readonly code: DiagnosticCode; readonly severity: 'info' | 'warn' | 'error'; readonly detail: string; readonly line?: number; readonly skill?: string }[]
}

export interface AmphoreusBoot {
  readonly revision: number
  readonly nonce: string
  readonly level: SuiteLevel | 'loading'
  readonly wallpaper: {
    readonly enabled: boolean
    readonly url?: string
    readonly sidebarUrl?: string
    readonly darkMask: number
    readonly lightMask: number
  }
}

export interface AmphoreusState {
  readonly revision: number
  readonly nonce: string
  readonly suite: PublicSuite | undefined
  readonly seats: readonly SeatRecord[]
  readonly bindings: readonly BindingRecord[]
  readonly memory: readonly MemoryRecord[]
  readonly observations: readonly ObservationRecord[]
  readonly suiteEvents: readonly SuiteEventRecord[]
  readonly canvas: readonly { readonly sessionId: string; readonly value: CanvasRecord }[]
  readonly effectiveConfig: {
    readonly wallpaper: { readonly enabled: boolean; readonly global: 'rotate' | 'fixed'; readonly globalIndex: number; readonly sidebarIndex: number; readonly perSeat: boolean; readonly darkMask: number; readonly lightMask: number; readonly surfaceAlpha: { readonly light: number; readonly dark: number } }
    readonly magazineMode: 'light' | 'full'
    readonly seatStyle: boolean
    readonly assetsConfigured: boolean
    readonly heroWorkspaceMode: 'seats' | 'off'
  }
}

declare global {
  interface Window {
    __AMPHOREUS_BOOT__?: AmphoreusBoot
  }
}
