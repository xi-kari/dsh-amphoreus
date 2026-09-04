/**
 * Seat workspace folders: on install/startup the plugin materializes one
 * directory per golden-blood seat under `<dataDir>/seats/<heroId>/` and keeps
 * a README naming the seat. These folders are the intended `cwd` for sessions
 * opened from that hero's workbench, so DSH's own cwd-grouping and the
 * workbench projection both cluster seat work naturally.
 *
 * This never touches the skill roots (hard constraint: skill dirs stay
 * read-only); it writes only inside the plugin's own dataDir.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HERO_VISUALS } from '../shared/heroes.ts'
import type { SuiteSnapshot } from './suite/types.ts'

export interface SeatDirRecord {
  readonly heroId: string
  readonly skillName: string
  readonly dir: string
}

export interface EnsureSeatDirsResult {
  readonly seatsRoot: string
  readonly dirs: readonly SeatDirRecord[]
  readonly created: number
}

/** Compute the seat folder for one hero id (pure; no I/O). */
export function seatDirOf(dataDir: string, heroId: string): string {
  return join(dataDir, 'seats', heroId)
}

const README_MARK = '<!-- dsh-amphoreus:seat-readme v1 -->'

function readmeFor(heroId: string, skillName: string, displayName: string | undefined): string {
  const name = displayName === undefined || displayName === '' ? heroId : displayName
  return [
    README_MARK,
    `# ${name} · 席位工作空间`,
    '',
    `这是 dsh-amphoreus 为黄金裔席位 **${name}**（\`${skillName}\`）准备的工作目录。`,
    '在这里新建的 DSH 会话默认归入该席位的工作台。',
    '',
    `- 席位 heroId：\`${heroId}\``,
    `- 绑定技能卡：\`${skillName}\`（内容始终来自技能目录，插件不复制卡文）`,
    '- 目录由插件自动创建；删除后下次启动会重建，放心存放项目文件。',
    '',
  ].join('\n')
}

/**
 * Idempotently create every seat folder plus a README. displayNames come from
 * the live suite snapshot (runtime-parsed, never hardcoded); a missing card
 * still gets its folder so the seat is usable the moment the card deploys.
 */
export async function ensureSeatDirs(dataDir: string, snapshot: SuiteSnapshot | undefined): Promise<EnsureSeatDirsResult> {
  const seatsRoot = join(dataDir, 'seats')
  await mkdir(seatsRoot, { recursive: true })
  const dirs: SeatDirRecord[] = []
  let created = 0
  for (const hero of HERO_VISUALS) {
    const dir = seatDirOf(dataDir, hero.heroId)
    await mkdir(dir, { recursive: true })
    const displayName = snapshot?.cards.get(hero.skill)?.displayName
    const readmePath = join(dir, 'README.md')
    const next = readmeFor(hero.heroId, hero.skill, displayName)
    let existing: string | undefined
    try {
      existing = await readFile(readmePath, 'utf8')
    } catch {
      existing = undefined
    }
    // Only (re)write files the plugin itself authored — a user-replaced README stays.
    if (existing === undefined || (existing.startsWith(README_MARK) && existing !== next)) {
      await writeFile(readmePath, next, 'utf8')
      if (existing === undefined) created++
    }
    dirs.push({ heroId: hero.heroId, skillName: hero.skill, dir })
  }
  return { seatsRoot, dirs, created }
}
