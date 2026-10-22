import { createNoise2D, disturbRipple, heartDistance, rippleGrid, smooth, stepRipple, type RippleGrid } from './code-ripple-math.ts'
import css from './code-ripple.module.css'

export interface CodeRippleOptions {
  readonly color: string
  readonly dark: boolean
  readonly intensity: number
  readonly interactive: boolean
  readonly static: boolean
  readonly blockedRects?: () => readonly Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>[]
}

export interface CodeRippleController {
  update(options: CodeRippleOptions): void
  dispose(): void
}

type Rgb = readonly [number, number, number]
type Heart = { readonly x: number; readonly y: number; readonly born: number }
interface GlState {
  readonly gl: WebGLRenderingContext
  readonly program: WebGLProgram
  readonly buffer: WebGLBuffer
  readonly textures: readonly WebGLTexture[]
  readonly grid: WebGLUniformLocation | null
  readonly cell: WebGLUniformLocation | null
  readonly atlasSize: WebGLUniformLocation | null
  readonly height: WebGLUniformLocation | null
  cols: number
  rows: number
}

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const FONT = 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace'
const TINTS = 8
const STEP = 1 / 60
const FRAME_MS = 1000 / 30
const VEIL_MS = 900
const PROTECTED_SELECTOR = '[data-composer-card], [data-amph-settings], [role="dialog"][aria-modal="true"], [data-amph-header]'
const READING_SELECTOR = '[data-conversation-content] :is(p, li, h1, h2, h3, h4, h5, h6, pre, table, blockquote, [class*="bubble"])'
const VERTEX = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }'
const FRAGMENT = `
precision highp float;
uniform sampler2D cells;
uniform sampler2D atlas;
uniform vec2 grid;
uniform vec2 cell;
uniform vec2 atlasSize;
uniform float height;
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, height - gl_FragCoord.y);
  vec2 index = floor(pixel / cell);
  vec4 data = texture2D(cells, (index + 0.5) / grid);
  if (data.b <= 0.0) discard;
  vec2 texel = floor(data.rg * 255.0 + 0.5) * cell + floor(pixel - index * cell) + 0.5;
  gl_FragColor = texture2D(atlas, texel / atlasSize) * data.b;
}`

function releaseGl(state: GlState, lose = false): void {
  const { gl } = state
  for (const texture of state.textures) gl.deleteTexture(texture)
  gl.deleteBuffer(state.buffer)
  gl.deleteProgram(state.program)
  if (lose) gl.getExtension('WEBGL_lose_context')?.loseContext()
}

function createGl(canvas: HTMLCanvasElement): GlState | null {
  let gl: WebGLRenderingContext | null
  try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }) }
  catch { return null }
  if (!gl) return null
  const shaders: WebGLShader[] = [], textures: WebGLTexture[] = []
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null
  let committed = false
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)
      if (!shader) return null
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null
    }
    program = gl.createProgram()
    if (!program) return null
    for (const shader of shaders) gl.attachShader(program, shader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)
    buffer = gl.createBuffer()
    if (!buffer) return null
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    if (position < 0) return null
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    for (const unit of [0, 1]) {
      const texture = gl.createTexture()
      if (!texture) return null
      textures.push(texture)
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.uniform1i(gl.getUniformLocation(program, 'cells'), 0)
    gl.uniform1i(gl.getUniformLocation(program, 'atlas'), 1)
    committed = true
    return { gl, program, buffer, textures, grid: gl.getUniformLocation(program, 'grid'), cell: gl.getUniformLocation(program, 'cell'),
      atlasSize: gl.getUniformLocation(program, 'atlasSize'), height: gl.getUniformLocation(program, 'height'), cols: 0, rows: 0 }
  } catch { return null }
  finally {
    for (const shader of shaders) gl.deleteShader(shader)
    if (!committed) {
      for (const texture of textures) gl.deleteTexture(texture)
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}

function vivid(color: Rgb): Rgb {
  const [red, green, blue] = color.map(value => value / 255) as [number, number, number]
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), chroma = max - min, lightness = (max + min) / 2
  if (!chroma) return color
  const sector = max === red ? ((green - blue) / chroma + 6) % 6 : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4
  const saturation = Math.max(chroma / (1 - Math.abs(2 * lightness - 1)), .62)
  const span = (1 - Math.abs(2 * lightness - 1)) * saturation, middle = span * (1 - Math.abs(sector % 2 - 1)), base = lightness - span / 2
  const rgb = sector < 1 ? [span, middle, 0] : sector < 2 ? [middle, span, 0] : sector < 3 ? [0, span, middle] : sector < 4 ? [0, middle, span] : sector < 5 ? [middle, 0, span] : [span, 0, middle]
  return rgb.map(value => Math.round((value + base) * 255)) as [number, number, number]
}

function normalized(options: CodeRippleOptions): CodeRippleOptions {
  return { ...options, intensity: Number.isFinite(options.intensity) ? Math.max(0, Math.min(1, options.intensity)) : .5 }
}

class RippleEngine implements CodeRippleController {
  readonly #container: HTMLElement
  readonly #document: Document
  readonly #window: Window
  readonly #motion: MediaQueryList
  readonly #abort = new AbortController()
  readonly #noise = createNoise2D()
  readonly #atlas: HTMLCanvasElement
  readonly #attributes: ReadonlyMap<string, string | null>
  #options: CodeRippleOptions
  #canvas: HTMLCanvasElement
  #gl: GlState | null = null
  #context: CanvasRenderingContext2D | null = null
  #observer: ResizeObserver
  #grid: RippleGrid = rippleGrid(1, 1, 1)
  #rect = { left: 0, top: 0, width: 1, height: 1 }
  #frame = 0
  #paintFrame = 0
  #veilTimer = 0
  #last = 0
  #clock = Math.random() * 900
  #draws = 0
  #lost = false
  #disposed = false
  #layoutDirty = true
  #atlasDirty = true
  #glyphs = new Uint8Array(0)
  #grain = new Float32Array(0)
  #ambient = new Float32Array(0)
  #cells = new Uint8Array(0)
  #clouds = new Float32Array(0)
  #veil = new Float32Array(0)
  #veilScratch = new Float32Array(0)
  #ambientAt = -Infinity
  #veilAt = -Infinity
  #height = new Float32Array(0)
  #previous = new Float32Array(0)
  #next = new Float32Array(0)
  #damping = new Float32Array(0)
  #waving = false
  #pending = 0
  #hearts: Heart[] = []
  #lastTap = { x: 0, y: 0, time: -Infinity, heart: false }
  #touches = new Map<number, { x: number; y: number; time: number }>()
  #nextDrop = 0
  #echo: { x: number; y: number; at: number; amount: number } | null = null
  #trail: { x: number; y: number; time: number } | null = null
  #reserve = .32
  #reserveAt = 0

  constructor(container: HTMLElement, options: CodeRippleOptions) {
    this.#container = container
    this.#document = container.ownerDocument
    this.#window = this.#document.defaultView ?? window
    this.#options = normalized(options)
    this.#attributes = new Map(['data-code-ripple-renderer', 'data-code-ripple-state', 'data-code-ripple-frame'].map(key => [key, container.getAttribute(key)]))
    this.#motion = this.#window.matchMedia('(prefers-reduced-motion: reduce)')
    this.#atlas = this.#document.createElement('canvas')
    this.#canvas = this.#newCanvas()
    this.#gl = createGl(this.#canvas)
    if (!this.#gl) this.#fallback()
    else container.setAttribute('data-code-ripple-renderer', 'webgl')
    this.#bindCanvas()
    const signal = this.#abort.signal
    this.#document.addEventListener('pointerdown', this.#pointerDown, { capture: true, passive: true, signal })
    this.#document.addEventListener('pointerup', this.#pointerUp, { capture: true, passive: true, signal })
    this.#document.addEventListener('pointercancel', this.#pointerCancel, { capture: true, passive: true, signal })
    this.#document.addEventListener('pointermove', this.#pointerMove, { passive: true, signal })
    this.#document.documentElement.addEventListener('pointerleave', this.#pointerLeave, { passive: true, signal })
    this.#document.addEventListener('visibilitychange', this.#visibility, { signal })
    this.#document.addEventListener('scroll', this.#scroll, { capture: true, passive: true, signal })
    this.#window.addEventListener('resize', this.#resize, { passive: true, signal })
    this.#motion.addEventListener('change', this.#motionChange, { signal })
    this.#observer = new ResizeObserver(this.#resize)
    this.#observer.observe(container)
    this.#paint(0)
    this.#sync()
  }

  update(options: CodeRippleOptions): void {
    if (this.#disposed) return
    const previous = this.#options
    const next = normalized(options)
    if (previous.color === next.color && previous.dark === next.dark && previous.intensity === next.intensity
      && previous.interactive === next.interactive && previous.static === next.static && previous.blockedRects === next.blockedRects) return
    this.#options = next
    if (previous.color !== options.color || previous.dark !== options.dark) this.#atlasDirty = true
    this.#ambientAt = -Infinity
    if (options.static || !options.interactive) { this.#touches.clear(); this.#trail = null }
    if (options.static) this.#calm()
    if (!this.#animated()) this.#paint(0)
    this.#sync()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#stop()
    this.#abort.abort()
    this.#observer.disconnect()
    this.#unbindCanvas()
    if (this.#gl) releaseGl(this.#gl, true)
    this.#gl = null
    this.#context = null
    this.#canvas.remove()
    this.#canvas.width = this.#canvas.height = 0
    this.#atlas.width = this.#atlas.height = 0
    this.#touches.clear()
    this.#hearts = []
    this.#glyphs = new Uint8Array(0)
    this.#cells = new Uint8Array(0)
    this.#height = this.#previous = this.#next = this.#damping = new Float32Array(0)
    this.#grain = this.#ambient = this.#clouds = this.#veil = this.#veilScratch = new Float32Array(0)
    for (const [key, value] of this.#attributes) {
      if (value === null) this.#container.removeAttribute(key)
      else this.#container.setAttribute(key, value)
    }
  }

  #newCanvas(): HTMLCanvasElement {
    const canvas = this.#document.createElement('canvas')
    canvas.className = css.canvas ?? ''
    canvas.setAttribute('aria-hidden', 'true')
    this.#container.append(canvas)
    return canvas
  }
  #bindCanvas(): void {
    this.#canvas.addEventListener('webglcontextlost', this.#contextLost)
    this.#canvas.addEventListener('webglcontextrestored', this.#contextRestored)
  }
  #unbindCanvas(): void {
    this.#canvas.removeEventListener('webglcontextlost', this.#contextLost)
    this.#canvas.removeEventListener('webglcontextrestored', this.#contextRestored)
  }
  #fallback(): void {
    this.#unbindCanvas()
    if (this.#gl) releaseGl(this.#gl)
    this.#gl = null
    this.#canvas.remove()
    this.#canvas.width = this.#canvas.height = 0
    this.#canvas = this.#newCanvas()
    try { this.#context = this.#canvas.getContext('2d') } catch { this.#context = null }
    this.#container.setAttribute('data-code-ripple-renderer', this.#context ? '2d' : 'unavailable')
    this.#layoutDirty = true
    this.#atlasDirty = true
    this.#lost = false
  }
  #contextLost = (event: Event): void => {
    if (this.#disposed) return
    event.preventDefault()
    this.#lost = true
    this.#stop()
    this.#sync()
  }
  #contextRestored = (): void => {
    if (this.#disposed) return
    if (this.#gl) releaseGl(this.#gl)
    this.#gl = createGl(this.#canvas)
    this.#lost = false
    if (!this.#gl) { this.#fallback(); this.#bindCanvas() }
    this.#atlasDirty = true
    this.#paint(0)
    this.#sync()
  }
  #visible(): boolean { return this.#document.visibilityState === 'visible' && this.#container.isConnected }
  #animated(): boolean {
    return !this.#disposed && !this.#lost && this.#visible() && !this.#motion.matches && !this.#options.static
      && this.#options.intensity > 0 && (this.#gl !== null || this.#context !== null)
  }
  #sync(): void {
    const running = this.#animated()
    if (running && !this.#frame) {
      this.#last = this.#window.performance.now()
      this.#frame = this.#window.requestAnimationFrame(this.#tick)
    } else if (!running) this.#stop()
    this.#container.setAttribute('data-code-ripple-state', this.#lost ? 'lost' : !this.#visible() ? 'paused'
      : this.#gl === null && this.#context === null ? 'unavailable' : running ? 'running' : 'static')
  }
  #stop(): void {
    if (this.#frame) this.#window.cancelAnimationFrame(this.#frame)
    if (this.#paintFrame) this.#window.cancelAnimationFrame(this.#paintFrame)
    if (this.#veilTimer) this.#window.clearTimeout(this.#veilTimer)
    this.#frame = this.#paintFrame = this.#veilTimer = 0
    this.#trail = null
    this.#touches.clear()
  }
  #visibility = (): void => { if (this.#visible()) { this.#layoutDirty = true; this.#paint(0) } this.#sync() }
  #motionChange = (): void => { if (this.#motion.matches) this.#calm(); this.#paint(0); this.#sync() }
  #resize = (): void => { this.#layoutDirty = true; this.#requestPaint() }
  #scroll = (): void => { this.#requestPaint() }
  #requestPaint(): void {
    if (this.#disposed || this.#lost || !this.#visible() || this.#frame || this.#paintFrame) return
    this.#paintFrame = this.#window.requestAnimationFrame(() => {
      this.#paintFrame = 0
      const previousVeil = this.#veilAt
      this.#paint(0)
      this.#sync()
      if (this.#veilAt === previousVeil && !this.#veilTimer && !this.#frame && this.#visible()) this.#veilTimer = this.#window.setTimeout(() => {
        this.#veilTimer = 0
        this.#paint(0)
      }, Math.max(0, VEIL_MS - (this.#window.performance.now() - this.#veilAt)))
    })
  }
  #tick = (now: number): void => {
    this.#frame = 0
    if (!this.#animated()) { this.#sync(); return }
    const elapsed = now - this.#last
    if (elapsed >= FRAME_MS) {
      this.#last = now
      const delta = Math.min(elapsed, 100) / 1000
      this.#clock += delta
      this.#rain()
      if (this.#waving) {
        this.#pending += delta
        let count = 0
        while (this.#pending >= STEP && count < 6 && this.#waving) {
          const g = this.#grid
          const peak = stepRipple(this.#height, this.#previous, this.#next, this.#damping, g.simCols, g.simRows, g.lambdaX, g.lambdaY)
          const previous = this.#previous; this.#previous = this.#height; this.#height = this.#next; this.#next = previous
          this.#pending -= STEP; count++
          if (peak < 1e-4) this.#calm()
        }
        if (count === 6) this.#pending = 0
      } else this.#pending = 0
      this.#paint(delta)
    }
    if (this.#animated()) this.#frame = this.#window.requestAnimationFrame(this.#tick)
  }

  #point(event: PointerEvent): { x: number; y: number } { return { x: event.clientX - this.#rect.left, y: event.clientY - this.#rect.top } }
  #interactive(): boolean { return this.#animated() && this.#options.interactive }
  #pointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || !this.#interactive()) return
    const point = this.#point(event)
    if (event.pointerType === 'mouse') { if (event.button === 0) this.#tap(point.x, point.y); return }
    this.#touches.set(event.pointerId, { ...point, time: this.#window.performance.now() })
  }
  #pointerUp = (event: PointerEvent): void => {
    const start = this.#touches.get(event.pointerId)
    if (!start) return
    this.#touches.delete(event.pointerId)
    const point = this.#point(event)
    if (this.#interactive() && Math.hypot(point.x - start.x, point.y - start.y) < 12 && this.#window.performance.now() - start.time < 600) this.#tap(point.x, point.y)
  }
  #pointerCancel = (event: PointerEvent): void => { this.#touches.delete(event.pointerId) }
  #pointerLeave = (): void => { this.#trail = null }
  #pointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || !this.#interactive()) return
    const now = this.#window.performance.now(), { x, y } = this.#point(event), last = this.#trail
    if (!last || now - last.time > 160) { this.#trail = { x, y, time: now }; return }
    const distance = Math.hypot(x - last.x, y - last.y)
    if (distance < 26) return
    this.#trail = { x, y, time: now }
    this.#reserve = Math.min(.32, this.#reserve + (now - this.#reserveAt) / 1000 * .07)
    this.#reserveAt = now
    const speed = distance / Math.max(8, now - last.time)
    const amount = Math.min(.08, .025 + speed * .05) * this.#reserve / .32
    if (amount < .008) return
    this.#reserve -= amount
    this.#disturb(x, y, amount)
  }
  #tap(x: number, y: number): void {
    const now = this.#window.performance.now(), last = this.#lastTap
    const heart = !last.heart && now - last.time < 480 && Math.hypot(x - last.x, y - last.y) < 96
    if (heart) { this.#hearts.push({ x, y, born: this.#clock }); if (this.#hearts.length > 4) this.#hearts.shift() }
    else this.#disturb(x, y, 1)
    this.#lastTap = { x, y, time: now, heart }
  }
  #disturb(x: number, y: number, amount: number): void {
    const g = this.#grid
    disturbRipple(this.#height, g.simCols, g.simRows, x * g.ratio / g.cellW + .5, y * g.ratio * 2 / g.cellH + .5, amount)
    this.#waving = true
  }
  #rain(): void {
    const echo = this.#echo
    if (echo && this.#clock >= echo.at) { this.#echo = null; this.#disturb(echo.x, echo.y, echo.amount) }
    if (!this.#nextDrop) { this.#nextDrop = this.#clock + .5 + Math.random() * 1.1; return }
    if (this.#clock < this.#nextDrop) return
    const { width, height } = this.#rect
    const sparse = Math.min(1.8, Math.max(1, Math.sqrt(1e6 / Math.max(1, width * height))))
    this.#nextDrop = this.#clock + (1.4 + Math.random() * 3) * sparse
    let x = 0
    for (let attempt = 0; attempt < 4; attempt++) { x = Math.random() * width; if (Math.random() < .3 + .7 * smooth(.16, .4, Math.abs(x / width - .5))) break }
    const y = height * (.06 + Math.random() * .88), amount = .22 + Math.random() * .18
    this.#disturb(x, y, amount)
    if (Math.random() < .22) {
      const angle = Math.random() * Math.PI * 2, reach = 24 + Math.random() * 52
      this.#echo = { x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach, at: this.#clock + .16 + Math.random() * .26, amount: amount * (.45 + Math.random() * .25) }
    }
  }
  #calm(): void {
    this.#height.fill(0); this.#previous.fill(0); this.#next.fill(0)
    this.#waving = false; this.#pending = 0; this.#hearts = []; this.#echo = null; this.#nextDrop = 0
    this.#lastTap = { x: 0, y: 0, time: -Infinity, heart: false }
  }

  #layout(): void {
    const rect = this.#container.getBoundingClientRect()
    this.#rect = { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
    const g = rippleGrid(rect.width, rect.height, this.#window.devicePixelRatio), old = this.#grid
    this.#layoutDirty = false
    if (this.#canvas.width !== g.width) this.#canvas.width = g.width
    if (this.#canvas.height !== g.height) this.#canvas.height = g.height
    if (this.#glyphs.length && g.cols === old.cols && g.rows === old.rows && g.ratio === old.ratio && g.cellW === old.cellW && g.cellH === old.cellH) return
    const count = g.cols * g.rows, glyphs = new Uint8Array(count), grain = new Float32Array(count)
    for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) {
      const at = row * g.cols + col, previous = row * old.cols + col
      glyphs[at] = row < old.rows && col < old.cols && this.#glyphs.length ? this.#glyphs[previous]! : Math.floor(Math.random() * GLYPHS.length)
      grain[at] = row < old.rows && col < old.cols && this.#grain.length ? this.#grain[previous]! : Math.random()
    }
    this.#grid = g
    this.#glyphs = glyphs; this.#grain = grain; this.#ambient = new Float32Array(count); this.#cells = new Uint8Array(count * 4)
    this.#veil = new Float32Array(count).fill(1); this.#veilScratch = new Float32Array(count); this.#clouds = new Float32Array(g.cols + 1)
    this.#ambientAt = -Infinity; this.#veilAt = -Infinity; this.#atlasDirty = true
    const simCount = g.simCols * g.simRows
    this.#height = new Float32Array(simCount); this.#previous = new Float32Array(simCount); this.#next = new Float32Array(simCount); this.#damping = new Float32Array(simCount)
    const fade = Math.exp(-STEP / 1.5)
    for (let row = 0; row < g.simRows; row++) for (let col = 0; col < g.simCols; col++) {
      const edge = Math.min(row, col, g.simRows - 1 - row, g.simCols - 1 - col)
      const sponge = edge >= 6 ? 0 : ((6 - edge) / 6) ** 2 * .12
      this.#damping[row * g.simCols + col] = fade * (1 - sponge)
    }
    this.#calm()
  }
  #paintAtlas(): void {
    const atlas = this.#atlas, g = this.#grid
    atlas.width = g.cellW * GLYPHS.length; atlas.height = g.cellH * TINTS
    const context = atlas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, atlas.width, atlas.height)
    context.fillStyle = '#68758c'
    context.fillStyle = this.#options.color
    context.fillRect(0, 0, 1, 1)
    const pixel = context.getImageData(0, 0, 1, 1).data
    const accent: Rgb = [pixel[0]!, pixel[1]!, pixel[2]!]
    const crest = vivid(accent), neutral = this.#options.dark ? 148 : 102
    const muted = accent.map(value => Math.round(value * .45 + neutral * .55))
    context.clearRect(0, 0, atlas.width, atlas.height)
    context.textAlign = 'center'; context.textBaseline = 'middle'
    for (let tint = 0; tint < TINTS; tint++) {
      const mix = tint / (TINTS - 1)
      context.fillStyle = `rgb(${muted.map((value, channel) => Math.round(value + (crest[channel]! - value) * mix)).join(' ')})`
      context.font = `${mix > .7 ? 600 : 400} ${Math.max(1, Math.round(12 * g.ratio))}px ${FONT}`
      for (let glyph = 0; glyph < GLYPHS.length; glyph++) context.fillText(GLYPHS[glyph]!, glyph * g.cellW + g.cellW / 2, tint * g.cellH + g.cellH / 2 + g.ratio * .5)
    }
    if (this.#gl) {
      const { gl, atlasSize } = this.#gl
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.#gl.textures[1]!)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.uniform2f(atlasSize, atlas.width, atlas.height)
    }
    this.#atlasDirty = false
  }
  #measureVeil(now: number): void {
    if (now - this.#veilAt < VEIL_MS) return
    this.#veilAt = now
    let blocks: readonly Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>[]
    try {
      if (this.#options.blockedRects) blocks = this.#options.blockedRects()
      else {
        const visible: DOMRect[] = []
        const candidates = [...this.#document.querySelectorAll(PROTECTED_SELECTOR), ...this.#document.querySelectorAll(READING_SELECTOR)]
        for (const node of candidates.slice(0, 512)) {
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0 || rect.bottom < this.#rect.top || rect.top > this.#rect.top + this.#rect.height
            || rect.right < this.#rect.left || rect.left > this.#rect.left + this.#rect.width) continue
          visible.push(rect)
          if (visible.length === 128) break
        }
        blocks = visible
      }
    }
    catch { blocks = [] }
    const g = this.#grid, cssW = g.cellW / g.ratio, cssH = g.cellH / g.ratio, mask = this.#veilScratch
    mask.fill(1)
    for (const block of blocks.slice(0, 128)) {
      if (![block.left, block.top, block.right, block.bottom].every(Number.isFinite)) continue
      const top = block.top - this.#rect.top - 12, bottom = block.bottom - this.#rect.top + 12
      if (bottom < 0 || top > this.#rect.height || block.right < this.#rect.left || block.left > this.#rect.left + this.#rect.width) continue
      const left = Math.max(0, Math.floor((block.left - this.#rect.left - 12) / cssW)), right = Math.min(g.cols - 1, Math.floor((block.right - this.#rect.left + 12) / cssW))
      const first = Math.max(0, Math.floor(top / cssH)), last = Math.min(g.rows - 1, Math.floor(bottom / cssH))
      for (let row = first; row <= last; row++) mask.fill(.4, row * g.cols + left, row * g.cols + right + 1)
    }
    const out = this.#veil
    for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) {
      let sum = 0, count = 0
      for (let step = -2; step <= 2; step++) { const at = col + step; if (at >= 0 && at < g.cols) { sum += mask[row * g.cols + at]!; count++ } }
      out[row * g.cols + col] = sum / count
    }
    for (let col = 0; col < g.cols; col++) {
      let above = out[col]!
      for (let row = 0; row < g.rows; row++) { const index = row * g.cols + col, here = out[index]!, below = row + 1 < g.rows ? out[index + g.cols]! : here; mask[index] = (above + here * 2 + below) / 4; above = here }
    }
    out.set(mask)
  }
  #computeAmbient(): void {
    const g = this.#grid, cssW = g.cellW / g.ratio, cssH = g.cellH / g.ratio, cloud = this.#clouds
    const clock = this.#clock, slow = clock * .024, quick = clock * .042, tide = clock * .011
    const level = (this.#options.dark ? .12 : .2) * this.#options.intensity
    for (let row = 0; row < g.rows; row++) {
      const y = (row + .5) * cssH
      for (let col = 0; col <= g.cols; col += 2) {
        const x = (col + .5) * cssW, bend = this.#noise(x / 1150 - tide, y / 940 + tide * .7)
        const bank = .68 * this.#noise(x / 620 + slow + bend * .62, y / 520 - slow * .6 + bend * .44) + .32 * this.#noise(x / 230 - quick + bend * .3, y / 200 + quick * .7)
        cloud[col] = .05 + .95 * smooth(-.02, .62, bank)
      }
      for (let col = 1; col < g.cols; col += 2) cloud[col] = (cloud[col - 1]! + cloud[col + 1]!) * .5
      for (let col = 0; col < g.cols; col++) this.#ambient[row * g.cols + col] = level * cloud[col]! * (.25 + .75 * this.#grain[row * g.cols + col]!)
    }
    this.#ambientAt = clock
  }
  #compose(delta: number): void {
    const clock = this.#clock, animate = delta > 0, g = this.#grid
    if (animate) {
      let flips = this.#glyphs.length * .04 * delta
      while (flips >= 1 || flips > 0 && Math.random() < flips) { this.#glyphs[Math.floor(Math.random() * this.#glyphs.length)] = Math.floor(Math.random() * GLYPHS.length); flips-- }
      this.#hearts = this.#hearts.filter(heart => clock - heart.born < 2.6)
    }
    if (clock - this.#ambientAt >= 1 / 15) this.#computeAmbient()
    this.#measureVeil(this.#window.performance.now())
    const cssW = g.cellW / g.ratio, cssH = g.cellH / g.ratio
    const waveLevel = (this.#options.dark ? .66 : .78) * this.#options.intensity
    const opening = Math.min(54, this.#rect.width * .12)
    const hearts = this.#hearts.map(heart => {
      const age = Math.max(0, clock - heart.born), size = opening + age * 170, width = 9 + age * 10, life = Math.max(0, 1 - age / 2.6), reach = width * 2.4
      return { x: heart.x, y: heart.y, size, width, reach, amp: .3 * life * life, bound: (1.12 * size + reach) ** 2 }
    })
    for (let row = 0; row < g.rows; row++) {
      let top = (2 * row + 1) * g.simCols + 1
      const y = (row + .5) * cssH
      for (let col = 0; col < g.cols; col++, top++) {
        const index = row * g.cols + col, clearing = this.#veil[index]!
        let alpha = this.#ambient[index]! * clearing, tint = 0, level = 0, motion = 0
        if (this.#waving) { const bottom = top + g.simCols; level = (this.#height[top]! + this.#height[bottom]!) * .5; motion = Math.abs(level - (this.#previous[top]! + this.#previous[bottom]!) * .5) }
        for (const heart of hearts) {
          const dx = (col + .5) * cssW - heart.x, dy = heart.y - y
          if (dx * dx + dy * dy > heart.bound) continue
          const distance = heartDistance(dx / heart.size, dy / heart.size - .075) * heart.size
          if (distance > heart.reach || distance < -6 * heart.width) continue
          const front = distance / heart.width
          let profile = Math.exp(-front * front)
          if (distance < 0) { const trough = (distance + 2.2 * heart.width) / (.9 * heart.width), echo = (distance + 4.4 * heart.width) / (.8 * heart.width); profile += .22 * Math.exp(-echo * echo) - .5 * Math.exp(-trough * trough) }
          level += heart.amp * profile; motion += heart.amp * profile * profile * .04
        }
        if (level > .0005) { tint = 1 - Math.exp(-level / .07); alpha += waveLevel * tint * (.55 + .45 * this.#grain[index]!) * (.4 + .6 * clearing) }
        else if (level < -.0005) alpha *= Math.exp(level / .07 * 1.4)
        if (animate && motion > .002 && Math.random() < Math.min(.25, motion * 6)) this.#glyphs[index] = Math.floor(Math.random() * GLYPHS.length)
        const out = index * 4
        if (alpha < .012) { this.#cells[out + 2] = 0; continue }
        this.#cells[out] = this.#glyphs[index]!
        this.#cells[out + 1] = Math.round(tint * (TINTS - 1))
        this.#cells[out + 2] = alpha > .92 ? 235 : Math.round(alpha * 255)
      }
    }
  }
  #paint(delta: number): void {
    if (this.#disposed || this.#lost || !this.#visible() || !this.#gl && !this.#context) return
    if (this.#layoutDirty) this.#layout()
    if (this.#atlasDirty) this.#paintAtlas()
    this.#compose(delta)
    const g = this.#grid, canvas = this.#canvas
    if (this.#gl) {
      const state = this.#gl, gl = state.gl
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.textures[0]!)
      if (state.cols !== g.cols || state.rows !== g.rows) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, g.cols, g.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.#cells)
        state.cols = g.cols; state.rows = g.rows
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.cols, g.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.#cells)
      gl.uniform2f(state.grid, g.cols, g.rows); gl.uniform2f(state.cell, g.cellW, g.cellH); gl.uniform1f(state.height, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    } else if (this.#context) {
      const context = this.#context
      context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.clearRect(0, 0, canvas.width, canvas.height)
      for (let row = 0, out = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++, out += 4) {
        const alpha = this.#cells[out + 2]!
        if (!alpha) continue
        context.globalAlpha = alpha / 255
        context.drawImage(this.#atlas, this.#cells[out]! * g.cellW, this.#cells[out + 1]! * g.cellH, g.cellW, g.cellH, col * g.cellW, row * g.cellH, g.cellW, g.cellH)
      }
    }
    this.#container.setAttribute('data-code-ripple-frame', String(++this.#draws))
  }
}

export function createCodeRipple(container: HTMLElement, options: CodeRippleOptions): CodeRippleController {
  return new RippleEngine(container, options)
}
