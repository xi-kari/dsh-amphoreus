import type { AmphoreusGlobal, BindingRecord, CanvasRecord, MemoryRecord, ObservationRecord, SeatRecord, SuiteEventRecord } from '../host/store.ts'
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

export interface WorkbenchPublicConfig {
  readonly enabled: boolean
  readonly host: 'iframe' | 'native'
  readonly defaultView: 'chat' | 'workbench'
  readonly cardTextLimit: number
  readonly autoProjection: boolean
}

export type WorkbenchStatus =
  | { readonly kind: 'ready' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly reason: string }

export interface UnprojectableRecord {
  readonly sessionId: string
  readonly heroId: string | null
  readonly title: string | null
  readonly reason: string
  readonly at: number
}

/** iframe 壳 <script> 注入的全局，形状比宿主页 __AMPHOREUS_BOOT__ 小。 */
export interface WorkbenchBoot {
  readonly nonce: string
  readonly revision: number
  readonly workbench: WorkbenchPublicConfig
}

export interface ThemeTokensMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:theme-tokens'
  readonly tokens: Readonly<Record<string, string>>
  readonly dark: boolean
}

export interface SeatChangedMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:seat-changed'
  readonly heroId: string | null
}

export interface MagazineModeMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:magazine-mode'
  readonly mode: 'light' | 'full'
}

export interface AmphoreusBoot {
  readonly revision: number
  readonly nonce: string
  readonly level: SuiteLevel | 'loading'
  readonly workbench: WorkbenchPublicConfig
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
  readonly seatDirs: readonly { readonly heroId: string; readonly skillName: string; readonly dir: string }[]
  readonly bindings: readonly BindingRecord[]
  readonly memory: readonly MemoryRecord[]
  readonly observations: readonly ObservationRecord[]
  readonly prefs: AmphoreusGlobal['prefs']
  readonly suiteEvents: readonly SuiteEventRecord[]
  readonly canvas: readonly { readonly sessionId: string; readonly value: CanvasRecord }[]
  readonly workbench: {
    readonly status: WorkbenchStatus
    readonly unprojectable: readonly UnprojectableRecord[]
  }
  readonly effectiveConfig: {
    readonly wallpaper: { readonly enabled: boolean; readonly global: 'rotate' | 'fixed'; readonly globalIndex: number; readonly sidebarIndex: number; readonly perSeat: boolean; readonly darkMask: number; readonly lightMask: number; readonly surfaceAlpha: { readonly light: number; readonly dark: number } }
    readonly magazineMode: 'light' | 'full'
    readonly magazineModeSource: 'config' | 'prefs'
    readonly seatStyle: boolean
    readonly assetsConfigured: boolean
    readonly heroWorkspaceMode: 'seats' | 'off'
    readonly workbench: WorkbenchPublicConfig
  }
}

declare global {
  interface Window {
    __AMPHOREUS_BOOT__?: AmphoreusBoot
  }
}
