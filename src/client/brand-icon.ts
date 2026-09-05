/**
 * δ-me13 tab glyph: original artwork for this plugin (no vendor marks). A
 * lavender→sky gradient tile (Vol.13 Cyrene palette) carrying a serif δ and
 * three receding ripple arcs. Inlined as a data URI so the favicon needs no
 * route, no asset root and no cache invalidation.
 */
export const BRAND_ICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
  '<stop offset="0" stop-color="#e1acd3"/><stop offset=".55" stop-color="#b9a4e0"/><stop offset="1" stop-color="#a7ddf8"/>',
  '</linearGradient></defs>',
  '<rect x="2" y="2" width="60" height="60" rx="16" fill="url(#g)"/>',
  '<rect x="2" y="2" width="60" height="60" rx="16" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.5"/>',
  '<path d="M14 46a18 18 0 0 1 36 0" fill="none" stroke="#ffffff" stroke-opacity=".38" stroke-width="1.6"/>',
  '<path d="M20 46a12 12 0 0 1 24 0" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.6"/>',
  '<text x="32" y="43" text-anchor="middle" font-family="Georgia, \'Times New Roman\', \'Songti SC\', serif" font-style="italic" font-weight="700" font-size="34" fill="#3a2d5e">δ</text>',
  '<text x="47" y="22" text-anchor="middle" font-family="ui-monospace, Consolas, monospace" font-weight="700" font-size="11" fill="#3a2d5e" fill-opacity=".85">13</text>',
  '</svg>',
].join('')

export const BRAND_ICON_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(BRAND_ICON_SVG)}`

/** Web-app manifest replacing the vendor one (installed-app name/icon). */
export const BRAND_MANIFEST = {
  id: '/',
  name: 'δ-me13',
  short_name: 'δ-me13',
  start_url: '/',
  scope: '/',
  display: 'fullscreen',
  icons: [{ src: BRAND_ICON_DATA_URL, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
} as const

export const BRAND_MANIFEST_DATA_URL = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(BRAND_MANIFEST))}`
