import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'
import { effectiveSeatMemory } from '../src/client/memory-model.ts'
import { SEAT_NOTE_MAX_CHARS, SEAT_NOTE_MARKER } from '../src/shared/api.ts'

const settings = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/client/memory-panel.tsx', import.meta.url), 'utf8')
const panelCss = readFileSync(new URL('../src/client/memory-panel.module.css', import.meta.url), 'utf8')
const state = readFileSync(new URL('../src/client/state.ts', import.meta.url), 'utf8')

const MEMORY_KEYS = [
  'settings.memoryHeading', 'settings.memoryHint', 'settings.memoryCount', 'settings.memoryInject', 'settings.memoryInjectTip',
  'settings.memoryAutoNote', 'settings.memoryAutoNoteTip', 'settings.memoryInjectLimit', 'settings.memoryEmpty',
  'settings.memoryAuthorSeat', 'settings.memoryAuthorUser', 'settings.memoryAuthorLegacy', 'settings.memoryDelete',
  'settings.memoryAdd', 'settings.memoryPlaceholder', 'settings.memoryCommandHint', 'settings.memoryInactive',
] as const

test('memory settings keys exist in both dictionaries and key sets stay identical', () => {
  for (const key of MEMORY_KEYS) {
    assert.equal(typeof zh[key], 'string', key)
    assert.equal(typeof en[key], 'string', key)
    assert.notEqual(zh[key], '')
    assert.notEqual(en[key], '')
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.match(zh['settings.memoryCommandHint'], /\{command\}/)
  assert.match(en['settings.memoryCommandHint'], /\{command\}/)
  // Every panel key is used by the panel source and none is left orphaned.
  for (const key of MEMORY_KEYS) assert.ok(panel.includes(`'${key}'`), key)
})

test('memory panel is mounted in the side column after the wallpaper panel and uses append/delete/patch model methods', () => {
  const wallpaper = settings.indexOf('<WallpaperPanel')
  const memory = settings.indexOf('<MemoryPanel')
  const workbench = settings.indexOf('aria-labelledby="amphoreus-workbench"')
  assert.ok(wallpaper >= 0 && wallpaper < memory && memory < workbench)
  const mount = settings.slice(memory, workbench)
  assert.match(mount, /model\.addMemoryNote\(skill, text\)/)
  assert.match(mount, /model\.deleteMemoryNote\(skill, id\)/)
  assert.match(mount, /model\.setMemorySettings\(skill, patch\)/)
  assert.match(mount, /config=\{state\.effectiveConfig\.memory\}/)
  assert.match(mount, /memory=\{state\.memory\}/)
  // Hidden / undeployed seats that own a memory record are still listed (flagged inactive) so overrides stay reachable.
  assert.match(mount, /state\.memory\.some\(record => record\.skillName === seat\.skillName\)/)
  assert.match(mount, /inactive: seat\.status !== 'deployed' \|\| seat\.hidden === true/)
  assert.match(panel, /record\.notes\.length > 0 \|\| record\.settings !== undefined/)
  assert.match(panel, /settings\.memoryInactive/)
  assert.match(settings, /type SettingsAction = 'reparse'[\s\S]*'derive-force'[\s\S]*'memory'/)
  // File inputs live in the panel component, keeping the visual slice pin intact.
  const visual = settings.indexOf('aria-labelledby="amphoreus-visual"')
  assert.doesNotMatch(settings.slice(visual, workbench), /<input|<textarea/)
  assert.match(panel, /<textarea/)
  assert.match(panel, /aria-labelledby="amphoreus-memory"/)
  assert.match(panel, /data-amph-memory-panel=""/)
})

test('panel counter uses the shared 200 cap, never receives ctx, and writes go through the three routes', () => {
  assert.equal(SEAT_NOTE_MAX_CHARS, 200)
  assert.equal(SEAT_NOTE_MARKER, '留言：')
  assert.match(panel, /SEAT_NOTE_MAX_CHARS/)
  assert.doesNotMatch(panel, /\bctx\b/)
  assert.doesNotMatch(panel, /document\.body\.appendChild/)
  assert.match(state, /\/amphoreus\/api\/memory\/\$\{encodeURIComponent\(skill\)\}\/notes`/)
  assert.match(state, /\/amphoreus\/api\/memory\/\$\{encodeURIComponent\(skill\)\}\/notes\/\$\{encodeURIComponent\(id\)\}`/)
  assert.match(state, /\/amphoreus\/api\/memory\/\$\{encodeURIComponent\(skill\)\}\/settings`/)
  assert.match(state, /method: 'DELETE'[\s\S]*'x-amphoreus-nonce': nonce/)
  assert.doesNotMatch(state, /addMemoryNote[\s\S]{0,400}method: 'PUT'/, 'notes are appended, never full-replaced')
})

test('memory panel CSS uses only DSW alias tokens (no raw colors, no non-alias dsw vars)', () => {
  assert.doesNotMatch(panelCss, /#[0-9a-f]{3,8}\b/iu)
  assert.doesNotMatch(panelCss, /\brgba?\(|\bhsla?\(/iu)
  assert.doesNotMatch(panelCss, /--dsw-(?!alias-)/u)
  for (const declaration of panelCss.matchAll(/(?:^|;|\{)\s*(?:color|background|border-color|border-left-color|outline):\s*([^;]+);/gmu)) {
    assert.match(declaration[1]!, /var\(--dsw-alias-|var\(--amph-seat-accent|transparent|^0$|solid/u, declaration[1])
  }
  for (const className of ['list', 'row', 'head', 'toggle', 'notes', 'note', 'badge', 'compose', 'textarea', 'counter', 'limit']) {
    assert.match(panelCss, new RegExp(`\\.${className}(?:\\b|\\[)`), className)
  }
})

test('effectiveSeatMemory mirrors the host merge (record overrides under config defaults)', () => {
  const config = { inject: true, autoNote: true, injectLimit: 8, command: 'remember' }
  assert.deepEqual(effectiveSeatMemory(config, undefined), { inject: true, autoNote: true, injectLimit: 8 })
  assert.deepEqual(effectiveSeatMemory(config, { skillName: 'x', notes: [], pinnedSessionIds: [], updatedAt: 0, settings: { inject: false, injectLimit: 2 } }), { inject: false, autoNote: true, injectLimit: 2 })
})
