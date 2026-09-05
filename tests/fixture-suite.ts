import type { AmphoreusConfig } from '../src/host/config.ts'
import { parseSuite, type SuiteTextFile } from '../src/host/suite/parse.ts'

export interface FixtureSnapshotOptions {
  readonly withFaceCard?: boolean
}

export function fixtureSnapshot(options: FixtureSnapshotOptions = {}) {
  const root = { index: 0, configured: 'X:/fixture', expanded: 'X:/fixture', canonical: 'X:/fixture' }
  return parseSuite({
    root,
    roots: [root],
    router: text('X:/fixture/amphoreus/SKILL.md', '---\nname: amphoreus\ndescription: fixture\ndisable-model-invocation: true\n---\n## 必读分层\n- `角色未部署｜原因：module_unavailable｜未完成职责：<职责>`\n## 分派表\n| 需求 | 角色与 skill |\n|---|---|\n| 规划 | 晨星 `amphoreus-testcard-a` |\n## 流水线与会诊\n'),
    common: text('X:/fixture/amphoreus/references/common.md', '# common\n## 深度门\n| 深度 | 条件 | 形态 |\n|---|---|---|\n| L0 | 简单 | 单卡 |\n- `角色未部署｜原因：module_unavailable｜未完成职责：<职责>`\n## 风格税\n| 档位 | 范围 | 用途 |\n|---|---|---|\n| 标准 | 中 | 默认 |\n## 移交与流水线\n- `此事移交◯◯：<内容>`\n## 汇报与回执\n- `◯◯卡｜读取：<内容>｜档位：标准／静音`\n'),
    cards: [
      {
        dir: 'amphoreus-testcard-a',
        skill: text('X:/fixture/amphoreus-testcard-a/SKILL.md', '---\nname: amphoreus-testcard-a\ndescription: fixture amphoreus-testcard-a／晨星；\ndisable-model-invocation: true\n---\nSECRET_CARD_BODY\n## 身份与职能\n- 编号一\n## 输出模板\n- `晨星卡｜读取：common.md｜档位：标准／静音`\n## 协作与移交\n'),
      },
      ...(options.withFaceCard === true
        ? [{
            dir: 'amphoreus-testcard-b',
            skill: text('X:/fixture/amphoreus-testcard-b/SKILL.md', '---\nname: amphoreus-testcard-b\ndescription: fixture amphoreus-testcard-b／暮星／夜星；\ndisable-model-invocation: true\n---\nSECOND_CARD_BODY\n## 身份与职能\n- 编号二\n## 输出模板\n- `暮星卡｜读取：common.md｜档位：标准／静音`\n- `夜星卡｜读取：common.md｜档位：标准／静音`\n## 协作与移交\n'),
          }]
        : []),
    ],
  }, { parsedAt: 1, generation: 9 })
}

export function fixtureConfig(): AmphoreusConfig {
  return {
    skillRoots: ['X:/fixture'], dataDir: '', assetsRoot: '', commonPath: 'amphoreus/references/common.md', relationsPath: 'amphoreus/references/relations.md',
    sectionAliases: {}, providerName: 'dsh-amphoreus', providerSource: 'amphoreus', providerRank: 300, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: true, global: 'fixed', globalIndex: 4, sidebarIndex: 5, perSeat: true, darkMask: 0.18, lightMask: 0.03, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: ['startup', 'clear'] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
    suiteWatch: { mode: 'off', pollMs: 15000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: 'fixture', ref: 'main', keepBackups: 3 }, trustedHosts: [],
    // @anchor fixture-config
  }
}

export function text(path: string, content: string): SuiteTextFile {
  return { path, content }
}
