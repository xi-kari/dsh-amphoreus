import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'

const settings = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/settings.module.css', import.meta.url), 'utf8')
const localeSource = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

const VISUAL_KEYS = [
  'settings.visualHeading',
  'settings.visualHint',
  'settings.magazineMode',
  'settings.magazineLight',
  'settings.magazineFull',
  'settings.magazineFromPrefs',
  'settings.magazineFromConfig',
  'settings.magazineReset',
  'settings.assetsCache',
  'settings.derivedCount',
  'settings.magickMissing',
  'settings.derive',
  'settings.deriveForce',
  'settings.deriving',
  'settings.lastDerive',
] as const

test('visual settings add exactly 15 balanced localized keys', () => {
  assert.equal(VISUAL_KEYS.length, 15)
  for (const key of VISUAL_KEYS) {
    assert.equal(typeof zh[key], 'string', key)
    assert.equal(typeof en[key], 'string', key)
    assert.notEqual(zh[key], '')
    assert.notEqual(en[key], '')
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.equal(localeSource.match(/'settings\.visualHeading'/g)?.length, 2)
  assert.equal(zh['settings.derivedCount'], '已派生 {n} 个文件')
})

test('visual panel is between runtime and workbench and keeps assetsRoot read-only', () => {
  const runtime = settings.indexOf('aria-labelledby="amphoreus-runtime"')
  const visual = settings.indexOf('aria-labelledby="amphoreus-visual"')
  const workbench = settings.indexOf('aria-labelledby="amphoreus-workbench"')
  assert.ok(runtime >= 0 && runtime < visual && visual < workbench)
  const panel = settings.slice(visual, workbench)
  assert.match(panel, /role="radiogroup"[\s\S]*role="radio"/)
  assert.match(panel, /model\.setMagazineMode\(mode\)/)
  assert.match(panel, /model\.setMagazineMode\(null\)/)
  assert.match(panel, /model\.deriveAssets\(false\)/)
  assert.match(panel, /model\.deriveAssets\(true\)/)
  assert.match(panel, /<dt>assetsRoot<\/dt><dd><code>\{state\.assets\.root/)
  assert.doesNotMatch(panel, /<input|<textarea/)
  assert.match(panel, /settings\.derivedCount', \{ n: String\(state\.assets\.derivedCount\) \}/)
  assert.match(panel, /aria-live="polite" aria-atomic="true"/)
})

test('named action lock is synchronous and all visual controls share the intended disable gates', () => {
  assert.match(settings, /type SettingsAction = 'reparse'[\s\S]*'derive-force'/)
  assert.match(settings, /const \[activeAction, setActiveAction\] = useState<SettingsAction>/)
  assert.match(settings, /const actionLock = useRef\(false\)/)
  const run = settings.slice(settings.indexOf('const run = async'), settings.indexOf("if (snapshot.phase === 'loading')"))
  assert.ok(run.indexOf('actionLock.current = true') < run.indexOf('setActiveAction(action)'))
  assert.match(run, /finally \{[\s\S]*actionLock\.current = false[\s\S]*setActiveAction\(undefined\)/)
  assert.doesNotMatch(settings, /\[reparsing, setReparsing\]/)
  assert.match(settings, /const busy = activeAction !== undefined \|\| snapshot\.refreshing/)
  assert.match(settings, /const deriveDisabled = busy \|\| state\.assets\.running \|\| state\.assets\.root === '' \|\| state\.assets\.magick === null/)
  assert.equal(settings.match(/disabled=\{deriveDisabled\}/g)?.length, 2)
  const reset = settings.slice(settings.indexOf("run('magazine-reset'") - 120, settings.indexOf("run('magazine-reset'") + 120)
  assert.match(reset, /className=\{css\.linkButton\} disabled=\{busy\}/)
})

test('visual CSS module uses the five requested classes and only DSW color tokens', () => {
  for (const className of ['segmented', 'segment', 'hintLine', 'linkButton']) {
    assert.match(styles, new RegExp(`\\.${className}(?:\\b|\\[)`))
  }
  assert.match(styles, /\.segment\[aria-checked="true"\]/)
  const start = styles.indexOf('.segmented')
  const end = styles.indexOf('\n.skeleton', start)
  const visualStyles = styles.slice(start, end)
  assert.doesNotMatch(visualStyles, /#[0-9a-f]{3,8}|rgba?\(/iu)
  for (const declaration of visualStyles.matchAll(/(?:color|background|border):\s*([^;]+);/gu)) {
    assert.match(declaration[1]!, /var\(--dsw-|transparent|^0$/u)
  }
})
