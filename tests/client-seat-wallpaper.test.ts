import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerSeatTheme, type SeatLayer } from '../src/client/theme.ts'
import {
  clampMask,
  cssUrl,
  seatMaskFactor,
  seatWallpaperCandidates,
} from '../src/client/seat-wallpaper.ts'
import { CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, type AmphoreusState, type CustomWallpaperInfo } from '../src/shared/api.ts'
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
    assert.deepEqual(fixture.seatCalls, ['anaxa'], 'role intent is applied before image decoding')
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
    assert.deepEqual(fixture.seatCalls, ['aglaea'])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'aglaea')

    fixture.sessions.publish('session-a')
    assert.equal(fixture.images.length, 1, 'hydrating the matching binding must keep the bootstrap transition')
    assert.deepEqual(fixture.seatCalls, ['aglaea'], 'session hydration must not insert an intermediate global apply')
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
    assert.deepEqual(fixture.seatCalls, ['aglaea', null])
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), null)

    fixture.images[0]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()
    assert.deepEqual(fixture.seatCalls, ['aglaea', null])
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

    assert.deepEqual(fixture.seatCalls, [null, 'anaxa', 'aglaea'])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'aglaea')

    fixture.controller.hint('anaxa')
    assert.equal(fixture.images.length, 3)
    fixture.sessions.publish('session-b')
    fixture.images[2]!.resolve()
    await settle()
    fixture.runTimers()
    await settle()

    assert.deepEqual(fixture.seatCalls, [null, 'anaxa', 'aglaea', 'anaxa', null])
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
    assert.deepEqual(fixture.seatCalls, ['anaxa'])

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

    assert.deepEqual(fixture.seatCalls, ['anaxa'])
    assert.equal(fixture.slot(0).dataset.active, undefined)
    assert.equal(fixture.slot(1).dataset.active, undefined)
    assert.equal(fixture.layer.style.getPropertyValue('--amphoreus-wallpaper-url'), 'url("/global.webp")')
    assert.equal(warnings.length, 0)
  } finally {
    fixture.cleanup()
    console.warn = originalWarn
  }
})

test('all candidate failures preserve role color once, and dispose seals pending work and listeners', async () => {
  const fixture = installFixture(fixtureState({ heroId: 'anaxa' }), 'session-a')
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    assert.equal(fixture.images.length, 1)
    fixture.images[0]!.reject(new Error('calendar missing'))
    await settle()

    assert.equal(warnings.length, 1)
    assert.deepEqual(fixture.seatCalls, ['anaxa'])
    assert.equal(fixture.body.dataset.amphoreusSeat, 'anaxa')
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
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'anaxa')
    assert.equal(warnings.length, 1)
  } finally {
    fixture.cleanup()
    console.warn = originalWarn
  }
})

test('unloading the seat theme preserves intent while a fresh bound session restores its own role', async () => {
  const fixture = installFixture(fixtureState({ heroId: 'anaxa' }), 'session-a')
  try {
    fixture.images[0]!.resolve()
    await settle(); fixture.runTimers(); await settle()
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'anaxa')
    fixture.controller.dispose()
    assert.equal(fixture.storage.getItem('dsh-amphoreus:last-seat'), 'anaxa')
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
    assert.equal(fixture.model.listeners.size, 0)
    assert.equal(fixture.sessions.listeners.size, 0)
  } finally { fixture.cleanup() }
  const rebound = installFixture(fixtureState({ heroId: 'aglaea' }), 'session-a', 'anaxa')
  try {
    rebound.images[0]!.resolve()
    await settle(); rebound.runTimers(); await settle()
    assert.equal(rebound.body.dataset.amphoreusSeat, 'aglaea')
    rebound.sessions.publish('ordinary-session')
    assert.equal(rebound.body.dataset.amphoreusSeat, undefined)
    assert.equal(rebound.storage.getItem('dsh-amphoreus:last-seat'), null)
  } finally { rebound.cleanup() }
})

test('none keeps role colors without images and custom uses only the selected global or role image', async () => {
  const none = installFixture(fixtureState({ heroId: 'anaxa', mode: 'none', enabled: false }), 'session-a')
  try {
    assert.equal(none.images.length, 0)
    assert.deepEqual(none.seatCalls, ['anaxa'])
  } finally { none.cleanup() }
  const customState = { ...fixtureState({ heroId: 'anaxa', mode: 'custom' }), visualBoot: { wallpaper: { url: '/global-custom.png' } } } as AmphoreusState
  const custom = installFixture(customState, 'session-a')
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    assert.equal(custom.images[0]?.src, '/global-custom.png')
    custom.images[0]!.reject(new Error('custom missing'))
    await settle()
    assert.equal(custom.images.length, 1)
    assert.equal(custom.body.dataset.amphoreusSeat, 'anaxa')
    assert.equal(warnings.length, 1)
  } finally { custom.cleanup(); console.warn = originalWarn }
  const override = installFixture({ ...customState, customWallpapers: [{ heroId: 'anaxa', kind: 'image', url: '/role-custom.png' }] } as AmphoreusState, 'session-a')
  try { assert.equal(override.images[0]?.src, '/role-custom.png') } finally { override.cleanup() }
})

function customMedia(heroId: string, kind: 'image' | 'video'): CustomWallpaperInfo {
  return { heroId, kind, url: `/custom-${heroId}.${kind === 'video' ? 'webm' : 'png'}`, mime: kind === 'video' ? 'video/webm' : 'image/png', bytes: 32,
    placement: { ...CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS } }
}

test('all thirteen wallpaper owners including Cyrene retain their custom image independently of theme tokens and perSeat presets', async () => {
  for (const hero of HERO_VISUALS) {
    const media = customMedia(hero.heroId, 'image')
    const state = { ...fixtureState({ heroId: hero.heroId, mode: 'custom', perSeat: false }), customWallpapers: [customMedia('global', 'image'), media] } as AmphoreusState
    const fixture = installFixture(state, 'session-a')
    try {
      assert.equal(fixture.images[0]?.src, media.url, hero.heroId)
      fixture.images[0]!.resolve(); await settle(); fixture.runTimers(); await settle()
      assert.equal(fixture.slot(1).style.backgroundImage, cssUrl(media.url), hero.heroId)
      assert.equal(fixture.seatCalls.at(-1), hero.heroId === 'cyrene' ? null : hero.heroId)
    } finally { fixture.cleanup() }
  }
})

test('global and all thirteen role videos mount without decoding or waiting for an unrelated poster', async () => {
  for (const owner of ['global', ...HERO_VISUALS.map(hero => hero.heroId)]) {
    const media = customMedia(owner, 'video')
    const state = { ...fixtureState({ ...(owner === 'global' ? {} : { heroId: owner }), mode: 'custom' }), customWallpapers: [media] } as AmphoreusState
    const fixture = installFixture(state, owner === 'global' ? undefined : 'session-a')
    try {
      assert.equal(fixture.images.length, 0, `${owner}: video must not wait for a poster`)
      assert.equal(fixture.layer.video, undefined, `${owner}: pending media does not replace the active surface`)
      assert.equal(fixture.videos[0]?.playCount, 0, `${owner}: pending video must not play`)
      fixture.videos[0]!.ready(); await settle(); fixture.runTimers(); await settle()
      assert.equal(fixture.layer.video?.getAttribute('src'), media.url, owner)
      assert.equal(fixture.layer.video?.playCount, 1, owner)
      assert.equal(fixture.layer.video?.muted, true, owner)
      const video = fixture.layer.video!
      fixture.model.publish({ ...state, customWallpapers: [{ ...media, placement: { ...media.placement, paused: true } }] })
      assert.equal(fixture.layer.video, video, 'placement edits retain the video element')
      assert.equal(video.loads, 1, 'placement edits do not reload the source')
      assert.equal(video.paused, true)
      fixture.model.publish({ ...state, effectiveConfig: { ...state.effectiveConfig, wallpaper: { ...state.effectiveConfig.wallpaper, mode: 'none', enabled: false } } })
      assert.equal(fixture.layer.video, undefined)
      assert.equal(video.getAttribute('src'), null)
    } finally { fixture.cleanup() }
  }
})

test('an unbound global surface decodes the selected global image and uses its placement', async () => {
  const media = { ...customMedia('global', 'image'), placement: { ...CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, x: 17 } }
  const fixture = installFixture({ ...fixtureState({ mode: 'custom' }), customWallpapers: [media] } as AmphoreusState, undefined)
  try {
    assert.equal(fixture.images[0]?.src, media.url)
    fixture.images[0]!.resolve(); await settle(); fixture.runTimers(); await settle()
    assert.equal(fixture.slot(1).style.backgroundImage, cssUrl(media.url))
    assert.equal(fixture.body.style.getPropertyValue('--amph-wp-x'), '17%')
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
  } finally { fixture.cleanup() }
})

test('custom, preset, and none select distinct media without deleting role or global uploads', async () => {
  const media = customMedia('anaxa', 'image')
  const uploads = [media, customMedia('global', 'video')]
  const state = { ...fixtureState({ heroId: 'anaxa', mode: 'custom' }), customWallpapers: uploads } as AmphoreusState
  const fixture = installFixture(state, 'session-a')
  const select = (mode: 'custom' | 'preset' | 'none') => fixture.model.publish({
    ...state, effectiveConfig: { ...state.effectiveConfig, wallpaper: { ...state.effectiveConfig.wallpaper, mode, enabled: mode !== 'none' } },
  })
  try {
    assert.equal(fixture.images.at(-1)?.src, media.url)
    fixture.images.at(-1)!.resolve(); await settle(); fixture.runTimers(); await settle()
    select('preset')
    assert.equal(fixture.images.at(-1)?.src, seatWallpaperUrl(heroVisualById('anaxa')!))
    fixture.images.at(-1)!.resolve(); await settle(); fixture.runTimers(); await settle()
    assert.equal(fixture.body.style.getPropertyValue('--amph-wp-x'), '')
    select('none')
    assert.equal(fixture.slot(0).dataset.active, undefined)
    assert.equal(fixture.slot(1).dataset.active, undefined)
    assert.equal(fixture.layer.video, undefined)
    select('custom')
    assert.equal(fixture.images.at(-1)?.src, media.url)
    assert.equal(fixture.model.getSnapshot().state?.customWallpapers, uploads)
  } finally { fixture.cleanup() }
})

test('a pending or failed video preserves the previous image and releases its preload resources', async () => {
  const image = customMedia('anaxa', 'image')
  const state = { ...fixtureState({ heroId: 'anaxa', mode: 'custom' }), customWallpapers: [image] } as AmphoreusState
  const fixture = installFixture(state, 'session-a')
  const warn = console.warn; console.warn = () => {}
  try {
    fixture.images[0]!.resolve(); await settle(); fixture.runTimers(); await settle()
    const previous = fixture.slot(1).style.backgroundImage
    fixture.model.publish({ ...state, customWallpapers: [customMedia('anaxa', 'video')] })
    assert.equal(fixture.slot(1).style.backgroundImage, previous)
    assert.equal(fixture.videos[0]!.playCount, 0)
    fixture.videos[0]!.fail(); await settle()
    assert.equal(fixture.slot(1).style.backgroundImage, previous)
    assert.equal(fixture.layer.video, undefined)
    assert.equal(fixture.videos[0]!.getAttribute('src'), null)
    assert.equal(fixture.timers.size, 0)
    assert.ok([...fixture.videos[0]!.listeners.values()].every(set => set.size === 0))
  } finally { fixture.cleanup(); console.warn = warn }
})

test('video timeout keeps the previous video playing and a new generation cancels stale preload before fading', async () => {
  const initial = customMedia('cyrene', 'video')
  const state = { ...fixtureState({ heroId: 'cyrene', mode: 'custom' }), customWallpapers: [initial] } as AmphoreusState
  const fixture = installFixture(state, 'session-a')
  const warn = console.warn; console.warn = () => {}
  const select = (url: string) => fixture.model.publish({ ...state, customWallpapers: [{ ...initial, url }] })
  try {
    fixture.videos[0]!.ready(); await settle(); fixture.runTimers(); await settle()
    const active = fixture.layer.video!
    select('/timeout.webm')
    assert.equal(active.paused, false)
    assert.equal(fixture.videos[1]!.playCount, 0)
    fixture.runTimers(); await settle()
    assert.equal(fixture.layer.video, active)
    assert.equal(active.paused, false)
    assert.equal(fixture.videos[1]!.getAttribute('src'), null)
    select('/stale.webm')
    const stale = fixture.videos[2]!
    select('/latest.webm')
    assert.equal(stale.getAttribute('src'), null)
    stale.ready(); await settle()
    assert.equal(fixture.layer.video, active)
    const latest = fixture.videos[3]!
    latest.ready(); await settle()
    assert.equal(fixture.layer.videos.length, 2)
    assert.equal(active.paused, true)
    assert.equal(latest.playCount, 1)
    fixture.hide(); await settle()
    assert.equal(fixture.layer.videos.length, 1)
    assert.equal(fixture.layer.video, latest)
    assert.equal(active.getAttribute('src'), null)
    assert.equal(latest.style.transition, 'none')
    assert.equal(fixture.timers.size, 0)
    select('/cancel-on-dispose.webm')
    fixture.controller.dispose()
    fixture.videos[4]!.ready(); await settle()
    assert.equal(fixture.layer.videos.length, 0)
    assert.ok(fixture.videos.every(video => video.getAttribute('src') === null && video.paused))
    assert.equal(fixture.timers.size, 0)
  } finally { fixture.cleanup(); console.warn = warn }
})

test('steady video pauses while hidden, resumes in place and respects manual pause and disposal', async () => {
  const media = customMedia('global', 'video')
  const state = { ...fixtureState({ mode: 'custom' }), customWallpapers: [media] } as AmphoreusState
  const fixture = installFixture(state)
  try {
    fixture.videos[0]!.ready(); await settle(); fixture.runTimers(); await settle()
    const video = fixture.layer.video!
    assert.equal(video.paused, false)
    fixture.hide()
    assert.equal(video.paused, true)
    fixture.model.publish({ ...state, customWallpapers: [{ ...media, placement: { ...media.placement, x: 30 } }] })
    assert.equal(video.paused, true, 'placement changes cannot restart a hidden video')
    fixture.show()
    assert.equal(fixture.layer.video, video)
    assert.equal(video.paused, false)
    assert.equal(video.loads, 1)
    fixture.model.publish({ ...state, customWallpapers: [{ ...media, placement: { ...media.placement, paused: true } }] })
    const playCount = video.playCount
    fixture.hide(); fixture.show()
    assert.equal(video.paused, true)
    assert.equal(video.playCount, playCount)
    fixture.hide(); fixture.controller.dispose(); fixture.show()
    assert.equal(video.getAttribute('src'), null)
    assert.equal(video.playCount, playCount)
    assert.equal(fixture.timers.size, 0)
  } finally { fixture.cleanup() }
})

test('a video prepared in a hidden page waits to play until that page becomes visible', async () => {
  const state = { ...fixtureState({ mode: 'custom' }), customWallpapers: [customMedia('global', 'video')] } as AmphoreusState
  const fixture = installFixture(state, undefined, undefined, { hidden: true })
  try {
    fixture.videos[0]!.ready(); await settle(); await settle()
    const video = fixture.layer.video!
    assert.equal(video.paused, true)
    assert.equal(video.playCount, 0)
    fixture.show()
    assert.equal(video.paused, false)
    assert.equal(video.playCount, 1)
  } finally { fixture.cleanup() }
})

test('reduced motion or a hidden page commits a prepared video immediately without a fade timer', async () => {
  for (const motion of [{ reduced: true }, { hidden: true }]) {
    const state = { ...fixtureState({ mode: 'custom' }), customWallpapers: [customMedia('global', 'video')] } as AmphoreusState
    const fixture = installFixture(state, undefined, undefined, motion)
    try {
      fixture.videos[0]!.ready(); await settle(); await settle()
      assert.equal(fixture.layer.video, fixture.videos[0])
      assert.equal(fixture.layer.video!.style.opacity, '1')
      assert.equal(fixture.layer.video!.style.transition, 'none')
      assert.equal(fixture.timers.size, 0)
    } finally { fixture.cleanup() }
  }
})

test('reduced motion completing an image fade keeps the immediate role and cancels the delayed completion', async () => {
  const fixture = installFixture(fixtureState({ heroId: 'anaxa' }), 'session-a')
  try {
    assert.equal(fixture.body.dataset.amphoreusSeat, 'anaxa')
    fixture.images[0]!.resolve(); await settle()
    assert.equal(fixture.timers.size, 1)
    fixture.reduceMotion(); await settle()
    assert.equal(fixture.timers.size, 0)
    assert.equal(fixture.slot(1).dataset.active, '')
    fixture.controller.dispose(); fixture.runTimers(); await settle()
    assert.equal(fixture.slot(1).dataset.active, undefined)
  } finally { fixture.cleanup() }
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
  readonly mode?: 'none' | 'preset' | 'custom'
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
        mode: options.mode ?? 'preset',
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
  readonly videos: FakeVideo[] = []
  get video(): FakeVideo | undefined { return this.videos[0] }

  appendChild(video: FakeVideo): void { this.videos.push(video); video.parent = this }

  querySelectorAll<T>(selector: string): T[] {
    return (selector === 'video.amph-seat-video' ? this.videos : []) as T[]
  }

  querySelector<T>(selector: string): T | null {
    if (selector === 'video.amph-seat-video') return (this.video ?? null) as T | null
    const match = /data-slot="([01])"/u.exec(selector)
    return (match === null ? null : this.slots.get(Number(match[1]))) as T | null
  }
}

class FakeVideo extends FakeElement {
  className = ''; playsInline = false; disablePictureInPicture = false
  muted = false; loop = false; playbackRate = 1; paused = true
  loads = 0; playCount = 0; parent: FakeElement | undefined
  readyState = 0; videoWidth = 0; videoHeight = 0
  listeners = new Map<string, Set<() => void>>()
  attributes = new Map<string, string>()
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  load(): void { this.loads++ }
  pause(): void { this.paused = true }
  play(): Promise<void> { this.paused = false; this.playCount++; return Promise.resolve() }
  remove(): void { if (this.parent !== undefined) { const index = this.parent.videos.indexOf(this); if (index >= 0) this.parent.videos.splice(index, 1) } }
  addEventListener(type: string, callback: () => void): void { const set = this.listeners.get(type) ?? new Set(); set.add(callback); this.listeners.set(type, set) }
  removeEventListener(type: string, callback: () => void): void { this.listeners.get(type)?.delete(callback) }
  ready(): void { this.readyState = 2; this.videoWidth = 320; this.videoHeight = 180; for (const callback of [...this.listeners.get('loadeddata') ?? []]) callback() }
  fail(): void { for (const callback of [...this.listeners.get('error') ?? []]) callback() }
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

function installFixture(initialState: AmphoreusState, current: string | undefined, initialSeat?: string, motion: { reduced?: boolean; hidden?: boolean } = {}) {
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
  const videos: FakeVideo[] = []
  const timers = new Map<number, () => void>()
  const documentEvents = new EventTarget()
  const media = Object.assign(new EventTarget(), { matches: motion.reduced ?? false })
  const documentValue = {
    body,
    visibilityState: motion.hidden ? 'hidden' : 'visible',
    getElementById: (id: string) => id === 'amphoreus-wallpaper' ? layer : null,
    createElement: (tag: string) => { assert.equal(tag, 'video'); const video = new FakeVideo(); videos.push(video); return video },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  }
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
    value: documentValue,
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
      matchMedia: () => media,
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
    videos,
    timers,
    hide: () => { documentValue.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange')) },
    show: () => { documentValue.visibilityState = 'visible'; documentEvents.dispatchEvent(new Event('visibilitychange')) },
    reduceMotion: () => { media.matches = true; media.dispatchEvent(new Event('change')) },
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
