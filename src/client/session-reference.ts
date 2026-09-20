import type { SessionReference, SessionRetainOptions } from '@deepseek-ai/dsh-api-session-controller/client'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    amphoreusOperation: unknown
    amphoreusWorkbench: unknown
  }
}

export interface SessionLease<TBinding> extends Pick<SessionReference, 'release'> {
  readonly ready: Promise<TBinding>
}

export async function withSessionReference<TBinding, TResult>(
  sessions: { retain(id: string, options: SessionRetainOptions): SessionLease<TBinding> },
  sessionId: string,
  operation: (binding: TBinding) => TResult | Promise<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  const reference = sessions.retain(sessionId, {
    source: 'amphoreusOperation',
    ...(signal === undefined ? {} : { signal }),
  })
  try {
    const binding = await reference.ready
    signal?.throwIfAborted()
    return await operation(binding)
  } finally {
    reference.release()
  }
}
