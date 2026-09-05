/**
 * One-shot skill-card injection for seat-bound sessions (设计文档 01 §6).
 * When a session bound to a seat starts, append the seat's skill card at its
 * first accepted pre-step exactly the way dsh-tool-skill would for a typed
 * `/name`: same ctx.skills.get lookup, same renderSkillContent body, same
 * skill-invocation source. Session-start is notification-only here: it records
 * the lifecycle source but never performs an asynchronous inbox injection that
 * could miss an already-claimed first request. Dedup against a user-typed
 * gesture rides the binding's injection state plus a same-step message scan.
 * Never injects the router card; resumes repair uncommitted first injections, honors
 * config.autoInvoke.sources for clear/compact.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the agent/* event declarations into cordis Events.
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: merges the session/* event declarations into cordis Events.
import type { SessionEvent, SessionLogOffset } from '@deepseek-ai/dsh-session'
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

/** Register fork inheritance, lifecycle-source tracking, and pre-step injection. */
export function registerInjector(ctx: Context, options: InjectorOptions): () => void {
  const { config, stores } = options
  const skills = (ctx as InjectorContext).skills
  const bindings = () => stores.main.table('bindings')
  const inheritedPending = new Map<string, BindingRecord>()
  const sessionStartSources = new Map<string, SessionStartSourceName>()
  const proposed = new Map<string, { binding: BindingRecord; automaticId?: string }>()
  const committed = new Map<string, BindingRecord>()

  const sameBinding = (left: BindingRecord, right: BindingRecord): boolean =>
    left.skillName === right.skillName && left.face === right.face && left.boundAt === right.boundAt

  const invocation = (message: UserMessage, skillName: string): boolean =>
    message.source.kind === 'skill-invocation'
      && (message.source as { name?: string }).name === skillName

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
    const value: BindingRecord = {
      ...binding,
      injection: { state, at: Date.now(), ...(reason === undefined ? {} : { reason }) },
    }
    committed.set(binding.sessionId, value)
    proposed.delete(binding.sessionId)
    try {
      await bindings().update(binding.sessionId, current =>
        sameBinding(current, binding) && current.injection.state === 'pending'
          ? { ...current, injection: value.injection }
          : current)
    } catch (error) {
      if ((error as { code?: string }).code !== 'missing-key') throw error
    }
    if (committed.get(binding.sessionId) === value) committed.delete(binding.sessionId)
    if (inheritedPending.get(binding.sessionId) === binding) inheritedPending.delete(binding.sessionId)
    sessionStartSources.delete(binding.sessionId)
  }

  const disposeEvent = ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    const pending = proposed.get(session.id)
    if (pending === undefined || !invocation(event.data, pending.binding.skillName)) return
    const binding = bindings().get(session.id) ?? inheritedPending.get(session.id)
    if (binding === undefined || binding.injection.state !== 'pending' || !sameBinding(binding, pending.binding)) return
    const automatic = pending.automaticId !== undefined && event.data.id === pending.automaticId
    void markInjection(binding, automatic ? 'done' : 'skipped', automatic ? undefined : 'user-invoked-same-skill')
      .catch(error => { ctx.logger.warn(`amphoreus injector (committed): ${String(error)}`) })
  })

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

  // Session-start is an emit notification, so asynchronous work started here
  // cannot gate the first inbox claim. Record only the source; pre-step below
  // is the single transaction boundary that commits model-facing card input.
  const disposeStart = ctx.on('agent/session-start', ({ agent, source }) => {
    sessionStartSources.set(agent.session.id, source)
  })

  // Pre-step proposes input; only session/event confirms that it was accepted.
  const disposePreStep = ctx.on(
    'agent/pre-step',
    async ({ agent, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      signal.throwIfAborted()
      let binding = bindings().get(agent.session.id) ?? inheritedPending.get(agent.session.id)
      if (binding === undefined) return decision
      const source = sessionStartSources.get(agent.session.id)
      if (binding.injection.state === 'done' && source === 'resume' && config.autoInvoke.enabled) {
        const previous = binding
        const acceptedInLog = agent.session.snapshotEvents().some(event =>
          event.time >= previous.boundAt && event.type === 'user/message' && invocation(event.data, previous.skillName))
        if (acceptedInLog) {
          sessionStartSources.delete(agent.session.id)
          return decision
        }
        try {
          binding = await bindings().update(agent.session.id, current =>
            sameBinding(current, previous) && current.injection.state === 'done'
              ? { ...current, injection: { state: 'pending' } }
              : current)
        } catch (error) {
          if ((error as { code?: string }).code === 'missing-key') return { kind: 'reject' }
          throw error
        }
        signal.throwIfAborted()
        if (!sameBinding(binding, previous)) return { kind: 'reject' }
      }
      if (binding.injection.state !== 'pending') return decision
      const accepted = committed.get(agent.session.id)
      if (accepted !== undefined && sameBinding(accepted, binding)) return decision
      if (!config.autoInvoke.enabled) return decision
      if (source !== 'resume' && source !== undefined && !sourceEnabled(source)) return decision
      const recorded = agent.session.snapshotEvents().find((event: SessionEvent) =>
        event.time >= binding.boundAt && event.type === 'user/message' && invocation(event.data, binding.skillName))
      if (recorded !== undefined) {
        await markInjection(binding, 'done', 'accepted-in-session-log')
        return decision
      }
      const already = decision.messages.some(message =>
        invocation(message, binding.skillName))
      if (already) {
        proposed.set(agent.session.id, { binding })
        return decision
      }
      const message = await cardMessage(agent, binding.skillName, signal)
      signal.throwIfAborted()
      const latest = bindings().get(agent.session.id) ?? inheritedPending.get(agent.session.id)
      if (latest === undefined || !sameBinding(latest, binding)) return { kind: 'reject' }
      if (message === undefined) {
        await markInjection(binding, 'failed', 'card-missing-or-user-disabled')
        return decision
      }
      proposed.set(agent.session.id, { binding, automaticId: message.id })
      return { ...decision, messages: [...decision.messages, message] }
    },
  )

  const disposeAgent = ctx.on('agent/disposed', ({ agent }) => {
    inheritedPending.delete(agent.session.id)
    sessionStartSources.delete(agent.session.id)
    proposed.delete(agent.session.id)
    committed.delete(agent.session.id)
  })

  return () => {
    inheritedPending.clear()
    sessionStartSources.clear()
    proposed.clear()
    committed.clear()
    disposeCreated()
    disposeStart()
    disposePreStep()
    disposeAgent()
    disposeEvent()
  }
}
