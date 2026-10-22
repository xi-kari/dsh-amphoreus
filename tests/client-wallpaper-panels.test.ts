import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import { CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS } from '../src/shared/api.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'
import { WALLPAPER_ACCEPT } from '../src/shared/wallpaper-media.ts'
import { en, zh } from '../src/client/locales.ts'

const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
function component(name: string, exported: string, environment: Record<string, any> = {}) {
  const exports: Record<string, any> = {}
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const code = transpileModule(readFileSync(new URL(`../src/client/${name}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, ...environment, require(specifier: string) {
    if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (specifier === 'react') return environment.react ?? { useRef: (value: any) => ({ current: value }), useState: (value: any) => [value, () => {}], useEffect: () => {} }
    if (specifier.endsWith('/api.ts')) return { CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS }
    if (specifier.endsWith('/heroes.ts')) return { HERO_VISUALS }
    if (specifier.endsWith('/wallpaper-media.ts')) return { WALLPAPER_ACCEPT }
    if (specifier.endsWith('/seat-model.ts')) return { seatColorOf: () => ({ accent: '#654321' }) }
    if (specifier.endsWith('/segmented-choice.tsx')) return { SegmentedChoice: 'segmented-choice' }
    if (specifier.endsWith('/image-preview.tsx')) return { ImagePreview: 'image-preview' }
    if (specifier.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) }
    throw new Error(specifier)
  } })
  return exports[exported]
}

test('global wallpaper can be selected from none and its actual input accepts image and video without first changing mode', () => {
  const render = component('background-panel', 'BackgroundPanel')
  const uploads: File[] = [], modes: string[] = []
  const tree = render({ mode: 'none', custom: undefined, busy: false, t: (key: keyof typeof zh) => zh[key], onMode: (mode: string) => modes.push(mode), onUpload: (file: File) => uploads.push(file), onRemove() {} })
  const input = flatten(tree).find(node => node.type === 'input' && node.props.type === 'file')
  assert.ok(input)
  assert.equal(input.props.accept, WALLPAPER_ACCEPT)
  assert.ok(input.props.accept.includes('video/mp4') && input.props.accept.includes('video/webm'))
  const file = new File(['video'], 'clip.webm')
  const target = { files: [file], value: 'clip.webm' }
  input.props.onChange({ currentTarget: target })
  assert.deepEqual(uploads, [file]); assert.deepEqual(modes, [])
  assert.equal(target.value, '')
})

test('global video renders a video preview instead of sending the file to an image element or image lightbox', () => {
  const render = component('background-panel', 'BackgroundPanel')
  const tree = render({ mode: 'custom', custom: { heroId: 'global', kind: 'video', url: '/video.webm' }, busy: false, t: (key: keyof typeof zh) => zh[key], onMode() {}, onUpload() {}, onRemove() {} })
  const nodes = flatten(tree)
  assert.equal(nodes.filter(node => node.type === 'video' && node.props.src === '/video.webm').length, 1)
  assert.equal(nodes.some(node => node.type === 'img' && node.props.src === '/video.webm'), false)
  assert.equal(nodes.find(node => node.type === 'image-preview').props.items.length, 0)
})

test('every role including Cyrene uploads to its own owner and renders video previews when configured', () => {
  const render = component('wallpaper-panel', 'WallpaperPanel')
  const uploads: [string, File][] = []
  const tree = render({ customWallpapers: [{ heroId: 'cyrene', kind: 'video', url: '/cyrene.webm', bytes: 99 }], seatNames: new Map(), busy: false,
    t: (key: keyof typeof zh) => zh[key], onUpload: (hero: string, file: File) => uploads.push([hero, file]), onRemove() {}, onPlacement() {} })
  const nodes = flatten(tree)
  const inputs = nodes.filter(node => node.type === 'input' && node.props.type === 'file')
  assert.equal(inputs.length, 13)
  for (const hero of HERO_VISUALS) {
    const input = inputs.find(node => node.props.id === `amphoreus-wp-${hero.heroId}`)
    assert.ok(input, hero.heroId)
    const file = new File(['png'], `${hero.heroId}.png`)
    input.props.onChange({ currentTarget: { files: [file], value: '' } })
    assert.deepEqual(uploads.at(-1), [hero.heroId, file])
  }
  assert.equal(nodes.filter(node => node.type === 'video' && node.props.src === '/cyrene.webm').length, 1)
  for (const key of ['settings.backgroundHint', 'settings.wallpaperHint', 'settings.backgroundUpload'] as const) { assert.ok(zh[key]); assert.ok(en[key]) }
})

function placementHarness(onPlacement: (hero: string, patch: any) => boolean | Promise<boolean>) {
  const hooks: any[] = [], timers = new Map<number, () => void>()
  let cursor = 0, id = 0, effects: Array<() => void> = [], tree: any
  const react = {
    useState(initial: any) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value: any) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
    useRef(initial: any) { const index = cursor++; return hooks[index] ??= { current: initial } },
    useEffect(callback: () => (() => void) | void, dependencies: any[]) {
      const index = cursor++
      if (!hooks[index] || dependencies.some((value, i) => value !== hooks[index].dependencies[i])) effects.push(() => {
        hooks[index]?.cleanup?.(); hooks[index] = { dependencies, cleanup: callback() }
      })
    },
  }
  const draw = component('wallpaper-panel', 'WallpaperPanel', { react, window: {
    setTimeout(callback: () => void) { const next = ++id; timers.set(next, callback); return next }, clearTimeout(timer: number) { timers.delete(timer) },
  } })
  let props = { customWallpapers: [{ heroId: 'cyrene', kind: 'video', url: '/cyrene.webm', bytes: 99, placement: CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS }],
    seatNames: new Map(), busy: false, t: (key: keyof typeof zh) => zh[key], onUpload() {}, onRemove() {}, onPlacement }
  function render(patch: Partial<typeof props> = {}) {
    props = { ...props, ...patch }; cursor = 0; effects = []
    tree = draw(props)
    for (const effect of effects) effect()
    return tree
  }
  function find(predicate: (node: any) => boolean) { const node = flatten(tree).find(predicate); assert.ok(node); return node.props }
  render()
  find(node => node.type === 'button' && node.props.children === zh['settings.wallpaperAdjust']).onClick()
  render()
  return { render, find, timers, nodes: () => flatten(tree),
    fire() { for (const [key, callback] of [...timers]) { timers.delete(key); callback() } },
    cleanup() { for (const hook of hooks) hook?.cleanup?.() },
  }
}

const settle = async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve() }

test('queued placement survives another busy action and all persisted media controls are disabled until it ends', async () => {
  const calls: any[] = []
  const h = placementHarness((hero, patch) => { calls.push([hero, patch]); return true })
  try {
    h.find(node => node.props.id === 'amphoreus-wp-cyrene-x').onChange({ currentTarget: { value: '27' } })
    h.render({ busy: true })
    h.fire(); await settle()
    assert.equal(calls.length, 0)
    assert.equal(h.find(node => node.props.id === 'amphoreus-wp-cyrene-x').value, 27)
    for (const node of h.nodes().filter(node => node.type === 'input')) assert.equal(node.props.disabled, true)
    assert.equal(h.find(node => node.type === 'button' && node.props.children === zh['settings.wallpaperResetPlacement']).disabled, true)
    h.render({ busy: false }); await settle()
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['cyrene', { x: 27 }]])
  } finally { h.cleanup() }
})

test('a placement refused by the settings action keeps its draft until the busy cycle permits acceptance', async () => {
  const calls: any[] = []
  let accept = false
  const h = placementHarness((_hero, patch) => { calls.push(patch); return accept })
  try {
    h.find(node => node.props.id === 'amphoreus-wp-cyrene-scale').onChange({ currentTarget: { value: '1.5' } })
    h.fire(); await settle(); h.render()
    assert.equal(calls.length, 1)
    assert.equal(h.find(node => node.props.id === 'amphoreus-wp-cyrene-scale').value, 1.5)
    h.render({ busy: true }); accept = true; h.render({ busy: false }); h.fire(); await settle()
    assert.equal(calls.length, 2)
    assert.equal(calls[1].scale, 1.5)
  } finally { h.cleanup() }
})

test('a refused placement retries after a batched busy cycle that never rendered a changed busy prop', async () => {
  const calls: any[] = []
  const h = placementHarness((_hero, patch) => { calls.push(patch); return calls.length > 1 })
  try {
    h.find(node => node.props.id === 'amphoreus-wp-cyrene-x').onChange({ currentTarget: { value: '33' } })
    h.fire(); await settle()
    assert.equal(calls.length, 1)
    assert.equal(h.timers.size, 1)
    h.fire(); await settle()
    assert.equal(calls.length, 2)
    assert.equal(calls[1].x, 33)
    assert.equal(h.timers.size, 0)
  } finally { h.cleanup() }
})

test('placement reset cancels an older slider debounce and unmount prevents remaining delayed writes', async () => {
  const calls: any[] = []
  const h = placementHarness((_hero, patch) => { calls.push(patch); return true })
  h.find(node => node.props.id === 'amphoreus-wp-cyrene-x').onChange({ currentTarget: { value: '18' } })
  h.find(node => node.type === 'button' && node.props.children === zh['settings.wallpaperResetPlacement']).onClick()
  await settle(); h.fire(); await settle()
  assert.deepEqual(calls, [null])
  h.find(node => node.props.id === 'amphoreus-wp-cyrene-y').onChange({ currentTarget: { value: '9' } })
  h.cleanup(); h.fire(); await settle()
  assert.deepEqual(calls, [null])
})
