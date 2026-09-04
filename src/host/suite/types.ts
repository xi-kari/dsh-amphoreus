/**
 * Suite contract types: the structured result of parsing one skill root at
 * runtime. Nothing here carries suite text as constants; every value below is
 * produced by `parseSuite` from the files on disk (设计底账 05 §1.1 第 3/8 条).
 */

export type SkillName = string
export type CardName = SkillName
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const CARD_NAME = /^amphoreus-[a-z0-9]+(?:-[a-z0-9]+)*$/
export const ROUTER_NAME = 'amphoreus'

export interface ResolvedRoot {
  readonly index: number
  readonly configured: string
  readonly expanded: string
  readonly canonical: string
}

export interface Frontmatter {
  readonly name: SkillName
  readonly description: string
  readonly disableModelInvocation: boolean | undefined
  readonly userInvocable: boolean | undefined
  readonly raw: Readonly<Record<string, unknown>>
}

export interface MdSection {
  title: string
  level: 2 | 3
  startLine: number
  endLine: number
  lines: string[]
  children: MdSection[]
}

export interface ReceiptTemplate {
  readonly faceName: string
  readonly faceNameRaw: string
  readonly line: number
}

export interface AliasTarget {
  readonly skill: CardName
  readonly face?: string
}

export interface HandoffEdge {
  readonly from: CardName
  readonly kind: 'handoff' | 'notify'
  readonly verb: string
  readonly targetText: string
  readonly to: AliasTarget | undefined
  readonly payloadHint: string
  readonly raw: string
  readonly line: number
}

export interface PipelineStation {
  readonly text: string
  readonly to: AliasTarget | undefined
}

export interface Pipeline {
  readonly name: string
  readonly stations: readonly PipelineStation[]
  readonly source: 'common' | 'router'
  readonly raw: string
  readonly line: number
}

export interface DispatchRow {
  readonly needs: readonly string[]
  readonly roleText: string
  readonly skill: CardName
  readonly face?: string
  readonly line: number
}

export interface ReceiptFormat {
  readonly template: string
  readonly separator: string
  readonly cardSuffix: string
  readonly readsLabel: string
  readonly tierLabel: string
  readonly tiers: readonly string[]
  readonly regex: RegExp
}

export interface ContractFormats {
  readonly receipt?: ReceiptFormat
  readonly absence: { readonly template: string; readonly regex: RegExp | undefined; readonly fromFile: boolean }
  readonly handoff: { readonly template: string; readonly verb: string; readonly regex: RegExp | undefined; readonly fromFile: boolean }
  readonly firewallWords: readonly string[]
  readonly depthGate: readonly { depth: string; entry: string; mode: string }[]
  readonly tiers: readonly string[]
  readonly sections: readonly string[]
  readonly sha256: string
}

export interface RouterCard {
  readonly path: string
  readonly sha256: string
  readonly frontmatter: Frontmatter
  readonly sections: readonly string[]
  readonly dispatchNotes: string
  readonly pipelinesEcho: readonly Pipeline[]
}

export interface CardEntry {
  readonly name: CardName
  readonly dir: string
  readonly path: string
  readonly sha256: string
  readonly frontmatter: Frontmatter
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly primaryReceiptName?: string
  readonly faces: readonly string[]
  readonly displayName: string
  readonly aliases: readonly string[]
  readonly ordinal?: number
  readonly duties: readonly string[]
  readonly receipts: readonly ReceiptTemplate[]
  readonly handoffs: readonly HandoffEdge[]
  readonly sections: readonly string[]
  readonly body: string
  readonly hasPersona: boolean
  readonly status: 'ok' | 'name-mismatch'
}

export interface InvalidCard {
  readonly dir: string
  readonly path: string
  readonly reason: DiagnosticCode
  readonly detail: string
  readonly frontmatterName?: string
}

export type DiagnosticCode =
  | 'root-missing' | 'root-unexpandable' | 'router-missing' | 'router-frontmatter-invalid' | 'root-standby-differs'
  | 'common-missing' | 'relations-missing' | 'section-missing' | 'section-alias-hit' | 'section-duplicate' | 'table-row-unparsed'
  | 'card-frontmatter-invalid' | 'card-legacy-key' | 'card-name-mismatch' | 'card-not-amphoreus' | 'card-missing-for-known-seat'
  | 'invocation-policy-relaxed' | 'receipt-template-missing' | 'alias-conflict' | 'alias-unresolved' | 'pipeline-station-unresolved'
  | 'template-missing' | 'receipt-template-drift' | 'pipeline-from-router' | 'reference-path-mismatch' | 'command-collision'
  | 'symlink-escape' | 'file-too-large' | 'parse-exception' | 'shadowed-by-nearer-layer' | 'health-check-failed' | 'suspected-rename'
  | 'io-error'

export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly severity: 'info' | 'warn' | 'error'
  readonly detail: string
  readonly path?: string
  readonly line?: number
  readonly skill?: SkillName
}

export interface FeatureSwitches {
  readonly provider: boolean
  readonly autoInject: boolean
  readonly seatSync: boolean
  readonly dispatchHints: boolean
  readonly pipelines: boolean
  readonly handoffButtons: boolean
  readonly receiptDetection: boolean
  readonly salonHints: boolean
}

export type SuiteLevel = 'L0' | 'L1' | 'L2' | 'L3'

export interface RelationsSummary {
  readonly present: boolean
  readonly sha256: string
  readonly sections: readonly string[]
  readonly salonParams: Readonly<Record<string, string>>
  readonly interestEdges: readonly { hero: string; heroSkill?: CardName; edge: string; evidence: string }[]
  readonly forbiddenPairs: readonly string[]
}

export interface SuiteFingerprint {
  readonly manifestSha256: string
  readonly statDigest: string
  readonly fileCount: number
  readonly git?: { head: string; describe?: string; dirty: boolean }
  readonly label: string
  readonly computedAt: number
  readonly manifest?: readonly { rel: string; sha256: string; size: number }[]
}

/** A complete parse of the primary root: the only skill-side contract the plugin exposes. */
export interface SuiteSnapshot {
  readonly parserVersion: string
  readonly parsedAt: number
  readonly generation: number
  readonly root?: ResolvedRoot
  readonly roots: readonly ResolvedRoot[]
  readonly fingerprint?: SuiteFingerprint
  readonly level: SuiteLevel
  readonly features: FeatureSwitches
  readonly router?: RouterCard
  readonly contracts?: ContractFormats
  readonly relations?: RelationsSummary
  readonly cards: ReadonlyMap<CardName, CardEntry>
  readonly invalidCards: readonly InvalidCard[]
  readonly nameIndex: ReadonlyMap<string, AliasTarget>
  readonly dispatch: readonly DispatchRow[]
  readonly pipelines: readonly Pipeline[]
  readonly diagnostics: readonly Diagnostic[]
}
