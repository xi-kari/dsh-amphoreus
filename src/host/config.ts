/** Host plugin configuration (schemastery; every nested object defaults so partial patches keep the rest). */
import z from '@deepseek-ai/schemastery'

export type SessionStartSourceName = 'startup' | 'resume' | 'clear' | 'compact'

export interface AmphoreusConfig {
  skillRoots: string[]
  dataDir: string
  assetsRoot: string
  commonPath: string
  relationsPath: string
  sectionAliases: Record<string, string[]>
  providerName: string
  providerSource: string
  providerRank: number
  registerProvider: boolean
  forceUserOnly: boolean
  heroWorkspaceMode: 'seats' | 'off'
  magazineMode: 'light' | 'full'
  seatStyle: boolean
  wallpaper: {
    enabled: boolean
    global: 'rotate' | 'fixed'
    globalIndex: number
    sidebarIndex: number
    perSeat: boolean
    darkMask: number
    lightMask: number
    surfaceAlpha: { light: number; dark: number }
  }
  autoInvoke: { enabled: boolean; sources: SessionStartSourceName[] }
  receiptParsing: boolean
  handoff: { enabled: boolean }
  workbench: { enabled: boolean; defaultView: 'chat' | 'workbench'; cardTextLimit: number; autoProjection: boolean }
  suiteWatch: { mode: 'fs' | 'poll' | 'off'; pollMs: number; debounceMs: number }
  validate: { enabled: boolean; python: string }
  sync: { source: string; ref: string; keepBackups: number }
  trustedHosts: string[]
}

/** Runtime value for nested-object defaults; schemastery fills inner defaults from an empty object (verified on 3.18.2). */
const EMPTY_OBJECT = {} as unknown as never

export const Config: z<AmphoreusConfig> = z.object({
  skillRoots: z.array(z.string()).default(['~/.claude/skills', '~/.codex/skills']),
  dataDir: z.string().default(''),
  assetsRoot: z.string().default(''),
  commonPath: z.string().default('amphoreus/references/common.md'),
  relationsPath: z.string().default('amphoreus/references/relations.md'),
  sectionAliases: z.dict(z.array(z.string())).default(EMPTY_OBJECT),
  providerName: z.string().default('dsh-amphoreus'),
  providerSource: z.string().default('amphoreus'),
  providerRank: z.number().default(300),
  registerProvider: z.boolean().default(true),
  forceUserOnly: z.boolean().default(false),
  heroWorkspaceMode: z.union(['seats', 'off']).default('seats'),
  magazineMode: z.union(['light', 'full']).default('light'),
  seatStyle: z.boolean().default(true),
  wallpaper: z.object({
    enabled: z.boolean().default(true),
    global: z.union(['rotate', 'fixed']).default('fixed'),
    globalIndex: z.natural().max(5).default(4),
    sidebarIndex: z.natural().max(5).default(5),
    perSeat: z.boolean().default(true),
    darkMask: z.number().min(0).max(0.9).default(0.18),
    lightMask: z.number().min(0).max(0.9).default(0.03),
    surfaceAlpha: z.object({
      light: z.number().min(0).max(1).default(0.22),
      dark: z.number().min(0).max(1).default(0.4),
    }).default(EMPTY_OBJECT),
  }).default(EMPTY_OBJECT),
  autoInvoke: z.object({
    enabled: z.boolean().default(true),
    sources: z.array(z.union(['startup', 'resume', 'clear', 'compact'])).default(['startup', 'clear']),
  }).default(EMPTY_OBJECT),
  receiptParsing: z.boolean().default(true),
  handoff: z.object({ enabled: z.boolean().default(true) }).default(EMPTY_OBJECT),
  workbench: z.object({
    enabled: z.boolean().default(true),
    defaultView: z.union(['chat', 'workbench']).default('chat'),
    cardTextLimit: z.natural().min(1000).max(32000).default(8000),
    autoProjection: z.boolean().default(true),
  }).default(EMPTY_OBJECT),
  suiteWatch: z.object({
    mode: z.union(['fs', 'poll', 'off']).default('fs'),
    pollMs: z.natural().default(15000),
    debounceMs: z.natural().default(800),
  }).default(EMPTY_OBJECT),
  validate: z.object({
    enabled: z.boolean().default(false),
    python: z.string().default('python'),
  }).default(EMPTY_OBJECT),
  sync: z.object({
    source: z.string().default('github:xi-kari/amphoreus-skill-suite'),
    ref: z.string().default('main'),
    keepBackups: z.natural().default(3),
  }).default(EMPTY_OBJECT),
  trustedHosts: z.array(z.string()).default([]),
})
