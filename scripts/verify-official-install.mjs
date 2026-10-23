import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const json = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const redact = value => value.replace(/([?&]token=)[^\s&"']+/gu, '$1[redacted]')

export function isolatedEnvironment(directory, identity) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(?:DSH_|ELECTRON_|NODE_|NARB_|npm_|pnpm_|corepack_)/iu.test(name)
    && !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/iu.test(name)))
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: join(directory, 'home'),
    DSH_CLIENT_VERSION: identity,
    HOME: directory,
    USERPROFILE: directory,
    APPDATA: join(directory, 'appdata'),
    LOCALAPPDATA: join(directory, 'localappdata'),
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    XDG_STATE_HOME: join(directory, 'state'),
    NARB_NATIVE_CACHE_DIR: join(directory, 'native-cache'),
    npm_config_userconfig: join(directory, 'npmrc'),
    npm_config_globalconfig: join(directory, 'npmrc'),
    npm_config_store_dir: join(directory, 'store'),
    npm_config_enable_global_virtual_store: 'false',
  }
}

async function execute(executable, args, options = {}) {
  const child = spawn(executable, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout: redact(stdout), stderr: redact(stderr) }))
  })
}

async function stockWorker(desktop, directory) {
  const runtime = join(desktop, 'resources', 'app.asar', 'dsh')
  const app = json(join(desktop, 'resources', 'app.asar', 'package.json'))
  const descriptor = json(join(runtime, 'desktop-runtime.json'))
  const { initProfile, PROFILE_TEMPLATES } = await import(pathToFileURL(join(runtime, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')))
  initProfile(join(directory, 'home', 'profiles', 'desktop'), PROFILE_TEMPLATES.web.bundles)
  process.stdout.write(JSON.stringify({ version: app.version, buildCommit: app.dshBuildCommit, release: descriptor.release }))
}

export async function bootStockHost({ executable, runtime, support, profile, environment, directory, phase }) {
  const entry = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  const child = spawn(executable, ['--expose-internals', entry, runtime, profile,
    join(support, 'primary-runtime'), join(support, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'), join(support, 'bin')], {
    cwd: profile, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stdout = ''
  let stderr = ''
  let graceful = false
  let ready
  const errors = []
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const exit = new Promise(resolvePromise => child.once('close', code => resolvePromise(code)))
  let timer
  const startup = await new Promise((resolvePromise, reject) => {
    timer = setTimeout(() => resolvePromise({ status: 'timeout' }), 90000)
    child.once('error', reject)
    child.once('close', code => resolvePromise({ status: 'exited', code }))
    child.on('message', message => {
      if (message?.type === 'ready') {
        ready = message
        resolvePromise({ status: 'ready' })
      } else if (message?.type === 'fatal') {
        errors.push({ message: message.message, diagnostic: redact(message.diagnostic ?? '') })
        resolvePromise({ status: 'fatal', error: message.message })
      } else if (message?.type === 'shutdown-complete') graceful = true
    })
  })
  clearTimeout(timer)
  let authentication
  if (ready) {
    const login = await fetch(ready.url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const origin = new URL(ready.url).origin
    authentication = { origin, cookie }
  }
  return {
    startup,
    errors,
    bootGraph: ready?.injections?.find(injection => injection.name === '__DSH_BOOT__')?.value,
    request: authentication ? async (path, options = {}) => fetch(new URL(path, authentication.origin), {
      ...options, headers: { cookie: authentication.cookie, origin: authentication.origin, ...options.headers }, signal: AbortSignal.timeout(20000),
    }) : undefined,
    unauthenticatedRequest: authentication ? async path => fetch(new URL(path, authentication.origin), { signal: AbortSignal.timeout(20000) }) : undefined,
    stop: async () => {
      if (child.connected) child.send({ type: 'shutdown' })
      let shutdownTimer
      const code = await Promise.race([exit, new Promise(resolvePromise => { shutdownTimer = setTimeout(() => resolvePromise(undefined), 15000) })])
      clearTimeout(shutdownTimer)
      if (code === undefined) child.kill()
      writeFileSync(join(directory, `${phase}.stdout.log`), redact(stdout))
      writeFileSync(join(directory, `${phase}.stderr.log`), redact(stderr))
      return { code, graceful, errors }
    },
  }
}

export function parseBootGraph(html) {
  const value = /<script>globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/u.exec(html)?.[1]
  return value === undefined ? undefined : JSON.parse(value)
}

async function currentClient(host) {
  const response = await host.request('/')
  const graph = parseBootGraph(await response.text())
  const entry = graph?.entries?.find(entry => entry.id === 'dsh-amphoreus')
  const previous = host.bootGraph?.entries?.find(entry => entry.id === 'dsh-amphoreus')
  const client = await host.request(entry?.url ?? previous?.url ?? '/plugins/??dsh-amphoreus/client.js')
  return { status: client.status, graphHasPlugin: Boolean(entry), graphRev: graph?.rev, entryRev: entry?.rev }
}

export async function inspectPlugin(host) {
  if (!host.request) return { startup: host.startup }
  const frontend = await host.request('/')
  const html = await frontend.text()
  let state
  let stateStatus
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await host.request('/amphoreus/api/state')
    stateStatus = response.status
    if (response.ok) { state = await response.json(); break }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  const clientEntry = parseBootGraph(html)?.entries?.find(entry => entry.id === 'dsh-amphoreus')
  const client = await host.request(clientEntry?.url ?? '/plugins/??dsh-amphoreus/client.js')
  const diagnosticsResponse = await host.request('/official-test/diagnostics')
  const diagnostics = diagnosticsResponse.ok ? await diagnosticsResponse.json() : undefined
  const result = {
    startup: host.startup,
    frontendStatus: frontend.status,
    frontendHasPlugin: html.includes('dsh-amphoreus'),
    stateStatus,
    clientStatus: client.status,
    clientType: client.headers.get('content-type'),
    diagnostics,
  }
  if (state) {
    result.seatCount = state.seats?.length
    result.derivedCount = state.assets?.derivedCount
    result.setupNeeded = state.effectiveConfig?.setupNeeded
    result.backgroundMode = state.effectiveConfig?.wallpaper?.mode
    result.heroWorkspaceMode = state.effectiveConfig?.heroWorkspaceMode
    result.stickerSources = state.stickerSources ?? {}
    result.visualDefaults = { magazineMode: state.effectiveConfig?.magazineMode, codeBackground: state.effectiveConfig?.codeBackground,
      mascot: state.effectiveConfig?.grammar?.mascot, ambient: state.effectiveConfig?.grammar?.ambient }
    result.assets = []
    for (const asset of state.assets?.derived ?? []) {
      const response = await host.request(`/amphoreus/derived/${asset}`, { method: 'HEAD' })
      result.assets.push({ path: asset, status: response.status, type: response.headers.get('content-type') })
    }
    result.covers = []
    for (const asset of (state.assets?.derived ?? []).filter(path => path.endsWith('/cover-34.webp'))) {
      const response = await host.request(`/amphoreus/derived/${asset}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      result.covers.push({ path: asset, status: response.status, bytes: bytes.length,
        webp: bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
        sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    const before = await host.request('/amphoreus/api/prefs').then(response => response.json())
    const mutation = await host.request('/amphoreus/api/prefs', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': state.nonce }, body: '{}',
    })
    const after = await host.request('/amphoreus/api/prefs').then(response => response.json())
    result.sameValuePut = { status: mutation.status, unchanged: JSON.stringify(before) === JSON.stringify(after) }
  }
  return result
}

export function verifyInstallReport(report, options = {}) {
  const failures = []
  const require = (condition, message) => { if (!condition) failures.push(message) }
  require(report.install?.code === 0, 'official CLI installation failed')
  require(report.stockUnmodified === true, 'official installation bytes changed')
  const first = report.checks?.find(check => check.phase === 'enabled')
  if (options.expectFailure) {
    require(first?.stateStatus === 404, 'old plugin failure was not reproduced')
    require(first?.diagnostics?.workspaceSetHiddenByOwner === 'undefined', 'stock workspace capability did not match the reproduction')
    require(first?.diagnostics?.rejectionProbe?.includes('setHiddenByOwner'), 'old plugin guard rejection was not captured')
    require(report.enabledShutdown?.code === 0 && report.enabledShutdown?.graceful === true, 'reproduction host did not stop cleanly')
    return { passed: failures.length === 0, failures }
  }
  const phases = options.lifecycle ? ['enabled', 'disabled', 'reenabled', 'uninstalled'] : ['enabled']
  for (const phase of phases) {
    const check = report.checks?.find(check => check.phase === phase)
    const active = phase === 'enabled' || phase === 'reenabled'
    require(check?.startup?.status === 'ready' && check?.frontendStatus === 200, `${phase}: stock host did not become usable`)
    require(check?.stateStatus === (active ? 200 : 404), `${phase}: unexpected plugin API status`)
    require(check?.clientStatus === (active ? 200 : 404), `${phase}: unexpected plugin client status`)
    require(check?.frontendHasPlugin === active, `${phase}: unexpected frontend boot entry`)
    require(report[`${phase === 'enabled' ? 'enabled' : phase}Shutdown`]?.code === 0
      && report[`${phase === 'enabled' ? 'enabled' : phase}Shutdown`]?.graceful === true, `${phase}: host did not stop cleanly`)
    require(check?.diagnostics?.logs?.length === 0, `${phase}: host reported runtime errors`)
    if (!active) continue
    require(check?.diagnostics?.plugins?.some(plugin => plugin.enabled && plugin.fiberPhase === 'active'), `${phase}: plugin is not active`)
    require(check?.sameValuePut?.status === 200 && check?.sameValuePut?.unchanged === true, `${phase}: authenticated preference write changed data or failed`)
    if (options.expectedSeats !== undefined) require(check?.seatCount === options.expectedSeats, `${phase}: wrong seat count`)
    require((check?.assets ?? []).every(asset => asset.status === 200 && asset.type?.startsWith('image/')), `${phase}: a derived asset failed`)
    require((check?.covers ?? []).every(cover => cover.status === 200 && cover.webp === true && cover.bytes > 0), `${phase}: a cover is not valid WebP`)
    if (options.expectedAssets !== undefined) {
      require(check?.derivedCount === options.expectedAssets && check?.assets?.length === options.expectedAssets, `${phase}: wrong derived asset count`)
      require(check?.covers?.length === (options.expectedSeats ?? 13), `${phase}: missing role covers`)
      require(check?.setupNeeded === false && check?.backgroundMode === 'preset', `${phase}: artwork was not configured automatically`)
      const visual = check?.visualDefaults
      require(visual?.magazineMode === 'full' && visual?.codeBackground?.enabled === true && visual?.codeBackground?.intensity === 0.7
        && visual?.codeBackground?.interactive === true && visual?.mascot === 'reactive' && visual?.ambient === true, `${phase}: bundled visual defaults differ`)
    }
  }
  if (options.lifecycle) {
    const live = report.liveToggle
    require(live?.disableStatus === 200 && live?.disabledApiStatus === 404 && live?.disabledClientStatus === 404
      && live?.enableStatus === 200 && live?.enabledApiStatus === 200 && live?.enabledClientStatus === 200
      && live?.storeUnchangedWhileDisabled === true, 'live plugin-manager disable/re-enable failed or changed data')
    require(report.createdWorkspace?.status === 200 && report.workspacePreserved === true, 'seat workspace did not survive the lifecycle')
    require(report.disabledStoreUnchanged === true, 'disabling the plugin changed its stored data')
    require(report.uninstall?.code === 0 && report.userStorePreserved === true, 'uninstall failed or changed plugin data')
  }
  if (options.sticker) {
    require(report.stockSticker?.authenticatedStatus === 200 && report.stockSticker?.type?.startsWith('image/')
      && report.stockSticker?.matchesOriginal === true && report.stockSticker?.unauthenticatedStatus === 401,
    'official local-file image route or authentication failed')
    require(report.stickerMapping?.count > 0 && report.stickerMapping?.status === 200 && report.stickerMapping?.matchesOriginal === true,
      'validated sticker path mapping or mapped image failed')
  }
  return { passed: failures.length === 0, failures }
}

async function main() {
  const { values } = parseArgs({ options: {
    desktop: { type: 'string' }, tarball: { type: 'string' }, out: { type: 'string' },
    'expect-failure': { type: 'boolean' }, lifecycle: { type: 'boolean' },
    'skills-root': { type: 'string' }, sticker: { type: 'string' }, worker: { type: 'boolean' },
    'expect-assets': { type: 'string' }, 'expect-seats': { type: 'string' },
  } })
  for (const name of ['desktop', 'out']) if (!values[name]) throw new Error(`--${name} is required`)
  const desktop = resolve(values.desktop)
  const directory = resolve(values.out)
  if (values.worker) { await stockWorker(desktop, directory); return }
  if (!values.tarball) throw new Error('--tarball is required')
  if (existsSync(directory)) throw new Error('Use a new isolated output directory')
  const executable = join(desktop, 'DeepSeek Harness.exe')
  const runtime = join(desktop, 'resources', 'app.asar', 'dsh')
  const support = join(desktop, 'resources', 'runtime')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'npmrc'), '')
  const environment = isolatedEnvironment(directory, '0.2.1-rc.2')
  const worker = await execute(executable, ['--expose-internals', fileURLToPath(import.meta.url), '--worker', '--desktop', desktop, '--out', directory], { cwd: directory, env: environment })
  if (worker.code !== 0) throw new Error(`Official profile initialization failed: ${worker.stderr}`)
  const identity = JSON.parse(worker.stdout)
  const baseline = { executable: sha256(executable), archive: sha256(join(desktop, 'resources', 'app.asar')) }
  const profile = join(directory, 'home', 'profiles', 'desktop')
  const diagnostic = join(directory, 'diagnostics.mjs')
  const rejectionProbe = values['expect-failure'] ? `
    let rejectionProbe
    if (typeof workspace?.setHiddenByOwner !== 'function') {
      const plugin = await import(pathToFileURL(createRequire(${JSON.stringify(join(profile, 'package.json'))}).resolve('dsh-amphoreus')))
      if (String(plugin.apply).includes('requireWorkspaceVisibility')) {
        let effect
        plugin.apply({ get: name => name === 'workspaceRegistry' ? workspace : undefined,
          effect: callback => { effect = Promise.resolve().then(callback); return () => {} } }, {})
        try { await effect } catch (error) { rejectionProbe = error.message }
      }
    }
` : '    const rejectionProbe = undefined\n'
  writeFileSync(diagnostic, `import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
export const inject = ['webServer', 'pluginManager', 'workspaceRegistry']
export function apply(ctx) {
  for (const [operation, enabled] of [['disable', false], ['enable', true]]) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/official-test/' + operation, async handler(request, response) {
      if (request.method !== 'POST') { response.statusCode = 405; response.end(); return }
      response.setHeader('content-type', 'application/json')
      try {
        const plugin = (await ctx.pluginManager.listPlugins()).find(entry => entry.moduleName === 'dsh-amphoreus')
        if (!plugin) throw new Error('Test plugin entry is unavailable')
        response.end(JSON.stringify(await ctx.pluginManager.setPluginEnabled(plugin.entryId, enabled)))
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })) }
    } }))
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/official-test/create-seat-workspace', async handler(request, response) {
    if (request.method !== 'POST') { response.statusCode = 405; response.end(); return }
    response.setHeader('content-type', 'application/json')
    try {
      const workspace = await ctx.get('workspaceRegistry').create(${JSON.stringify(join(profile, '..', '..', 'amphoreus', 'seats', 'aglaea'))})
      response.end(JSON.stringify({ id: workspace.id, path: workspace.path }))
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })) }
  } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/official-test/diagnostics', async handler(_request, response) {
    const workspace = ctx.get('workspaceRegistry')
${rejectionProbe}
    const rows = [...ctx.loader.entries()].filter(entry => entry.options.name === 'dsh-amphoreus')
    const plugins = (await ctx.pluginManager.listPlugins()).filter(entry => entry.moduleName === 'dsh-amphoreus').map(({ meta, ...entry }) => entry)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ plugins, rejectionProbe, workspaceSetHiddenByOwner: typeof workspace?.setHiddenByOwner,
      workspaces: workspace?.list().map(item => ({ id: item.id, path: item.path })),
      services: Object.fromEntries(['webServer', 'connection', 'skills', 'storageDomain', 'sessions', 'sessionPersistence', 'agents', 'commands', 'workspaceRegistry'].map(name => [name, Boolean(ctx.get(name))])),
      failures: rows.map(entry => ({ id: entry.options.id, phase: entry.fiber?.state })),
      logs: ctx.logger.buffer.filter(message => message.type === 'error').map(message => ({ name: message.name, type: message.type,
        message: message.args.map(value => value instanceof Error ? value.stack : String(value)).join(' ') })) }))
  } }))
}
`)
  const configuredSkills = values['skills-root'] ? `- id: amphoreus\n  config:\n    skillRoots: [${JSON.stringify(resolve(values['skills-root']))}]\n` : ''
  writeFileSync(join(profile, 'cordis.patch.yml'), configuredSkills + `- insert:\n    - id: official-test-diagnostics\n      name: ${JSON.stringify(diagnostic.replaceAll('\\', '/'))}\n`)
  const cli = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  const runCli = async (args, name) => {
    const result = await execute(executable, ['--expose-internals', cli, 'plugin', '--profile', 'desktop', ...args], { cwd: directory, env: environment })
    writeFileSync(join(directory, `${name}.stdout.log`), result.stdout)
    writeFileSync(join(directory, `${name}.stderr.log`), result.stderr)
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  }
  const install = await runCli(['add', `file:${resolve(values.tarball)}`, '--ignore-scripts'], 'install')
  const report = { stock: identity, stockHashes: baseline, tarball: { sha256: sha256(resolve(values.tarball)) }, install, checks: [] }
  writeJson(join(directory, 'report.json'), report)
  if (install.code !== 0) throw new Error(`Normal official plugin install failed; inspect ${join(directory, 'install.stderr.log')}`)
  const hostOptions = { executable, runtime, support, profile, environment, directory }
  const host = await bootStockHost({ ...hostOptions, phase: 'enabled' })
  try {
    report.checks.push({ phase: 'enabled', ...await inspectPlugin(host) })
    if (values.lifecycle && report.checks[0].stateStatus === 200) {
      const workspace = await host.request('/official-test/create-seat-workspace', { method: 'POST' })
      const text = await workspace.text()
      report.createdWorkspace = { status: workspace.status, ...(text ? JSON.parse(text) : {}) }
    }
    if (values.sticker && host.request) {
      const path = '/api/file?path=' + encodeURIComponent(resolve(values.sticker))
      const authenticated = await host.request(path)
      const bytes = Buffer.from(await authenticated.arrayBuffer())
      const unauthenticated = await host.unauthenticatedRequest(path)
      const mappings = report.checks[0].stickerSources
      const mappedPath = mappings[resolve(values.sticker).replaceAll('\\', '/')]
      const mappedResponse = mappedPath ? await host.request(mappedPath) : undefined
      const mappedBytes = mappedResponse ? Buffer.from(await mappedResponse.arrayBuffer()) : undefined
      report.stickerMapping = { count: Object.keys(mappings).length, path: mappedPath, status: mappedResponse?.status,
        matchesOriginal: mappedBytes ? createHash('sha256').update(mappedBytes).digest('hex') === sha256(resolve(values.sticker)) : false }
      report.stockSticker = { authenticatedStatus: authenticated.status, type: authenticated.headers.get('content-type'),
        bytes: bytes.length, matchesOriginal: createHash('sha256').update(bytes).digest('hex') === sha256(resolve(values.sticker)),
        unauthenticatedStatus: unauthenticated.status }
    }
    if (values.lifecycle && report.checks[0].stateStatus === 200) {
      const store = join(directory, 'home', 'storages', 'amphoreus.json')
      const before = sha256(store)
      const disabled = await host.request('/official-test/disable', { method: 'POST' })
      const disableResult = await disabled.json()
      const disabledApi = await host.request('/amphoreus/api/state')
      const disabledClient = await currentClient(host)
      const unchanged = before === sha256(store)
      const enabled = await host.request('/official-test/enable', { method: 'POST' })
      const enableResult = await enabled.json()
      const enabledApi = await host.request('/amphoreus/api/state')
      let enabledClient = await currentClient(host)
      const enabledClientStatuses = [enabledClient]
      for (let attempt = 0; (enabledClient.status !== 200 || !enabledClient.graphHasPlugin) && attempt < 20; attempt += 1) {
        await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
        enabledClient = await currentClient(host)
        enabledClientStatuses.push(enabledClient)
      }
      report.liveToggle = { disableStatus: disabled.status, disableResult, disabledApiStatus: disabledApi.status,
        disabledClientStatus: disabledClient.status, enableStatus: enabled.status, enabledApiStatus: enabledApi.status,
        enabledClientStatus: enabledClient.status, enableResult, enabledClientStatuses, storeUnchangedWhileDisabled: unchanged }
    }
  }
  finally { report.enabledShutdown = await host.stop(); writeJson(join(directory, 'report.json'), report) }
  if (values.lifecycle && report.checks[0].stateStatus === 200) {
    const store = join(directory, 'home', 'storages', 'amphoreus.json')
    const beforeStore = existsSync(store) ? sha256(store) : undefined
    const patch = join(profile, 'cordis.patch.yml')
    const original = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
    writeFileSync(patch, original + '\n- id: amphoreus\n  disabled: true\n')
    const disabled = await bootStockHost({ ...hostOptions, phase: 'disabled' })
    try { report.checks.push({ phase: 'disabled', ...await inspectPlugin(disabled) }) }
    finally { report.disabledShutdown = await disabled.stop() }
    report.disabledStoreUnchanged = beforeStore !== undefined && existsSync(store) && sha256(store) === beforeStore
    writeFileSync(patch, original)
    const enabled = await bootStockHost({ ...hostOptions, phase: 'reenabled' })
    try { report.checks.push({ phase: 'reenabled', ...await inspectPlugin(enabled) }) }
    finally { report.reenabledShutdown = await enabled.stop() }
    const beforeUninstall = existsSync(store) ? sha256(store) : undefined
    report.uninstall = await runCli(['remove', 'dsh-amphoreus'], 'uninstall')
    const removed = await bootStockHost({ ...hostOptions, phase: 'uninstalled' })
    try { report.checks.push({ phase: 'uninstalled', ...await inspectPlugin(removed) }) }
    finally { report.uninstalledShutdown = await removed.stop() }
    report.userStorePreserved = beforeUninstall !== undefined && existsSync(store) && sha256(store) === beforeUninstall
    report.workspacePreserved = report.createdWorkspace?.status === 200 && report.checks.slice(1).every(check =>
      check.diagnostics?.workspaces?.some(workspace => workspace.id === report.createdWorkspace.id && workspace.path === report.createdWorkspace.path))
  }
  report.stockUnmodified = baseline.executable === sha256(executable) && baseline.archive === sha256(join(desktop, 'resources', 'app.asar'))
  report.expectedFailureReproduced = values['expect-failure'] ? report.checks[0].stateStatus !== 200 && JSON.stringify(report).includes('setHiddenByOwner') : undefined
  const count = (value, fallback) => {
    if (value === undefined) return fallback
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Expected counts must be positive integers')
    return parsed
  }
  report.verification = verifyInstallReport(report, { expectFailure: values['expect-failure'], lifecycle: values.lifecycle,
    sticker: Boolean(values.sticker), expectedSeats: count(values['expect-seats'], values['skills-root'] ? 13 : undefined),
    expectedAssets: count(values['expect-assets']) })
  writeJson(join(directory, 'report.json'), report)
  console.log(JSON.stringify({ report: join(directory, 'report.json'), installCode: install.code, checks: report.checks.map(({ assets, covers, diagnostics, stickerSources, ...check }) => ({ ...check, assets: assets?.length, covers: covers?.length, stickerSources: stickerSources ? Object.keys(stickerSources).length : undefined })), stockUnmodified: report.stockUnmodified, expectedFailureReproduced: report.expectedFailureReproduced, verification: report.verification }))
  if (!report.verification.passed) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(redact(String(error))); process.exitCode = 1 })
