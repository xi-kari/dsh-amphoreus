/*
 * Vendored from liangmianya/dsh-synapse v0.4.1 (MIT) — app.js, the canvas single page.
 * Adapted for dsh-amphoreus: routes moved to /amphoreus/workbench/api, bridge source renamed to
 * dsh-amphoreus, message types renamed synapse:* -> amphoreus:*. See NOTICE for the original license.
 */
const app = document.querySelector('#app')
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
const DEFAULT_QUICK_PHRASES = ['展开说明', '举例', '通俗易懂', '对比解释']
const MAX_QUICK_PHRASES = 12
const MAX_QUICK_PHRASE_LENGTH = 16
function normalizeQuickPhrases(value) {
  if (!Array.isArray(value)) return []
  const phrases = []
  for (const item of value) {
    const phrase = typeof item === 'string' ? item.trim().slice(0, MAX_QUICK_PHRASE_LENGTH) : ''
    if (phrase !== '' && !phrases.includes(phrase)) phrases.push(phrase)
    if (phrases.length === MAX_QUICK_PHRASES) break
  }
  return phrases
}
function storedSeat(value) {
  try { return value === undefined ? localStorage.getItem('dsh-amphoreus:last-seat') : (localStorage.setItem('dsh-amphoreus:last-seat', value), value) } catch { return null }
}
const restoredSeatId = (() => {
  const value = storedSeat()
  const heroId = typeof value === 'string' && value.startsWith('seat:') ? value.slice(5) : null
  return value === 'all' || heroId !== null && heroId !== 'null' && /^[a-z0-9][a-z0-9-]*$/.test(heroId) ? value : null
})()
const BOOT = (typeof globalThis.__AMPHOREUS_BOOT__ === 'object' && globalThis.__AMPHOREUS_BOOT__ !== null) ? globalThis.__AMPHOREUS_BOOT__ : {}
const WORKBENCH_CONFIG = BOOT.workbench ?? { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true }
const CARD_WIDTH = 310
const CARD_HEIGHT = 276
const CARD_GAP_Y = 42
const CAMERA_INSET_X = 56
const CAMERA_INSET_Y = 56
const THEME_TOKEN_NAME_RE = /^--dsw-(?:alias|specific)-[a-z0-9-]{1,64}$/
const THEME_TOKEN_VALUE_RE = /^[#a-zA-Z0-9(),.%\s\/-]{1,120}$/
const THEME_TOKEN_NON_COLOR_RE = /\b(?:url|var|image(?:-set)?|cross-fade|element|(?:repeating-)?(?:linear|radial|conic)-gradient)\s*\(/i
const MAX_BRIDGED_THEME_TOKENS = 87
let appliedThemeTokens = []

function trustedThemeTokenEvent(event) {
  return event.source === window.parent
    && event.origin === window.location.origin
    && event.data?.source === 'dsh-amphoreus'
}

function validThemeTokenValue(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return THEME_TOKEN_VALUE_RE.test(normalized)
    && !THEME_TOKEN_NON_COLOR_RE.test(normalized)
    && typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('color', normalized)
}

function applyThemeTokensMessage(data) {
  if (typeof data?.dark !== 'boolean') return false
  const tokens = data.tokens
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) return false
  const entries = Object.entries(tokens)
  if (entries.length > MAX_BRIDGED_THEME_TOKENS) return false
  const next = []
  for (const [name, value] of entries) {
    if (!THEME_TOKEN_NAME_RE.test(name) || !validThemeTokenValue(value)) continue
    next.push([name, value.trim()])
  }
  const root = document.documentElement
  for (const name of appliedThemeTokens) root.style.removeProperty(name)
  appliedThemeTokens = []
  for (const [name, value] of next) {
    root.style.setProperty(name, value)
    appliedThemeTokens.push(name)
  }
  root.dataset.theme = data.dark ? 'dark' : 'light'
  root.style.colorScheme = data.dark ? 'dark' : 'light'
  return true
}
// Cards outside the viewport (plus this world-space margin) are not mounted
// into the DOM; the margin pre-mounts cards just before they scroll into view
// so panning never flashes empty space.
const VIEWPORT_MARGIN = 1400
const state = {
  index: new Map(), indexRevision: 0, indexRequest: 0, eventSource: null, persistenceHydrated: false, bootstrapped: false, mapOpenPending: false, workspace: null, activeId: null, selectedCardId: null, mode: restoredSeatId === null ? 'portal' : 'canvas', zoom: 1, currentDsh: null, currentSessionId: null, sidebarCollapsed: false,
  // Seat portal: hero seats from the host (chronicle art, palette, folder).
  seats: [], sessionsById: new Map(), assetsConfigured: false, seatId: restoredSeatId, cardFlightPending: false, cardTextLimit: WORKBENCH_CONFIG.cardTextLimit, magazineMode: 'light',
  unprojectable: new Map(),
  historyBySession: new Map(), historyRevisionBySession: new Map(), historyCompleteBySession: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(),
  draft: null, error: '', branchAnchors: new Map(), cardPositions: new Map(), legacyPositionKeys: new Set(), collapsedCardIds: new Set(), quickPhrases: [...DEFAULT_QUICK_PHRASES], quickPhraseEditorOpen: false,
  dragging: false, canvasGesture: false, canvasRefreshAfter: 0, canvasViewInitialized: false, canvasCamera: { x: 0, y: 0 }, mapCardSessionSwitches: new Set(),
  expandedMessageIds: new Set(),
  canvasCards: undefined, canvasCardsById: undefined, canvasGraph: undefined, mountedCardIds: new Set(), canvasNeedsCenter: false,
  detailScrollByThread: new Map(), detailThreadId: null, detailTargetCardId: null,
  inspectorCardId: null, inspectorOpening: false, inspectorScrollByCard: new Map(),
}
if (document.documentElement) document.documentElement.dataset.magazine = state.magazineMode

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const currentThread = () => state.workspace?.threads.find(thread => thread.id === state.activeId) ?? state.workspace?.threads[0] ?? null
const threadListTitle = thread => thread.dshSessionTitle ?? thread.title ?? questionFor(thread)

const canvasDirty = new Set()
const canvasPendingPayloads = new Set()
let canvasTimer = 0
let canvasSaveChain = Promise.resolve()
let canvasLastOperation = Promise.resolve()
let canvasRevisionCounter = 0
let lastCanvasRevision = 0

function nextCanvasRevision() {
  const revision = Math.max(lastCanvasRevision + 1, Date.now() * 1000 + canvasRevisionCounter++)
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('画布写入版本已超出安全整数范围')
  lastCanvasRevision = revision
  return revision
}

function sessionOfCardId(cardId) {
  const index = cardId.indexOf(':turn')
  return index === -1 ? null : cardId.slice(0, index)
}

function persistablePositionKey(id) {
  const sessionId = sessionOfCardId(id)
  if (sessionId === null) return false
  const suffix = id.slice(sessionId.length)
  return /^:turn:\d+$/.test(suffix) || /^:turn-index:\d+$/.test(suffix) && state.legacyPositionKeys.has(id)
}

function canvasRecordFor(sessionId) {
  const positions = {}
  for (const [id, position] of state.cardPositions) {
    if (sessionOfCardId(id) === sessionId && persistablePositionKey(id)) positions[id] = position
  }
  const collapsed = [...state.collapsedCardIds].filter(id => sessionOfCardId(id) === sessionId)
  const branchAnchors = {}
  const anchor = state.branchAnchors.get(sessionId)
  if (anchor !== undefined) {
    const parent = sessionOfCardId(anchor)
    const seq = Number(anchor.slice(anchor.lastIndexOf(':') + 1))
    if (parent !== null && Number.isInteger(seq) && seq >= 0) branchAnchors[parent] = seq
  }
  return { positions, collapsed, branchAnchors }
}

function canvasWrite(sessionId, body, revision, keepalive = false) {
  return api(`/amphoreus/api/canvas/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    body,
    keepalive,
    headers: { 'x-amphoreus-canvas-revision': String(revision) },
  })
}

function persistenceUnavailableError() {
  return new Error('画布持久化状态尚未加载')
}

function flushCanvasSaves() {
  if (!state.persistenceHydrated) return Promise.reject(persistenceUnavailableError())
  if (canvasTimer !== 0) window.clearTimeout(canvasTimer)
  canvasTimer = 0
  const payloads = [...canvasDirty].map(sessionId => ({ sessionId, body: JSON.stringify(canvasRecordFor(sessionId)), revision: nextCanvasRevision() }))
  canvasDirty.clear()
  if (payloads.length === 0) return canvasLastOperation
  for (const payload of payloads) canvasPendingPayloads.add(payload)
  const operation = canvasSaveChain.then(async () => {
    let firstError
    for (const payload of payloads) {
      try {
        await canvasWrite(payload.sessionId, payload.body, payload.revision)
      } catch (error) {
        canvasDirty.add(payload.sessionId)
        firstError ??= error
      } finally {
        canvasPendingPayloads.delete(payload)
      }
    }
    if (firstError !== undefined) throw firstError
  })
  canvasLastOperation = operation
  canvasSaveChain = operation.catch(() => {})
  return operation
}

function scheduleCanvasSave(sessionId) {
  if (sessionId === null) return
  if (!state.persistenceHydrated) throw persistenceUnavailableError()
  canvasDirty.add(sessionId)
  if (canvasTimer !== 0) return
  canvasTimer = window.setTimeout(() => {
    canvasTimer = 0
    void flushCanvasSaves().catch(setError)
  }, 400)
}

function flushCanvasKeepalive() {
  if (!state.persistenceHydrated) return
  if (canvasTimer !== 0) window.clearTimeout(canvasTimer)
  canvasTimer = 0
  const payloads = new Map([...canvasPendingPayloads].map(payload => [payload.sessionId, { body: payload.body, revision: payload.revision }]))
  for (const sessionId of canvasDirty) payloads.set(sessionId, { body: JSON.stringify(canvasRecordFor(sessionId)), revision: nextCanvasRevision() })
  canvasDirty.clear()
  for (const [sessionId, payload] of payloads) {
    void canvasWrite(sessionId, payload.body, payload.revision, true).catch(() => { canvasDirty.add(sessionId) })
  }
}

function rememberBranchAnchor(sessionId, cardId) {
  state.branchAnchors.set(sessionId, cardId)
  scheduleCanvasSave(sessionId)
}

function persistCardPositions(cardIds = [...state.cardPositions.keys()]) {
  const sessionIds = cardIds.filter(persistablePositionKey).map(sessionOfCardId)
  for (const sessionId of new Set(sessionIds)) scheduleCanvasSave(sessionId)
}

function persistCollapsedCards(cardId) {
  scheduleCanvasSave(sessionOfCardId(cardId))
}

let quickPhraseSaveChain = Promise.resolve()
function persistQuickPhrases() {
  if (!state.persistenceHydrated) {
    const operation = Promise.reject(persistenceUnavailableError())
    void operation.catch(setError)
    return operation
  }
  const quickPhrases = [...state.quickPhrases]
  const operation = quickPhraseSaveChain.then(() => api('/amphoreus/api/prefs', { method: 'PUT', body: JSON.stringify({ quickPhrases }) }))
  quickPhraseSaveChain = operation.catch(setError)
  return quickPhraseSaveChain
}

function rememberCardPosition(cardId, position, aliases = []) {
  state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
  for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
  persistCardPositions([cardId, ...aliases])
}

function resetCardPositions() {
  const sessionIds = new Set([...state.cardPositions.keys()].map(sessionOfCardId))
  state.cardPositions.clear()
  state.legacyPositionKeys.clear()
  for (const sessionId of sessionIds) scheduleCanvasSave(sessionId)
}

function resetCanvasCamera() {
  state.canvasViewInitialized = false
  state.canvasCamera = { x: 0, y: 0 }
}

async function api(path, options = {}) {
  const method = String(options.method ?? 'GET').toUpperCase()
  const write = method !== 'GET' && method !== 'HEAD'
  const nonceHeader = write && typeof BOOT.nonce === 'string' ? { 'x-amphoreus-nonce': BOOT.nonce } : {}
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...nonceHeader, ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 403 && body.error === 'invalid amphoreus nonce') throw new Error('工作台令牌已失效（宿主已重启），请刷新页面')
    throw new Error(body.error ?? '请求失败')
  }
  return body
}

function legacyQuickPhraseCandidates() {
  let amphoreus = null
  let synapse = null
  try { amphoreus = localStorage.getItem('dsh-amphoreus:quick-phrases:v1') } catch { /* Storage may be unavailable. */ }
  try { synapse = localStorage.getItem('dsh-synapse:quick-phrases:v1') } catch { /* Storage may be unavailable. */ }
  return [amphoreus, synapse]
}

function parseLegacyQuickPhrases(raw) {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) && value.every(item => typeof item === 'string') ? normalizeQuickPhrases(value) : null
  } catch { return null }
}

async function hydrateBootState(bootState) {
  if (typeof bootState !== 'object' || bootState === null || !Array.isArray(bootState.canvas)
    || typeof bootState.prefs !== 'object' || bootState.prefs === null || !Array.isArray(bootState.prefs.quickPhrases)
    || !bootState.prefs.quickPhrases.every(phrase => typeof phrase === 'string')
    || bootState.prefs.quickPhrasesInitialized !== undefined && typeof bootState.prefs.quickPhrasesInitialized !== 'boolean') {
    throw new Error('持久化状态响应无效')
  }
  state.cardPositions.clear()
  state.legacyPositionKeys.clear()
  state.collapsedCardIds.clear()
  state.branchAnchors.clear()
  for (const item of bootState.canvas) {
    if (typeof item?.sessionId !== 'string' || typeof item.value !== 'object' || item.value === null
      || typeof item.value.positions !== 'object' || item.value.positions === null || Array.isArray(item.value.positions)
      || !Array.isArray(item.value.collapsed)
      || typeof item.value.branchAnchors !== 'object' || item.value.branchAnchors === null || Array.isArray(item.value.branchAnchors)) {
      throw new Error('画布持久化记录无效')
    }
    for (const [cardId, position] of Object.entries(item.value.positions ?? {})) {
      if (typeof position?.x !== 'number' || !Number.isFinite(position.x) || typeof position.y !== 'number' || !Number.isFinite(position.y)) throw new Error('画布坐标无效')
      state.cardPositions.set(cardId, { x: position.x, y: position.y })
      if (cardId.includes(':turn-index:')) state.legacyPositionKeys.add(cardId)
    }
    for (const cardId of Array.isArray(item.value.collapsed) ? item.value.collapsed : []) {
      if (typeof cardId !== 'string') throw new Error('画布折叠记录无效')
      state.collapsedCardIds.add(cardId)
    }
    for (const [parentSessionId, userSeq] of Object.entries(item.value.branchAnchors ?? {})) {
      if (!Number.isInteger(userSeq) || userSeq < 0) throw new Error('画布分支锚点无效')
      state.branchAnchors.set(item.sessionId, `${parentSessionId}:turn:${userSeq}`)
    }
  }

  const storedPhrases = Array.isArray(bootState?.prefs?.quickPhrases) ? bootState.prefs.quickPhrases : []
  const initialized = bootState?.prefs?.quickPhrasesInitialized === true
  if (initialized || storedPhrases.length > 0) {
    state.quickPhrases = normalizeQuickPhrases(storedPhrases)
    if (!initialized) {
      try {
        await api('/amphoreus/api/prefs', { method: 'PUT', body: JSON.stringify({ quickPhrases: state.quickPhrases }) })
      } catch (error) { setError(error) }
    }
  } else {
    state.quickPhrases = [...DEFAULT_QUICK_PHRASES]
    const [amphoreus, synapse] = legacyQuickPhraseCandidates()
    const migrated = parseLegacyQuickPhrases(amphoreus) ?? parseLegacyQuickPhrases(synapse)
    if (migrated !== null) {
      try {
        await api('/amphoreus/api/prefs', { method: 'PUT', body: JSON.stringify({ quickPhrases: migrated }) })
        state.quickPhrases = migrated
        try { localStorage.removeItem('dsh-amphoreus:quick-phrases:v1') } catch { /* Storage may be unavailable. */ }
        try { localStorage.removeItem('dsh-synapse:quick-phrases:v1') } catch { /* Storage may be unavailable. */ }
      } catch (error) { setError(error) }
    }
  }
  state.persistenceHydrated = true
}

function post(type, payload = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'dsh-amphoreus', type, ...payload }, window.location.origin)
}

function optionalSafeInteger(value) {
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

async function openDshSession(sessionId, seqValue, turnValue) {
  const seq = optionalSafeInteger(seqValue)
  const turn = optionalSafeInteger(turnValue)
  await flushCanvasSaves()
  post('amphoreus:open-session', { sessionId, seq, turn })
}

function dshRpc(type, payload = {}) {
  if (window.parent === window) return Promise.reject(new Error('请从 DSH 页面打开 Synapse 后再操作会话'))
  const requestId = crypto.randomUUID()
  post(type, { requestId, ...payload })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pendingRpc.delete(requestId)
      reject(new Error('DSH 未在规定时间内响应'))
    }, 20_000)
    state.pendingRpc.set(requestId, { resolve, reject, timer })
  })
}

function settleRpc(requestId, value, error) {
  const pending = state.pendingRpc.get(requestId)
  if (pending === undefined) return
  state.pendingRpc.delete(requestId)
  window.clearTimeout(pending.timer)
  if (error === undefined) pending.resolve(value)
  else pending.reject(error instanceof Error ? error : new Error(String(error)))
}

function setError(error = '') { state.error = error instanceof Error ? error.message : error; render() }

function canReplaceView() {
  return state.draft === null && !state.dragging && !state.canvasGesture && Date.now() >= state.canvasRefreshAfter && !document.activeElement?.matches('textarea')
}

function deferCanvasRefresh(delay = 700) {
  state.canvasRefreshAfter = Math.max(state.canvasRefreshAfter, Date.now() + delay)
}

function seatForCurrentView() {
  const heroId = state.seatId !== null && state.seatId.startsWith('seat:') ? state.seatId.slice(5) : null
  return heroId === null ? undefined : state.seats.find(item => item.heroId === heroId)
}

function motifUrlForSeat(seat, dark) {
  if (seat?.motif === null || typeof seat?.motif !== 'object') return 'none'
  const value = dark ? seat.motif.dark : seat.motif.light
  return typeof value === 'string' && value.startsWith('url("data:image/svg+xml;utf8,') ? value : 'none'
}

function syncCurrentMotif(dark) {
  document.querySelector('.main-stage')?.style.setProperty('--amphoreus-motif-url', motifUrlForSeat(seatForCurrentView(), dark))
}

function currentDshThread(threads = state.workspace?.threads ?? []) {
  const id = state.currentSessionId
  return typeof id === 'string' ? threads.find(thread => thread.dshSessionId === id) : undefined
}

function normalizeDir(value) {
  return typeof value === 'string' && value !== '' ? value.toLowerCase().replaceAll('/', '\\').replace(/\\+$/, '') : null
}

function heroIdOf(session) {
  if (session === undefined || session === null) return null
  if (typeof session.skillName === 'string') {
    const seatBySkill = state.seats.find(seat => seat.skillName === session.skillName)
    if (typeof seatBySkill?.heroId === 'string' && seatBySkill.heroId !== '') return seatBySkill.heroId
  }
  const cwd = normalizeDir(session.cwd)
  if (cwd === null) return null
  const seatByDir = state.seats.find(seat => {
    const dir = normalizeDir(seat.dir)
    return dir !== null && (cwd === dir || cwd.startsWith(`${dir}\\`))
  })
  return typeof seatByDir?.heroId === 'string' && seatByDir.heroId !== '' ? seatByDir.heroId : null
}

function seatKeyOf(seatId) { return seatId === 'all' ? 'all' : typeof seatId === 'string' && seatId.startsWith('seat:') ? seatId.slice(5) : 'all' }
function isHidden(sessionId) { return state.index.get(sessionId)?.hidden === true }
function sameSeat(sessionId, seatKey) {
  const session = state.sessionsById.get(sessionId)
  return session !== undefined && (heroIdOf(session) ?? 'all') === seatKey
}
function seatSessionCount(heroId) {
  const key = heroId ?? 'all'
  return [...state.sessionsById.values()].filter(session => (heroIdOf(session) ?? 'all') === key && !isHidden(session.id)).length
}

function rebuildWorkspace() {
  const seatId = state.seatId
  if (seatId === null) return
  const seatKey = seatKeyOf(seatId)
  const threads = [...state.sessionsById.values()]
    .filter(session => (heroIdOf(session) ?? 'all') === seatKey && !isHidden(session.id))
    .map(session => {
      const indexed = state.index.get(session.id)
      return {
        id: session.id,
        dshSessionId: session.id,
        title: session.title,
        dshSessionTitle: indexed?.title ?? session.title,
        parentId: session.parentId !== null && sameSeat(session.parentId, seatKey) && !isHidden(session.parentId) ? session.parentId : null,
        sourceParentSessionId: session.parentId,
        sourceSeedLength: indexed?.inheritedCount ?? null,
        cards: indexed?.cards ?? [],
        skillName: session.skillName,
        face: session.face,
        running: session.running,
      }
    })
  state.workspace = { id: seatId, title: seatTitleOf(seatId), threads }
  state.activeId = threads.some(thread => thread.id === state.activeId)
    ? state.activeId
    : currentDshThread(threads)?.id ?? threads[0]?.id ?? null
}

function applyWorkspaces(data) {
  state.seats = (Array.isArray(data.seats) ? data.seats : []).filter(seat => seat !== null && typeof seat === 'object')
  state.assetsConfigured = data.assetsConfigured === true
  state.sessionsById = new Map((Array.isArray(data.sessions) ? data.sessions : []).filter(session => typeof session?.id === 'string').map(session => [session.id, session]))
  if (state.seatId?.startsWith('seat:') && state.seats.length > 0 && !state.seats.some(seat => seat.heroId === state.seatId.slice(5))) {
    state.seatId = null
    state.mode = 'portal'
    state.workspace = null
  }
  rebuildWorkspace()
  scheduleViewRefresh()
}

let deferredViewTimer = 0
function scheduleViewRefresh() {
  if (canReplaceView()) {
    if (deferredViewTimer !== 0) window.clearTimeout(deferredViewTimer)
    deferredViewTimer = 0
    render()
    return
  }
  if (deferredViewTimer !== 0) return
  deferredViewTimer = window.setTimeout(() => {
    deferredViewTimer = 0
    scheduleViewRefresh()
  }, 120)
}

async function refreshIndex() {
  if (document.hidden) return false
  const request = ++state.indexRequest
  const body = await api('/amphoreus/workbench/api/index?includeHidden=1')
  const revision = Number(body.revision)
  if (request < state.indexRequest && revision <= state.indexRevision) return false
  if (revision < state.indexRevision) return false
  state.index = new Map((Array.isArray(body.sessions) ? body.sessions : []).filter(session => typeof session?.sessionId === 'string').map(session => [session.sessionId, session]))
  state.indexRevision = Number.isSafeInteger(revision) ? revision : state.indexRevision
  state.unprojectable = new Map((Array.isArray(body.unprojectable) ? body.unprojectable : []).filter(item => typeof item?.sessionId === 'string').map(item => [item.sessionId, item]))
  if (state.seatId !== null) rebuildWorkspace()
  if (canReplaceView()) render()
  return true
}

function openNewSession() {
  if (!state.persistenceHydrated) return setError(persistenceUnavailableError())
  if (state.draft !== null) return
  state.mode = 'canvas'
  state.activeId = null
  state.selectedCardId = null
  state.inspectorCardId = null
  state.inspectorOpening = false
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'new', text: '', sending: false }
  state.error = ''
  resetCanvasCamera()
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function archiveThread(thread) {
  if (!window.confirm(`归档画布中的「${thread.title}」及其分支？DSH 原会话会保留，可在 DSH 内继续查看。`)) return
  const result = await api(`/amphoreus/workbench/api/index/${thread.dshSessionId}`, { method: 'DELETE' })
  const hidden = Array.isArray(result.hidden) ? result.hidden.filter(id => typeof id === 'string') : []
  for (const sessionId of hidden) {
    const indexed = state.index.get(sessionId)
    state.index.set(sessionId, indexed === undefined
      ? { sessionId, hidden: true, cards: [] }
      : { ...indexed, hidden: true })
    state.historyBySession.delete(sessionId)
    state.historyRevisionBySession.delete(sessionId)
    state.historyCompleteBySession.delete(sessionId)
    state.liveReplies.delete(sessionId)
    state.pendingReplies.delete(sessionId)
    state.detailScrollByThread.delete(sessionId)
    if (state.detailThreadId === sessionId) state.detailTargetCardId = null
  }
  if (Number.isSafeInteger(result.revision)) state.indexRevision = result.revision
  for (const key of [...state.cardPositions.keys()]) {
    if (!hidden.some(sessionId => key.startsWith(`${sessionId}:`))) continue
    state.cardPositions.delete(key)
    state.legacyPositionKeys.delete(key)
  }
  for (const key of [...state.collapsedCardIds]) {
    if (!hidden.some(sessionId => key.startsWith(`${sessionId}:`))) continue
    state.collapsedCardIds.delete(key)
  }
  for (const sessionId of hidden) {
    state.branchAnchors.delete(sessionId)
    scheduleCanvasSave(sessionId)
  }
  rebuildWorkspace()
  render()
  await flushCanvasSaves()
}

function focusDraftInput() {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement)) return
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
}

function openContinue(parent, anchorId = undefined, text = '') {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'continue', parentId: parent.id, anchorId, text, sending: false }
  render()
  window.setTimeout(focusDraftInput, 0)
}

function openBranch(parent, atSeq = undefined, anchorId = undefined) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'branch', parentId: parent.id, atSeq, anchorId, text: '', sending: false }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function sendMessage(thread, text) {
  if (thread.dshSessionId === null) throw new Error('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(thread.dshSessionId)) throw new Error('该会话正在回复，请稍后再发送')
  state.pendingReplies.set(thread.dshSessionId, { text, at: Date.now() })
  state.error = ''
  render()
  try {
    await flushCanvasSaves()
    const activate = thread.dshSessionId !== state.currentSessionId
    if (activate) post('amphoreus:activate-session', { sessionId: thread.dshSessionId, defer: true })
    await dshRpc('amphoreus:send-message', { sessionId: thread.dshSessionId, text, activate })
  } catch (error) {
    state.pendingReplies.delete(thread.dshSessionId)
    render()
    throw error
  }
}

async function submitDraft() {
  const draft = state.draft
  const text = draft?.text.trim()
  if (draft === null || !text) return
  draft.sending = true
  state.error = ''
  render()
  try {
    if (draft.kind === 'new') {
      // Seat sessions live in the seat's own folder so the projection (and
      // DSH's cwd grouping) put them on this hero's canvas; seatHeroId lets
      // the DSH-side bridge bind the seat before the first prompt, which
      // makes the host injector seed the hero's skill card.
      const seatHeroId = state.seatId !== null && state.seatId.startsWith('seat:') ? state.seatId.slice(5) : undefined
      const seatDir = seatHeroId !== undefined ? state.seats.find(item => item.heroId === seatHeroId)?.dir : undefined
      const currentCwd = state.currentSessionId === null ? undefined : state.sessionsById.get(state.currentSessionId)?.cwd ?? undefined
      const session = await dshRpc('amphoreus:create-session', { cwd: seatDir ?? currentCwd, seatHeroId })
      await flushCanvasSaves()
      post('amphoreus:activate-session', { sessionId: session.id, defer: true })
      await dshRpc('amphoreus:send-message', { sessionId: session.id, text, activate: true })
      state.draft = null
      render()
      window.setTimeout(() => {
        void refreshIndex().catch(() => {})
      }, 150)
      return
    }
    const parent = state.workspace?.threads.find(thread => thread.id === draft.parentId)
    if (parent === undefined) throw new Error('来源会话不存在')
    if (draft.kind === 'continue') {
      state.draft = null
      await sendMessage(parent, text)
      return
    }
    const session = await dshRpc('amphoreus:fork-session', { sessionId: parent.dshSessionId, atSeq: draft.atSeq })
    if (draft.anchorId !== undefined) rememberBranchAnchor(session.id, draft.anchorId)
    await flushCanvasSaves()
    const child = {
      id: session.id,
      dshSessionId: session.id,
      title: text.slice(0, 42),
      dshSessionTitle: session.title,
      parentId: parent.id,
      sourceParentSessionId: parent.dshSessionId,
      sourceSeedLength: null,
      cards: [],
    }
    if (state.workspace !== null && !state.workspace.threads.some(thread => thread.id === child.id || thread.dshSessionId === child.dshSessionId)) state.workspace.threads.push(child)
    state.activeId = child.id
    state.draft = null
    state.pendingReplies.set(child.dshSessionId, { text, at: Date.now() })
    render()
    post('amphoreus:activate-session', { sessionId: child.dshSessionId, defer: true })
    await dshRpc('amphoreus:send-message', { sessionId: child.dshSessionId, text, activate: true })
    await refreshIndex()
  } catch (error) {
    if (draft.kind === 'branch') {
      state.pendingReplies.delete(state.workspace?.threads.find(thread => thread.id === state.activeId)?.dshSessionId)
      if (state.draft !== null) state.draft = { ...draft, sending: false }
    } else {
      state.draft = { ...draft, sending: false }
    }
    setError(error)
  }
}

function threadsById() { return new Map((state.workspace?.threads ?? []).map(thread => [thread.id, thread])) }
function placeholderMessages(thread) {
  return (Array.isArray(thread.cards) ? thread.cards : []).flatMap(card => [
    { kind: 'user', text: '', sourceSeq: card.userSeq, at: 0, placeholder: true, turn: card.turn },
    ...(card.assistantSeq === null ? [] : [{
      kind: 'assistant',
      text: '',
      sourceSeq: card.assistantSeq,
      at: 0,
      placeholder: true,
      turn: card.turn,
      process: (Array.isArray(card.toolCallIds) ? card.toolCallIds : []).map(callId => ({ callId, name: '工具调用', arguments: null, result: null, error: null })),
    }]),
    ...(card.errorSeq === null ? [] : [{ kind: 'error', text: '本轮失败', sourceSeq: card.errorSeq, at: 0, placeholder: true, turn: card.turn }]),
  ])
}
function persistedMessagesFor(thread) {
  const history = state.historyBySession.get(thread.dshSessionId)
  if (history === undefined) return placeholderMessages(thread)
  if (state.historyCompleteBySession.get(thread.dshSessionId) === true) return history
  const bySeq = new Map()
  const withoutSeq = []
  for (const message of [...placeholderMessages(thread), ...history]) {
    if (Number.isInteger(message.sourceSeq)) bySeq.set(message.sourceSeq, message)
    else withoutSeq.push(message)
  }
  return [...bySeq.values()].sort((left, right) => left.sourceSeq - right.sourceSeq).concat(withoutSeq)
}

function pendingUserIndex(messages, pending) {
  return messages.findLastIndex(message => message.kind === 'user' && message.text === pending.text && new Date(message.at).getTime() >= pending.at - 2_000)
}

function settlePendingReply(thread, messages) {
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return false
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex === -1 || !messages.slice(userIndex + 1).some(message => message.kind === 'assistant' || message.kind === 'error')) return false
  state.pendingReplies.delete(thread.dshSessionId)
  state.liveReplies.delete(thread.dshSessionId)
  return true
}

function messagesFor(thread) {
  const messages = persistedMessagesFor(thread)
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return messages
  if (settlePendingReply(thread, messages)) return messages
  const liveReply = state.liveReplies.get(thread.dshSessionId)
  const liveAssistant = liveReply?.running ? { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() } : { kind: 'assistant', text: '', pending: true, at: new Date().toISOString() }
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex !== -1) return [...messages, liveAssistant]
  return [...messages, { kind: 'user', text: pending.text, pending: true, at: new Date(pending.at).toISOString() }, liveAssistant]
}

function latestMessage(thread, kind) { return [...messagesFor(thread)].reverse().find(message => message.kind === kind) }
function questionFor(thread) { return latestMessage(thread, 'user')?.text ?? thread.dshSessionTitle ?? '等待用户提问' }
function answerFor(thread) { return latestMessage(thread, 'assistant') ?? null }

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

function markdownBlock(text) {
  const lines = text.split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (unordered !== null || ordered !== null) {
      const matcher = unordered === null ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/
      const items = []
      while (index < lines.length) {
        const item = matcher.exec(lines[index])
        if (item === null) break
        items.push(`<li>${inlineMarkdown(item[1])}</li>`)
        index++
      }
      output.push(`<${unordered === null ? 'ol' : 'ul'}>${items.join('')}</${unordered === null ? 'ol' : 'ul'}>`)
      continue
    }
    // GFM table: a leading-pipe header row followed by a |-delimiter row,
    // then any number of leading-pipe body rows.
    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line
      const body = []
      index += 2
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      output.push(`<table><thead><tr>${tableCells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${tableCells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,3})\s+/.test(lines[index]) && !/^[-*+]\s+/.test(lines[index]) && !/^\d+[.)]\s+/.test(lines[index])) paragraph.push(lines[index++])
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) paragraph.push(lines[index++])
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return output.join('')
}

// Markdown parsing is pure CPU and repeats for every card on every canvas
// rebuild; cache the rendered HTML by input text so stable answers are never
// re-parsed. Bounded: streaming partial texts churn keys, so evict oldest.
const markdownCache = new Map()
const MARKDOWN_CACHE_LIMIT = 5000
function renderMarkdown(text) {
  const key = String(text)
  const cached = markdownCache.get(key)
  if (cached !== undefined) return cached
  const parts = key.split(/```/)
  const rendered = parts.map((part, index) => index % 2 === 1
    ? `<pre><code>${escapeHtml(part.replace(/^\w*\n/, ''))}</code></pre>`
    : markdownBlock(part)).join('')
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) markdownCache.delete(markdownCache.keys().next().value)
  markdownCache.set(key, rendered)
  return rendered
}

const clampCardText = text => text.length <= state.cardTextLimit ? text : `${text.slice(0, state.cardTextLimit)}\n——…（详情查看全文）`

function overlapsCard(position, other) {
  return position.x < other.x + CARD_WIDTH && position.x + CARD_WIDTH > other.x
    && position.y < other.y + CARD_HEIGHT && position.y + CARD_HEIGHT > other.y
}

function firstAvailableCardPosition(position, occupied) {
  const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
  while (true) {
    const collisions = occupied.filter(other => overlapsCard(candidate, other))
    if (collisions.length === 0) return candidate
    candidate.y = Math.max(...collisions.map(other => other.y + CARD_HEIGHT + CARD_GAP_Y))
  }
}

function connectorPath(fromPosition, toPosition) {
  const fromX = fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + CARD_HEIGHT / 2
  const toX = toPosition.x
  const toY = toPosition.y + CARD_HEIGHT / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function connectorPathFromElements(fromCard, toCard) {
  const fromX = Number.parseFloat(fromCard.style.left) + CARD_WIDTH
  const fromY = Number.parseFloat(fromCard.style.top) + CARD_HEIGHT / 2
  const toX = Number.parseFloat(toCard.style.left)
  const toY = Number.parseFloat(toCard.style.top) + CARD_HEIGHT / 2
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

function selectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Connector paths are rebuilt together with the canvas DOM; cache the mapping
// from card id to its incident paths so dragging never scans the whole SVG.
let connectorPathsByCard = new Map()
function cacheCardConnectors() {
  connectorPathsByCard = new Map()
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  for (const path of viewport.querySelectorAll('.connectors path[data-from]')) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    for (const id of [fromId, toId]) {
      const paths = connectorPathsByCard.get(id)
      if (paths === undefined) connectorPathsByCard.set(id, new Set([path]))
      else paths.add(path)
    }
  }
}

function refreshCardConnectors(cardId) {
  const paths = connectorPathsByCard.get(cardId)
  if (paths === undefined || paths.size === 0) return
  const byId = state.canvasCardsById
  if (byId === undefined) return
  for (const path of paths) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    const fromCard = byId.get(fromId)
    const toCard = byId.get(toId)
    if (fromCard === undefined || toCard === undefined) continue
    // Data-driven endpoints: the counterpart card may be unmounted (outside
    // the viewport) but its position is still authoritative.
    path.setAttribute('d', connectorPath(fromCard.position, toCard.position))
  }
}

function initialCanvasCamera(cards) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  // Focus the active conversation's latest turn, not its first: after many
  // rounds the canvas should open where work is happening, at the newest card.
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const active = activeCards.at(-1)
  const focus = draft ?? active ?? cards[0]
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  return { x: CAMERA_INSET_X - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
}

function placeConversationCards(cards) {
  const saved = new Map(cards.flatMap(card => {
    if (card.positionLocked !== true) return []
    const position = state.cardPositions.get(card.id) ?? state.cardPositions.get(card.positionKey)
    return position === undefined ? [] : [[card.id, { x: position.x, y: position.y }]]
  }))
  const occupied = []
  for (const card of cards) {
    const position = saved.get(card.id)
    if (position !== undefined) {
      card.position = position
      continue
    }
    card.position = firstAvailableCardPosition(card.naturalPosition ?? card.position, occupied)
    occupied.push(card.position)
  }
  return cards
}

function layoutConversationGraph(cards, threads) {
  const childrenByThread = new Map()
  for (const thread of threads) {
    if (thread.parentId === null) continue
    const children = childrenByThread.get(thread.parentId) ?? []
    children.push(thread.id)
    childrenByThread.set(thread.parentId, children)
  }
  const laneByThread = new Map()
  const visitThread = threadId => {
    if (laneByThread.has(threadId)) return
    laneByThread.set(threadId, laneByThread.size)
    for (const childId of childrenByThread.get(threadId) ?? []) visitThread(childId)
  }
  for (const thread of threads) if (thread.parentId === null) visitThread(thread.id)
  for (const thread of threads) visitThread(thread.id)

  const byId = new Map(cards.map(card => [card.id, card]))
  const positioned = new Map()
  const positionFor = (card, visiting = new Set()) => {
    if (positioned.has(card.id)) return positioned.get(card.id)
    if (visiting.has(card.id)) return { x: 86, y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y) }
    visiting.add(card.id)
    const parent = card.parentId === null ? undefined : byId.get(card.parentId)
    const parentPosition = parent === undefined ? undefined : positionFor(parent, visiting)
    const position = {
      x: parentPosition === undefined ? 86 : parentPosition.x + 365,
      y: 82 + (laneByThread.get(card.dshThreadId) ?? 0) * (CARD_HEIGHT + CARD_GAP_Y),
    }
    visiting.delete(card.id)
    positioned.set(card.id, position)
    return position
  }
  for (const card of cards) {
    card.naturalPosition = positionFor(card)
    if (!card.positionLocked) card.position = card.naturalPosition
  }
  return placeConversationCards(cards)
}

function conversationCards(threads) {
  const cards = []
  const cardsByThread = new Map()
  for (const thread of threads) {
    const messages = messagesFor(thread)
    const turns = []
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const question = messages[messageIndex]
      if (question.kind !== 'user') continue
      const replies = []
      const errors = []
      let processCount = 0
      for (let replyIndex = messageIndex + 1; replyIndex < messages.length; replyIndex++) {
        const reply = messages[replyIndex]
        if (reply.kind === 'user') break
        if (reply.kind === 'assistant') replies.push(reply)
        if (reply.kind === 'error') errors.push(reply)
        if (Array.isArray(reply.process)) processCount += reply.process.length
        else if (reply.kind === 'tool') processCount += 1
      }
      const answer = replies.at(-1) ?? null
      const error = errors.at(-1) ?? null
      const turnIndex = turns.length
      const placeholder = question.placeholder === true
      const indexedCard = state.index.get(thread.dshSessionId)?.cards?.find(card => card.userSeq === question.sourceSeq)
      const hasSourceSeq = Number.isInteger(question.sourceSeq)
      const id = hasSourceSeq ? `${thread.id}:turn:${question.sourceSeq}` : `${thread.id}:pending:${turnIndex}`
      const previous = turns.at(-1)
      const positionKey = `${thread.id}:turn-index:${turnIndex}`
      const naturalPosition = previous === undefined ? { x: 86, y: 82 } : { x: previous.naturalPosition.x + 365, y: previous.naturalPosition.y }
      const indexedPosition = state.cardPositions?.get(id)
      const fallbackPosition = state.cardPositions?.get(positionKey)
      if (hasSourceSeq && indexedPosition === undefined && fallbackPosition !== undefined) {
        state.cardPositions.set(id, fallbackPosition)
        state.cardPositions.delete(`${thread.id}:pending:${turnIndex}`)
        persistCardPositions([id])
      }
      const savedPosition = indexedPosition ?? fallbackPosition
      const positionLocked = savedPosition !== undefined
      const position = positionLocked ? savedPosition : naturalPosition
      turns.push({
        id,
        positionKey,
        dshThreadId: thread.id,
        sourceParentId: thread.parentId,
        parentId: null,
        sourceSeq: question.sourceSeq,
        turnIndex,
        naturalPosition,
        position,
        positionLocked,
        question: placeholder ? (turnIndex === 0 ? (thread.dshSessionTitle ?? thread.title) : `第 ${turnIndex + 1} 轮`) : question.text,
        answer,
        error,
        processCount,
        placeholder,
        turn: question.turn ?? answer?.turn ?? error?.turn ?? indexedCard?.turn ?? null,
      })
    }
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const latestTurn = turns.at(-1)
    if (liveReply?.running && latestTurn !== undefined && (latestTurn.placeholder === true || latestTurn.answer === null || latestTurn.answer.pending === true)) {
      latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString(), turn: latestTurn.turn }
      latestTurn.placeholder = false
    }
    if (turns.length === 0) {
      const id = `${thread.id}:turn:empty`
      const positionKey = `${thread.id}:turn-index:0`
      const naturalPosition = { x: 86, y: 82 }
      const savedPosition = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
      const positionLocked = savedPosition !== undefined
      turns.push({
      id,
      positionKey,
      dshThreadId: thread.id,
      sourceParentId: thread.parentId,
      parentId: null,
      sourceSeq: undefined,
      turnIndex: 0,
      naturalPosition,
      position: positionLocked ? savedPosition : naturalPosition,
      positionLocked,
      question: thread.dshSessionTitle ?? thread.title,
      answer: null,
      error: null,
      processCount: 0,
      placeholder: false,
      turn: null,
      })
    }
    turns.at(-1).canContinue = true
    cardsByThread.set(thread.id, turns)
    cards.push(...turns)
  }
  for (const card of cards) {
    const siblings = cardsByThread.get(card.dshThreadId)
    if (card.turnIndex > 0) card.parentId = siblings[card.turnIndex - 1].id
    else {
      const parentCards = cardsByThread.get(card.sourceParentId)
      const sourceThread = threads.find(thread => thread.id === card.dshThreadId)
      const firstChildQuestion = siblings?.[0]
      const seedLength = sourceThread?.sourceSeedLength ?? firstChildQuestion?.sourceSeq
      // A fork inherits every parent event before DSH's durable seed boundary.
      // The latest parent question below that boundary is the exact Turn where
      // this child was born. Canvas coordinates never participate in lineage.
      const inheritedTurn = Number.isSafeInteger(seedLength)
        ? parentCards?.filter(candidate => Number.isInteger(candidate.sourceSeq) && candidate.sourceSeq < seedLength).at(-1)
        : undefined
      card.parentId = state.branchAnchors.get(card.dshThreadId) ?? inheritedTurn?.id ?? null
    }
  }
  return layoutConversationGraph(cards, threads)
}

function conversationGraphView(cards, collapsedCardIds = state.collapsedCardIds) {
  const cardIds = new Set(cards.map(card => card.id))
  const childrenByParent = new Map()
  for (const card of cards) {
    if (card.parentId === null || !cardIds.has(card.parentId)) continue
    const children = childrenByParent.get(card.parentId) ?? []
    children.push(card.id)
    childrenByParent.set(card.parentId, children)
  }

  const hiddenIds = new Set()
  for (const rootId of collapsedCardIds) {
    if (!cardIds.has(rootId)) continue
    const visited = new Set([rootId])
    const visit = parentId => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (visited.has(childId)) continue
        visited.add(childId)
        hiddenIds.add(childId)
        visit(childId)
      }
    }
    visit(rootId)
  }

  // Persisted collapse roots must remain visible even if malformed metadata
  // contains a cycle where two collapsed nodes otherwise hide each other.
  for (const rootId of collapsedCardIds) hiddenIds.delete(rootId)

  // Post-order accumulation: each card's descendant count is 1 + the sum of
  // its children's subtree sizes, so the whole graph is O(n) instead of a BFS
  // from every card (O(n²) on deep chains). Malformed parent cycles are
  // detected through the DFS path: every member of a cycle reaches every other
  // member plus the union of their off-cycle subtrees, so when the cycle entry
  // pops last, all members are settled to (cycleSize - 1) + off-cycle total,
  // which matches the per-card BFS' unique-descendant count.
  const descendantCounts = new Map()
  const inStack = new Set()
  for (const card of cards) {
    if (descendantCounts.has(card.id)) continue
    const stack = [{ id: card.id, children: childrenByParent.get(card.id) ?? [], index: 0 }]
    const path = [card.id]
    let cycleEntry = null
    let cycleMembers = null
    let cycleOffCycleTotal = 0
    inStack.add(card.id)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.index < top.children.length) {
        const childId = top.children[top.index++]
        if (descendantCounts.has(childId)) continue
        if (inStack.has(childId)) {
          // Back edge: the nodes from childId up to top.id form a cycle.
          cycleEntry = childId
          cycleMembers = new Set(path.slice(path.indexOf(childId)))
          cycleOffCycleTotal = 0
          continue
        }
        inStack.add(childId)
        path.push(childId)
        stack.push({ id: childId, children: childrenByParent.get(childId) ?? [], index: 0 })
      } else {
        stack.pop()
        path.pop()
        inStack.delete(top.id)
        let count = 0
        for (const childId of top.children) {
          if (cycleMembers !== null && cycleMembers.has(childId)) continue // ring edge; base count added below
          count += 1 + (descendantCounts.get(childId) ?? 0)
        }
        if (cycleMembers !== null && cycleMembers.has(top.id)) cycleOffCycleTotal += count
        if (cycleMembers !== null && top.id === cycleEntry) {
          // All cycle members have popped (the entry pops last in post-order);
          // settle them so ancestors popping next read the final counts.
          const base = cycleMembers.size - 1
          for (const id of cycleMembers) descendantCounts.set(id, base + cycleOffCycleTotal)
          cycleEntry = null
          cycleMembers = null
        } else {
          descendantCounts.set(top.id, count)
        }
      }
    }
  }

  return {
    cards: cards.filter(card => !hiddenIds.has(card.id)),
    childCounts: new Map(cards.map(card => [card.id, childrenByParent.get(card.id)?.length ?? 0])),
    descendantCounts,
  }
}

function revealConversationThread(cards, threadId) {
  const byId = new Map(cards.map(card => [card.id, card]))
  const revealed = new Set()
  for (const target of cards.filter(card => card.dshThreadId === threadId)) {
    const visited = new Set([target.id])
    let parentId = target.parentId
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId)
      if (state.collapsedCardIds.delete(parentId)) revealed.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  for (const cardId of revealed) persistCollapsedCards(cardId)
}

function canvasConnectors(cards) {
  const index = new Map(cards.map(card => [card.id, card]))
  const links = cards.map(card => {
    const parent = card.parentId === null ? null : index.get(card.parentId)
    if (parent === undefined || parent === null) return ''
    const active = card.dshThreadId === state.activeId && parent.dshThreadId === state.activeId ? ' active-connector' : ''
    return `<path class="${active.trim()}" data-from="${escapeHtml(parent.id)}" data-to="${escapeHtml(card.id)}" d="${connectorPath(parent.position, card.position)}"></path>`
  })
  const placement = draftPlacement(cards)
  if (placement !== null) {
    links.push(`<path class="draft-connector" data-from="${escapeHtml(placement.parent.id)}" data-to="draft" d="${connectorPath(placement.parent.position, placement.position)}"></path>`)
  }
  return links.join('')
}

function conversationCard(card, graph) {
  const cardThread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  const unprojectable = cardThread?.dshSessionId ? state.unprojectable.get(cardThread.dshSessionId) : undefined
  const unprojectableBadge = unprojectable ? `<span class="card-unprojectable" title="${escapeHtml(unprojectable.reason)}">不可投影</span>` : ''
  const selected = card.id === state.selectedCardId ? 'selected' : ''
  const source = card.parentId === null ? 'DSH 会话' : card.turnIndex === 0 ? 'DSH 分支' : '追问'
  const continueButton = card.canContinue === true
    ? `<button class="graph-continue-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" aria-label="添加追问" title="添加追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
    : ''
  const childCount = graph.childCounts.get(card.id) ?? 0
  const collapsed = state.collapsedCardIds.has(card.id)
  const foldLabel = collapsed ? '展开后续对话' : '折叠后续对话'
  const foldButton = childCount === 0 || card.canContinue === true ? '' : `<button class="graph-fold-button${collapsed ? ' collapsed' : ''}" data-action="toggle-card-children" data-card="${escapeHtml(card.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${foldLabel}" title="${foldLabel}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8h9"/>${collapsed ? '<path d="M8 3.5v9"/>' : ''}</svg></button>`
  const branchButton = childCount === 0 || card.canContinue === true || !Number.isInteger(card.answer?.sourceSeq) ? '' : `<button class="graph-branch-button" data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}" aria-label="在新对话中分支" title="在新对话中分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor"/></svg></button>`
  return `<article class="thread-card ${selected} ${card.placeholder ? 'placeholder' : ''}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:#3478f6">
    <button class="node-handle" data-drag-card="${card.id}" aria-label="拖动 ${escapeHtml(card.question)}" title="拖动卡片"></button>
    ${continueButton}${foldButton}${branchButton}
    <div class="thread-card-head"><span class="topic-dot"></span><button class="thread-title" data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看完整会话：${escapeHtml(card.question)}">${escapeHtml(card.question)}</button></div>
    <div class="thread-meta"><span>${source}</span><span>第 ${card.turnIndex + 1} 轮</span>${card.error === null ? '' : '<span class="card-error-status">失败</span>'}${unprojectableBadge}${card.processCount > 0 ? `<span class="card-process-count">工具 ${card.processCount}</span>` : ''}</div>
    <div class="thread-answer">${card.placeholder ? '<p class="thread-answer-empty">选中此会话后加载正文</p>' : card.answer === null ? (card.error === null ? '<p class="thread-answer-empty">等待助手回复</p>' : '') : card.answer.pending && card.answer.text === '' ? '<p class="thread-answer-pending">正在回复</p>' : `${renderMarkdown(clampCardText(card.answer.text))}${card.answer.pending ? '<p class="thread-answer-pending">正在回复</p>' : ''}`}${card.error === null ? '' : `<p class="thread-answer-error" title="${escapeHtml(card.error.text)}">本轮失败：${escapeHtml(card.error.text)}</p>`}</div>
    <footer><button data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看完整会话" aria-label="查看完整会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 8.5 8 2.5l6 6V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z"/><path d="M6.2 14v-3.6a1.8 1.8 0 0 1 3.6 0V14" /></svg>详情</button><button data-action="open-dsh" data-thread="${card.dshThreadId}" data-seq="${Number.isInteger(card.sourceSeq) ? card.sourceSeq : ''}" data-turn="${Number.isInteger(card.turn) ? card.turn : ''}" title="在 DSH 中打开" aria-label="在 DSH 中打开"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>DSH</button><button data-action="archive-thread" data-thread="${card.dshThreadId}" title="归档此会话" aria-label="归档此会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5h11M5.5 7v5.5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V7"/><path d="M4 5 5 2.8a.7.7 0 0 1 .6-.4h4.8a.7.7 0 0 1 .6.4L12 5M6 9.5h4"/></svg>归档</button></footer>
  </article>`
}

function draftActions(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  return `<div class="draft-actions"><button type="button" data-action="cancel-draft" ${disabled} aria-label="取消" title="取消"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button><button class="primary" type="submit" ${disabled} aria-label="发送" title="发送"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg></button></div>`
}

function quickPhraseEditor(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  const phrases = state.quickPhrases.map((phrase, index) => `<div class="draft-quick-phrase-editor-row"><input data-quick-phrase-index="${index}" maxlength="${MAX_QUICK_PHRASE_LENGTH}" value="${escapeHtml(phrase)}" aria-label="快捷词 ${index + 1}" ${disabled}><button type="button" data-action="remove-quick-phrase" data-quick-phrase-index="${index}" aria-label="删除 ${escapeHtml(phrase)}" title="删除" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div>`).join('')
  return `<section class="draft-quick-editor" aria-label="编辑快捷词"><div class="draft-quick-editor-list">${phrases}</div><div class="draft-quick-phrase-add"><input maxlength="${MAX_QUICK_PHRASE_LENGTH}" placeholder="添加快捷词" aria-label="添加快捷词" ${disabled}><button class="primary" type="button" data-action="add-quick-phrase" aria-label="添加快捷词" title="添加快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div><button class="draft-quick-editor-close" type="button" data-action="close-quick-phrase-editor" ${disabled}>完成</button></section>`
}

function draftQuickPhrases(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  if (state.quickPhraseEditorOpen) return quickPhraseEditor(draft)
  const phrases = state.quickPhrases.map(phrase => `<button class="draft-quick-phrase" type="button" data-action="insert-quick-phrase" data-quick-phrase="${escapeHtml(phrase)}" ${disabled}>${escapeHtml(phrase)}</button>`).join('')
  return `<div class="draft-quick-phrases" aria-label="常用补充词">${phrases}<button class="draft-quick-phrase-add-button" type="button" data-action="open-quick-phrase-editor" aria-label="管理快捷词" title="管理快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>`
}

function insertQuickPhrase(phrase) {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement) || state.draft === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const prefix = input.value.slice(0, start)
  const suffix = input.value.slice(end)
  const separator = prefix !== '' && !prefix.endsWith('\n') ? '\n' : ''
  const text = `${prefix}${separator}${phrase}${suffix}`
  if (text.length > input.maxLength) return setError('追问内容不能超过 4000 个字符')
  const caret = prefix.length + separator.length + phrase.length
  input.value = text
  state.draft.text = text
  input.focus()
  input.setSelectionRange(caret, caret)
}

function addQuickPhrase(value) {
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') return false
  if (state.quickPhrases.includes(phrase)) return setError('这个快捷词已经存在')
  if (state.quickPhrases.length >= MAX_QUICK_PHRASES) return setError(`最多保留 ${MAX_QUICK_PHRASES} 个快捷词`)
  state.quickPhrases.push(phrase)
  persistQuickPhrases()
  return true
}

function updateQuickPhrase(index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= state.quickPhrases.length) return
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') {
    state.quickPhrases.splice(index, 1)
  } else if (state.quickPhrases.some((item, itemIndex) => itemIndex !== index && item === phrase)) {
    return setError('这个快捷词已经存在')
  } else {
    state.quickPhrases[index] = phrase
  }
  persistQuickPhrases()
  render()
}

function draftPlacement(cards) {
  const draft = state.draft
  if (draft === null || draft.kind === 'new') return null
  const parent = draft.anchorId === undefined
    ? cards.filter(card => card.dshThreadId === draft.parentId).at(-1)
    : cards.find(card => card.id === draft.anchorId)
  if (parent === undefined) return null
  return { parent, position: firstAvailableCardPosition({ x: parent.position.x + 365, y: parent.position.y }, cards.map(card => card.position)) }
}

function draftCard(cards) {
  const draft = state.draft
  if (draft?.kind === 'new') return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:86px;top:82px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>新会话</strong></div>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="输入第一条消息" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:#3478f6">
    <div class="thread-card-head"><span class="topic-dot"></span><strong>${continuing ? '新的追问' : '新的分支'}</strong></div>
    <form class="draft-branch-form" data-draft>${draftQuickPhrases(draft)}<textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
}

function selectionFollowupButton() {
  return `<button class="selection-followup" type="button" data-action="follow-selection" hidden aria-label="基于所选内容创建追问" title="基于所选内容追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 3.5h10v6.25H7.2L4 12.5V9.75H3Z"/><path d="M8 4.9v3.4M6.3 6.6h3.4"/></svg><span>追问</span></button>`
}

// Cards are mounted into the DOM only when they intersect the viewport
// (inflated by VIEWPORT_MARGIN) in world coordinates. The camera transform is
// translate(camera) scale(zoom), so screen = world * zoom + camera.
function visibleCardIds(cards) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return new Set(cards.map(card => card.id))
  const bounds = viewport.getBoundingClientRect()
  const left = (-state.canvasCamera.x - VIEWPORT_MARGIN) / state.zoom
  const right = (bounds.width - state.canvasCamera.x + VIEWPORT_MARGIN) / state.zoom
  const top = (-state.canvasCamera.y - VIEWPORT_MARGIN) / state.zoom
  const bottom = (bounds.height - state.canvasCamera.y + VIEWPORT_MARGIN) / state.zoom
  const visible = new Set()
  for (const card of cards) {
    const { x, y } = card.position
    if (x + CARD_WIDTH < left || x > right || y + CARD_HEIGHT < top || y > bottom) continue
    visible.add(card.id)
  }
  return visible
}

// Incrementally mount cards entering the viewport and unmount cards leaving
// it, without rebuilding the canvas. Called after pan/zoom/focus camera moves.
function syncCanvasViewport() {
  if (state.mode !== 'canvas' || state.canvasCards === undefined) return
  const layer = document.querySelector('.cards-layer')
  if (!(layer instanceof HTMLElement)) return
  const visible = visibleCardIds(state.canvasCards)
  for (const cardId of [...state.mountedCardIds]) {
    if (visible.has(cardId)) continue
    const element = layer.querySelector(`[data-card-id="${selectorValue(cardId)}"]`)
    if (element instanceof HTMLElement) element.remove()
    state.mountedCardIds.delete(cardId)
  }
  for (const card of state.canvasCards) {
    if (!visible.has(card.id) || state.mountedCardIds.has(card.id)) continue
    const wrapper = document.createElement('div')
    wrapper.innerHTML = conversationCard(card, state.canvasGraph)
    const element = wrapper.firstElementChild
    if (element instanceof HTMLElement) {
      layer.appendChild(element)
      const handle = element.querySelector('[data-drag-card]')
      if (handle instanceof HTMLElement) bindDragHandle(handle)
    }
    state.mountedCardIds.add(card.id)
  }
}

function renderCanvas() {
  const threads = state.workspace?.threads ?? []
  if (threads.length === 0 && state.draft?.kind !== 'new') return `<section class="empty-canvas"><strong>当前工作目录还没有 DSH 对话。</strong><p>点击新会话，在画布中输入第一条消息。</p><div><button class="primary" type="button" data-action="create-session">新建会话</button></div></section>`
  const allCards = conversationCards(threads)
  const graph = conversationGraphView(allCards)
  const cards = graph.cards
  state.canvasCards = cards
  state.canvasCardsById = new Map(cards.map(card => [card.id, card]))
  state.canvasGraph = graph
  if (state.inspectorCardId !== null && !state.canvasCardsById.has(state.inspectorCardId)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
  }
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(cards)
    state.canvasViewInitialized = true
    // The viewport is not laid out yet while renderCanvas builds its HTML;
    // center the focused card once the DOM is mounted (render tail).
    state.canvasNeedsCenter = true
  }
  const visible = visibleCardIds(cards)
  state.mountedCardIds = new Set(visible)
  const mounted = cards.filter(card => visible.has(card.id))
  const inspector = state.inspectorCardId === null ? '' : renderCardInspector(state.canvasCardsById.get(state.inspectorCardId))
  return `<section class="canvas-view"><div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><svg class="connectors">${canvasConnectors(cards)}</svg><div class="cards-layer">${mounted.map(card => conversationCard(card, graph)).join('')}${draftCard(cards)}</div></div></div>${inspector}</section>`
}

function isProcessMessage(message) {
  if (message.kind === 'tool' || message.kind === 'tool-result') return true
  return message.kind === 'assistant' && /(?:^|\n)\s*(?:bash|pwsh|powershell|web_search|web_fetch|browser|read_file|write_file)\s*\n\s*\{/.test(message.text)
}

function processSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140) || '工具调用记录'
}

function threadMessage(thread, message) {
  const isUser = message.kind === 'user'
  const label = isUser ? '你' : message.kind === 'assistant' ? 'DSH' : message.kind === 'error' ? '错误' : '记录'
  const branch = message.kind === 'assistant' && Number.isInteger(message.sourceSeq)
    ? `<button class="message-branch" data-action="open-branch" data-thread="${thread.id}" data-seq="${message.sourceSeq}" title="从此回答创建分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>分支</button>`
    : ''
  const messageId = `${thread.id}:${message.sourceSeq ?? `${message.kind}:${message.at}`}`
  const collapsible = isProcessMessage(message)
  const expanded = state.expandedMessageIds.has(messageId)
  const fold = collapsible ? `<button class="message-fold" data-action="toggle-message" data-message="${escapeHtml(messageId)}" aria-label="${expanded ? '收起过程记录' : '展开过程记录'}" title="${expanded ? '收起' : '展开'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg></button>` : ''
  const process = Array.isArray(message.process) && message.process.length > 0 ? message.process : null
  const body = message.pending && message.text === '' ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>'
    : `${collapsible && !expanded ? `<p class="message-summary">${escapeHtml(processSummary(message.text))}</p>` : renderMarkdown(message.text)}${message.pending ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>' : ''}${process === null ? '' : processRecords(process, messageId)}`
  const avatar = isUser ? '' : '<span class="message-avatar" aria-hidden="true"></span>'
  return `<article class="message message-${message.kind}${message.pending ? ' message-pending' : ''}${collapsible ? ' message-collapsible' : ''}${expanded ? ' expanded' : ''}" data-message-seq="${Number.isInteger(message.sourceSeq) ? message.sourceSeq : ''}"><header>${avatar}<span class="message-role">${label}</span><time>${formatTime(message.at)}</time>${branch}${fold}</header><div class="message-body">${body}</div></article>`
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  const entries = process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const entryExpanded = state.expandedMessageIds.has(entryKey)
    const status = entry.error !== null ? '失败' : entry.result === null ? '等待结果' : '完成'
    const argumentsHtml = entry.arguments === null || entry.arguments === '' ? '' : `<pre class="process-args">${escapeHtml(entry.arguments)}</pre>`
    const outcomeHtml = entry.error !== null ? `<pre class="process-error">${escapeHtml(entry.error)}</pre>` : entry.result === null ? '' : `<pre class="process-result">${escapeHtml(entry.result)}</pre>`
    return `<div class="process-entry${entryExpanded ? ' expanded' : ''}"><button class="process-entry-fold" data-action="toggle-message" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(entry.name)}</span><span class="process-status${entry.error !== null ? ' process-status-error' : entry.result === null ? ' process-status-pending' : ' process-status-done'}">${status}</span></button>${entryExpanded ? `<div class="process-entry-body">${argumentsHtml}${outcomeHtml}</div>` : ''}</div>`
  }).join('')
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? entries : ''}</section>`
}

function messagesForCard(card) {
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  if (thread === undefined) return { thread: null, messages: [] }
  const messages = messagesFor(thread)
  let turnIndex = -1
  let start = -1
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].kind !== 'user') continue
    turnIndex += 1
    if (turnIndex === card.turnIndex) {
      start = index
      break
    }
  }
  if (start === -1) return { thread, messages: [] }
  const end = messages.findIndex((message, index) => index > start && message.kind === 'user')
  return { thread, messages: messages.slice(start, end === -1 ? undefined : end) }
}

function inspectorProcessEntries(messages) {
  const entries = []
  for (const message of messages) {
    if (Array.isArray(message.process)) {
      entries.push(...message.process.map(entry => ({ ...entry })))
      continue
    }
    if (message.kind === 'tool') {
      entries.push({ name: processSummary(message.text), arguments: message.text, result: null, error: null })
      continue
    }
    if (message.kind === 'tool-result') {
      const previous = entries.at(-1)
      if (previous !== undefined && previous.result === null && previous.error === null) previous.result = message.text
      else entries.push({ name: '工具结果', arguments: null, result: message.text, error: null })
    }
  }
  return entries
}

function renderCardInspector(card) {
  if (card === undefined) return ''
  const { thread, messages } = messagesForCard(card)
  if (thread === null) return ''
  const process = inspectorProcessEntries(messages)
  const answer = card.answer === null
    ? card.error === null ? '<p class="card-inspector-pending">等待助手回复</p>' : ''
    : `<article class="card-inspector-answer">${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="card-inspector-pending">正在回复</p>' : ''}</article>`
  const error = card.error === null ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(card.error.text)}</p></section>`
  const processRecordsHtml = process.length === 0 ? '' : processRecords(process, `${thread.id}:${card.id}:inspector`)
  const continueAction = card.canContinue === true ? `<button type="button" data-action="open-continue" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 3.5h11v7h-6l-3.5 2.5v-2.5h-1.5Z"/><path d="M8 5.5v3M6.5 7h3"/></svg>继续追问</button>` : ''
  const branch = Number.isInteger(card.answer?.sourceSeq)
    ? `<button type="button" data-action="open-branch" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M5.5 3.5h2A2.5 2.5 0 0 1 10 6v5"/></svg>创建分支</button>`
    : ''
  const openDshAction = `<button class="primary" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(card.answer?.sourceSeq) ? card.answer.sourceSeq : ''}" data-turn="${Number.isInteger(card.turn) ? card.turn : ''}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>在 DSH 中打开</button>`
  return `<aside class="card-inspector${state.inspectorOpening ? ' is-opening' : ''}" aria-label="卡片详情" data-inspector-card="${escapeHtml(card.id)}"><header class="card-inspector-head"><div><div class="card-inspector-meta"><span>第 ${card.turnIndex + 1} 轮</span>${card.error === null ? '' : '<span class="card-inspector-error-status">失败</span>'}${process.length > 0 ? `<span>工具 ${process.length}</span>` : ''}</div><h2>${escapeHtml(card.question)}</h2></div><button class="card-inspector-close" type="button" data-action="close-card-inspector" aria-label="关闭卡片详情" title="关闭"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></header><div class="card-inspector-scroll">${error}${answer}${processRecordsHtml}</div><footer class="card-inspector-actions">${continueAction}${branch}${openDshAction}</footer></aside>`
}

function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const messages = messagesFor(thread)
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  const latestAssistant = [...messages].reverse().find(message => message.kind === 'assistant' && (Number.isInteger(message.sourceSeq) || Number.isInteger(message.turn)))
  const latestAssistantSeq = latestAssistant?.sourceSeq
  const latestAssistantTurn = latestAssistant?.turn
  return `<section class="detail-view"><header class="detail-head"><div class="detail-head-title"><div class="detail-head-meta"><span class="detail-badge">${thread.parentId === null ? '会话' : '分支'}</span>${thread.dshSessionTitle ?? thread.title ? `<span class="detail-subtitle">${escapeHtml(thread.dshSessionTitle ?? thread.title)}</span>` : ''}</div><h1>${escapeHtml(questionFor(thread))}</h1></div><div class="detail-head-actions"><button data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(latestAssistantSeq) ? latestAssistantSeq : ''}" data-turn="${Number.isInteger(latestAssistantTurn) ? latestAssistantTurn : ''}" title="在原生对话中打开此会话">在 DSH 中打开</button><button data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支">创建分支</button><button class="primary" data-action="show-canvas">返回画布</button></div></header><div class="detail-scroll">${messages.map(message => threadMessage(thread, message)).join('') || '<div class="note-empty">等待这条会话的第一条消息。</div>'}</div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" placeholder="继续当前会话…" ${waiting ? 'disabled' : ''}></textarea><button class="primary" type="submit" ${waiting ? 'disabled' : ''}>${waiting ? '等待回复' : '发送'}</button></form></section>`
}

// ---- Seat portal（英雄纪卡牌门户） --------------------------------------------

async function enterSeat(workspaceId, sourceCard) {
  // FLIP hand-off: clone the clicked chronicle card at its viewport rect and
  // fly it to the seat view's sidebar card slot after render.
  const flight = sourceCard instanceof HTMLElement ? beginCardFlight(sourceCard) : null
  state.cardFlightPending = flight !== null
  state.seatId = workspaceId
  post('amphoreus:seat-changed', { heroId: workspaceId.startsWith('seat:') ? workspaceId.slice(5) : null })
  state.mode = 'canvas'
  state.activeId = null
  state.selectedCardId = null
  resetCanvasCamera()
  storedSeat(workspaceId)
  rebuildWorkspace()
  render()
  if (flight !== null) window.requestAnimationFrame(() => flight.land())
}

function beginCardFlight(sourceCard) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  const from = sourceCard.getBoundingClientRect()
  const clone = sourceCard.cloneNode(true)
  clone.classList.add('card-flight')
  clone.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;z-index:120;pointer-events:none;animation:none;transition:left .46s cubic-bezier(.22,.9,.24,1),top .46s cubic-bezier(.22,.9,.24,1),width .46s cubic-bezier(.22,.9,.24,1),height .46s cubic-bezier(.22,.9,.24,1),border-radius .46s ease,opacity .3s ease .34s;`
  document.body.appendChild(clone)
  let landed = false
  const finish = () => {
    if (clone.isConnected) clone.remove()
    state.cardFlightPending = false
    const target = document.querySelector('.seat-card-slot')
    if (target instanceof HTMLElement) target.classList.remove('awaiting-flight')
  }
  return {
    land() {
      if (landed) return
      landed = true
      const target = document.querySelector('.seat-card-slot')
      if (!(target instanceof HTMLElement)) { finish(); return }
      target.classList.add('awaiting-flight')
      const to = target.getBoundingClientRect()
      // Force a layout so the transition picks up the start rect.
      void clone.offsetWidth
      clone.style.left = `${to.left}px`
      clone.style.top = `${to.top}px`
      clone.style.width = `${to.width}px`
      clone.style.height = `${to.height}px`
      clone.style.borderRadius = '12px'
      window.setTimeout(finish, 500)
      clone.addEventListener('transitionend', event => { if (event.propertyName === 'left') window.setTimeout(finish, 40) }, { once: true })
    },
  }
}

function seatTitleOf(workspaceId) {
  if (workspaceId === 'all') return '全体会议'
  const heroId = typeof workspaceId === 'string' && workspaceId.startsWith('seat:') ? workspaceId.slice(5) : ''
  const seat = state.seats.find(item => item.heroId === heroId)
  return (seat?.displayName ?? heroId) || '全体会议'
}

function showPortal() {
  state.mode = 'portal'
  state.seatId = null
  post('amphoreus:seat-changed', { heroId: null })
  state.workspace = null
  state.activeId = null
  state.selectedCardId = null
  state.inspectorCardId = null
  render()
}

function renderPortal() {
  const visibleSeats = state.seats.filter(seat => typeof seat.heroId === 'string' && seat.heroId !== '')
  const seatCards = visibleSeats.map((seat, index) => {
    const count = seatSessionCount(seat.heroId)
    const art = seat.chronicleUrl
      ? `<img class="portal-art" src="${escapeHtml(seat.chronicleUrl)}" alt="" loading="lazy" decoding="async">`
      : `<div class="portal-art portal-art-fallback" style="--seat-accent:${escapeHtml(seat.accent ?? '#8a681c')};--seat-accent2:${escapeHtml(seat.accent2 ?? '#37305e')}"></div>`
    const sticker = seat.stickerUrl ? `<img class="portal-sticker" src="${escapeHtml(seat.stickerUrl)}" alt="" loading="lazy" decoding="async">` : ''
    const name = seat.displayName ?? seat.heroId
    const ordinal = seat.ordinal !== null ? String(seat.ordinal).padStart(2, '0') : String(index + 1).padStart(2, '0')
    return `<button class="portal-card ${seat.deployed ? '' : 'undeployed'}" type="button" data-action="enter-seat" data-seat="${escapeHtml(seat.heroId)}" data-workspace="seat:${escapeHtml(seat.heroId)}" style="--seat-accent:${escapeHtml(seat.accent ?? '#8a681c')};--d:${index * 36}ms" title="${escapeHtml(name)}${seat.deployed ? '' : '（未部署）'}">
      ${art}
      <span class="portal-veil"></span>
      ${sticker}
      <span class="portal-meta">
        <i class="portal-no">${ordinal}</i>
        <strong class="portal-name">${escapeHtml(name)}</strong>
        <span class="portal-duty">${escapeHtml((seat.duties ?? []).slice(0, 3).join(' · ') || (seat.deployed ? '' : '角色未部署'))}</span>
        <span class="portal-count">${count > 0 ? `${count} 段会话` : '尚无会话'}</span>
      </span>
    </button>`
  }).join('')
  const allCount = seatSessionCount(null)
  return `<section class="portal" aria-label="黄金裔工作台">
    <header class="portal-head">
      <p class="portal-kicker">CHRYSOS · CONCILIUM</p>
      <h1>黄金裔工作台</h1>
      <p class="portal-sub">点开一张英雄纪，进入这位黄金裔的独立工作空间。</p>
    </header>
    <button class="portal-all" type="button" data-action="enter-seat" data-workspace="all">
      <span class="portal-all-mark" aria-hidden="true">✦</span>
      <span class="portal-all-copy"><strong>全体会议</strong><span>未归席的会话与总览画布</span></span>
      <span class="portal-count">${allCount > 0 ? `${allCount} 段会话` : '尚无会话'}</span>
    </button>
    <div class="portal-grid">${seatCards || '<p class="tree-empty">席位尚未就绪</p>'}</div>
  </section>`
}

function render() {
  // Remember the departing thread's scroll position per thread id, so
  // switching sessions restores each conversation's own place instead of
  // smearing one session's position onto another.
  if (state.mode === 'thread' && state.detailThreadId !== null) {
    const detail = document.querySelector('.detail-scroll')
    if (detail instanceof HTMLElement) state.detailScrollByThread.set(state.detailThreadId, detail.scrollTop)
  }
  if (state.mode === 'canvas' && state.inspectorCardId !== null) {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) state.inspectorScrollByCard.set(state.inspectorCardId, inspector.scrollTop)
  }
  state.detailThreadId = state.mode === 'thread' ? state.activeId : null
  const detailScrollTop = state.detailThreadId === null ? null : state.detailScrollByThread.get(state.detailThreadId) ?? null
  const inspectorScrollTop = state.mode === 'canvas' && state.inspectorCardId !== null ? state.inspectorScrollByCard.get(state.inspectorCardId) ?? null : null
  const cardScrollTops = new Map()
  if (state.mode === 'canvas') {
    // Key by the unique card id: every card of a session shares data-thread,
    // so keying on it would clobber sibling cards' scroll positions. Only
    // scrollable answers have a position worth preserving; reading the two
    // height properties shares the same forced layout as the scrollTop read.
    for (const answer of document.querySelectorAll('.thread-card[data-thread] .thread-answer')) {
      if (answer.scrollHeight <= answer.clientHeight) continue
      const card = answer.closest('.thread-card')
      if (card instanceof HTMLElement && typeof card.dataset.cardId === 'string') cardScrollTops.set(card.dataset.cardId, answer.scrollTop)
    }
  }
  if (state.mode === 'portal') {
    app.innerHTML = `<main class="synapse-shell portal-shell">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${renderPortal()}</main>`
    return
  }
  const workspace = state.workspace
  const threads = workspace?.threads ?? []
  const view = state.mode === 'thread' ? renderThread() : renderCanvas()
  const seat = seatForCurrentView()
  const canvasControls = state.mode === 'canvas' && (threads.length > 0 || state.draft?.kind === 'new') ? `<div class="canvas-controls"><button data-action="layout" title="整理节点" aria-label="整理节点"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>整理</button><button data-action="focus-active" title="定位到当前会话" aria-label="定位到当前会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6"/></svg>定位</button><button data-action="zoom-out" aria-label="缩小" title="缩小"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.5 8h9"/></svg></button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="放大" title="放大"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>` : ''
  const detailAvailable = currentThread() !== null
  const canvasTabs = `<nav class="canvas-tabs" aria-label="会话地图视图"><button class="${state.mode === 'canvas' ? 'active' : ''}" data-action="show-canvas">地图</button><button class="${state.mode === 'thread' ? 'active' : ''}" data-action="show-thread" data-thread="${state.activeId ?? ''}" ${detailAvailable ? '' : 'disabled'}>详情</button></nav>`
  const seatBrand = seat !== undefined
    ? `<div class="brand seat-brand" aria-label="${escapeHtml(seat.displayName ?? seat.heroId)}" style="--seat-accent:${escapeHtml(seat.accent ?? '#8a681c')}">${seat.stickerUrl ? `<img class="brand-sticker" src="${escapeHtml(seat.stickerUrl)}" alt="">` : '<span class="portal-all-mark" aria-hidden="true">✦</span>'}<strong>${escapeHtml(seat.displayName ?? seat.heroId)}</strong></div>`
    : `<div class="brand" aria-label="全体会议"><span class="portal-all-mark" aria-hidden="true">✦</span><strong>${escapeHtml(seatTitleOf(state.seatId ?? 'all'))}</strong></div>`
  // The chronicle card lives on in the seat sidebar — the portal card's FLIP
  // clone lands exactly on this slot.
  const seatCardSlot = seat !== undefined && seat.chronicleUrl
    ? `<figure class="seat-card-slot ${state.cardFlightPending ? 'awaiting-flight' : ''}" data-action="show-portal" role="button" tabindex="0" title="返回全部角色"><img src="${escapeHtml(seat.chronicleUrl)}" alt="${escapeHtml(seat.displayName ?? seat.heroId)}"><figcaption><span>${escapeHtml((seat.duties ?? []).slice(0, 3).join(' · ') || '')}</span></figcaption></figure>`
    : ''
  const seatHero = state.seatId?.startsWith('seat:') ? state.seatId.slice(5) : null
  const orphanUnprojectable = [...state.unprojectable.values()].filter(item =>
    (heroIdOf(state.sessionsById.get(item.sessionId)) ?? null) === seatHero && !threads.some(thread => thread.dshSessionId === item.sessionId))
  const unprojectableList = orphanUnprojectable.length === 0 ? '' :
    `<div class="sidebar-heading"><span>不可投影</span></div><ul class="unprojectable-list">${orphanUnprojectable.map(item => `<li title="${escapeHtml(item.reason)}"><span>${escapeHtml(item.title ?? item.sessionId)}</span><i>${escapeHtml(item.reason)}</i></li>`).join('')}</ul>`
  const mainStageStyle = `--seat-stage-art:${seat?.cardUrl ? `url("${seat.cardUrl}")` : 'none'};--amphoreus-motif-url:${motifUrlForSeat(seat, document.documentElement.dataset.theme === 'dark')};--amphoreus-seat-accent:${seat?.accent ?? 'var(--dsw-alias-brand-primary)'};--amphoreus-seat-accent2:${seat?.accent2 ?? 'var(--dsw-alias-brand-primary)'}`
  app.innerHTML = `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-brand-row">${seatBrand}<button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button></div><button class="back-portal" type="button" data-action="show-portal"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8 10 12.5"/></svg><span>全部角色</span></button>${seatCardSlot}<button class="new-workspace" type="button" data-action="create-session" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新会话</span></button><div class="sidebar-heading"><span>会话</span></div><nav class="thread-tree">${threads.map(thread => `<button class="tree-row ${thread.id === state.activeId ? 'active' : ''}" data-action="select-thread" data-thread="${thread.id}" style="--thread-color:${escapeHtml(seat?.accent ?? '#374151')}"><span class="tree-dot"></span><span>${escapeHtml(threadListTitle(thread))}</span>${thread.parentId === null ? '' : '<i>分支</i>'}</button>`).join('') || '<p class="tree-empty">暂未同步会话</p>'}</nav>${unprojectableList}</aside><header class="topbar">${canvasControls}</header><section class="main-stage" style="${escapeHtml(mainStageStyle)}">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}${view}${selectionFollowupButton()}</section></main>`
  installDragging()
  cacheCardConnectors()
  // The initial camera from renderCanvas is inset (viewport not laid out yet);
  // center it on the focused card once the canvas DOM is mounted.
  if (state.canvasNeedsCenter) {
    state.canvasNeedsCenter = false
    window.requestAnimationFrame(() => { if (state.mode === 'canvas') focusActiveCard() })
  }
  for (const [cardId, scrollTop] of cardScrollTops) {
    const answer = app.querySelector(`.thread-card[data-card-id="${CSS.escape(cardId)}"] .thread-answer`)
    if (answer instanceof HTMLElement) answer.scrollTop = scrollTop
  }
  if (detailScrollTop !== null) window.requestAnimationFrame(() => {
    const nextDetail = document.querySelector('.detail-scroll')
    if (nextDetail instanceof HTMLElement) nextDetail.scrollTop = detailScrollTop
  })
  if (inspectorScrollTop !== null) window.requestAnimationFrame(() => {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) inspector.scrollTop = inspectorScrollTop
  })
  if (state.inspectorOpening) window.requestAnimationFrame(() => {
    document.querySelector('.card-inspector')?.classList.remove('is-opening')
    state.inspectorOpening = false
  })
  // Jump the detail view to the card the user clicked: card ids carry the
  // source sequence (`<thread>:turn:<seq>`), which matches data-message-seq
  // anchors on the rendered messages.
  const targetCardId = state.detailTargetCardId
  state.detailTargetCardId = null
  if (targetCardId !== null) {
    const match = /:turn:(\d+)$/.exec(targetCardId)
    const seq = match === null ? null : match[1]
    if (seq !== null) window.requestAnimationFrame(() => {
      const target = app.querySelector(`[data-message-seq="${CSS.escape(seq)}"]`)
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' })
    })
  }
}

function renderPreservingDetailScroll() {
  render()
}

let inspectorCloseTimer = 0
function openCardInspector(cardId) {
  if (inspectorCloseTimer !== 0) {
    window.clearTimeout(inspectorCloseTimer)
    inspectorCloseTimer = 0
  }
  state.inspectorOpening = state.inspectorCardId === null
  state.inspectorCardId = cardId
}

function closeCardInspector({ animate = true } = {}) {
  if (state.inspectorCardId === null) return
  if (inspectorCloseTimer !== 0) window.clearTimeout(inspectorCloseTimer)
  const cardId = state.inspectorCardId
  const inspector = document.querySelector('.card-inspector')
  if (!animate || !(inspector instanceof HTMLElement)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
    return
  }
  inspector.classList.add('is-closing')
  inspectorCloseTimer = window.setTimeout(() => {
    inspectorCloseTimer = 0
    if (state.inspectorCardId !== cardId) return
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
  }, 180)
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
}

function bindDragHandle(handle) {
  handle.addEventListener('pointerdown', event => {
    const cardId = event.currentTarget.dataset.dragCard
    const card = event.currentTarget.closest('.thread-card')
    if (cardId === undefined || !(card instanceof HTMLElement)) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY, position: { x: Number.parseFloat(card.style.left), y: Number.parseFloat(card.style.top) } }
    const aliases = card.dataset.positionKey === undefined ? [] : [card.dataset.positionKey]
    let position = origin.position
    let stopped = false
    let frame = 0
    state.dragging = true
    // Coalesce pointermove updates to one DOM pass per animation frame so a
    // high report-rate pointer cannot queue a reflow per event.
    const apply = () => {
      frame = 0
      state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
      for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
      // Keep the virtualized data object in sync so viewport visibility and
      // connector paths track the live drag position.
      const dataCard = state.canvasCardsById?.get(cardId)
      if (dataCard !== undefined) dataCard.position = { x: position.x, y: position.y }
      card.style.left = `${position.x}px`
      card.style.top = `${position.y}px`
      refreshCardConnectors(cardId)
    }
    const move = moveEvent => {
      position = { x: origin.position.x + (moveEvent.clientX - origin.x) / state.zoom, y: origin.position.y + (moveEvent.clientY - origin.y) / state.zoom }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      apply()
      rememberCardPosition(cardId, position, aliases)
      state.dragging = false
      deferCanvasRefresh(120)
      // No full render: only the dragged card's inline position and its
      // connectors changed; rebuilding the whole canvas on drop is the jank.
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function installDragging() {
  for (const handle of document.querySelectorAll('[data-drag-card]')) bindDragHandle(handle)
}

function canvasViewport(target) {
  return target instanceof Element ? target.closest('.canvas-viewport') : null
}

function zoomCanvas(viewport, nextZoom, clientX, clientY) {
  const zoom = Math.min(4, Math.max(.6, Math.round(nextZoom * 100) / 100))
  if (zoom === state.zoom) return
  const bounds = viewport.getBoundingClientRect()
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const worldX = (localX - state.canvasCamera.x) / state.zoom
  const worldY = (localY - state.canvasCamera.y) / state.zoom
  state.zoom = zoom
  state.canvasCamera = { x: localX - worldX * zoom, y: localY - worldY * zoom }
  const content = viewport.querySelector('.canvas-content')
  if (content instanceof HTMLElement) {
    // Drop the composited layer before zooming: a cached will-change raster
    // would be upscaled instead of re-rasterized, which was the original
    // zoom-blur bug. will-change re-applies via .is-panning on the next pan.
    content.style.willChange = 'auto'
    applyCanvasTransform()
    syncCanvasViewport()
    window.requestAnimationFrame(() => { content.style.willChange = '' })
  } else {
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const label = document.querySelector('.canvas-controls span')
  if (label !== null) label.textContent = `${Math.round(state.zoom * 100)}%`
}

function zoomCanvasAtCenter(delta) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const bounds = viewport.getBoundingClientRect()
  zoomCanvas(viewport, state.zoom + delta, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
}

function focusActiveCard() {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const cards = state.canvasCards
  if (cards === undefined || cards.length === 0) return
  // Drafts win over the active conversation's latest turn; fall back to the
  // first card. Cards may be unmounted (outside the viewport), so the focus
  // target comes from the data model, never from DOM queries.
  const draft = state.draft === null ? undefined
    : state.draft.kind === 'new' ? { position: { x: 86, y: 82 } } : draftPlacement(cards)
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const card = draft ?? activeCards.at(-1) ?? cards[0]
  const { x: left, y: top } = card.position
  const bounds = viewport.getBoundingClientRect()
  state.canvasCamera = {
    x: bounds.width / 2 - (left + CARD_WIDTH / 2) * state.zoom,
    y: bounds.height / 2 - (top + CARD_HEIGHT / 2) * state.zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
}

let selectionFollowup = null
let selectionFollowupFrame = 0

function hideSelectionFollowup() {
  if (selectionFollowupFrame !== 0) {
    window.cancelAnimationFrame(selectionFollowupFrame)
    selectionFollowupFrame = 0
  }
  selectionFollowup = null
  const button = app.querySelector('.selection-followup')
  if (button instanceof HTMLButtonElement) button.hidden = true
}

function selectionFollowupTarget(range) {
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (!(start instanceof Element) || !(end instanceof Element)) return null
  const answer = start.closest('.thread-answer')
  if (answer instanceof HTMLElement && answer.contains(end)) {
    const card = answer.closest('.thread-card[data-thread]:not(.draft-card)')
    if (card instanceof HTMLElement && card.dataset.thread !== undefined) return { threadId: card.dataset.thread }
  }
  const messageBody = start.closest('.message-assistant .message-body')
  const thread = currentThread()
  if (messageBody instanceof HTMLElement && messageBody.contains(end) && thread !== null) return { threadId: thread.id }
  return null
}

function updateSelectionFollowup() {
  selectionFollowupFrame = 0
  const button = app.querySelector('.selection-followup')
  const selection = window.getSelection()
  if (!(button instanceof HTMLButtonElement) || state.draft !== null || selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return hideSelectionFollowup()
  const text = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const target = text === '' || text.length > 4000 ? null : selectionFollowupTarget(range)
  const rect = range.getBoundingClientRect()
  if (target === null || rect.width === 0 || rect.height === 0) return hideSelectionFollowup()
  selectionFollowup = { ...target, text }
  button.dataset.thread = target.threadId
  button.style.left = `${Math.min(window.innerWidth - 12, Math.max(76, rect.right))}px`
  button.style.top = `${Math.min(window.innerHeight - 38, Math.max(8, rect.bottom + 8))}px`
  button.hidden = false
}

function queueSelectionFollowup() {
  if (selectionFollowupFrame !== 0) return
  selectionFollowupFrame = window.requestAnimationFrame(updateSelectionFollowup)
}

app.addEventListener('pointerdown', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select')) return
  event.preventDefault()
  const origin = { x: event.clientX, y: event.clientY, camera: { ...state.canvasCamera } }
  let pendingCamera = null
  let frame = 0
  state.canvasGesture = true
  viewport.classList.add('is-panning')
  viewport.setPointerCapture(event.pointerId)
  const apply = () => {
    frame = 0
    if (pendingCamera === null) return
    state.canvasCamera = pendingCamera
    pendingCamera = null
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const move = moveEvent => {
    pendingCamera = {
      x: origin.camera.x + moveEvent.clientX - origin.x,
      y: origin.camera.y + moveEvent.clientY - origin.y,
    }
    if (frame === 0) frame = window.requestAnimationFrame(apply)
  }
  const stop = () => {
    viewport.classList.remove('is-panning')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
    apply()
    state.canvasGesture = false
    deferCanvasRefresh(120)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

app.addEventListener('wheel', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  const card = event.target instanceof Element ? event.target.closest('.thread-card') : null
  if (card instanceof HTMLElement) {
    // Over a card the wheel scrolls that card's own answer with the browser's
    // native wheel (OS-smooth, never a page jump per notch); the answer's
    // overscroll-behavior: contain stops the scroll chaining into the canvas.
    const answer = card.querySelector('.thread-answer')
    if (answer instanceof HTMLElement && answer.scrollHeight > answer.clientHeight) {
      deferCanvasRefresh()
      return
    }
    // A card with no scrollable answer swallows the wheel instead of zooming.
    event.preventDefault()
    deferCanvasRefresh()
    return
  }
  event.preventDefault()
  zoomCanvas(viewport, state.zoom + (event.deltaY < 0 ? .05 : -.05), event.clientX, event.clientY)
}, { passive: false })

// Track pointer-down so the card click handler can tell a plain click from a
// text-selection or drag gesture; acting on the latter would re-render and
// wipe the user's selection.
let pointerDownPosition = null
app.addEventListener('pointerdown', event => { pointerDownPosition = { x: event.clientX, y: event.clientY } })
app.addEventListener('pointerdown', event => {
  const button = event.target instanceof Element ? event.target.closest('.selection-followup') : null
  if (button instanceof HTMLButtonElement) event.preventDefault()
  else hideSelectionFollowup()
})
app.addEventListener('pointerup', queueSelectionFollowup)
app.addEventListener('scroll', hideSelectionFollowup, true)
document.addEventListener('selectionchange', queueSelectionFollowup)
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || state.mode !== 'canvas' || state.inspectorCardId === null) return
  event.preventDefault()
  closeCardInspector({ animate: false })
})

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]')
  if (!(button instanceof HTMLElement)) {
    const card = event.target instanceof Element ? event.target.closest('.thread-card[data-thread]:not(.draft-card)') : null
    if (!(card instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.node-handle, textarea, select, form')) return
    // A double-click selects a word and a drag selects a range; neither is a
    // select-click, so leave the selection intact instead of re-rendering.
    if (event.detail > 1) return
    if (pointerDownPosition !== null
      && Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4) return
    const thread = state.workspace?.threads.find(item => item.id === card.dataset.thread)
    if (thread === undefined) return
    const cardId = card.dataset.cardId
    if (cardId === undefined) return
    state.activeId = thread.id
    state.selectedCardId = cardId
    openCardInspector(cardId)
    state.error = ''
    render()
    // Bidirectional current-session sync: switch DSH's current session
    // without closing the map; the client confirms via amphoreus:current-session.
    if (thread.dshSessionId !== null) {
      if (thread.dshSessionId !== state.currentDsh?.id) state.mapCardSessionSwitches.add(thread.dshSessionId)
      try {
        await flushCanvasSaves()
        post('amphoreus:activate-session', { sessionId: thread.dshSessionId })
      } catch (error) { setError(error) }
    }
    return
  }
  const thread = state.workspace?.threads.find(item => item.id === button.dataset.thread)
  try {
    if (button.dataset.action === 'follow-selection') {
      const followup = selectionFollowup
      hideSelectionFollowup()
      if (followup !== null && thread !== undefined && thread.id === followup.threadId && state.draft === null) openContinue(thread, undefined, followup.text)
      return
    }
    if (button.dataset.action === 'insert-quick-phrase' && button.dataset.quickPhrase !== undefined) insertQuickPhrase(button.dataset.quickPhrase)
    if (button.dataset.action === 'open-quick-phrase-editor') { state.quickPhraseEditorOpen = true; render() }
    if (button.dataset.action === 'close-quick-phrase-editor') { state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'add-quick-phrase') {
      const editor = button.closest('.draft-quick-phrase-add')
      const input = editor?.querySelector('input')
      if (input instanceof HTMLInputElement && addQuickPhrase(input.value)) {
        render()
        window.setTimeout(() => document.querySelector('.draft-quick-phrase-add input')?.focus(), 0)
      }
    }
    if (button.dataset.action === 'remove-quick-phrase') {
      const index = Number(button.dataset.quickPhraseIndex)
      if (Number.isInteger(index) && index >= 0 && index < state.quickPhrases.length) {
        state.quickPhrases.splice(index, 1)
        persistQuickPhrases()
        render()
      }
    }
    if (button.dataset.action === 'show-portal') { showPortal(); return }
    if (button.dataset.action === 'enter-seat' && typeof button.dataset.workspace === 'string') {
      await enterSeat(button.dataset.workspace, button.classList.contains('portal-card') ? button : undefined)
      return
    }
    if (button.dataset.action === 'close-card-inspector') { closeCardInspector(); return }
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'create-session') openNewSession()
    if (button.dataset.action === 'open-current' && state.currentDsh !== null) {
      await openDshSession(state.currentDsh.id, undefined, undefined)
    }
    if (button.dataset.action === 'select-thread' && thread !== undefined) {
      state.mapCardSessionSwitches.clear()
      state.activeId = thread.id
      state.selectedCardId = null
      state.inspectorCardId = null
      state.inspectorOpening = false
      state.error = ''
      if (state.workspace !== null) revealConversationThread(conversationCards(state.workspace.threads), thread.id)
      render()
      // Bidirectional current-session sync: switch DSH's current session
      // without closing the map; the client confirms via amphoreus:current-session.
      if (thread.dshSessionId !== null) {
        await flushCanvasSaves()
        post('amphoreus:activate-session', { sessionId: thread.dshSessionId })
      }
    }
    if (button.dataset.action === 'show-thread' && thread !== undefined) {
      state.activeId = thread.id
      state.mode = 'thread'
      state.detailTargetCardId = button.dataset.card ?? null
      if (thread.dshSessionId !== null && thread.dshSessionId !== state.currentSessionId) {
        await flushCanvasSaves()
        post('amphoreus:activate-session', { sessionId: thread.dshSessionId })
      }
      render()
    }
    if (button.dataset.action === 'show-canvas') { state.mode = 'canvas'; render() }
    if (button.dataset.action === 'toggle-card-children' && button.dataset.card !== undefined) {
      const cardId = button.dataset.card
      const collapsing = !state.collapsedCardIds.has(cardId)
      if (collapsing && state.workspace !== null) {
        const allCards = conversationCards(state.workspace.threads)
        const nextCollapsed = new Set(state.collapsedCardIds).add(cardId)
        const visibleCards = conversationGraphView(allCards, nextCollapsed).cards
        const visibleIds = new Set(visibleCards.map(card => card.id))
        const draftParentId = draftPlacement(allCards)?.parent.id
        if (draftParentId !== undefined && !visibleIds.has(draftParentId)) return setError('请先完成或取消正在编辑的追问或分支')
        if (state.activeId !== null && !visibleCards.some(card => card.dshThreadId === state.activeId)) return setError('当前会话位于这个后续分支中，请先切换会话')
      }
      collapsing ? state.collapsedCardIds.add(cardId) : state.collapsedCardIds.delete(cardId)
      persistCollapsedCards(cardId)
      render()
      window.setTimeout(() => document.querySelector(`[data-action="toggle-card-children"][data-card="${selectorValue(cardId)}"]`)?.focus(), 0)
    }
    if (button.dataset.action === 'open-continue' && thread !== undefined) openContinue(thread, button.dataset.card)
    if (button.dataset.action === 'open-branch' && thread !== undefined) {
      const requestedSeq = Number(button.dataset.seq)
      if (button.dataset.card !== undefined && !Number.isInteger(requestedSeq)) return setError('请等待这张卡片的最终回答后再创建分支')
      const fallbackSeq = latestMessage(thread, 'assistant')?.sourceSeq
      openBranch(thread, Number.isInteger(requestedSeq) ? requestedSeq : fallbackSeq, button.dataset.card)
    }
    if (button.dataset.action === 'cancel-draft') { state.draft = null; state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'toggle-message' && button.dataset.message !== undefined) { state.expandedMessageIds.has(button.dataset.message) ? state.expandedMessageIds.delete(button.dataset.message) : state.expandedMessageIds.add(button.dataset.message); renderPreservingDetailScroll() }
    if (button.dataset.action === 'open-dsh' && typeof thread?.dshSessionId === 'string') {
      await openDshSession(thread.dshSessionId, button.dataset.seq, button.dataset.turn)
    }
    if (button.dataset.action === 'archive-thread' && thread !== undefined) await archiveThread(thread)
    if (button.dataset.action === 'zoom-in') zoomCanvasAtCenter(.1)
    if (button.dataset.action === 'zoom-out') zoomCanvasAtCenter(-.1)
    if (button.dataset.action === 'focus-active') focusActiveCard()
    if (button.dataset.action === 'dismiss-error') { state.error = ''; render() }
    if (button.dataset.action === 'layout' && state.workspace !== null) {
      resetCardPositions()
      resetCanvasCamera()
      render()
    }
  } catch (error) { setError(error) }
})

app.addEventListener('change', event => {
  const quickPhrase = event.target instanceof Element ? event.target.closest('[data-quick-phrase-index]') : null
  if (quickPhrase instanceof HTMLInputElement) {
    updateQuickPhrase(Number(quickPhrase.dataset.quickPhraseIndex), quickPhrase.value)
  }
})
app.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLTextAreaElement && input.closest('[data-draft]') && state.draft !== null) state.draft.text = input.value })
app.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  if (form.matches('[data-draft]')) { event.preventDefault(); void submitDraft(); return }
  const thread = state.workspace?.threads.find(item => item.id === form.dataset.compose)
  const input = form.querySelector('textarea')
  if (thread === undefined || !(input instanceof HTMLTextAreaElement) || input.value.trim() === '') return
  event.preventDefault()
  const text = input.value.trim()
  input.value = ''
  void sendMessage(thread, text).catch(setError)
})

function completeMapOpen() {
  if (state.mode === 'thread') state.mode = 'canvas'
  render()
  void refreshIndex().catch(setError)
  post('amphoreus:seat-changed', { heroId: typeof state.seatId === 'string' && state.seatId.startsWith('seat:') ? state.seatId.slice(5) : null })
  window.requestAnimationFrame(() => post('amphoreus:map-ready'))
  window.setTimeout(() => post('amphoreus:map-ready'), 240)
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.source !== 'dsh-amphoreus') return
  const data = event.data
  if (data.type === 'amphoreus:map-opened') {
    // Reopening keeps the current surface; remounts restore the last valid
    // seat before the parent bridge sends this handshake.
    if (state.bootstrapped) completeMapOpen()
    else state.mapOpenPending = true
  }
  if (data.type === 'amphoreus:theme') {
    document.documentElement.dataset.theme = data.dark === true ? 'dark' : 'light'
  }
  if (data.type === 'amphoreus:theme-tokens') {
    if (!trustedThemeTokenEvent(event)) return
    if (!applyThemeTokensMessage(data)) return
    if (state.mode !== 'portal') {
      syncCurrentMotif(data.dark === true)
      if (canReplaceView()) render()
      else deferCanvasRefresh()
    }
  }
  if (data.type === 'amphoreus:magazine-mode' && (data.mode === 'light' || data.mode === 'full') && data.mode !== state.magazineMode) {
    state.magazineMode = data.mode
    document.documentElement.dataset.magazine = data.mode
    if (state.mode !== 'portal') {
      if (canReplaceView()) render()
      else deferCanvasRefresh()
    } else render()
  }
  if (data.type === 'amphoreus:workspaces') {
    applyWorkspaces(data)
  }
  if (data.type === 'amphoreus:current-session') {
    const previousId = state.currentDsh?.id
    state.currentDsh = data.session
    state.currentSessionId = typeof data.session?.id === 'string' ? data.session.id : null
    const preserveCanvasCamera = previousId !== data.session?.id && state.mapCardSessionSwitches.delete(data.session?.id)
    if (state.mode === 'portal') return
    const thread = currentDshThread()
    if (thread !== undefined) {
      const preserveSelectedCard = state.activeId === thread.id
      state.activeId = thread.id
      if (!preserveSelectedCard) {
        state.selectedCardId = null
        state.inspectorCardId = null
        state.inspectorOpening = false
      }
      if (state.workspace !== null) revealConversationThread(conversationCards(state.workspace.threads), thread.id)
      if (previousId !== data.session?.id && canReplaceView()) {
        render()
        if (!preserveCanvasCamera) focusActiveCard()
        return
      }
    }
    if (canReplaceView()) render()
  }
  if (data.type === 'amphoreus:messages' && typeof data.sessionId === 'string' && !isHidden(data.sessionId) && Array.isArray(data.messages)) {
    const revision = Number.isSafeInteger(data.revision) ? data.revision : 0
    const previousRevision = state.historyRevisionBySession.get(data.sessionId) ?? -1
    if (revision > previousRevision) {
      state.historyRevisionBySession.set(data.sessionId, revision)
      state.historyCompleteBySession.set(data.sessionId, data.complete === true)
      const messages = data.messages.map(message => ({
        kind: message.kind,
        text: message.text,
        at: message.time,
        sourceSeq: message.seq,
        turn: message.turn,
        step: message.step,
        process: message.process,
        anchorKey: message.anchorKey,
      }))
      state.historyBySession.set(data.sessionId, messages)
      const thread = state.workspace?.threads.find(item => item.dshSessionId === data.sessionId)
      if (thread !== undefined) settlePendingReply(thread, messages)
      if (canReplaceView()) renderPreservingDetailScroll()
    }
  }
  if (data.type === 'amphoreus:config' && Number.isSafeInteger(data.cardTextLimit) && data.cardTextLimit > 0) {
    state.cardTextLimit = data.cardTextLimit
    scheduleViewRefresh()
  }
  if (data.type === 'amphoreus:live-reply' && typeof data.sessionId === 'string' && !isHidden(data.sessionId)) {
    const thread = state.workspace?.threads.find(item => item.dshSessionId === data.sessionId)
    if (thread !== undefined) {
      if (data.running === true) {
        state.liveReplies.set(data.sessionId, { running: true, text: typeof data.text === 'string' ? data.text : '' })
        // Streaming: patch the live card's answer in place instead of
        // rebuilding the whole canvas on every chunk; a full render reconciles
        // at stream end. The detail view is single-thread, so keep its cheap
        // throttled full render.
        if (state.mode === 'canvas') scheduleLiveCardUpdate(data.sessionId)
        else if (canReplaceView()) scheduleLiveRender()
      } else {
        state.liveReplies.delete(data.sessionId)
        if (canReplaceView() || state.pendingReplies.has(data.sessionId)) renderPreservingDetailScroll()
      }
    }
  }
  if (data.type === 'amphoreus:forked-session' || data.type === 'amphoreus:created-session' || data.type === 'amphoreus:message-sent') settleRpc(data.requestId, data.session ?? data)
  if (data.type === 'amphoreus:bridge-error') { settleRpc(data.requestId, undefined, new Error(data.message)); if (data.requestId === undefined) setError(data.message) }
})

let liveRenderTimer = 0
let liveCardFrame = 0
let liveCardSessionId = null
function scheduleLiveCardUpdate(sessionId) {
  // Coalesce streaming chunks to one DOM patch per animation frame.
  liveCardSessionId = sessionId
  if (liveCardFrame !== 0) return
  liveCardFrame = window.requestAnimationFrame(() => {
    liveCardFrame = 0
    if (liveCardSessionId === null) return
    const id = liveCardSessionId
    liveCardSessionId = null
    applyLiveReplyToCard(id)
  })
}
function applyLiveReplyToCard(sessionId) {
  if (state.mode !== 'canvas') return
  // Never patch cards mid-gesture: the reflow would compete with the drag or
  // pan frame; the next live-reply chunk re-applies after the gesture ends.
  if (state.dragging || state.canvasGesture) return
  const thread = state.workspace?.threads.find(item => item.dshSessionId === sessionId)
  if (thread === undefined) return
  const live = state.liveReplies.get(sessionId)
  if (live?.running !== true) return
  const cards = app.querySelectorAll(`.thread-card[data-thread="${CSS.escape(thread.id)}"]`)
  const card = cards[cards.length - 1]
  if (!(card instanceof HTMLElement)) return
  const answer = card.querySelector('.thread-answer')
  if (!(answer instanceof HTMLElement)) return
  const text = clampCardText(live.text)
  answer.innerHTML = text.trim() === ''
    ? '<p class="thread-answer-pending">正在回复</p>'
    : `${renderMarkdown(text)}<p class="thread-answer-pending">正在回复</p>`
}
function scheduleLiveRender() {
  if (liveRenderTimer !== 0 || !canReplaceView()) return
  liveRenderTimer = window.setTimeout(() => {
    liveRenderTimer = 0
    if (canReplaceView()) renderPreservingDetailScroll()
  }, 120)
}

let indexRefreshTimer = 0
function scheduleIndexRefresh() {
  if (document.hidden || indexRefreshTimer !== 0) return
  indexRefreshTimer = window.setTimeout(() => {
    indexRefreshTimer = 0
    if (!document.hidden) void refreshIndex().catch(setError)
  }, 120)
}

function connectEvents() {
  if (state.eventSource !== null) return
  const es = new EventSource('/amphoreus/api/events')
  state.eventSource = es
  es.addEventListener('workbench-change', scheduleIndexRefresh)
  es.addEventListener('snapshot', () => { /* Seats and sessions arrive through the parent bridge. */ })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (indexRefreshTimer !== 0) window.clearTimeout(indexRefreshTimer)
      indexRefreshTimer = 0
      return
    }
    void refreshIndex().catch(setError)
  })
}

window.addEventListener('pagehide', flushCanvasKeepalive)

const BOOT_RETRY_MS = 1000
let bootInFlight = false
let bootRetryTimer = 0

function scheduleBootRetry() {
  if (state.bootstrapped || bootInFlight || bootRetryTimer !== 0) return
  bootRetryTimer = window.setTimeout(() => {
    bootRetryTimer = 0
    void bootWorkbench()
  }, BOOT_RETRY_MS)
}

async function bootWorkbench() {
  if (state.bootstrapped || bootInFlight) return
  bootInFlight = true
  state.error = ''
  try {
    const bootState = await api('/amphoreus/api/state')
    await hydrateBootState(bootState)
    if (!state.persistenceHydrated) throw persistenceUnavailableError()
  } catch (error) {
    state.persistenceHydrated = false
    setError(error)
    bootInFlight = false
    scheduleBootRetry()
    return
  }
  post('amphoreus:request-current')
  post('amphoreus:request-config')
  try { await refreshIndex() } catch (error) { setError(error) }
  connectEvents()
  state.bootstrapped = true
  bootInFlight = false
  if (state.mapOpenPending) {
    state.mapOpenPending = false
    completeMapOpen()
  }
}

void bootWorkbench()
