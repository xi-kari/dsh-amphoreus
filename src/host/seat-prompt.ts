import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { dirname, join } from 'node:path'
import { loadStickerCatalog } from './stickers.ts'
import type { AmphoreusStores, BindingRecord } from './store.ts'
import { SuiteReader } from './suite/reader.ts'
import type { SuiteSnapshot } from './suite/types.ts'

type PromptAssembly = Awaited<ReturnType<Context['systemPrompt']['assemble']>>

const DEFAULT_PERSONA_OPENER = /^You are a coding (?:agent|assistant) powered by the \{\{model\}\} model(?:, running on the DeepSeek Harness)?\.[ \t]*/

export interface SeatStickerReferences {
  readonly index: string
  readonly script: string
  readonly manifest: string
  readonly urlPrefix: string
  readonly keys: readonly string[]
}

export function stickerWebOrigin(server: { readonly host: string; readonly port: number }): string | undefined {
  if (server.host !== '127.0.0.1' || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535) return undefined
  return `http://${server.host}:${server.port}`
}

export async function loadSeatStickerReferences(root: string, origin: string | undefined): Promise<SeatStickerReferences | undefined> {
  if (origin === undefined) return undefined
  try {
    const catalog = await loadStickerCatalog(root)
    if (catalog === undefined || catalog.items.length === 0) return undefined
    const reader = await SuiteReader.create(root)
    const [index, script, manifest] = await Promise.all([
      reader.readTextFile('amphoreus/references/stickers.md'),
      reader.readTextFile('amphoreus/scripts/stickers.py'),
      reader.readTextFile('amphoreus/assets/stickers/manifest.json'),
    ])
    if (index === undefined || script === undefined || manifest === undefined) return undefined
    return {
      index: index.path,
      script: script.path,
      manifest: manifest.path,
      urlPrefix: `${origin}/amphoreus/stickers/`,
      keys: catalog.items.map(item => item.key),
    }
  } catch {
    return undefined
  }
}

export function seatPromptAssembly(
  assembly: PromptAssembly,
  binding: BindingRecord,
  displayName: string,
  references?: { readonly skill: string; readonly persona: string; readonly common: string; readonly relations?: string },
  stickers?: SeatStickerReferences,
): PromptAssembly {
  const identity = [
    `本会话已绑定黄金裔席位「${displayName}」（技能 ${binding.skillName}）。用户选择席位即已邀请该角色对话。请从第一条回复起按本席技能卡的身份、口吻与方法直接回应，延续同一角色。用户询问模型或运行环境时如实说明。`,
    '对话另一方是「开拓者」：需要指称对方时用「开拓者」或本轮实际读取的 persona 登记的本席专属称呼，不猜测专属称呼；不要在台词里出现「用户」「使用者」「User」这类界面词；技术正文与台账不受此限。',
    ...(references === undefined ? [] : [
      '技能参考资料来自外部技能目录，与当前工作目录是两个位置。执行技能卡要求的读取时，使用以下绝对路径；只有读取这些真实路径失败后才能报告资料缺失：',
      `技能卡：${references.skill}`,
      `persona.md：${references.persona}`,
      `common.md：${references.common}`,
      ...(references.relations === undefined ? [] : [`relations.md：${references.relations}（涉及角色互称、关系或圆桌互动时按共享合同读取）`]),
    ]),
    '本宿主是 DeepSeek Harness Web；角色表情的开关、静音、实际发言者、数量与位置均遵循本轮读取的 common.md 和 stickers.md。浏览器不呈现本地绝对路径、file: 或相对路径的 Markdown 图片，不能直接输出选择脚本返回的本地图片 Markdown。',
    ...(stickers === undefined ? [
      '当前未确认可供浏览器呈现的技能表情资源入口；依共享合同省略不可访问的图片，照常完成正文，不输出破图或占位符。',
    ] : [
      `stickers.md：${stickers.index}`,
      `选择脚本：${stickers.script}`,
      `表情 manifest：${stickers.manifest}`,
      '按需读取表情索引，并运行选择脚本时使用 --format json。只采用 status 为 ok 或 fallback、实际发言者相符且 key 在下列已确认可服务清单中的结果；选择失败时按共享合同省略图片，不猜测其他角色或不存在的键。',
      `已确认可服务的表情键：${stickers.keys.join('、')}`,
      `将确认后的 key 编码为 URL 路径段，使用 ![角色·表情](<${stickers.urlPrefix}<key>.webp>) 单独一行输出；此 HTTP 地址属于当前已注册的本地技能资源入口。不得使用脚本返回的本地 path 或 markdown 作为图片地址，也不上传素材或猜测远程图址。`,
    ]),
    ...(binding.source === 'dispatch' ? [
      '这是工作台为本席建立的独立派发会话。若问题面向全体，本入口采用各席独立作答，工作台会分别收集各席的回复；你只回答自己的部分，不在本会话重新召集或代演其他角色，也不根据本会话只显示你一人而推断其他席位缺席。遵循用户要求的篇幅；简单会议自介直接发言，不展开另一场会议或重复登记在场名单。圆桌、陪聊与工作场的输出形式遵循本轮读取的共享合同。',
    ] : []),
  ].join('\n')
  let replaced = false
  const sections = assembly.sections.map(section => {
    if (section.name === 'harness:identity') {
      replaced = true
      return { ...section, text: identity }
    }
    if (section.name === 'deployment:persona') {
      return { ...section, text: section.text.replace(DEFAULT_PERSONA_OPENER, '') }
    }
    return section
  })
  if (!replaced) sections.unshift({ name: 'amphoreus:seat-identity', text: identity })
  return { ...assembly, sections }
}

export function registerSeatPrompt(ctx: Context, options: {
  readonly stores: AmphoreusStores
  readonly current: () => SuiteSnapshot | undefined
  readonly commonPath?: string
  readonly relationsPath?: string
  readonly stickerOrigin?: () => string | undefined
}): () => void {
  return ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const sessionId = context.agent?.session.id
    if (sessionId === undefined) return assembly
    const binding = options.stores.main.table('bindings').get(sessionId)
    if (binding === undefined) return assembly
    const snapshot = options.current()
    const card = snapshot?.cards.get(binding.skillName)
    if (card === undefined || !card.userInvocable) return assembly
    const references = card.path === undefined ? undefined : {
      skill: card.path,
      persona: join(dirname(card.path), 'persona.md'),
      common: join(snapshot?.root?.canonical ?? dirname(dirname(card.path)), options.commonPath ?? 'amphoreus/references/common.md'),
      relations: join(snapshot?.root?.canonical ?? dirname(dirname(card.path)), options.relationsPath ?? 'amphoreus/references/relations.md'),
    }
    const stickers = snapshot?.root === undefined ? undefined
      : await loadSeatStickerReferences(snapshot.root.canonical, options.stickerOrigin?.())
    return seatPromptAssembly(assembly, binding, card.displayName, references, stickers)
  })
}
