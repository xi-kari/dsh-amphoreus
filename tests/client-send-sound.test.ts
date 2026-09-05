/** Source pins for the send-click sentinel and the settings sound panel wiring. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'
import { slotsForHero } from '../src/client/seat-sounds.ts'

const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const sendSound = readFileSync(new URL('../src/client/send-sound.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/client/sound-panel.tsx', import.meta.url), 'utf8')
const panelCss = readFileSync(new URL('../src/client/sound-panel.module.css', import.meta.url), 'utf8')
const state = readFileSync(new URL('../src/client/state.ts', import.meta.url), 'utf8')

test('send sentinel is the second entry inside the single conversation.input.dock inject callback, order 31, null render', () => {
  const start = client.indexOf("ctx.slots.inject('conversation.input.dock'")
  assert.ok(start >= 0)
  const end = client.indexOf('// @anchor client-tail', start)
  const block = client.slice(start, end)
  assert.match(block, /ctx\.slots\.inject\('conversation\.input\.dock', \(\) => \[ctx\.slots\.register\(\{/u, 'callback returns an array of registrations')
  const handoff = block.indexOf("id: 'amphoreus-handoff'")
  const sentinel = block.indexOf("id: 'amphoreus-send-sound'")
  assert.ok(handoff >= 0 && sentinel > handoff, 'sentinel follows the handoff dock')
  const sentinelBlock = block.slice(sentinel)
  assert.match(sentinelBlock, /order: 31/u)
  assert.match(sentinelBlock, /inject: \(\) => \(\{ player: soundPlayer, model, seat: seatWatch \}\)/u)
  assert.match(sentinelBlock, /\}, SendSound\)\]\)/u)
  assert.equal(client.match(/ctx\.slots\.inject\('conversation\.input\.dock'/gu)?.length, 1, 'call list pin: still one inject call')
  assert.equal(client.match(/const soundPlayer = createSeatSoundPlayer\(\)/gu)?.length, 1)
  assert.match(client, /installSeatSounds\(\{ seat: seatWatch, model, player: soundPlayer \}\)/u)
  assert.match(client, /previewSound: \(url: string, volume: number\) => soundPlayer\.play\(url, volume\)/u)
  assert.doesNotMatch(sendSound, /\bctx\b/u, 'components never receive ctx')
  assert.doesNotMatch(sendSound, /document\.body\.appendChild/u)
})

test('send sentinel derives the click from session pendingSubmissions (composer sends only) and renders null', () => {
  assert.match(sendSound, /PropsRuntime<'conversation\.input\.dock'>/u)
  assert.match(sendSound, /useSession\(snapshot => snapshot\.pendingSubmissions\)/u)
  assert.match(sendSound, /freshSubmissionIds\(seen\.current, ids\)/u)
  assert.match(sendSound, /resolveSeatSound\(model\.getSnapshot\(\)\.state, seat\.getSnapshot\(\), 'send'\)/u)
  assert.match(sendSound, /return null\s*\}\s*$/u)
  assert.doesNotMatch(sendSound, /inputActions|useInput/u, 'no dependence on the input machine: plugin prompts must stay silent and phase flips back to plain synchronously for default sends')
})

test('settings mounts the sound panel at the panels anchor, adds the sound action, and keeps file inputs out of settings.tsx', () => {
  assert.match(settings, /type SettingsAction = 'reparse'[\s\S]*'derive-force'[^\n]*\| 'sound'\n/u)
  const wallpaper = settings.indexOf('<WallpaperPanel')
  const sound = settings.indexOf('<SoundPanel')
  const workbench = settings.indexOf('aria-labelledby="amphoreus-workbench"')
  assert.ok(wallpaper >= 0 && wallpaper < sound && sound < workbench)
  const mount = settings.slice(sound, workbench)
  assert.match(mount, /onUpload=\{\(heroId, slot, file\) => \{ void run\('sound', \(\) => model\.uploadSeatSound\(heroId, slot, file\)\) \}\}/u)
  assert.match(mount, /onRemove=\{\(heroId, slot\) => \{ void run\('sound', \(\) => model\.removeSeatSound\(heroId, slot\)\) \}\}/u)
  assert.match(mount, /onPrefs=\{patch => \{ void run\('sound', \(\) => model\.setSeatSoundPrefs\(patch\)\) \}\}/u)
  assert.match(mount, /onPreview=\{previewSound\}/u)
  assert.match(mount, /master=\{state\.prefs\.seatSounds\?\.master \?\? SEAT_SOUND_MASTER_DEFAULT\}/u)
  assert.match(settings, /readonly previewSound: \(url: string, volume: number\) => void/u)
  const visual = settings.indexOf('aria-labelledby="amphoreus-visual"')
  assert.doesNotMatch(settings.slice(visual, workbench), /<input|<textarea/u, 'file inputs live in the panel component')
})

test('sound panel: accept list mirrors the host map, cyrene shows only the send slot, upload header path uses x-amphoreus-ext', () => {
  assert.deepEqual([...slotsForHero('anaxa')], ['greeting', 'send'])
  assert.deepEqual([...slotsForHero('cyrene')], ['send'])
  assert.match(panel, /audio\/mpeg,audio\/ogg,audio\/wav,audio\/x-wav,audio\/webm,audio\/mp4,audio\/aac,audio\/flac,\.mp3,\.ogg,\.wav,\.webm,\.m4a,\.aac,\.flac/u)
  assert.match(panel, /onPreview\(info\.url, prefs\.volume\)/u)
  assert.match(panel, /window\.setTimeout\([\s\S]*?\}, 200\)\)/u, 'volume slider is debounced')
  assert.match(panel, /onPrefs\(\{ master: event\.currentTarget\.checked \}\)/u)
  assert.doesNotMatch(panel, /\bctx\b|document\.body\.appendChild/u)
  assert.match(state, /'x-amphoreus-ext': ext/u)
  assert.match(state, /file\.type \|\| 'application\/octet-stream'/u)
  assert.match(state, /\/amphoreus\/api\/seat-sound\/\$\{encodeURIComponent\(heroId\)\}\/\$\{slot\}/u)
  assert.match(state, /body: JSON\.stringify\(\{ seatSounds: patch \}\)/u)
})

test('sound panel CSS uses only DSW tokens', () => {
  assert.doesNotMatch(panelCss, /#[0-9a-f]{3,8}\b/iu)
  assert.doesNotMatch(panelCss, /\brgba?\(|\bhsla?\(/iu)
  for (const declaration of panelCss.matchAll(/(?:color|background|border(?:-bottom)?|accent-color):\s*([^;]+);/gu)) {
    assert.match(declaration[1]!, /var\(--dsw-|transparent|^0$|^1px solid var\(--dsw-/u, declaration[0])
  }
})

test('settings.sound* keys are balanced between zh and en and avoid firewall words', () => {
  const keys = Object.keys(zh).filter(key => key.startsWith('settings.sound'))
  assert.equal(keys.length, 14)
  for (const key of keys) {
    assert.equal(typeof (en as Record<string, string>)[key], 'string', key)
    assert.notEqual((zh as Record<string, string>)[key], '')
    assert.notEqual((en as Record<string, string>)[key], '')
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.equal(zh['settings.soundPreview'], '试听')
  for (const word of ['回执', '档位', '逐字', '锚点', '移交物']) {
    for (const key of keys) assert.equal((zh as Record<string, string>)[key]!.includes(word), false, `${key}: ${word}`)
  }
})
