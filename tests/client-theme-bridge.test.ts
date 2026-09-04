import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readDswTokens } from '../src/client/theme.ts'

const workbench = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

test('readDswTokens trims values and omits empty bridged tokens', () => {
  const tokens = readDswTokens(name => name.endsWith('bg-base') ? ' rgb(1, 2, 3) ' : '')
  assert.deepEqual(tokens, { '--dsw-alias-bg-base': 'rgb(1, 2, 3)' })
})

test('workbench pushes the same two-frame theme bridge on lifecycle signals and cleans it up', () => {
  assert.match(workbench, /const pushThemeTokensRef = useRef/)
  assert.match(workbench, /afterFrame\(\(\) => \{\s*afterFrame\(\(\) => \{/)
  assert.match(workbench, /type: 'amphoreus:theme-tokens'[\s\S]*tokens: theme\.read\(\)[\s\S]*dark: theme\.isDark\(\)/)
  assert.match(workbench, /const unsubscribe = theme\.subscribe\(push\)/)
  assert.match(workbench, /unsubscribe\(\)[\s\S]*cancelAnimationFrame\(frame\)/)

  const ready = workbench.slice(workbench.indexOf("case 'amphoreus:map-ready'"), workbench.indexOf("case 'amphoreus:map-opened'"))
  assert.match(ready, /pushThemeTokensRef\.current\(\)/)
  const frame = workbench.slice(workbench.indexOf('<iframe'), workbench.indexOf('/>', workbench.indexOf('<iframe')))
  assert.match(frame, /amphoreus:map-opened[\s\S]*pushThemeTokensRef\.current\(\)/)
  assert.doesNotMatch(workbench, /type:\s*['"]amphoreus:theme['"]/)
})

test('apply constructs one stable theme bridge before slot registration and injects that reference', () => {
  const bridge = client.indexOf('const themeBridge = {')
  const firstSlot = client.indexOf('ctx.slots.')
  assert.ok(bridge >= 0 && bridge < firstSlot)
  assert.equal(client.match(/const themeBridge = \{/g)?.length, 1)
  assert.match(client, /read: readDswTokens/)
  assert.match(client, /ctx\.theme\.getTheme\(\)\.active\.colorScheme === 'dark'/)
  assert.match(client, /ctx\.on\('theme\/change', \(\) => listener\(\)\)/)
  assert.match(client, /theme: themeBridge/)
})
