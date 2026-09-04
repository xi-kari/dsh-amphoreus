import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import type { SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { createSkillProvider, invocationOf, type SkillProviderSource } from '../src/host/bridge.ts'
import { parseSuite, type SuiteTextFile } from '../src/host/suite/parse.ts'
import { SuiteReader, type FreshSkillFile } from '../src/host/suite/reader.ts'
import type { Frontmatter, ResolvedRoot, SuiteSnapshot } from '../src/host/suite/types.ts'

const ROOT: ResolvedRoot = { index: 0, configured: 'X:/fixture', expanded: 'X:/fixture', canonical: 'X:/fixture' }

test('skill provider is incomplete before first parse, lists router plus fictional cards, and loads fresh disk content', async () => {
  let snapshot: SuiteSnapshot | undefined
  let scheduled = ''
  const fresh: FreshSkillFile = {
    path: 'X:/fixture/amphoreus-testcard-a/SKILL.md',
    directory: 'X:/fixture/amphoreus-testcard-a',
    sha256: 'fresh-sha',
    frontmatter: frontmatter('amphoreus-testcard-a', 'fresh description', true),
    body: '# fresh body',
  }
  const source: SkillProviderSource = {
    current: () => snapshot,
    readFresh: async () => fresh,
    scheduleReparse: reason => { scheduled = reason },
  }
  const provider = createSkillProvider(source, {
    providerName: 'dsh-amphoreus',
    providerSource: 'amphoreus',
    providerRank: 300,
    forceUserOnly: false,
  })

  const pending = await provider.list({}) as SkillProviderObservation
  assert.deepEqual(pending, { candidates: [], complete: false })

  snapshot = minimalSnapshot()
  const observation = await provider.list({}) as SkillProviderObservation
  assert.equal(observation.complete, true)
  assert.equal(observation.candidates.length, 2)
  const router = observation.candidates.find(candidate => candidate.name === 'amphoreus')
  const card = observation.candidates.find(candidate => candidate.name === 'amphoreus-testcard-a')
  assert.equal(router?.provider, 'dsh-amphoreus')
  assert.equal(card?.source, 'amphoreus')
  assert.equal(card?.rank, 300)
  assert.deepEqual(card?.invocation, { modelInvocable: false, userInvocable: true })
  assert.deepEqual(card?.resourceBase, { kind: 'directory', path: 'X:/fixture/amphoreus-testcard-a' })
  assert.equal((card?.metadata?.amphoreus as { displayName?: string })?.displayName, '晨星')

  assert.notEqual(card, undefined)
  const loaded = await provider.get(card!, {})
  assert.equal(loaded?.name, 'amphoreus-testcard-a')
  assert.equal(loaded?.description, 'fresh description')
  assert.equal(loaded?.content, '# fresh body')
  assert.equal(scheduled, 'provider-get-observed-change')
})

test('provider get rejects a foreign locator and forceUserOnly only tightens model invocation', async () => {
  const fm = frontmatter('amphoreus-testcard-a', 'fixture', false)
  assert.deepEqual(invocationOf(fm, false), { modelInvocable: true, userInvocable: true })
  assert.deepEqual(invocationOf(fm, true), { modelInvocable: false, userInvocable: true })
  const noUser: Frontmatter = { ...fm, userInvocable: false }
  assert.deepEqual(invocationOf(noUser, true), { modelInvocable: false, userInvocable: false })

  const source: SkillProviderSource = { current: () => minimalSnapshot(), readFresh: async () => undefined, scheduleReparse: () => {} }
  const provider = createSkillProvider(source, { providerName: 'dsh-amphoreus', providerSource: 'amphoreus', providerRank: 300, forceUserOnly: false })
  const loaded = await provider.get({
    name: 'amphoreus-testcard-a',
    description: 'fixture',
    invocation: { modelInvocable: false, userInvocable: true },
    provider: 'foreign-provider',
    source: 'custom',
    rank: 300,
    locator: {},
  }, {})
  assert.equal(loaded, undefined)
})

test('SuiteReader loads only direct fictional suite cards and rejects lexical traversal', async t => {
  const root = await createReaderFixture()
  t.after(async () => removeFixture(root))
  const diagnostics: import('../src/host/suite/types.ts').Diagnostic[] = []
  const reader = await SuiteReader.create(root, diagnostics)
  const cards = await reader.listCardDirs()
  assert.deepEqual(cards.map(card => card.name), ['amphoreus-testcard-a'])
  assert.equal(await reader.guardPath('../outside.txt'), undefined)
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'symlink-escape'))

  const loaded = await reader.loadSuiteFiles({
    root: { index: 0, configured: root, expanded: root, canonical: root },
    roots: [{ index: 0, configured: root, expanded: root, canonical: root }],
    commonPath: 'amphoreus/references/common.md',
    relationsPath: 'amphoreus/references/relations.md',
  })
  assert.equal(loaded.cards.length, 1)
  assert.notEqual(loaded.router, undefined)
  assert.notEqual(loaded.common, undefined)
  assert.equal(loaded.relations, undefined)

  const skillPath = join(root, 'amphoreus-testcard-a', 'SKILL.md')
  const fresh = await reader.readSkillPath(skillPath)
  assert.equal(fresh?.frontmatter.name, 'amphoreus-testcard-a')
  assert.equal(fresh?.body, '# fictional body')
})

function minimalSnapshot(): SuiteSnapshot {
  return parseSuite({
    root: ROOT,
    roots: [ROOT],
    router: text('X:/fixture/amphoreus/SKILL.md', `---\nname: amphoreus\ndescription: fixture router\ndisable-model-invocation: true\n---\n## 必读分层\n- \`角色未部署｜原因：module_unavailable｜未完成职责：<职责>\`\n## 分派表\n| 需求 | 角色与 skill |\n|---|---|\n| 规划 | 晨星 \`amphoreus-testcard-a\` |\n## 流水线与会诊\n- 试炼线：晨星 → 晨星。\n`),
    common: text('X:/fixture/amphoreus/references/common.md', `# common\n## 深度门\n| 深度 | 条件 | 形态 |\n|---|---|---|\n| L0 | 简单 | 单卡 |\n- \`角色未部署｜原因：module_unavailable｜未完成职责：<职责>\`\n## 风格税\n| 档位 | 范围 | 用途 |\n|---|---|---|\n| 标准 | 中 | 默认 |\n## 移交与流水线\n- \`此事移交◯◯：<内容>\`\n- 试炼线：晨星 → 晨星。\n## 汇报与回执\n- \`◯◯卡｜读取：<内容>｜档位：标准／静音\`\n`),
    cards: [{
      dir: 'amphoreus-testcard-a',
      skill: text('X:/fixture/amphoreus-testcard-a/SKILL.md', `---\nname: amphoreus-testcard-a\ndescription: fixture amphoreus-testcard-a／晨星；\ndisable-model-invocation: true\n---\n## 身份与职能\n- 编号一\n## 输出模板\n- \`晨星卡｜读取：common.md｜档位：标准／静音\`\n## 协作与移交\n`),
      persona: text('X:/fixture/amphoreus-testcard-a/persona.md', '# fixture'),
    }],
  }, { generation: 2, parsedAt: 3 })
}

function frontmatter(name: string, description: string, disabled: boolean): Frontmatter {
  return { name, description, disableModelInvocation: disabled, userInvocable: undefined, raw: {} }
}

function text(path: string, content: string): SuiteTextFile {
  return { path, content }
}

async function createReaderFixture(): Promise<string> {
  const root = resolve(await mkdtemp(join(tmpdir(), 'dsh-amphoreus-reader-')))
  await mkdir(join(root, 'amphoreus', 'references'), { recursive: true })
  await mkdir(join(root, 'amphoreus-testcard-a'), { recursive: true })
  await mkdir(join(root, 'unrelated-skill'), { recursive: true })
  await writeFile(join(root, 'amphoreus', 'SKILL.md'), '---\nname: amphoreus\ndescription: fixture\n---\n', 'utf8')
  await writeFile(join(root, 'amphoreus', 'references', 'common.md'), '# common\n', 'utf8')
  await writeFile(join(root, 'amphoreus-testcard-a', 'SKILL.md'), '---\nname: amphoreus-testcard-a\ndescription: fixture\n---\n# fictional body\n', 'utf8')
  await writeFile(join(root, 'amphoreus-testcard-a', 'persona.md'), '# fictional persona\n', 'utf8')
  await writeFile(join(root, 'unrelated-skill', 'SKILL.md'), 'unrelated\n', 'utf8')
  return root
}

async function removeFixture(root: string): Promise<void> {
  const resolved = resolve(root)
  assert.match(resolved, /dsh-amphoreus-reader-/)
  assert.ok(resolved.startsWith(`${resolve(tmpdir())}\\`) || resolved.startsWith(`${resolve(tmpdir())}/`))
  await rm(resolved, { recursive: true, force: true })
}
