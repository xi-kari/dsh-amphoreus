import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileTemplate, parseSuite, type SuiteFiles, type SuiteTextFile } from '../src/host/suite/parse.ts'
import type { ResolvedRoot } from '../src/host/suite/types.ts'

const ROOT: ResolvedRoot = {
  index: 0,
  configured: 'X:/fixture/skills',
  expanded: 'X:/fixture/skills',
  canonical: 'X:/fixture/skills',
}

function source(path: string, content: string): SuiteTextFile {
  return { path, content: content.trimStart() }
}

const ROUTER = source('X:/fixture/skills/amphoreus/SKILL.md', `
---
name: amphoreus
description: Routes a fictional constellation.
disable-model-invocation: true
---
# Fixture router

## 必读分层
- Read [common](references/common.md) and [relations](references/relations.md).
- Missing: \`角色未部署｜原因：module_unavailable｜未完成职责：<职责>\`.

## 分派表
| 需求 | 角色与 skill |
|---|---|
| 规划、排期 | 晨星 \`amphoreus-testcard-a\` |
| 回滚 | 暮星／夜星 \`amphoreus-testcard-b\` |

The table is followed by an unparsed routing note.

## 流水线与会诊
- 试炼线：晨星 → 夜星。
`)

const COMMON = source('X:/fixture/skills/amphoreus/references/common.md', `
# Shared fixture contract

## 深度门
| 深度 | 进入条件 | 运行形态 |
|---|---|---|
| L0 | 简单 | 直答 |
| L1 | 一般 | 单卡 |
| 陪聊场 | 闲聊 | 对话 |

- 缺席时使用 \`角色未部署｜原因：module_unavailable｜未完成职责：<职责>\`。

## 风格税
| 档位 | 范围 | 用途 |
|---|---|---|
| 浓 | 多 | 明示 |
| 标准 | 中 | 默认 |
| 静音 | 无 | 严肃 |

- 工艺词防火墙：下列 3 词只许出现在台账与合同，不得进入角色台词与旁白：词甲、词乙、读取：。

## 移交与流水线
- 固定格式：\`此事移交◯◯：<可直接使用的移交物>\`。
- 试炼线：晨星 → 夜星。

## 汇报与回执
- 固定格式：\`◯◯卡｜读取：<本轮实际读取>｜档位：浓／标准／静音\`。
`)

const RELATIONS = source('X:/fixture/skills/amphoreus/references/relations.md', `
# Fixture relations

## 兴趣边
| 角色 | 兴趣 | 证据 |
|---|---|---|
| 晨星 | 结构 | fixture |

## 同场禁区与搭桥
| 对子 | 规则 |
|---|---|
| 晨星×暮星 | 经主持搭桥 |

## 沙龙参数
| 参数 | 值 |
|---|---|
| active_limit | 4 |

## 圆桌参数
No structured fields in the first version.
`)

const CARD_A = source('X:/fixture/skills/amphoreus-testcard-a/SKILL.md', `
---
name: amphoreus-testcard-a
description: Use for planning via amphoreus-testcard-a／晨星；路由分派规划、排期，或显式点名。
disable-model-invocation: true
---
# Test card A

## 身份与职能
- 编号一；负责虚构规划。

## 输出模板
- 末行固定：\`晨星卡｜读取：common.md、persona.md｜档位：浓／标准／静音\`。

## 协作与移交
- 完成后写：\`此事移交夜星：<可复核计划>\`。
- 同时允许：\`此事知会暮星：<计划差异>\`。
- 模板复述 \`此事移交◯◯：<移交物>\` 不形成边。
`)

const CARD_B = source('X:/fixture/skills/amphoreus-testcard-b/SKILL.md', `
---
name: amphoreus-testcard-b
description: Use for rollback via amphoreus-testcard-b／暮星／夜星；路由分派回滚，或显式点名。
disable-model-invocation: true
---
# Test card B

## 身份与职能
- 编号十三；负责虚构回退。

## 输出模板
- 常态：\`暮星卡｜读取：common.md、persona.md｜档位：浓／标准／静音\`。
- 另一面：\`夜星♭卡｜读取：common.md、persona.md｜档位：浓／标准／静音\`。

## 协作交接
- 模板复述 \`此事移交◯◯：<移交物>\` 不形成边。
`)

function fixture(overrides: Partial<SuiteFiles> = {}): SuiteFiles {
  return {
    root: ROOT,
    roots: [ROOT],
    router: ROUTER,
    common: COMMON,
    relations: RELATIONS,
    cards: [
      { dir: 'amphoreus-testcard-a', skill: CARD_A, persona: source('X:/fixture/skills/amphoreus-testcard-a/persona.md', '# fixture') },
      { dir: 'amphoreus-testcard-b', skill: CARD_B, persona: source('X:/fixture/skills/amphoreus-testcard-b/persona.md', '# fixture') },
    ],
    ...overrides,
  }
}

const CONFIG = {
  parsedAt: 123,
  generation: 7,
  sectionAliases: { '协作与移交': ['协作交接'] },
} as const

test('parseSuite: complete fictional suite produces L0 contracts, cards, faces, dispatch, pipelines and handoffs', () => {
  const snapshot = parseSuite(fixture(), CONFIG)
  assert.equal(snapshot.parserVersion, '1')
  assert.equal(snapshot.parsedAt, 123)
  assert.equal(snapshot.generation, 7)
  assert.equal(snapshot.level, 'L0')
  assert.deepEqual(snapshot.features, {
    provider: true,
    autoInject: true,
    seatSync: true,
    dispatchHints: true,
    pipelines: true,
    handoffButtons: true,
    receiptDetection: true,
    salonHints: true,
  })
  assert.equal(snapshot.cards.size, 2)
  assert.equal(snapshot.invalidCards.length, 0)
  assert.equal(snapshot.router?.dispatchNotes, 'The table is followed by an unparsed routing note.')

  const first = snapshot.cards.get('amphoreus-testcard-a')
  const second = snapshot.cards.get('amphoreus-testcard-b')
  assert.equal(first?.displayName, '晨星')
  assert.equal(first?.ordinal, 1)
  assert.deepEqual(first?.duties, ['规划', '排期'])
  assert.equal(second?.displayName, '暮星')
  assert.equal(second?.ordinal, 13)
  assert.deepEqual(second?.faces, ['夜星'])
  assert.deepEqual(second?.duties, ['回滚'])
  assert.equal(second?.status, 'ok')

  assert.deepEqual(snapshot.nameIndex.get('夜星'), { skill: 'amphoreus-testcard-b', face: '夜星' })
  assert.deepEqual(snapshot.dispatch[1], {
    needs: ['回滚'],
    roleText: '暮星／夜星',
    skill: 'amphoreus-testcard-b',
    face: '夜星',
    line: snapshot.dispatch[1]?.line,
  })
  assert.equal(snapshot.pipelines.length, 1)
  assert.equal(snapshot.pipelines[0]?.name, '试炼线')
  assert.deepEqual(snapshot.pipelines[0]?.stations[1]?.to, { skill: 'amphoreus-testcard-b', face: '夜星' })

  assert.equal(first?.handoffs.length, 2)
  assert.deepEqual(first?.handoffs.map(edge => [edge.kind, edge.targetText, edge.to]), [
    ['handoff', '夜星', { skill: 'amphoreus-testcard-b', face: '夜星' }],
    ['notify', '暮星', { skill: 'amphoreus-testcard-b' }],
  ])
  assert.equal(second?.handoffs.length, 0)

  assert.deepEqual(snapshot.contracts?.tiers, ['浓', '标准', '静音'])
  assert.deepEqual(snapshot.contracts?.firewallWords, ['词甲', '词乙', '读取：'])
  assert.equal(snapshot.contracts?.receipt?.regex.test('晨星卡｜读取：common.md、persona.md｜档位：标准'), true)
  assert.equal(snapshot.contracts?.absence.regex?.test('角色未部署｜原因：module_unavailable｜未完成职责：规划'), true)
  assert.equal(snapshot.contracts?.handoff.regex?.test('此事移交夜星:<计划>'), true)
  assert.deepEqual(snapshot.contracts?.depthGate.map(row => row.depth), ['L0', 'L1', '陪聊场'])
  assert.equal(snapshot.relations?.salonParams.active_limit, '4')
  assert.equal(snapshot.relations?.interestEdges[0]?.heroSkill, 'amphoreus-testcard-a')
  assert.deepEqual(snapshot.relations?.forbiddenPairs, ['晨星×暮星'])
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'section-alias-hit'))
})

test('compileTemplate follows source punctuation and exposes named groups', () => {
  const handoff = compileTemplate('转交◯◯：<内容>', 'handoff')
  const handoffMatch = handoff?.exec('转交暮星:<数据>')
  assert.equal(handoffMatch?.groups?.target, '暮星')
  assert.equal(handoffMatch?.groups?.payload, '<数据>')

  const absence = compileTemplate('缺席｜职责：<职责>', 'absence')
  assert.equal(absence?.exec('缺席｜职责：复核')?.groups?.duty, '复核')
})

test('parseSuite: missing common is explicit L2 with no contract-backed features', () => {
  const snapshot = parseSuite(fixture({ common: undefined }), CONFIG)
  assert.equal(snapshot.level, 'L2')
  assert.equal(snapshot.contracts, undefined)
  assert.equal(snapshot.features.provider, true)
  assert.equal(snapshot.features.autoInject, true)
  assert.equal(snapshot.features.pipelines, false)
  assert.equal(snapshot.features.handoffButtons, false)
  assert.equal(snapshot.features.receiptDetection, false)
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'common-missing'))
})

test('parseSuite: no primary root is L3 and never reuses supplied card data', () => {
  const snapshot = parseSuite({ cards: fixture().cards }, CONFIG)
  assert.equal(snapshot.level, 'L3')
  assert.equal(snapshot.cards.size, 0)
  assert.deepEqual(snapshot.features, {
    provider: false,
    autoInject: false,
    seatSync: false,
    dispatchHints: false,
    pipelines: false,
    handoffButtons: false,
    receiptDetection: false,
    salonHints: false,
  })
})

test('parseSuite: a legacy-key card is rejected alone and degrades the suite to L1', () => {
  const bad = source('X:/fixture/skills/amphoreus-testcard-b/SKILL.md', CARD_B.content.replace('disable-model-invocation: true', 'modelInvocable: false'))
  const base = fixture()
  const snapshot = parseSuite({ ...base, cards: [base.cards[0]!, { dir: 'amphoreus-testcard-b', skill: bad }] }, CONFIG)
  assert.equal(snapshot.level, 'L1')
  assert.equal(snapshot.cards.size, 1)
  assert.equal(snapshot.invalidCards[0]?.reason, 'card-legacy-key')
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'card-legacy-key'))
})

test('parseSuite: receipt contract drift disables receipt detection without guessing', () => {
  const drifted = source(COMMON.path, COMMON.content.replace('◯◯卡｜读取：<本轮实际读取>｜档位：浓／标准／静音', '某某卡｜读取：<本轮实际读取>｜档位：浓／标准／静音'))
  const snapshot = parseSuite(fixture({ common: drifted }), CONFIG)
  assert.equal(snapshot.level, 'L1')
  assert.equal(snapshot.contracts?.receipt, undefined)
  assert.equal(snapshot.features.receiptDetection, false)
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'receipt-template-missing'))
  assert.equal(snapshot.cards.get('amphoreus-testcard-b')?.displayName, '暮星')
})

test('parseSuite: conflicting aliases are removed for both cards', () => {
  const conflict = source(CARD_B.path, CARD_B.content.replace('／暮星／夜星', '／暮星／夜星／晨星'))
  const base = fixture()
  const snapshot = parseSuite({ ...base, cards: [base.cards[0]!, { ...base.cards[1]!, skill: conflict }] }, CONFIG)
  assert.equal(snapshot.nameIndex.has('晨星'), false)
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'alias-conflict' && diagnostic.detail.includes('晨星')))
})

test('parseSuite: name mismatch keeps the frontmatter name as the binding key', () => {
  const base = fixture()
  const snapshot = parseSuite({ ...base, cards: [{ ...base.cards[0]!, dir: 'amphoreus-renamed-folder' }, base.cards[1]!] }, CONFIG)
  assert.equal(snapshot.cards.get('amphoreus-testcard-a')?.status, 'name-mismatch')
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'card-name-mismatch'))
})
