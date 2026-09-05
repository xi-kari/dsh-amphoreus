/**
 * Seam stamper for the seat visual grammar (pattern borrowed from
 * NoNameLeGo/dsh-catppuccin-theme's glass layer, MIT). The grammar stylesheet
 * keys off stable `data-amph-*` hooks that stock DSH markup does not carry, so
 * this module stamps them onto matching elements at runtime and keeps them
 * stamped as React remounts nodes. Selectors use only attributes the shell
 * authors itself (`data-composer-card`, `data-conversation-scroll`, `data-slot`,
 * ARIA roles) or lightningcss-preserved class-name substrings.
 *
 * Stamps are inert unless `<html data-amph-grammar>` is present (every rule in
 * grammar.css is gated on it), so leaving them behind when the layer is off
 * still renders the exact stock UI.
 */
export interface Seam {
  readonly attribute: string
  readonly selector: string
  /** Stamp only the first match (topmost) instead of every descendant match. */
  readonly first?: boolean
}

export const GRAMMAR_SEAMS: readonly Seam[] = [
  // Layout frame: the sidebar column's direct parent.
  { attribute: 'data-amph-frame', selector: ':has(> [class*="sidebarCol"])' },
  // Sidebar column and its topmost content root.
  { attribute: 'data-amph-sidebar', selector: '[class*="sidebarCol"]' },
  { attribute: 'data-amph-sidebar-root', selector: '[class*="sidebarCol"] [class*="root"]', first: true },
  // New-session button (raised control).
  { attribute: 'data-amph-raised', selector: 'button[class*="newSession"]' },
  // Conversation header card.
  { attribute: 'data-amph-header', selector: '[data-phase] > header, [data-phase] header[class*="header"]' },
  // Trajectory view.
  { attribute: 'data-amph-trajectory', selector: '[data-conversation-composer-overlay]' },
  // Details column root.
  { attribute: 'data-amph-details', selector: '[class*="detailsCol"] [class*="root"]', first: true },
  // Composer: the card's direct parent (input bar root) and the card itself.
  { attribute: 'data-amph-inputbar', selector: ':has(> [data-composer-card])' },
  { attribute: 'data-amph-composer', selector: '[data-composer-card]' },
  // Stats line under the composer.
  { attribute: 'data-amph-stats', selector: '[data-slot="conversation.composer.dock"] [class*="root"]' },
  // User bubbles inside the transcript only (third-party "bubble" widgets stay untouched).
  { attribute: 'data-amph-bubble', selector: '[data-conversation-scroll] [class*="bubble"]' },
  // Settings dialog panel (modal only) and its nav.
  { attribute: 'data-amph-settings', selector: '[role="dialog"][aria-modal="true"]:has([data-slot="settings.section"])' },
  // Empty-state hero headline.
  { attribute: 'data-amph-hero', selector: '[class*="composerHero"]' },
]

function stamp(seam: Seam): void {
  if (seam.first) {
    const el = document.querySelector(seam.selector)
    if (el !== null && !el.hasAttribute(seam.attribute)) el.setAttribute(seam.attribute, '')
    return
  }
  for (const el of document.querySelectorAll(seam.selector)) {
    if (!el.hasAttribute(seam.attribute)) el.setAttribute(seam.attribute, '')
  }
}

export function stampGrammarSeams(seams: readonly Seam[] = GRAMMAR_SEAMS): void {
  for (const seam of seams) stamp(seam)
}

/** Stamp once, then keep stamping as the tree changes; returns a disposer. */
export function startGrammarSeamStamper(seams: readonly Seam[] = GRAMMAR_SEAMS): () => void {
  stampGrammarSeams(seams)
  let scheduled = false
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      stampGrammarSeams(seams)
    })
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  return () => { observer.disconnect() }
}
