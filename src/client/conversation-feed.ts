import type { AssistantBlock, ChatSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'

export interface FeedProcess {
  callId: string
  name: string
  arguments: string | null
  result: string | null
  error: string | null
}

export interface FeedMessage {
  seq: number
  kind: 'user' | 'assistant' | 'error'
  text: string
  time: number
  turn: number | null
  step: number | null
  anchorKey: string | null
  process?: FeedProcess[]
}

export interface MessagesPayload {
  sessionId: string
  revision: number
  complete: boolean
  messages: FeedMessage[]
}

export const HARD_TEXT_CAP = 32_000

function bounded(text: string): string {
  return text.slice(0, HARD_TEXT_CAP)
}

export function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap((block: {
    type?: string
    text?: unknown
    name?: unknown
    arguments?: unknown
    content?: unknown
  }) => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [block.name, block.arguments]
    if (block?.type === 'tool-result') return [contentText(block.content)]
    return []
  }).filter((value): value is string => typeof value === 'string' && value.trim() !== '').join('\n')
}

function resultText(node: ToolResultNode): string {
  const text = contentText(node.content)
  if (text !== '') return bounded(text)
  if (node.error === undefined) return ''
  return bounded([node.error.name, node.error.code].filter(value => value.trim() !== '').join(': '))
}

function processFor(messages: readonly FeedMessage[], callId: string): FeedProcess | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const process = messages[index]?.process?.find(entry => entry.callId === callId)
    if (process !== undefined) return process
  }
  return undefined
}

export function feedFromChat(
  sessionId: string,
  chat: ChatSnapshot,
  revision: number,
  hasMore: boolean,
): MessagesPayload {
  const anchorBySeq = new Map(chat.nodes.values().map(node => [node.anchorSeq, node.key] as const))
  const messages: FeedMessage[] = []

  for (const node of chat.legacy.nodes) {
    const anchorKey = anchorBySeq.get(node.seq) ?? null
    switch (node.kind) {
      case 'user':
      case 'steering':
        messages.push({
          seq: node.seq,
          kind: 'user',
          text: bounded(contentText(node.content)),
          time: node.time,
          turn: null,
          step: null,
          anchorKey,
        })
        break
      case 'assistant': {
        const blocks: readonly AssistantBlock[] = node.blocks
        const process = blocks.flatMap((block): FeedProcess[] => block.kind === 'tool-call'
          ? [{
              callId: block.callId,
              name: block.name,
              arguments: bounded(block.argsRaw),
              result: null,
              error: null,
            }]
          : [])
        messages.push({
          seq: node.seq,
          kind: 'assistant',
          text: bounded(blocks
            .filter(block => block.kind === 'text')
            .map(block => block.text)
            .join('\n')),
          time: node.time,
          turn: node.turn,
          step: node.step,
          anchorKey,
          ...(process.length === 0 ? {} : { process }),
        })
        break
      }
      case 'tool-result': {
        const process = processFor(messages, node.callId)
        if (process !== undefined) {
          if (node.isError) process.error = resultText(node)
          else process.result = resultText(node)
        }
        break
      }
      case 'turn-error':
        messages.push({
          seq: node.seq,
          kind: 'error',
          text: bounded(node.message),
          time: node.time,
          turn: node.turn,
          step: node.step,
          anchorKey,
        })
        break
      case 'context':
      case 'compaction':
      case 'command':
      case 'model-retry':
      case 'turn-max-tokens':
      case 'unknown':
        break
    }
  }

  return { sessionId, revision, complete: !hasMore, messages }
}

export function liveTextOf(chat: ChatSnapshot | undefined): string {
  return bounded(chat?.legacy.partial?.blocks
    .filter(block => block.kind === 'text')
    .map(block => block.text)
    .join('') ?? '')
}
