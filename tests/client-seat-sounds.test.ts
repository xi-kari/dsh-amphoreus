/** Seat sound player + greeting hook under node --test with a fake audio factory and gesture target. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeatSoundPlayer, freshSubmissionIds, installSeatSounds, mergeSeatSoundPatch, nextSendDecision, resolveSeatSound, SEND_SEEN_LIMIT, type AudioLike } from '../src/client/seat-sounds.ts'
import type { AmphoreusState } from '../src/shared/api.ts'

class FakeAudio implements AudioLike {
  volume = 1
  played = 0
  paused = 0
  readonly url: string
  readonly allowed: boolean
  constructor(url: string, allowed: boolean) {
    this.url = url
    this.allowed = allowed
  }
  play(): Promise<void> {
    this.played += 1
    return this.allowed ? Promise.resolve() : Promise.reject(new DOMException('blocked', 'NotAllowedError'))
  }
  pause(): void { this.paused += 1 }
}

class FakeDoc {
  readonly listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }
  count(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0)
  }
}

function fixture(allowed = true) {
  const created: FakeAudio[] = []
  const doc = new FakeDoc()
  const player = createSeatSoundPlayer({ audioFactory: url => { const audio = new FakeAudio(url, allowed); created.push(audio); return audio }, doc })
  return { created, doc, player }
}

function seatWatch(initial: string | null) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: string | null) {
      if (next === current) return
      current = next
      for (const listener of [...listeners]) listener()
    },
    size: () => listeners.size,
  }
}

function stateWith(options: { master?: boolean; sounds?: { heroId: string; slot: 'greeting' | 'send'; enabled?: boolean; volume?: number }[] } = {}): Pick<AmphoreusState, 'seatSounds' | 'prefs'> {
  return {
    prefs: { lastSeat: null, wallpaperCursor: 0, quickPhrases: [], quickPhrasesInitialized: false, ...(options.master === undefined ? {} : { seatSounds: { master: options.master } }) },
    seatSounds: (options.sounds ?? []).map(sound => ({
      heroId: sound.heroId, slot: sound.slot, mime: 'audio/mpeg', bytes: 10,
      url: `/amphoreus/seat-sound/${sound.heroId}/${sound.slot}.mp3?v=1`,
      prefs: { enabled: sound.enabled ?? true, volume: sound.volume ?? 0.6 },
    })),
  }
}

test('player: play() is silent before arming, greet() is queued and replayed once on the first gesture, listeners detach', async () => {
  const { created, doc, player } = fixture()
  assert.equal(player.armed, false)
  assert.equal(doc.count(), 2, 'pointerdown + keydown listeners')

  player.play('/a.mp3', 0.5)
  assert.equal(created.length, 0, 'send click never plays before a gesture')

  player.greet('/g1.mp3', 0.3)
  player.greet('/g2.mp3', 0.4)
  assert.equal(created.length, 0, 'greeting is deferred')

  doc.fire('keydown')
  assert.equal(player.armed, true)
  assert.deepEqual(created.map(audio => audio.url), ['/g2.mp3'], 'latest pending greeting wins, replayed exactly once')
  assert.equal(created[0]!.volume, 0.4)
  assert.equal(created[0]!.played, 1)
  assert.equal(doc.count(), 0, 'gesture listeners removed after arming')

  doc.fire('pointerdown')
  assert.equal(created.length, 1, 'no second replay')

  player.play('/send.mp3', 0.9)
  assert.equal(created.length, 2)
  assert.equal(created[1]!.volume, 0.9)

  player.greet('/g3.mp3', 1.7)
  assert.equal(created.length, 3)
  assert.equal(created[0]!.paused, 1, 'newer greeting stops the previous one')
  assert.equal(created[2]!.volume, 1, 'volume is clamped to 0..1')

  player.dispose()
  assert.equal(created[2]!.paused, 1)
  player.play('/after.mp3', 0.5)
  player.greet('/after.mp3', 0.5)
  assert.equal(created.length, 3, 'disposed player is inert')
  await Promise.resolve()
})

test('player: a rejected play() (autoplay policy) is swallowed, not thrown', async () => {
  const { created, doc, player } = fixture(false)
  doc.fire('pointerdown')
  assert.doesNotThrow(() => player.play('/blocked.mp3', 0.5))
  assert.equal(created[0]!.played, 1)
  await new Promise(resolve => setTimeout(resolve, 0))
  player.dispose()
})

test('player: armed option skips gesture wiring; a throwing factory is tolerated', () => {
  const doc = new FakeDoc()
  const player = createSeatSoundPlayer({ audioFactory: () => { throw new Error('no audio here') }, doc, armed: true })
  assert.equal(player.armed, true)
  assert.equal(doc.count(), 0)
  assert.doesNotThrow(() => player.play('/x.mp3', 0.5))
  assert.doesNotThrow(() => player.greet('/x.mp3', 0.5))
  player.dispose()
})

test('resolveSeatSound honours master, per-slot enabled/volume, missing uploads and the null (global) seat', () => {
  const state = stateWith({ sounds: [
    { heroId: 'anaxa', slot: 'greeting', volume: 0.2 },
    { heroId: 'anaxa', slot: 'send', enabled: false },
    { heroId: 'mydei', slot: 'send', volume: 1 },
  ] })
  assert.deepEqual(resolveSeatSound(state, 'anaxa', 'greeting'), { url: '/amphoreus/seat-sound/anaxa/greeting.mp3?v=1', volume: 0.2 })
  assert.equal(resolveSeatSound(state, 'anaxa', 'send'), undefined, 'slot disabled')
  assert.equal(resolveSeatSound(state, 'mydei', 'greeting'), undefined, 'no upload')
  assert.deepEqual(resolveSeatSound(state, 'mydei', 'send'), { url: '/amphoreus/seat-sound/mydei/send.mp3?v=1', volume: 1 })
  assert.equal(resolveSeatSound(state, null, 'greeting'), undefined, 'global seat')
  assert.equal(resolveSeatSound(undefined, 'anaxa', 'greeting'), undefined, 'state not loaded')
  assert.equal(resolveSeatSound(stateWith({ master: false, sounds: [{ heroId: 'anaxa', slot: 'greeting' }] }), 'anaxa', 'greeting'), undefined, 'master off')
  assert.deepEqual(resolveSeatSound(stateWith({ master: true, sounds: [{ heroId: 'anaxa', slot: 'greeting' }] }), 'anaxa', 'greeting')?.volume, 0.6)
})

test('installSeatSounds: greets only on a change to a non-null seat with an enabled greeting; disposer unsubscribes', () => {
  const greeted: { url: string; volume: number }[] = []
  const player = { greet: (url: string, volume: number) => { greeted.push({ url, volume }) } }
  const seat = seatWatch('anaxa')
  let state = stateWith({ sounds: [
    { heroId: 'anaxa', slot: 'greeting', volume: 0.2 },
    { heroId: 'mydei', slot: 'greeting', volume: 0.8 },
    { heroId: 'cipher', slot: 'greeting', enabled: false },
    { heroId: 'cipher', slot: 'send' },
  ] })
  const model = { getSnapshot: () => ({ phase: 'ready' as const, refreshing: false, state: state as AmphoreusState }) }
  const dispose = installSeatSounds({ seat, model, player })
  assert.equal(greeted.length, 0, 'initial seat is not greeted (page restore)')

  seat.set('mydei')
  assert.deepEqual(greeted, [{ url: '/amphoreus/seat-sound/mydei/greeting.mp3?v=1', volume: 0.8 }])

  seat.set(null)
  assert.equal(greeted.length, 1, 'leaving a seat / entering the global seat is silent')

  seat.set('anaxa')
  assert.equal(greeted.length, 2)
  assert.equal(greeted[1]!.volume, 0.2)

  seat.set('cipher')
  assert.equal(greeted.length, 2, 'disabled greeting slot stays silent even with a send sound present')

  seat.set('phainon')
  assert.equal(greeted.length, 2, 'no upload → silent')

  state = stateWith({ master: false, sounds: [{ heroId: 'mydei', slot: 'greeting' }] })
  seat.set('mydei')
  assert.equal(greeted.length, 2, 'master off → silent')

  dispose()
  assert.equal(seat.size(), 0)
  state = stateWith({ sounds: [{ heroId: 'anaxa', slot: 'greeting' }] })
  seat.set('anaxa')
  assert.equal(greeted.length, 2, 'disposed hook no longer greets')
})

test('freshSubmissionIds reports only ids not seen before (one composer send == one click)', () => {
  const seen = new Set(['a'])
  assert.deepEqual(freshSubmissionIds(seen, ['a', 'b', 'c']), ['b', 'c'])
  assert.deepEqual(freshSubmissionIds(seen, ['a']), [])
  assert.deepEqual(freshSubmissionIds(new Set(), []), [])
})

test('nextSendDecision: mount never plays, one play per batch with a fresh id, vanished ids do not replay, prune keeps in-flight ids', () => {
  // (a) first observation (session switch mid-flight): remember, stay silent
  const mount = nextSendDecision(undefined, ['r1', 'r2'])
  assert.equal(mount.play, false)
  assert.deepEqual([...mount.seen].sort(), ['r1', 'r2'])
  // same ids again → nothing new
  assert.equal(nextSendDecision(mount.seen, ['r1', 'r2']).play, false)
  // (b) one new id → exactly one play for the batch (two new ids still one batch)
  const second = nextSendDecision(mount.seen, ['r2', 'r3'])
  assert.equal(second.play, true)
  assert.deepEqual([...second.seen].sort(), ['r1', 'r2', 'r3'])
  const twoAtOnce = nextSendDecision(second.seen, ['r4', 'r5'])
  assert.equal(twoAtOnce.play, true)
  // (c) an id that disappeared and reappears is not fresh
  const gone = nextSendDecision(twoAtOnce.seen, [])
  assert.equal(gone.play, false)
  assert.equal(nextSendDecision(gone.seen, ['r3']).play, false)
  // retired ids stay remembered below the limit
  assert.equal(gone.seen.size, 5)
  // (d) prune: past the limit the set collapses to the current batch; the ids still in flight are kept, so the next identical observation does not replay
  let seen: Set<string> = new Set()
  for (let index = 0; index < SEND_SEEN_LIMIT; index += 1) seen = nextSendDecision(seen, [`id-${index}`]).seen
  assert.equal(seen.size, SEND_SEEN_LIMIT)
  const overflow = nextSendDecision(seen, ['id-63', 'id-64'])
  assert.equal(overflow.play, true)
  assert.deepEqual([...overflow.seen].sort(), ['id-63', 'id-64'], 'collapsed to what is in flight')
  assert.equal(nextSendDecision(overflow.seen, ['id-63', 'id-64']).play, false, 'no replay after the collapse')
  assert.equal(nextSendDecision(overflow.seen, ['id-64', 'id-65']).play, true)
  // empty batches never play
  assert.equal(nextSendDecision(new Set(), []).play, false)
})

test('mergeSeatSoundPatch: queued pref writes coalesce per leaf, later wins, null seat entry replaces', () => {
  assert.deepEqual(mergeSeatSoundPatch(undefined, { master: false }), { master: false })
  assert.deepEqual(
    mergeSeatSoundPatch({ seats: { anaxa: { greeting: { volume: 0.2 } } } }, { seats: { anaxa: { greeting: { enabled: false }, send: { volume: 1 } } } }),
    { seats: { anaxa: { greeting: { volume: 0.2, enabled: false }, send: { volume: 1 } } } },
  )
  assert.deepEqual(
    mergeSeatSoundPatch({ master: true, seats: { anaxa: { send: { volume: 0.1 } } } }, { master: false, seats: { anaxa: { send: { volume: 0.9 } }, cipher: { send: { enabled: true } } } }),
    { master: false, seats: { anaxa: { send: { volume: 0.9 } }, cipher: { send: { enabled: true } } } },
  )
  assert.deepEqual(mergeSeatSoundPatch({ master: false }, { seats: { anaxa: { greeting: { volume: 0.5 } } } }), { master: false, seats: { anaxa: { greeting: { volume: 0.5 } } } })
  assert.deepEqual(mergeSeatSoundPatch({ seats: { anaxa: { greeting: { volume: 0.5 } } } }, { seats: { anaxa: null } }), { seats: { anaxa: null } })
  assert.deepEqual(mergeSeatSoundPatch({ seats: { anaxa: null } }, { seats: { anaxa: { send: { volume: 0.3 } } } }), { seats: { anaxa: { send: { volume: 0.3 } } } })
})
