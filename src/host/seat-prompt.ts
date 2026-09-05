import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { dirname, join } from 'node:path'
import type { AmphoreusStores, BindingRecord } from './store.ts'
import type { SuiteSnapshot } from './suite/types.ts'

type PromptAssembly = Awaited<ReturnType<Context['systemPrompt']['assemble']>>

const DEFAULT_PERSONA_OPENER = /^You are a coding (?:agent|assistant) powered by the \{\{model\}\} model(?:, running on the DeepSeek Harness)?\.[ \t]*/

export function seatPromptAssembly(
  assembly: PromptAssembly,
  binding: BindingRecord,
  displayName: string,
  references?: { readonly skill: string; readonly persona: string; readonly common: string },
): PromptAssembly {
  const identity = [
    `本会话已绑定黄金裔席位「${displayName}」（技能 ${binding.skillName}）。用户选择席位即已邀请该角色对话。请从第一条回复起按本席技能卡的身份、口吻与方法直接回应，延续同一角色。用户询问模型或运行环境时如实说明。`,
    ...(references === undefined ? [] : [
      '技能参考资料来自外部技能目录，与当前工作目录是两个位置。执行技能卡要求的读取时，使用以下绝对路径；只有读取这些真实路径失败后才能报告资料缺失：',
      `技能卡：${references.skill}`,
      `persona.md：${references.persona}`,
      `common.md：${references.common}`,
    ]),
    ...(binding.source === 'dispatch' ? [
      '这是工作台为本席建立的独立派发会话。若问题面向全体，工作台会分别收集各席的回复；你只回答自己的部分，不在本会话重新召集或代演其他角色，也不根据本会话只显示你一人而推断其他席位缺席。遵循用户要求的篇幅；简单会议自介直接发言，不展开另一场会议或重复登记在场名单。',
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
    }
    return seatPromptAssembly(assembly, binding, card.displayName, references)
  })
}
