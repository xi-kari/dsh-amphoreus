import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerSeatTheme, type SeatLayer } from '../src/client/theme.ts'
import {
  clampMask,
  cssUrl,
  seatMaskFactor,
  seatWallpaperCandidates,
} from '../src/client/seat-wallpaper.ts'
import type { AmphoreusState } from '../src/shared/api.ts'
import { HERO_VISUALS, heroVisualById, seatWallpaperUrl } from '../src/shared/heroes.ts'

test('wallpaper helpers cover every calendar and prefer a versioned derived wide cover', () => {
  assert.equal(HERO_VISUALS.length, 13)
  for (const hero of HERO_VISUALS) {
    const url = seatWallpaperUrl(hero)
    assert.match(url, /^\/amphoreus\/assets\//u)
    assert.equal(url.includes(encodeURIComponent(hero.assets.calendar)), true, hero.heroId)
  }

  const anaxa = heroVisualById('anaxa')!
  assert.deepEqual(seatWallpaperCandidates(anaxa, {
    derived: ['anaxa/cover-169.webp'],
    assetsConfigured: true,
    derivedVersion: 42,
  }), [
    '/amphoreus/derived/anaxa/cover-169.webp?v=42',
    seatWallpaperUrl(anaxa),
  ])
  assert.deepEqual(seatWallpaperCandidates(anaxa, {
    derived: ['anaxa/cover-169.webp'],
    assetsConfigured: false,
  }), ['/amphoreus/derived/anaxa/cover-169.webp'])
  assert.deepEqual(seatWallpaperCandidates(anaxa, {
    derived: [],
    assetsConfigured: true,
  }), [seatWallpaperUrl(anaxa)])
  assert.deepEqual(seatWallpaperCandidates(anaxa, {
    derived: [],
    assetsConfigured: false,
  }), [])

  assert.equal(seatMaskFactor('light'), 1.3)
  assert.equal(seatMaskFactor('mid'), 1)
  assert.equal(seatMaskFactor('dark'), 0.8)
  assert.equal(clampMask(1.2), 0.9)
  assert.equal(clampMask(-1), 0)
  assert.equal(cssUrl('a"b'), 'url("a%22b")')
})

test('first-frame seat intent still hydrates a derived cover and ignores unrelated refreshes', async () => {
  const state = fixtureState({ heroId: 'anaxa', derived: ['anaxa/cover-169.webp'], derivedVersion: 8 })
  const fixture = installFixture(state, 'session-a', 'anaxa')
  try {
    assert.equal(fixture.images.length, 1)
    assert.equal(fixture.images[0]?.src, '/amphoreus/derived/anaxa/cover-169.webp?v=8')
    assert.deepEqual(fixture.seatCalls, [])
    fixture.controller.hint('aglaea')
    assert.equal(fixture.images.length, 1, 'the current binding must outrank an iframe hint')

    fixture.images[0]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.deepEqual(fixture.seatCalls, ['anaxa'])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'anaxa')
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'anaxa')
    assert.equal(fixture.slot(1).dataset.active, '')
    assert.equal(fixture.slot(1).style.backgroundImage, 'url("/amphoreus/derived/anaxa/cover-169.webp?v=8")')
    assert.equal(fixture.body.style.getPropertyValue('--amphoreus-dark-mask'), '0.144')
    assert.equal(fixture.body.style.getPropertyValue('--amphoreus-light-mask'), '0.024')

    fixture.model.publish({ ...state, revision: 99 } as AmphoreusState)
    assert.equal(fixture.images.length, 1, 'revision-only refresh must not replay the transition')
  } finally {
    fixture.cleanup()
  }
})

test('bootstrap intent bridges an undefined current session without an intermediate global leave', async () => {
  const state = fixtureState({ heroId: 'aglaea', derived: ['aglaea/cover-169.webp'], derivedVersion: 12 })
  const fixture = installFixture(state, undefined, 'aglaea')
  try {
    assert.equal(fixture.images.length, 1)
    assert.equal(fixture.images[0]?.src, '/amphoreus/derived/aglaea/cover-169.webp?v=12')
    assert.deepEqual(fixture.seatCalls, [])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'aglaea')

    fixture.sessions.publish('session-a')
    assert.equal(fixture.images.length, 1, 'hydrating the matching binding must keep the bootstrap transition')
    assert.deepEqual(fixture.seatCalls, [], 'session hydration must not insert an intermediate global apply')
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'aglaea')

    fixture.images[0]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.deepEqual(fixture.seatCalls, ['aglaea'])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')
    assert.equal(fixture.slot(1).dataset.active, '')
  } finally {
    fixture.cleanup()
  }
})

test('an explicit global hint cancels and clears bootstrap intent', async () => {
  const fixture = installFixture(fixtureState({}), undefined, 'aglaea')
  try {
    assert.equal(fixture.images.length, 1)
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')

    fixture.controller.hint(null)
    assert.deepEqual(fixture.seatCalls, [null])
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), null)

    fixture.images[0]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()
    assert.deepEqual(fixture.seatCalls, [null])
  } finally {
    fixture.cleanup()
  }
})

test('a broken derived cover falls back to the original calendar without warning', async () => {
  const state = fixtureState({ heroId: 'anaxa', derived: ['anaxa/cover-169.webp'] })
  const fixture = installFixture(state, 'session-a')
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    assert.equal(fixture.images[0]?.src, '/amphoreus/derived/anaxa/cover-169.webp')
    fixture.images[0]!.reject(new Error('derived missing'))
    await settle()
    assert.equal(fixture.images[1]?.src, seatWallpaperUrl(heroVisualById('anaxa')!))

    fixture.images[1]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.deepEqual(fixture.seatCalls, ['anaxa'])
    assert.equal(fixture.slot(1).style.backgroundImage, cssUrl(seatWallpaperUrl(heroVisualById('anaxa')!)))
    assert.equal(warnings.length, 0)
  } finally {
    fixture.cleanup()
    console.warn = originalWarn
  }
})

test('superseded image generations cannot overwrite a newer hint or a new session', async () => {
  const fixture = installFixture(fixtureState({}), 'session-a')
  try {
    assert.deepEqual(fixture.seatCalls, [null])
    fixture.controller.hint('anaxa')
    assert.equal(fixture.images.length, 1)

    fixture.controller.hint('aglaea')
    assert.equal(fixture.images.length, 2)
    fixture.images[1]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()
    fixture.images[0]!.resolve()
    await settle()

    assert.deepEqual(fixture.seatCalls, [null, 'aglaea'])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')

    fixture.controller.hint('anaxa')
    assert.equal(fixture.images.length, 3)
    fixture.sessions.publish('session-b')
    fixture.images[2]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.deepEqual(fixture.seatCalls, [null, 'aglaea', null])
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), null)
    assert.equal(fixture.slot(0).dataset.active, undefined)
    assert.equal(fixture.slot(1).dataset.active, undefined)
  } finally {
    fixture.cleanup()
  }
})

test('the full render key reacts to derived/config changes and token-only mode stays quiet', async () => {
  const initial = fixtureState({ heroId: 'anaxa', assetsConfigured: false })
  const fixture = installFixture(initial, 'session-a')
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    assert.equal(fixture.images.length, 0)
    assert.deepEqual(fixture.seatCalls, ['anaxa'])

    fixture.model.publish({ ...initial, revision: 2 } as AmphoreusState)
    assert.equal(fixture.images.length, 0)
    assert.deepEqual(fixture.seatCalls, ['anaxa'])

    const derived = fixtureState({
      heroId: 'anaxa',
      assetsConfigured: false,
      derived: ['anaxa/cover-169.webp'],
      derivedVersion: 55,
    })
    fixture.model.publish(derived)
    assert.equal(fixture.images[0]?.src, '/amphoreus/derived/anaxa/cover-169.webp?v=55')
    fixture.images[0]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()
    assert.deepEqual(fixture.seatCalls, ['anaxa', 'anaxa'])

    fixture.model.publish(fixtureState({
      heroId: 'anaxa',
      assetsConfigured: false,
      derived: ['anaxa/cover-169.webp'],
      derivedVersion: 55,
      darkMask: 0.3,
    }))
    assert.equal(fixture.images.length, 2, 'mask changes are part of the render key')

    fixture.model.publish(fixtureState({
      heroId: 'anaxa',
      assetsConfigured: false,
      derived: ['anaxa/cover-169.webp'],
      derivedVersion: 55,
      darkMask: 0.3,
      perSeat: false,
    }))
    fixture.images[1]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.deepEqual(fixture.seatCalls, ['anaxa', 'anaxa', 'anaxa'])
    assert.equal(fixture.slot(0).dataset.active, undefined)
    assert.equal(fixture.slot(1).dataset.active, undefined)
    assert.equal(fixture.layer.style.getPropertyValue('--amphoreus-wallpaper-url'), 'url("/global.webp")')
    assert.equal(warnings.length, 0)
  } finally {
    fixture.cleanup()
    console.warn = originalWarn
  }
})

test('all candidate failures fall back once, and dispose seals pending work and listeners', async () => {
  const fixture = installFixture(fixtureState({ heroId: 'anaxa' }), 'session-a')
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    assert.equal(fixture.images.length, 1)
    fixture.images[0]!.reject(new Error('calendar missing'))
    await settle()

    assert.equal(warnings.length, 1)
    assert.deepEqual(fixture.seatCalls, [null])
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
    fixture.model.publish(fixture.model.getSnapshot().state!)
    assert.equal(fixture.images.length, 1, 'an unchanged failed render key must not retry on every state event')

    fixture.sessions.publish('session-b')
    fixture.controller.hint('anaxa')
    assert.equal(fixture.images.length, 2)
    fixture.controller.dispose()
    assert.equal(fixture.model.listeners.size, 0)
    assert.equal(fixture.sessions.listeners.size, 0)
    fixture.images[1]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
    assert.equal(fixture.slot(0).style.backgroundImage, '')
    assert.equal(fixture.slot(1).style.backgroundImage, '')
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), null)
    assert.equal(warnings.length, 1)
  } finally {
    fixture.cleanup()
    console.warn = originalWarn
  }
})

interface StateOptions {
  readonly heroId?: string
  readonly assetsConfigured?: boolean
  readonly derived?: readonly string[]
  readonly derivedVersion?: number
  readonly enabled?: boolean
  readonly perSeat?: boolean
  readonly darkMask?: number
  readonly lightMask?: number
}

function fixtureState(options: StateOptions): AmphoreusState {
  const hero = options.heroId === undefined ? undefined : heroVisualById(options.heroId)
  return {
    revision: 1,
    bindings: hero === undefined ? [] : [{
      sessionId: 'session-a',
      skillName: hero.skill,
      boundAt: 1,
      source: 'manual',
      injection: { state: 'done', at: 1 },
    }],
    assets: {
      derived: options.derived ?? [],
      lastDerive: options.derivedVersion === undefined ? null : {
        at: options.derivedVersion,
        written: 1,
        failed: 0,
      },
    },
    effectiveConfig: {
      assetsConfigured: options.assetsConfigured ?? true,
      wallpaper: {
        enabled: options.enabled ?? true,
        perSeat: options.perSeat ?? true,
        darkMask: options.darkMask ?? 0.18,
        lightMask: options.lightMask ?? 0.03,
        surfaceAlpha: { light: 0.22, dark: 0.4 },
      },
    },
  } as unknown as AmphoreusState
}

class FakeStyle {
  readonly values = new Map<string, string>()
  backgroundImage = ''

  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }

  removeProperty(name: string): string {
    const previous = this.values.get(name) ?? ''
    this.values.delete(name)
    return previous
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? ''
  }
}

class FakeElement {
  readonly dataset: Record<string, string | undefined> = {}
  readonly style = new FakeStyle()
  readonly slots = new Map<number, FakeElement>()
  hidden = false
  readonly offsetWidth = 1

  querySelector<T>(selector: string): T | null {
    const match = /data-slot="([01])"/u.exec(selector)
    return (match === null ? null : this.slots.get(Number(match[1]))) as T | null
  }
}

class FakeStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

class FakeImage {
  src = ''
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void

  constructor() {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    this.promise = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    this.resolve = resolve
    this.reject = reject
  }

  decode(): Promise<void> {
    return this.promise
  }
}

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    listeners,
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (next: T) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function installFixture(initialState: AmphoreusState, current: string | undefined, initialSeat?: string) {
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const name of ['document', 'window', 'HTMLElement', 'Image', 'localStorage'] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  }

  const body = new FakeElement()
  const layer = new FakeElement()
  layer.slots.set(0, new FakeElement())
  layer.slots.set(1, new FakeElement())
  const storage = new FakeStorage()
  if (initialSeat !== undefined) {
    body.dataset.amphoreusSeat = initialSeat
    storage.setItem('dsh-amphoreus:last-seat', initialSeat)
  }
  const images: FakeImage[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1

  class FixtureImage extends FakeImage {
    constructor() {
      super()
      images.push(this)
    }
  }

  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body,
      getElementById: (id: string) => id === 'amphoreus-wallpaper' ? layer : null,
    },
  })
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FixtureImage })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __AMPHOREUS_BOOT__: {
        wallpaper: { url: '/global.webp', darkMask: 0.18, lightMask: 0.03 },
      },
      setTimeout: (callback: () => void) => {
        const id = nextTimer++
        timers.set(id, callback)
        return id
      },
      clearTimeout: (id: number) => { timers.delete(id) },
    },
  })

  const model = observable<{ state?: AmphoreusState }>({ state: initialState })
  const sessions = observable({ current })
  const seatCalls: Array<string | null> = []
  let selected: string | null = null
  const seatLayer: SeatLayer = {
    apply: heroId => {
      selected = heroId
      seatCalls.push(heroId)
      if (heroId === null) delete body.dataset.amphoreusSeat
      else body.dataset.amphoreusSeat = heroId
    },
    current: () => selected,
    dispose: () => {},
  }
  const controller = registerSeatTheme(
    {} as never,
    model as never,
    { list: sessions as never },
    seatLayer,
  )

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    controller.dispose()
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }

  return {
    body,
    layer,
    storage,
    images,
    model: {
      listeners: model.listeners,
      getSnapshot: () => model.getSnapshot(),
      publish: (state: AmphoreusState) => model.publish({ state }),
    },
    sessions: {
      listeners: sessions.listeners,
      publish: (sessionId: string | undefined) => sessions.publish({ current: sessionId }),
    },
    seatCalls,
    controller,
    slot: (index: 0 | 1) => layer.slots.get(index)!,
    runTimers: () => {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) callback()
    },
    cleanup,
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await new Promise<void>(resolve => queueMicrotask(resolve))
  await Promise.resolve()
}
