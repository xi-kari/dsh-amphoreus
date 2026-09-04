/**
 * One-shot skill-card injection for seat-bound sessions (设计文档 01 §6).
 * When a session bound to a seat starts, inject the seat's skill card exactly
 * the way dsh-tool-skill would for a typed `/name`: same ctx.skills.get
 * lookup, same renderSkillContent body, same skill-invocation source. Dedup
 * against a user-typed gesture rides the binding's injection state plus a
 * same-step message scan. Never injects the router card, never re-injects on
 * resume, honors config.autoInvoke.sources for clear/compact.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the agent/* event declarations into cordis Events.
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: merges the session/* event declarations into cordis Events.
import type { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { isUserInvocable, renderSkillContent, type SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { AmphoreusConfig, SessionStartSourceName } from './config.ts'
import type { AmphoreusStores, BindingRecord } from './store.ts'

type InjectorContext = Context & { readonly skills: SkillRegistry }

export interface InjectorOptions {
  readonly config: AmphoreusConfig
  readonly stores: AmphoreusStores
}

export interface InheritSeedEvent {
  readonly type: string
  readonly seq: number
  readonly data?: unknown
}

/** Derive a child binding only for a newly-created fork. */
export function planForkInheritance(input: {
  readonly childId: string
  readonly parent: BindingRecord | undefined
  readonly childExisting: BindingRecord | undefined
  readonly freshFork: boolean
  readonly seedEvents: readonly InheritSeedEvent[]
  readonly autoInvokeEnabled: boolean
  readonly now: number
}): BindingRecord | undefined {
  if (!input.freshFork || input.parent === undefined || input.childExisting !== undefined) return undefined
  const inherited = input.seedEvents.some(event => {
    const source = (event.data as { source?: { kind?: string; name?: string } } | undefined)?.source
    return event.type === 'user/message'
      && source?.kind === 'skill-invocation'
      && source.name === input.parent!.skillName
  })
  const injection = !input.autoInvokeEnabled
    ? { state: 'skipped' as const, at: input.now, reason: 'auto-invoke-disabled' }
    : inherited
      ? { state: 'skipped' as const, at: input.now, reason: 'inherited-from-parent' }
      : { state: 'pending' as const }
  return {
    sessionId: input.childId,
    skillName: input.parent.skillName,
    ...(input.parent.face === undefined ? {} : { face: input.parent.face }),
    boundAt: input.now,
    source: 'fork-inherit',
    injection,
  }
}

/** Register fork inheritance and both injection paths; returns a disposer. */
export function registerInjector(ctx: Context, options: InjectorOptions): () => void {
  const { config, stores } = options
  const skills = (ctx as InjectorContext).skills
  const bindings = () => stores.main.table('bindings')
  const inheritedPending = new Map<string, BindingRecord>()

  const sourceEnabled = (source: SessionStartSourceName): boolean =>
    config.autoInvoke.enabled && config.autoInvoke.sources.includes(source)

  async function cardMessage(agent: Agent, skillName: string, signal: AbortSignal): Promise<UserMessage | undefined> {
    const lookup = { cwd: agent.session.header.cwd, signal, scope: agent }
    const definition = await skills.get(skillName, lookup)
    if (definition === undefined || !isUserInvocable(definition)) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: renderSkillContent(definition) }],
      source: { kind: 'skill-invocation', name: skillName, form: 'instructions' },
    })
  }

  async function markInjection(binding: BindingRecord, state: 'done' | 'failed' | 'skipped', reason?: string): Promise<void> {
    await bindings().put(binding.sessionId, {
      ...binding,
      injection: { state, at: Date.now(), ...(reason === undefined ? {} : { reason }) },
    })
    inheritedPending.delete(binding.sessionId)
  }

  // Fork inheritance must be visible before agent/session-start can race the
  // durable table write. Resumed sessions fail the exact fresh-fork equality.
  const disposeCreated = ctx.on('session/created', session => {
    try {
      const parentId = session.header.parentSession
      if (parentId === undefined) return
      const plan = planForkInheritance({
        childId: session.id,
        parent: bindings().get(parentId),
        childExisting: bindings().get(session.id),
        freshFork: session.firstLiveSeq === session.inheritedEventCount,
        seedEvents: session.snapshotEvents(0 as SessionLogOffset, session.inheritedEventCount),
        autoInvokeEnabled: config.autoInvoke.enabled,
        now: Date.now(),
      })
      if (plan === undefined) return
      inheritedPending.set(session.id, plan)
      let write: Promise<void>
      try {
        write = bindings().put(session.id, plan)
      } catch (error) {
        inheritedPending.delete(session.id)
        ctx.logger.warn(`amphoreus injector (fork-inherit): ${String(error)}`)
        return
      }
      void write.then(
        () => { inheritedPending.delete(session.id) },
        error => {
          inheritedPending.delete(session.id)
          ctx.logger.warn(`amphoreus injector (fork-inherit): ${String(error)}`)
        },
      )
    } catch (error) {
      inheritedPending.delete(session.id)
      ctx.logger.warn(`amphoreus injector (fork-inherit): ${String(error)}`)
    }
  })

  // Path 1: seed at session start (before the first user prompt, F11/F12).
  const disposeStart = ctx.on('agent/session-start', ({ agent, source }) => {
    void (async () => {
      const binding = bindings().get(agent.session.id) ?? inheritedPending.get(agent.session.id)
      if (binding === undefined || binding.injection.state !== 'pending') return
      if (source === 'resume') return
      if (!sourceEnabled(source)) return
      const message = await cardMessage(agent, binding.skillName, AbortSignal.timeout(5000))
      if (message === undefined) {
        await markInjection(binding, 'failed', 'card-missing-or-user-disabled')
        return
      }
      agent.inject(message)
      await markInjection(binding, 'done')
    })().catch(error => ctx.logger.warn(`amphoreus injector (session-start): ${String(error)}`))
  })

  // Path 2: first pre-step fallback — covers bindings that landed after
  // session-start (fork + bind race) and dedups a user-typed /name gesture.
  const disposePreStep = ctx.on(
    'agent/pre-step',
    async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const binding = bindings().get(agent.session.id) ?? inheritedPending.get(agent.session.id)
      if (binding === undefined || binding.injection.state !== 'pending') return decision
      if (!config.autoInvoke.enabled) return decision
      const already = [...decision.messages, ...messages].some(message =>
        message.source.kind === 'skill-invocation'
        && (message.source as { name?: string }).name === binding.skillName)
      if (already) {
        await markInjection(binding, 'skipped', 'user-invoked-same-skill')
        return decision
      }
      const message = await cardMessage(agent, binding.skillName, signal)
      if (message === undefined) {
        await markInjection(binding, 'failed', 'card-missing-or-user-disabled')
        return decision
      }
      await markInjection(binding, 'done')
      return { ...decision, messages: [...decision.messages, message] }
    },
  )

  return () => {
    inheritedPending.clear()
    disposeCreated()
    disposeStart()
    disposePreStep()
  }
}
