import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createProfile, installerEnvironment } from './host-kit-runtime.mjs'

const { values } = parseArgs({ options: { kit: { type: 'string' }, suite: { type: 'string' } } })
if (!values.kit) throw new Error('Usage: node scripts/host-kit-smoke.mjs --kit <installed host kit>')
const kit = resolve(values.kit)
const home = mkdtempSync(join(tmpdir(), 'amphoreus-host-smoke-'))
if (values.suite) {
  const profile = createProfile(home)
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: amphoreus\n  config:\n    skillRoots: [${JSON.stringify(resolve(values.suite).replaceAll('\\', '/'))}]\n`)
}
const server = createServer()
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const child = spawn(process.execPath, [join(kit, 'runtime.mjs'), 'start', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: kit, windowsHide: true, detached: process.platform !== 'win32',
  env: { ...installerEnvironment(), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
let errors = ''
child.stdout.setEncoding('utf8').on('data', text => { output += text })
child.stderr.setEncoding('utf8').on('data', text => { errors += text })
const redact = text => text.replace(/([?&]token=)[^\s&"']+/gu, '$1[redacted]')
try {
  const deadline = Date.now() + 120000
  let url
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Host exited (${child.exitCode}): ${redact(errors)}`)
    url = output.match(/https?:\/\/127\.0\.0\.1:[0-9]+\/\?token=[^\s]+/u)?.[0]
    if (url) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(url, `Host did not become ready: ${redact(errors)}`)
  const authentication = await fetch(url, { redirect: 'manual' })
  assert.equal(authentication.status, 303)
  const cookie = authentication.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const origin = `http://127.0.0.1:${port}`
  let page
  let html = ''
  let bootReady = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    page = await fetch(`${origin}/`, { headers: { Cookie: cookie } })
    assert.equal(page.status, 200)
    html = await page.text()
    if (html.includes('__AMPHOREUS_BOOT__')) { bootReady = true; break }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(bootReady, `Plugin host did not inject its boot payload: ${redact(errors)}`)
  let response
  let state
  for (let attempt = 0; attempt < 80; attempt += 1) {
    response = await fetch(`${origin}/amphoreus/api/state`, { headers: { Cookie: cookie } })
    assert.equal(response.status, 200)
    state = await response.json()
    if (!values.suite || (state.seats?.length === 13 && state.suite?.level === 'L0')) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(Array.isArray(state.seats), 'Plugin API did not return seats.')
  if (values.suite) {
    assert.equal(state.seats.length, 13)
    assert.equal(state.suite?.level, 'L0')
  }
  const clientPath = [...html.matchAll(/\/?plugins\/\?\?[^"'<>\\\s]+/gu)].map(match => match[0]).find(path => path.includes('dsh-amphoreus/client.js'))
  assert.ok(clientPath, 'The DSH boot graph did not advertise the plugin client bundle.')
  const client = await fetch(new URL(clientPath.replaceAll('&amp;', '&'), `${origin}/`), { headers: { Cookie: cookie } })
  assert.equal(client.status, 200)
  assert.match(await client.text(), /window\.__ModuleLoader__\.load\(\{\s*id:\s*"dsh-amphoreus"/u)
  const workbench = await fetch(`${origin}/amphoreus/workbench/`, { headers: { Cookie: cookie } })
  assert.equal(workbench.status, 200)
  const workspace = readFileSync(join(kit, 'node_modules', '@deepseek-ai', 'dsh-workspace', 'lib', 'index.js'), 'utf8')
  assert.ok(workspace.includes('setHiddenByOwner') && workspace.includes('workspace_visibility'))
  console.log(JSON.stringify({ ok: true, host: '0.2.1-rc.2', authenticatedIndex: page.status, pluginState: response.status, clientBundle: client.status, workbench: workbench.status, seats: state.seats.length, suiteLevel: state.suite?.level, isolatedHome: home }, null, 2))
} finally {
  if (child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  }
}
