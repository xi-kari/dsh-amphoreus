export interface PromptAdmission {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}

export interface PromptTarget {
  prompt(content: { type: 'text'; text: string }[], mode: 'queue'): Promise<PromptAdmission>
}

export interface DeferredPromptOptions {
  readonly sessionId: string
  readonly text: string
  readonly requestedActivation: boolean
  readonly deferredActivations: Set<string>
  readonly currentSession: () => string | undefined
  readonly binding: (sessionId: string) => { readonly session: PromptTarget } | undefined
  readonly reply: () => void
  readonly open: (sessionId: string) => void
}

export async function promptWithDeferredActivation(options: DeferredPromptOptions): Promise<void> {
  const deferred = options.deferredActivations.delete(options.sessionId)
  const needsActivation = options.currentSession() !== options.sessionId
  if ((needsActivation || options.requestedActivation) && !deferred) throw new Error('缺少延迟激活意图')

  const binding = options.binding(options.sessionId)
  if (binding === undefined) throw new Error('会话不可用')
  const result = await binding.session.prompt([{ type: 'text', text: options.text }], 'queue')
  if (!result.ok) throw new Error(result.error?.message ?? '发送失败')

  options.reply()
  if (needsActivation) options.open(options.sessionId)
}
