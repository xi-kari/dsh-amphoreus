import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const context = vm.createContext({
  URL,
  state: { amph: { stickerSources: {} } },
  location: { origin: 'http://127.0.0.1:3080' },
  escapeHtml: (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)),
})
vm.runInContext(source.slice(source.indexOf('function inlineMarkdown('), source.indexOf('const clampCardText')), context)
const render = (value: string): string => vm.runInContext(`renderMarkdown(${JSON.stringify(value)})`, context)

test('desktop workbench maps only exact host-confirmed native paths and legacy URLs to its authenticated origin', () => {
  context.location.origin = 'dsh-app://app'
  context.state.amph.stickerSources = {
    'D:/Role Art/amphoreus/assets/stickers/cyrene.webp': '/amphoreus/stickers/cyrene.webp',
    'http://127.0.0.1:43123/amphoreus/stickers/cyrene.webp': '/amphoreus/stickers/cyrene.webp',
  }
  try {
    for (const url of Object.keys(context.state.amph.stickerSources)) {
      assert.match(render(`![昔涟](<${url}>)`), /<img class="dialogue-sticker" src="\/amphoreus\/stickers\/cyrene\.webp"/)
    }
    for (const url of ['D:/Other/amphoreus/assets/stickers/cyrene.webp', 'http://127.0.0.1:43124/amphoreus/stickers/cyrene.webp', 'http://attacker.invalid/amphoreus/stickers/cyrene.webp']) {
      assert.doesNotMatch(render(`![昔涟](<${url}>)`), /<img\b/)
    }
  } finally {
    context.location.origin = 'http://127.0.0.1:3080'
    context.state.amph.stickerSources = {}
  }
})

test('workbench displays same-origin skill stickers between dialogue and the receipt', () => {
  for (const ext of ['webp', 'gif', 'png']) {
    for (const url of [`/amphoreus/stickers/cyrene-roger.${ext}`, `http://127.0.0.1:3080/amphoreus/stickers/cyrene-roger.${ext}`]) {
      for (const target of [url, `<${url}>`]) {
        const html = render(`收到。\n![昔涟·收到](${target})\n昔涟卡｜读取：common.md、persona.md｜档位：标准`)
        assert.match(html, /<p>收到。<\/p><img class="dialogue-sticker"/)
        assert.match(html, new RegExp(`src="/amphoreus/stickers/cyrene-roger.${ext}" alt="昔涟·收到"`))
        assert.match(html, /<p>昔涟卡｜读取/)
      }
    }
  }
})

test('sticker markup stays inert inside fenced and inline code or raw HTML', () => {
  for (const text of [
    '```md\n![角色](/amphoreus/stickers/cyrene.webp)\n```',
    '~~~md\n![角色](/amphoreus/stickers/cyrene.webp)\n~~~',
    '`![角色](/amphoreus/stickers/cyrene.webp)`',
    '<img src="/amphoreus/stickers/cyrene.webp" onerror="alert(1)">',
  ]) assert.doesNotMatch(render(text), /<img\b/)
  assert.match(render('![<b>"角色"</b>](/amphoreus/stickers/cyrene.webp)'), /alt="&lt;b&gt;&quot;角色&quot;&lt;\/b&gt;"/)
})

test('workbench never fetches arbitrary files, remote images or malformed sticker destinations', () => {
  for (const target of [
    'https://example.com/amphoreus/stickers/cyrene.webp',
    'http://localhost:3080/amphoreus/stickers/cyrene.webp',
    'http://user:password@127.0.0.1:3080/amphoreus/stickers/cyrene.webp',
    '//example.com/amphoreus/stickers/cyrene.webp',
    'file:///D:/private.webp', 'D:/private.webp', 'javascript:alert', 'data:image/webp;base64,eA==',
    '/amphoreus/stickers/../private.webp', '/amphoreus/stickers/%2e%2e.webp',
    '/amphoreus/stickers/cyrene.webp?token=secret', '/amphoreus/stickers/cyrene.webp#fragment',
    '/amphoreus/assets/private.webp',
    '/amphoreus/stickers/cyrene.jpg', '/amphoreus/stickers/cyrene.svg', '/amphoreus/stickers/cyrene.GIF', '/amphoreus/stickers/cyrene.webp.png',
  ]) {
    assert.doesNotMatch(render(`![角色](<${target}>)`), /<img\b/, target)
  }
})
