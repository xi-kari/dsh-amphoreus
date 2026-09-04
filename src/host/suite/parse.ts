import { createHash } from 'node:crypto'
import {
  inlineCodes,
  normalizeContent,
  normalizeLine,
  parseFrontmatterFields,
  parseTable,
  sectionize,
  splitFrontmatter,
} from './markdown.ts'
import {
  CARD_NAME,
  ROUTER_NAME,
  type AliasTarget,
  type CardEntry,
  type CardName,
  type ContractFormats,
  type Diagnostic,
  type DiagnosticCode,
  type DispatchRow,
  type FeatureSwitches,
  type Frontmatter,
  type HandoffEdge,
  type InvalidCard,
  type MdSection,
  type Pipeline,
  type ReceiptFormat,
  type ReceiptTemplate,
  type RelationsSummary,
  type ResolvedRoot,
  type RouterCard,
  type SuiteLevel,
  type SuiteSnapshot,
} from './types.ts'

export const PARSER_VERSION = '1'

const FALLBACK_ABSENCE = '角色未部署｜原因：module_unavailable｜未完成职责：<职责>'
const FALLBACK_HANDOFF = '此事移交◯◯：<移交物>'
const FALLBACK_RECEIPT_NAME = /^([^`｜|]{1,12}?)卡[｜|]读取[：:]/u
const CARD_REFERENCE = /^\s*(.*?)\s*`(amphoreus-[a-z0-9]+(?:-[a-z0-9]+)*)`\s*$/u
const PIPELINE_LINE = /^([^：:]+?)[：:]\s*(.+?)\s*$/u
const DESCRIPTION_ALIASES = /(?<skill>amphoreus-[a-z0-9-]+)(?<aliases>(?:／[^；;，,。\s]+)+)/gu
const DUTY_DESCRIPTION = /路由分派(.+?)[，,]或显式点名/u
const CHINESE_ORDINAL = /编号([一二三四五六七八九十]+)/u

export interface SuiteTextFile {
  readonly path: string
  readonly content: string
}

export interface SuiteCardFiles {
  readonly dir: string
  readonly skill?: SuiteTextFile
  readonly persona?: SuiteTextFile
}

/** Fully in-memory input. The filesystem reader is deliberately outside the parser. */
export interface SuiteFiles {
  readonly root?: ResolvedRoot
  readonly roots?: readonly ResolvedRoot[]
  readonly router?: SuiteTextFile
  readonly common?: SuiteTextFile
  readonly relations?: SuiteTextFile
  readonly cards: readonly SuiteCardFiles[]
  readonly diagnostics?: readonly Diagnostic[]
}

export interface ParseSuiteConfig {
  readonly sectionAliases?: Readonly<Record<string, readonly string[]>>
  readonly parsedAt?: number
  readonly generation?: number
}

type TemplateKind = 'receipt' | 'absence' | 'handoff'

interface ParsedMarkdown {
  readonly path: string
  readonly text: string
  readonly body: string
  readonly bodyStartLine: number
  readonly sha256: string
  readonly frontmatter: Frontmatter
  readonly sections: readonly MdSection[]
}

interface CardDraft {
  readonly name: CardName
  readonly dir: string
  readonly path: string
  readonly sha256: string
  readonly frontmatter: Frontmatter
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly primaryReceiptName: string | undefined
  readonly faces: string[]
  readonly displayName: string
  readonly aliases: string[]
  readonly ordinal: number | undefined
  readonly receipts: ReceiptTemplate[]
  readonly sections: readonly MdSection[]
  readonly body: string
  readonly hasPersona: boolean
  readonly status: 'ok' | 'name-mismatch'
  duties: string[]
}

interface UnresolvedPipeline {
  readonly name: string
  readonly stations: readonly string[]
  readonly source: 'common' | 'router'
  readonly raw: string
  readonly line: number
}

interface CommonParse {
  readonly contracts: ContractFormats
  readonly pipelines: readonly UnresolvedPipeline[]
}

interface RouterParse {
  readonly card: RouterCard
  readonly dispatch: readonly DispatchRow[]
  readonly pipelines: readonly UnresolvedPipeline[]
}

class Diagnostics {
  readonly values: Diagnostic[]
  readonly #seen = new Set<string>()

  constructor(initial: readonly Diagnostic[] = []) {
    this.values = []
    for (const diagnostic of initial) this.push(diagnostic)
  }

  push(diagnostic: Diagnostic): void {
    const key = [diagnostic.code, diagnostic.severity, diagnostic.path ?? '', diagnostic.line ?? '', diagnostic.skill ?? '', diagnostic.detail].join('\u0000')
    if (this.#seen.has(key)) return
    this.#seen.add(key)
    this.values.push(diagnostic)
  }
}

/**
 * Parse one already-read suite. No filesystem access, writes, clock reads or
 * retained snapshot are used; malformed inputs become diagnostics and a
 * degraded snapshot instead of escaping as exceptions.
 */
export function parseSuite(files: SuiteFiles, config: ParseSuiteConfig = {}): SuiteSnapshot {
  const parsedAt = config.parsedAt ?? 0
  const generation = config.generation ?? 0
  const diagnostics = new Diagnostics(files.diagnostics)
  try {
    return parseSuiteInner(files, config, parsedAt, generation, diagnostics)
  } catch (error) {
    diagnostics.push({
      code: 'parse-exception',
      severity: 'error',
      detail: error instanceof Error ? error.message : String(error),
    })
    return makeSnapshot({
      files,
      parsedAt,
      generation,
      diagnostics: diagnostics.values,
      level: 'L3',
      cards: new Map(),
      invalidCards: [],
      nameIndex: new Map(),
      dispatch: [],
      pipelines: [],
    })
  }
}

function parseSuiteInner(
  files: SuiteFiles,
  config: ParseSuiteConfig,
  parsedAt: number,
  generation: number,
  diagnostics: Diagnostics,
): SuiteSnapshot {
  if (files.root === undefined) {
    diagnostics.push({ code: 'root-missing', severity: 'error', detail: '没有可解析的技能主根' })
    return makeSnapshot({
      files,
      parsedAt,
      generation,
      diagnostics: diagnostics.values,
      level: 'L3',
      cards: new Map(),
      invalidCards: [],
      nameIndex: new Map(),
      dispatch: [],
      pipelines: [],
    })
  }

  const aliases = config.sectionAliases ?? {}
  const routerDocument = files.router === undefined
    ? undefined
    : parseMarkdown(files.router, 'router', diagnostics)
  const routerValid = routerDocument !== undefined && routerDocument.frontmatter.name === ROUTER_NAME
  if (routerDocument !== undefined && !routerValid) {
    diagnostics.push({
      code: 'router-frontmatter-invalid',
      severity: 'warn',
      path: routerDocument.path,
      detail: `路由卡 frontmatter name ${JSON.stringify(routerDocument.frontmatter.name)} 不是 ${JSON.stringify(ROUTER_NAME)}`,
    })
  }
  if (files.router === undefined) {
    diagnostics.push({
      code: 'router-missing',
      severity: 'warn',
      path: `${files.root.canonical}/amphoreus/SKILL.md`,
      detail: '主根缺少路由卡 amphoreus/SKILL.md',
    })
  }

  const common = files.common === undefined
    ? undefined
    : parseCommon(files.common, aliases, routerDocument, diagnostics)
  if (files.common === undefined) {
    diagnostics.push({
      code: 'common-missing',
      severity: 'error',
      path: `${files.root.canonical}/amphoreus/references/common.md`,
      detail: '套件合同 common.md 缺失',
    })
  }

  const invalidCards: InvalidCard[] = []
  const drafts: CardDraft[] = []
  for (const cardFiles of files.cards) {
    const draft = parseCardDraft(cardFiles, common?.contracts, aliases, diagnostics, invalidCards)
    if (draft !== undefined) drafts.push(draft)
  }

  const draftByName = new Map<CardName, CardDraft>()
  for (const draft of drafts) {
    const previous = draftByName.get(draft.name)
    if (previous !== undefined) {
      diagnostics.push({
        code: 'alias-conflict',
        severity: 'warn',
        path: draft.path,
        skill: draft.name,
        detail: `技能名 ${draft.name} 同时来自目录 ${previous.dir} 与 ${draft.dir}，保留先读到的卡`,
      })
      continue
    }
    draftByName.set(draft.name, draft)
  }

  const routerBase = routerValid && routerDocument !== undefined
    ? parseRouterBase(routerDocument, aliases, draftByName, diagnostics)
    : undefined

  const dispatch = routerBase?.dispatch ?? []
  addDispatchAliases(draftByName, dispatch)
  for (const draft of draftByName.values()) {
    const dutySet = new Set<string>()
    for (const row of dispatch) {
      if (row.skill !== draft.name) continue
      for (const duty of row.needs) dutySet.add(duty)
    }
    if (dutySet.size === 0) {
      for (const duty of dutiesFromDescription(draft.frontmatter.description)) dutySet.add(duty)
    }
    draft.duties = [...dutySet]
  }

  const nameIndex = buildNameIndex(draftByName.values(), diagnostics)
  const commonPipelines = resolvePipelines(common?.pipelines ?? [], nameIndex, diagnostics)
  const routerPipelines = resolvePipelines(routerBase?.pipelines ?? [], nameIndex, diagnostics)
  const pipelines = choosePipelines(commonPipelines, routerPipelines, diagnostics)

  const cards = new Map<CardName, CardEntry>()
  for (const draft of draftByName.values()) {
    const handoffs = parseCardHandoffs(draft, common?.contracts, aliases, nameIndex, diagnostics)
    const entry: CardEntry = {
      name: draft.name,
      dir: draft.dir,
      path: draft.path,
      sha256: draft.sha256,
      frontmatter: draft.frontmatter,
      modelInvocable: draft.modelInvocable,
      userInvocable: draft.userInvocable,
      faces: draft.faces,
      displayName: draft.displayName,
      aliases: draft.aliases,
      duties: draft.duties,
      receipts: draft.receipts,
      handoffs,
      sections: draft.sections.map(section => section.title),
      body: draft.body,
      hasPersona: draft.hasPersona,
      status: draft.status,
      ...(draft.primaryReceiptName === undefined ? {} : { primaryReceiptName: draft.primaryReceiptName }),
      ...(draft.ordinal === undefined ? {} : { ordinal: draft.ordinal }),
    }
    cards.set(entry.name, entry)
  }

  const relations = files.relations === undefined
    ? missingRelations(files, diagnostics)
    : parseRelations(files.relations, aliases, nameIndex, diagnostics)

  const router = routerBase === undefined
    ? undefined
    : {
        ...routerBase.card,
        pipelinesEcho: routerPipelines,
      }

  const level = chooseLevel({
    hasRoot: true,
    routerValid,
    commonPresent: common !== undefined,
    contracts: common?.contracts,
    cards,
    invalidCards,
    dispatchPresent: dispatch.length > 0,
  })

  return makeSnapshot({
    files,
    parsedAt,
    generation,
    diagnostics: diagnostics.values,
    level,
    cards,
    invalidCards,
    nameIndex,
    dispatch,
    pipelines,
    ...(router === undefined ? {} : { router }),
    ...(common === undefined ? {} : { contracts: common.contracts }),
    ...(relations === undefined ? {} : { relations }),
  })
}

function parseMarkdown(file: SuiteTextFile, kind: 'router' | 'card', diagnostics: Diagnostics): ParsedMarkdown | undefined {
  const text = normalizeContent(file.content)
  const split = splitFrontmatterSafe(text)
  if (split.kind !== 'ok') {
    diagnostics.push({
      code: kind === 'router' ? 'router-frontmatter-invalid' : split.kind === 'legacy-key' ? 'card-legacy-key' : 'card-frontmatter-invalid',
      severity: kind === 'router' ? 'warn' : 'error',
      path: file.path,
      detail: split.detail,
    })
    return undefined
  }
  return {
    path: file.path,
    text,
    body: split.body.trim(),
    bodyStartLine: split.bodyStartLine,
    sha256: sha256(text),
    frontmatter: split.frontmatter,
    sections: sectionize(split.body, split.bodyStartLine),
  }
}

type SafeFrontmatter =
  | { readonly kind: 'ok'; readonly frontmatter: Frontmatter; readonly body: string; readonly bodyStartLine: number }
  | { readonly kind: 'invalid' | 'legacy-key'; readonly detail: string }

function splitFrontmatterSafe(text: string): SafeFrontmatter {
  const split = splitFrontmatter(text)
  if (split.kind === 'none') return { kind: 'invalid', detail: 'missing YAML frontmatter' }
  if (split.kind === 'yaml-error') return { kind: 'invalid', detail: split.message }
  const fields = parseFrontmatterFields(split.data)
  if (fields.kind === 'legacy-key') return { kind: 'legacy-key', detail: fields.detail }
  if (fields.kind !== 'ok') return { kind: 'invalid', detail: fields.detail }
  return { kind: 'ok', frontmatter: fields.frontmatter, body: split.body, bodyStartLine: split.bodyStartLine }
}

function parseCommon(
  file: SuiteTextFile,
  aliases: Readonly<Record<string, readonly string[]>>,
  routerDocument: ParsedMarkdown | undefined,
  diagnostics: Diagnostics,
): CommonParse | undefined {
  const text = normalizeContent(file.content)
  const sections = sectionize(text, 1)
  const depth = findSection(sections, '深度门', aliases, file.path, diagnostics)
  const style = findSection(sections, '风格税', aliases, file.path, diagnostics)
  const transfer = findSection(sections, '移交与流水线', aliases, file.path, diagnostics)
  const receiptSection = findSection(sections, '汇报与回执', aliases, file.path, diagnostics)

  const depthGate = parseDepthGate(depth, file.path, diagnostics)
  const styleResult = parseStyle(style, file.path, diagnostics)
  const absenceFromCommon = findInlineTemplate(depth, code => code.includes('角色未部署') && code.includes('module_unavailable'))
  const absenceFromRouter = routerDocument === undefined
    ? undefined
    : findInlineTemplate(
        findSection(routerDocument.sections, '必读分层', aliases, routerDocument.path, diagnostics),
        code => code.includes('角色未部署') && code.includes('module_unavailable'),
      )
  const absenceTemplate = absenceFromCommon?.template ?? absenceFromRouter?.template ?? FALLBACK_ABSENCE
  const absenceRegex = compileTemplate(absenceTemplate, 'absence')
  const absenceFromFile = absenceFromCommon !== undefined || absenceFromRouter !== undefined
  if (!absenceFromFile || absenceRegex === undefined) {
    diagnostics.push({
      code: 'template-missing',
      severity: 'warn',
      path: file.path,
      detail: '未从套件文件编译出缺席模板，使用显式降级模板',
    })
  }

  const handoffSource = findInlineTemplate(transfer, code => /^.+?◯◯[：:]<[^>]+>$/u.test(code))
  const handoffTemplate = handoffSource?.template ?? FALLBACK_HANDOFF
  const handoffRegex = compileTemplate(handoffTemplate, 'handoff')
  const handoffVerb = handoffVerbOf(handoffTemplate) ?? '此事移交'
  const handoffFromFile = handoffSource !== undefined && handoffRegex !== undefined
  if (!handoffFromFile) {
    diagnostics.push({
      code: 'template-missing',
      severity: 'warn',
      path: file.path,
      detail: '未从“移交与流水线”编译出移交模板，使用超集降级格式',
    })
  }

  const receiptSource = findInlineTemplate(receiptSection, looksLikeReceiptTemplate)
  const receipt = receiptSource === undefined ? undefined : parseReceiptFormat(receiptSource.template)
  if (receipt === undefined) {
    diagnostics.push({
      code: receiptSource === undefined ? 'receipt-template-missing' : 'receipt-template-drift',
      severity: 'warn',
      path: file.path,
      detail: receiptSource === undefined ? '“汇报与回执”未找到回执模板' : '回执模板形状无法编译',
      ...(receiptSource === undefined ? {} : { line: receiptSource.line }),
    })
  }

  return {
    contracts: {
      ...(receipt === undefined ? {} : { receipt }),
      absence: { template: absenceTemplate, regex: absenceRegex, fromFile: absenceFromFile && absenceRegex !== undefined },
      handoff: { template: handoffTemplate, verb: handoffVerb, regex: handoffRegex, fromFile: handoffFromFile },
      firewallWords: styleResult.firewallWords,
      depthGate,
      tiers: receipt?.tiers ?? styleResult.tiers,
      sections: sections.map(section => section.title),
      sha256: sha256(text),
    },
    pipelines: parsePipelineSection(transfer, 'common'),
  }
}

function parseRouterBase(
  document: ParsedMarkdown,
  aliases: Readonly<Record<string, readonly string[]>>,
  cards: ReadonlyMap<CardName, CardDraft>,
  diagnostics: Diagnostics,
): RouterParse {
  const dispatchSection = findSection(document.sections, '分派表', aliases, document.path, diagnostics)
  const pipelineSection = findSection(document.sections, '流水线与会诊', aliases, document.path, diagnostics)
  const requiredSection = findSection(document.sections, '必读分层', aliases, document.path, diagnostics)
  const dispatch = parseDispatch(dispatchSection, document.path, cards, diagnostics)
  const dispatchNotes = dispatchSection === undefined ? '' : tableRemainder(dispatchSection)
  if (requiredSection !== undefined) {
    for (const line of requiredSection.lines) {
      for (const link of line.matchAll(/\((references\/[^)]+)\)/gu)) {
        if (link[1] !== 'references/common.md' && link[1] !== 'references/relations.md') {
          diagnostics.push({
            code: 'reference-path-mismatch',
            severity: 'info',
            path: document.path,
            detail: `路由卡引用了未配置的参考路径 ${link[1]}`,
          })
        }
      }
    }
  }
  return {
    card: {
      path: document.path,
      sha256: document.sha256,
      frontmatter: document.frontmatter,
      sections: document.sections.map(section => section.title),
      dispatchNotes,
      pipelinesEcho: [],
    },
    dispatch,
    pipelines: parsePipelineSection(pipelineSection, 'router'),
  }
}

function parseCardDraft(
  files: SuiteCardFiles,
  contracts: ContractFormats | undefined,
  aliases: Readonly<Record<string, readonly string[]>>,
  diagnostics: Diagnostics,
  invalidCards: InvalidCard[],
): CardDraft | undefined {
  const path = files.skill?.path ?? `${files.dir}/SKILL.md`
  if (files.skill === undefined) {
    const detail = '角色卡目录缺少 SKILL.md'
    invalidCards.push({ dir: files.dir, path, reason: 'card-frontmatter-invalid', detail })
    diagnostics.push({ code: 'card-frontmatter-invalid', severity: 'error', path, detail })
    return undefined
  }
  const document = parseMarkdown(files.skill, 'card', diagnostics)
  if (document === undefined) {
    const text = normalizeContent(files.skill.content)
    const split = splitFrontmatter(text)
    let reason: DiagnosticCode = 'card-frontmatter-invalid'
    let frontmatterName: string | undefined
    if (split.kind === 'ok') {
      const fields = parseFrontmatterFields(split.data)
      if (fields.kind === 'legacy-key') reason = 'card-legacy-key'
      if (typeof split.data.name === 'string') frontmatterName = split.data.name
    }
    const detail = diagnostics.values.at(-1)?.detail ?? '角色卡 frontmatter 无效'
    invalidCards.push({
      dir: files.dir,
      path,
      reason,
      detail,
      ...(frontmatterName === undefined ? {} : { frontmatterName }),
    })
    return undefined
  }
  if (!CARD_NAME.test(document.frontmatter.name)) {
    const detail = `frontmatter name ${document.frontmatter.name} 不是 amphoreus 角色卡名`
    invalidCards.push({ dir: files.dir, path, reason: 'card-not-amphoreus', detail, frontmatterName: document.frontmatter.name })
    diagnostics.push({ code: 'card-not-amphoreus', severity: 'warn', path, skill: document.frontmatter.name, detail })
    return undefined
  }

  const status = document.frontmatter.name === files.dir ? 'ok' : 'name-mismatch'
  if (status === 'name-mismatch') {
    diagnostics.push({
      code: 'card-name-mismatch',
      severity: 'warn',
      path,
      skill: document.frontmatter.name,
      detail: `目录名 ${files.dir} 与 frontmatter name ${document.frontmatter.name} 不一致，以 name 为绑定键`,
    })
  }
  const output = findSection(document.sections, '输出模板', aliases, path, diagnostics, false)
  const receipts = parseCardReceipts(document, output, contracts?.receipt)
  if (receipts.length === 0) {
    diagnostics.push({
      code: 'receipt-template-missing',
      severity: 'info',
      path,
      skill: document.frontmatter.name,
      detail: '角色卡未解析到回执行，显示名将使用别名或技能名',
    })
  }
  const primaryReceiptName = receipts[0]?.faceName
  const faces = unique(receipts.slice(1).map(receipt => receipt.faceName).filter(name => name !== primaryReceiptName))
  const descriptionAliases = parseDescriptionAliases(document.frontmatter.description, document.frontmatter.name)
  const cardAliases = unique([...descriptionAliases, ...(primaryReceiptName === undefined ? [] : [primaryReceiptName]), ...faces])
  const displayName = primaryReceiptName ?? descriptionAliases[0] ?? document.frontmatter.name.replace(/^amphoreus-/, '')
  const identity = findSection(document.sections, '身份与职能', aliases, path, diagnostics, false)
  const ordinal = parseOrdinal(identity)
  if (document.frontmatter.disableModelInvocation !== true) {
    diagnostics.push({
      code: 'invocation-policy-relaxed',
      severity: 'warn',
      path,
      skill: document.frontmatter.name,
      detail: '此卡允许模型自动调用，与套件显式点名纪律可能不一致',
    })
  }
  return {
    name: document.frontmatter.name,
    dir: files.dir,
    path,
    sha256: document.sha256,
    frontmatter: document.frontmatter,
    modelInvocable: document.frontmatter.disableModelInvocation !== true,
    userInvocable: document.frontmatter.userInvocable !== false,
    primaryReceiptName,
    faces,
    displayName,
    aliases: cardAliases,
    ordinal,
    receipts,
    sections: document.sections,
    body: document.body,
    hasPersona: files.persona !== undefined,
    status,
    duties: [],
  }
}

function parseCardReceipts(document: ParsedMarkdown, output: MdSection | undefined, format: ReceiptFormat | undefined): ReceiptTemplate[] {
  const lines = output?.lines ?? document.body.split('\n')
  const firstLine = output === undefined ? document.bodyStartLine : output.startLine + 1
  const matcher = receiptNameMatcher(format)
  const receipts: ReceiptTemplate[] = []
  const seen = new Set<string>()
  for (let index = 0; index < lines.length; index++) {
    for (const code of inlineCodes(lines[index]!)) {
      const match = matcher.exec(code)
      matcher.lastIndex = 0
      if (match === null) continue
      const raw = match[1]!
      const faceName = raw.replace(/[^\p{L}\p{N}•]/gu, '')
      if (faceName === '' || seen.has(faceName)) continue
      seen.add(faceName)
      receipts.push({ faceName, faceNameRaw: raw, line: firstLine + index })
    }
  }
  return receipts
}

function receiptNameMatcher(format: ReceiptFormat | undefined): RegExp {
  if (format === undefined) return new RegExp(FALLBACK_RECEIPT_NAME.source, 'u')
  const separator = escapeClass(format.separator)
  const suffix = escapeRegExp(format.cardSuffix)
  const reads = escapeRegExp(format.readsLabel)
  return new RegExp(`^([^\`${separator}|]{1,12}?)${suffix}(?:${escapeRegExp(format.separator)}|\\|)${reads}[：:]`, 'u')
}

function parseDescriptionAliases(description: string, skill: string): string[] {
  const aliases: string[] = []
  for (const match of description.matchAll(DESCRIPTION_ALIASES)) {
    if (match.groups?.skill !== skill) continue
    const packed = match.groups?.aliases
    if (packed !== undefined) aliases.push(...packed.split('／').map(value => value.trim()).filter(Boolean))
  }
  return unique(aliases)
}

function dutiesFromDescription(description: string): string[] {
  const match = DUTY_DESCRIPTION.exec(description)
  if (match === null) return []
  return unique(match[1]!.split('、').map(value => value.trim()).filter(Boolean))
}

function parseOrdinal(section: MdSection | undefined): number | undefined {
  if (section === undefined) return undefined
  for (const line of section.lines) {
    const match = CHINESE_ORDINAL.exec(normalizeLine(line))
    if (match !== null) return chineseInteger(match[1]!)
  }
  return undefined
}

function chineseInteger(text: string): number | undefined {
  const digits: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (text === '十') return 10
  const ten = text.indexOf('十')
  if (ten >= 0) {
    const tens = ten === 0 ? 1 : digits[text.slice(0, ten)]
    const units = ten === text.length - 1 ? 0 : digits[text.slice(ten + 1)]
    return tens === undefined || units === undefined ? undefined : tens * 10 + units
  }
  return digits[text]
}

function parseDispatch(
  section: MdSection | undefined,
  path: string,
  cards: ReadonlyMap<CardName, CardDraft>,
  diagnostics: Diagnostics,
): DispatchRow[] {
  if (section === undefined) return []
  const table = parseTable(section.lines, section.startLine + 1)
  if (table === undefined) {
    diagnostics.push({ code: 'table-row-unparsed', severity: 'warn', path, line: section.startLine, detail: '分派表小节没有可解析的 Markdown 表格' })
    return []
  }
  for (const dropped of table.dropped) {
    diagnostics.push({ code: 'table-row-unparsed', severity: 'warn', path, line: dropped.line, detail: `分派表列数不符：${dropped.raw}` })
  }
  const rows: DispatchRow[] = []
  for (const row of table.rows) {
    if (row.cells.length < 2) continue
    const match = CARD_REFERENCE.exec(row.cells[1]!)
    if (match === null) {
      diagnostics.push({ code: 'table-row-unparsed', severity: 'warn', path, line: row.line, detail: `分派目标无法解析：${row.cells[1]}` })
      continue
    }
    const skill = match[2]!
    const draft = cards.get(skill)
    const roleText = match[1]!.trim()
    const face = draft?.faces.find(value => roleText.includes(value))
    rows.push({
      needs: unique(row.cells[0]!.split('、').map(value => value.trim()).filter(Boolean)),
      roleText,
      skill,
      line: row.line,
      ...(face === undefined ? {} : { face }),
    })
  }
  return rows
}

function tableRemainder(section: MdSection): string {
  const lines = section.lines
  let tableStart = -1
  let end = -1
  for (let index = 0; index + 1 < lines.length; index++) {
    if (!lines[index]!.trim().startsWith('|') || !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1]!.trim())) continue
    tableStart = index
    end = index + 2
    while (end < lines.length && lines[end]!.trim().startsWith('|')) end++
    break
  }
  if (tableStart < 0) return lines.join('\n').trim()
  return lines.slice(end).join('\n').trim()
}

function addDispatchAliases(cards: ReadonlyMap<CardName, CardDraft>, dispatch: readonly DispatchRow[]): void {
  for (const row of dispatch) {
    const card = cards.get(row.skill)
    if (card === undefined) continue
    for (const part of row.roleText.split('／')) {
      const alias = part.trim().replace(/特勤$/u, '').trim()
      if (alias !== '' && !card.aliases.includes(alias)) card.aliases.push(alias)
    }
  }
}

function buildNameIndex(cards: Iterable<CardDraft>, diagnostics: Diagnostics): ReadonlyMap<string, AliasTarget> {
  const claims = new Map<string, Map<CardName, AliasTarget>>()
  for (const card of cards) {
    const names = unique([card.displayName, ...card.faces, ...card.aliases])
    for (const name of names) {
      if (name === '') continue
      const bySkill = claims.get(name) ?? new Map<CardName, AliasTarget>()
      const target: AliasTarget = card.faces.includes(name) ? { skill: card.name, face: name } : { skill: card.name }
      const old = bySkill.get(card.name)
      if (old === undefined || (old.face === undefined && target.face !== undefined)) bySkill.set(card.name, target)
      claims.set(name, bySkill)
    }
  }
  const index = new Map<string, AliasTarget>()
  for (const [name, bySkill] of claims) {
    if (bySkill.size === 1) {
      index.set(name, bySkill.values().next().value as AliasTarget)
      continue
    }
    diagnostics.push({
      code: 'alias-conflict',
      severity: 'warn',
      detail: `名字 ${JSON.stringify(name)} 同时指向 ${[...bySkill.keys()].join('、')}，已从索引移除`,
    })
  }
  return index
}

function parsePipelineSection(section: MdSection | undefined, source: 'common' | 'router'): UnresolvedPipeline[] {
  if (section === undefined) return []
  const pipelines: UnresolvedPipeline[] = []
  for (let index = 0; index < section.lines.length; index++) {
    const raw = normalizeLine(section.lines[index]!)
    const match = PIPELINE_LINE.exec(raw)
    if (match === null) continue
    const chain = match[2]!.replace(/[。.]+\s*$/u, '')
    const stations = chain.split(/\s*→\s*/u).map(value => value.trim()).filter(Boolean)
    if (stations.length < 2) continue
    pipelines.push({ name: match[1]!.trim(), stations, source, raw, line: section.startLine + 1 + index })
  }
  return pipelines
}

function resolvePipelines(
  pipelines: readonly UnresolvedPipeline[],
  index: ReadonlyMap<string, AliasTarget>,
  diagnostics: Diagnostics,
): Pipeline[] {
  return pipelines.map(pipeline => ({
    name: pipeline.name,
    stations: pipeline.stations.map(text => {
      const target = index.get(text)
      if (target === undefined) {
        diagnostics.push({
          code: 'pipeline-station-unresolved',
          severity: 'warn',
          line: pipeline.line,
          detail: `${pipeline.name} 的站位 ${JSON.stringify(text)} 无法解析`,
        })
      }
      return { text, to: target }
    }),
    source: pipeline.source,
    raw: pipeline.raw,
    line: pipeline.line,
  }))
}

function choosePipelines(common: readonly Pipeline[], router: readonly Pipeline[], diagnostics: Diagnostics): readonly Pipeline[] {
  if (common.length === 0) {
    if (router.length > 0) {
      diagnostics.push({ code: 'pipeline-from-router', severity: 'warn', detail: 'common.md 无流水线，采用路由卡校验副本' })
    }
    return router
  }
  if (router.length > 0 && pipelineSignature(common) !== pipelineSignature(router)) {
    diagnostics.push({ code: 'pipeline-from-router', severity: 'warn', detail: '路由卡流水线与 common.md 不一致，以 common.md 为准' })
  }
  return common
}

function pipelineSignature(pipelines: readonly Pipeline[]): string {
  return JSON.stringify(pipelines.map(pipeline => [pipeline.name, pipeline.stations.map(station => station.text)]))
}

function parseCardHandoffs(
  card: CardDraft,
  contracts: ContractFormats | undefined,
  aliases: Readonly<Record<string, readonly string[]>>,
  index: ReadonlyMap<string, AliasTarget>,
  diagnostics: Diagnostics,
): HandoffEdge[] {
  const section = findSection(card.sections, '协作与移交', aliases, card.path, diagnostics, true, card.name)
  if (section === undefined) return []
  const verb = contracts?.handoff.verb ?? '此事移交'
  const matcher = new RegExp(`^(?<verb>${escapeRegExp(verb)}|此事知会)(?<target>[^：:\\x60]{1,12}?)[：:]<(?<payload>[^>\\x60]*)>$`, 'u')
  const edges: HandoffEdge[] = []
  for (let lineIndex = 0; lineIndex < section.lines.length; lineIndex++) {
    for (const code of inlineCodes(section.lines[lineIndex]!)) {
      if (code.includes('module_unavailable')) continue
      const match = matcher.exec(code)
      if (match?.groups === undefined) continue
      const targetText = match.groups.target!.trim()
      if (targetText === '◯◯') continue
      const target = index.get(targetText)
      if (target === undefined) {
        diagnostics.push({
          code: 'alias-unresolved',
          severity: 'warn',
          path: card.path,
          line: section.startLine + 1 + lineIndex,
          skill: card.name,
          detail: `移交目标 ${JSON.stringify(targetText)} 无法解析`,
        })
      }
      const matchedVerb = match.groups.verb!
      edges.push({
        from: card.name,
        kind: matchedVerb === verb ? 'handoff' : 'notify',
        verb: matchedVerb,
        targetText,
        to: target,
        payloadHint: match.groups.payload!,
        raw: code,
        line: section.startLine + 1 + lineIndex,
      })
    }
  }
  return edges
}

function parseRelations(
  file: SuiteTextFile,
  aliases: Readonly<Record<string, readonly string[]>>,
  index: ReadonlyMap<string, AliasTarget>,
  diagnostics: Diagnostics,
): RelationsSummary {
  const text = normalizeContent(file.content)
  const sections = sectionize(text, 1)
  const salon = findSection(sections, '沙龙参数', aliases, file.path, diagnostics, false)
  const interests = findSection(sections, '兴趣边', aliases, file.path, diagnostics, false)
  const forbidden = findSection(sections, '同场禁区与搭桥', aliases, file.path, diagnostics, false)
  const salonParams: Record<string, string> = {}
  const salonTable = salon === undefined ? undefined : parseTable(salon.lines, salon.startLine + 1)
  for (const row of salonTable?.rows ?? []) {
    if (row.cells.length >= 2) salonParams[row.cells[0]!] = row.cells[1]!
  }
  const interestEdges: RelationsSummary['interestEdges'][number][] = []
  const interestTable = interests === undefined ? undefined : parseTable(interests.lines, interests.startLine + 1)
  for (const row of interestTable?.rows ?? []) {
    if (row.cells.length < 3) continue
    const hero = row.cells[0]!
    const target = index.get(hero)
    interestEdges.push({ hero, edge: row.cells[1]!, evidence: row.cells[2]!, ...(target === undefined ? {} : { heroSkill: target.skill }) })
  }
  const forbiddenPairs: string[] = []
  const forbiddenTable = forbidden === undefined ? undefined : parseTable(forbidden.lines, forbidden.startLine + 1)
  for (const row of forbiddenTable?.rows ?? []) {
    if (row.cells[0] !== undefined && row.cells[0] !== '') forbiddenPairs.push(row.cells[0])
  }
  return {
    present: true,
    sha256: sha256(text),
    sections: sections.map(section => section.title),
    salonParams,
    interestEdges,
    forbiddenPairs: unique(forbiddenPairs),
  }
}

function missingRelations(files: SuiteFiles, diagnostics: Diagnostics): undefined {
  diagnostics.push({
    code: 'relations-missing',
    severity: 'info',
    detail: 'relations.md 缺失；关系提示不可用',
    ...(files.root === undefined ? {} : { path: `${files.root.canonical}/amphoreus/references/relations.md` }),
  })
  return undefined
}

function parseDepthGate(section: MdSection | undefined, path: string, diagnostics: Diagnostics): ContractFormats['depthGate'] {
  if (section === undefined) return []
  const table = parseTable(section.lines, section.startLine + 1)
  if (table === undefined) return []
  for (const dropped of table.dropped) diagnostics.push({ code: 'table-row-unparsed', severity: 'warn', path, line: dropped.line, detail: `深度门表格坏行：${dropped.raw}` })
  return table.rows
    .filter(row => row.cells.length >= 3 && (/^L\d+$/u.test(row.cells[0]!) || /场$/u.test(row.cells[0]!)))
    .map(row => ({ depth: row.cells[0]!, entry: row.cells[1]!, mode: row.cells[2]! }))
}

function parseStyle(
  section: MdSection | undefined,
  path: string,
  diagnostics: Diagnostics,
): { readonly tiers: readonly string[]; readonly firewallWords: readonly string[] } {
  if (section === undefined) return { tiers: [], firewallWords: [] }
  const table = parseTable(section.lines, section.startLine + 1)
  for (const dropped of table?.dropped ?? []) diagnostics.push({ code: 'table-row-unparsed', severity: 'warn', path, line: dropped.line, detail: `风格税表格坏行：${dropped.raw}` })
  const tiers = unique((table?.rows ?? []).map(row => row.cells[0]!).filter(Boolean))
  let firewallWords: string[] = []
  for (const line of section.lines) {
    if (!line.includes('防火墙')) continue
    const colon = line.lastIndexOf('：')
    if (colon < 0) continue
    const list = line.slice(colon + 1).replace(/[。.]\s*$/u, '')
    firewallWords = unique(list.split('、').map(value => value.trim()).filter(Boolean))
    if (firewallWords.length > 0) break
  }
  return { tiers, firewallWords }
}

function findInlineTemplate(
  section: MdSection | undefined,
  predicate: (code: string) => boolean,
): { readonly template: string; readonly line: number } | undefined {
  if (section === undefined) return undefined
  for (let index = 0; index < section.lines.length; index++) {
    for (const code of inlineCodes(section.lines[index]!)) {
      if (predicate(code)) return { template: code, line: section.startLine + 1 + index }
    }
  }
  return undefined
}

function looksLikeReceiptTemplate(template: string): boolean {
  return template.startsWith('◯◯') && /<[^>]+>/u.test(template) && /[／/]/u.test(template)
}

function parseReceiptFormat(template: string): ReceiptFormat | undefined {
  const match = /^◯◯(.{1,2})(.)([^：:]{1,8})([：:])<[^>]+>\2([^：:]{1,8})([：:])(.+)$/u.exec(template)
  if (match === null) return undefined
  const [, cardSuffix, separator, readsLabel, readsColon, tierLabel, tierColon, tierText] = match
  if (cardSuffix === undefined || separator === undefined || readsLabel === undefined || readsColon === undefined || tierLabel === undefined || tierColon === undefined || tierText === undefined) return undefined
  const tiers = unique(tierText.split(/[／/]/u).map(value => value.trim()).filter(Boolean))
  if (tiers.length === 0 || [cardSuffix, separator, readsLabel, tierLabel].some(value => value.length > 8)) return undefined
  const regex = new RegExp(
    `^(?<card>.+?)${escapeRegExp(cardSuffix)}${escapeRegExp(separator)}${escapeRegExp(readsLabel)}${escapeRegExp(readsColon)}(?<read>.*?)${escapeRegExp(separator)}${escapeRegExp(tierLabel)}${escapeRegExp(tierColon)}(?<tier>${tiers.map(escapeRegExp).join('|')})\\s*$`,
    'u',
  )
  const sample = template
    .replace('◯◯', '样例')
    .replace(/<[^>]+>/u, 'common.md')
    .replace(tierText, tiers[0]!)
  if (!regex.test(sample)) return undefined
  return { template, separator, cardSuffix, readsLabel, tierLabel, tiers, regex }
}

/** Compile a runtime contract template without embedding its labels or separator. */
export function compileTemplate(template: string, kind: TemplateKind, tiers: readonly string[] = []): RegExp | undefined {
  if (kind === 'receipt') return parseReceiptFormat(template)?.regex
  const marker = template.indexOf('◯◯')
  const placeholder = /<[^>]+>/u.exec(template)
  if (placeholder === null) return undefined
  if (kind === 'handoff' && marker < 1) return undefined
  let source = ''
  let cursor = 0
  const tokens: { readonly start: number; readonly end: number; readonly source: string }[] = []
  if (marker >= 0) tokens.push({ start: marker, end: marker + 2, source: '(?<target>.+?)' })
  for (const match of template.matchAll(/<[^>]+>/gu)) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      source: kind === 'absence' && match[0].includes('职责') ? '(?<duty>.+)' : '(?<payload>.+)',
    })
  }
  tokens.sort((a, b) => a.start - b.start)
  for (const token of tokens) {
    if (token.start < cursor) continue
    let literal = template.slice(cursor, token.start)
    if (kind === 'handoff') literal = escapeRegExp(literal).replaceAll('：', '[：:]')
    else literal = escapeRegExp(literal)
    source += literal + token.source
    cursor = token.end
  }
  let tail = template.slice(cursor)
  if (kind === 'handoff') tail = escapeRegExp(tail).replaceAll('：', '[：:]')
  else tail = escapeRegExp(tail)
  source += tail
  if (tiers.length > 0) {
    source = source.replace(escapeRegExp(tiers.join('／')), `(?<tier>${tiers.map(escapeRegExp).join('|')})`)
  }
  let regex: RegExp
  try {
    regex = new RegExp(`^${source}\\s*$`, 'u')
  } catch {
    return undefined
  }
  const sample = template.replace('◯◯', '样例').replace(/<[^>]+>/gu, '内容')
  return regex.test(sample) ? regex : undefined
}

function handoffVerbOf(template: string): string | undefined {
  const marker = template.indexOf('◯◯')
  if (marker < 1 || marker > 8) return undefined
  return template.slice(0, marker)
}

function findSection(
  sections: readonly MdSection[],
  canonical: string,
  aliases: Readonly<Record<string, readonly string[]>>,
  path: string,
  diagnostics: Diagnostics,
  required = true,
  skill?: CardName,
): MdSection | undefined {
  const h2 = sections.filter(section => section.level === 2)
  const exact = h2.filter(section => section.title === canonical)
  const configured = aliases[canonical] ?? []
  const aliasMatches = exact.length > 0 ? [] : h2.filter(section => configured.includes(section.title))
  const looseCanonical = looseTitle(canonical)
  const loose = exact.length > 0 || aliasMatches.length > 0
    ? []
    : h2.filter(section => looseTitle(section.title) === looseCanonical)
  const matches = exact.length > 0 ? exact : aliasMatches.length > 0 ? aliasMatches : loose
  if (matches.length === 0) {
    if (required) diagnostics.push({ code: 'section-missing', severity: 'warn', path, detail: `缺少小节 ${canonical}`, ...(skill === undefined ? {} : { skill }) })
    return undefined
  }
  if (matches.length > 1) {
    diagnostics.push({ code: 'section-duplicate', severity: 'warn', path, line: matches.at(-1)!.startLine, detail: `小节 ${canonical} 重复，采用最后一节`, ...(skill === undefined ? {} : { skill }) })
  }
  const selected = matches.at(-1)!
  if (selected.title !== canonical) {
    diagnostics.push({ code: 'section-alias-hit', severity: 'info', path, line: selected.startLine, detail: `小节 ${canonical} 由标题 ${selected.title} 匹配`, ...(skill === undefined ? {} : { skill }) })
  }
  return selected
}

function looseTitle(title: string): string {
  return title.replace(/\s+/gu, '').replace(/[（(][^）)]*[）)]/gu, '')
}

function chooseLevel(input: {
  readonly hasRoot: boolean
  readonly routerValid: boolean
  readonly commonPresent: boolean
  readonly contracts: ContractFormats | undefined
  readonly cards: ReadonlyMap<CardName, CardEntry>
  readonly invalidCards: readonly InvalidCard[]
  readonly dispatchPresent: boolean
}): SuiteLevel {
  if (!input.hasRoot) return 'L3'
  if (!input.commonPresent) return 'L2'
  if (
    input.routerValid
    && input.cards.size > 0
    && input.invalidCards.length === 0
    && input.dispatchPresent
    && input.contracts?.receipt !== undefined
    && input.contracts.absence.fromFile
    && input.contracts.handoff.fromFile
  ) return 'L0'
  return 'L1'
}

function featuresFor(level: SuiteLevel, input: {
  readonly hasProviderEntries: boolean
  readonly hasDispatch: boolean
  readonly hasPipelines: boolean
  readonly hasHandoffRegex: boolean
  readonly hasReceipt: boolean
  readonly hasRelations: boolean
}): FeatureSwitches {
  if (level === 'L3') {
    return { provider: false, autoInject: false, seatSync: false, dispatchHints: false, pipelines: false, handoffButtons: false, receiptDetection: false, salonHints: false }
  }
  if (level === 'L2') {
    return {
      provider: input.hasProviderEntries,
      autoInject: input.hasProviderEntries,
      seatSync: true,
      dispatchHints: input.hasDispatch,
      pipelines: false,
      handoffButtons: false,
      receiptDetection: false,
      salonHints: false,
    }
  }
  return {
    provider: input.hasProviderEntries,
    autoInject: input.hasProviderEntries,
    seatSync: true,
    dispatchHints: input.hasDispatch,
    pipelines: input.hasPipelines,
    handoffButtons: input.hasHandoffRegex,
    receiptDetection: input.hasReceipt,
    salonHints: input.hasRelations,
  }
}

function makeSnapshot(input: {
  readonly files: SuiteFiles
  readonly parsedAt: number
  readonly generation: number
  readonly diagnostics: readonly Diagnostic[]
  readonly level: SuiteLevel
  readonly cards: ReadonlyMap<CardName, CardEntry>
  readonly invalidCards: readonly InvalidCard[]
  readonly nameIndex: ReadonlyMap<string, AliasTarget>
  readonly dispatch: readonly DispatchRow[]
  readonly pipelines: readonly Pipeline[]
  readonly router?: RouterCard
  readonly contracts?: ContractFormats
  readonly relations?: RelationsSummary
}): SuiteSnapshot {
  const features = featuresFor(input.level, {
    hasProviderEntries: input.router !== undefined || input.cards.size > 0,
    hasDispatch: input.dispatch.length > 0,
    hasPipelines: input.pipelines.length > 0,
    hasHandoffRegex: input.contracts?.handoff.regex !== undefined,
    hasReceipt: input.contracts?.receipt !== undefined,
    hasRelations: input.relations?.present === true,
  })
  return {
    parserVersion: PARSER_VERSION,
    parsedAt: input.parsedAt,
    generation: input.generation,
    roots: input.files.roots ?? (input.files.root === undefined ? [] : [input.files.root]),
    level: input.level,
    features,
    cards: input.cards,
    invalidCards: input.invalidCards,
    nameIndex: input.nameIndex,
    dispatch: input.dispatch,
    pipelines: input.pipelines,
    diagnostics: input.diagnostics,
    ...(input.files.root === undefined ? {} : { root: input.files.root }),
    ...(input.router === undefined ? {} : { router: input.router }),
    ...(input.contracts === undefined ? {} : { contracts: input.contracts }),
    ...(input.relations === undefined ? {} : { relations: input.relations }),
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeClass(value: string): string {
  return value.replace(/[\\\]\-^]/g, '\\$&')
}
