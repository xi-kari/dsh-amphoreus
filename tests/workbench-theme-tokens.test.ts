import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')

function probe() {
  const properties = new Map<string, string>([['--amphoreus-unowned', 'keep-me']])
  const style = {
    colorScheme: '',
    setProperty: (name: string, value: string) => { properties.set(name, value) },
    removeProperty: (name: string) => properties.delete(name),
  }
  const root = { dataset: {} as Record<string, string>, style }
  const parent = {}
  const context = {
    console,
    history: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: root, querySelector: () => null },
    window: { parent, location: { origin: 'http://localhost' } },
    CSS: {
      supports: (property: string, value: string) => property === 'color'
        && value !== 'not-a-color',
    },
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  const prefix = source.slice(0, source.indexOf('\n// Cards outside the viewport'))
  vm.runInContext(`${prefix}\nglobalThis.__probe = { trustedThemeTokenEvent, validThemeTokenValue, applyThemeTokensMessage, owned: () => [...appliedThemeTokens] }`, context)
  return {
    parent,
    properties,
    root,
    receiver: context.globalThis.__probe as {
      trustedThemeTokenEvent(event: unknown): boolean
      validThemeTokenValue(value: unknown): boolean
      applyThemeTokensMessage(data: unknown): boolean
      owned(): string[]
    },
  }
}

test('theme token events require the exact parent, origin, and source marker', () => {
  const { parent, receiver } = probe()
  const data = { source: 'dsh-amphoreus', type: 'amphoreus:theme-tokens' }
  assert.equal(receiver.trustedThemeTokenEvent({ source: parent, origin: 'http://localhost', data }), true)
  assert.equal(receiver.trustedThemeTokenEvent({ source: {}, origin: 'http://localhost', data }), false)
  assert.equal(receiver.trustedThemeTokenEvent({ source: parent, origin: 'https://example.invalid', data }), false)
  assert.equal(receiver.trustedThemeTokenEvent({ source: parent, origin: 'http://localhost', data: { ...data, source: 'other' } }), false)
})

test('receiver applies only color-valued alias/specific tokens and preserves unowned styles', () => {
  const { properties, receiver, root } = probe()
  assert.equal(receiver.applyThemeTokensMessage({
    dark: true,
    tokens: {
      '--dsw-alias-bg-base': ' rgb(1, 2, 3) ',
      '--dsw-specific-bubble': 'rgba(4, 5, 6, 0.7)',
      '--dsw-static-neutral-00': '#fff',
      '--dsw-alias-url': 'url(//example.invalid/theme)',
      '--dsw-alias-image': 'image(example)',
      '--dsw-alias-gradient': 'linear-gradient(#fff,#000)',
      '--dsw-alias-reference': 'var(--other)',
      '--dsw-alias-not-color': 'not-a-color',
    },
  }), true)

  assert.equal(properties.get('--dsw-alias-bg-base'), 'rgb(1, 2, 3)')
  assert.equal(properties.get('--dsw-specific-bubble'), 'rgba(4, 5, 6, 0.7)')
  assert.equal(properties.get('--dsw-static-neutral-00'), undefined)
  assert.equal(properties.get('--dsw-alias-url'), undefined)
  assert.equal(properties.get('--dsw-alias-image'), undefined)
  assert.equal(properties.get('--dsw-alias-gradient'), undefined)
  assert.equal(properties.get('--dsw-alias-reference'), undefined)
  assert.equal(properties.get('--dsw-alias-not-color'), undefined)
  assert.equal(properties.get('--amphoreus-unowned'), 'keep-me')
  assert.deepEqual(Array.from(receiver.owned()), ['--dsw-alias-bg-base', '--dsw-specific-bubble'])
  assert.equal(root.dataset.theme, 'dark')
  assert.equal(root.style.colorScheme, 'dark')
})

test('a new valid generation removes only tokens owned by the previous generation', () => {
  const { properties, receiver, root } = probe()
  receiver.applyThemeTokensMessage({
    dark: true,
    tokens: {
      '--dsw-alias-bg-base': 'rgb(1, 2, 3)',
      '--dsw-specific-bubble': '#abc',
    },
  })
  receiver.applyThemeTokensMessage({ dark: false, tokens: { '--dsw-alias-label-primary': '#123456' } })

  assert.equal(properties.get('--dsw-alias-bg-base'), undefined)
  assert.equal(properties.get('--dsw-specific-bubble'), undefined)
  assert.equal(properties.get('--dsw-alias-label-primary'), '#123456')
  assert.equal(properties.get('--amphoreus-unowned'), 'keep-me')
  assert.deepEqual(Array.from(receiver.owned()), ['--dsw-alias-label-primary'])
  assert.equal(root.dataset.theme, 'light')
  assert.equal(root.style.colorScheme, 'light')
})

test('malformed generations fail closed without clearing the current token generation', () => {
  const { properties, receiver } = probe()
  receiver.applyThemeTokensMessage({ dark: false, tokens: { '--dsw-alias-bg-base': '#fff' } })
  assert.equal(receiver.applyThemeTokensMessage({ dark: 'yes', tokens: {} }), false)
  assert.equal(receiver.applyThemeTokensMessage({ dark: true, tokens: null }), false)
  assert.equal(receiver.applyThemeTokensMessage({
    dark: true,
    tokens: Object.fromEntries(Array.from({ length: 88 }, (_, index) => [`--dsw-alias-extra-${index}`, '#fff'])),
  }), false)
  assert.equal(properties.get('--dsw-alias-bg-base'), '#fff')
})

test('the legacy boolean receiver remains and the token branch enforces parent source', () => {
  assert.match(source, /if \(data\.type === 'amphoreus:theme'\) \{[\s\S]*dataset\.theme/)
  assert.match(source, /if \(data\.type === 'amphoreus:theme-tokens'\) \{\s*if \(!trustedThemeTokenEvent\(event\)\) return/)
})
