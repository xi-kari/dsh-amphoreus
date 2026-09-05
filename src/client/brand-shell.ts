/**
 * Shell branding beyond the slot system: the browser tab. DSH's DocumentTitle
 * projection writes `<session> — <product>` (product = `brand.localBuild`
 * copy or DSH_CLIENT_TITLE) and index.html ships the vendor favicon; neither
 * has a slot, so this layer rewrites both at the DOM edge and keeps them
 * rewritten as the official projection re-renders. Everything is undone on
 * dispose (title restored to the last official value, icon href restored).
 */

export interface ShellBrandOptions {
  /** Product name that replaces the official product title. */
  readonly name: string
  /** Icon URL (same-origin or data:) to use as the tab favicon. */
  readonly iconHref: string
  /** Optional manifest URL (same-origin or data:) replacing the vendor web-app manifest. */
  readonly manifestHref?: string
  /** Official product titles to strip (defaults cover both shipped locales). */
  readonly officialTitles?: readonly string[]
}

const DEFAULT_OFFICIAL_TITLES = ['DSH 本地构建', 'DSH Local Build', 'DeepSeek Harness'] as const
const SEPARATOR = ' — '

/** Rewrite one document title; returns the input unchanged when nothing matched (pure, for tests). */
export function rebrandTitle(title: string, name: string, officialTitles: readonly string[] = DEFAULT_OFFICIAL_TITLES): string {
  const trimmed = title.trim()
  if (officialTitles.includes(trimmed)) return name
  for (const official of officialTitles) {
    const suffix = `${SEPARATOR}${official}`
    if (trimmed.endsWith(suffix)) return `${trimmed.slice(0, -suffix.length)}${SEPARATOR}${name}`
  }
  return title
}

/** Install the tab rebrand; returns a disposer that restores the official title and icon. */
export function installShellBrand(options: ShellBrandOptions): () => void {
  const officialTitles = options.officialTitles ?? DEFAULT_OFFICIAL_TITLES
  let lastOfficial = document.title
  let applying = false
  const applyTitle = (): void => {
    if (applying) return
    const current = document.title
    const next = rebrandTitle(current, options.name, officialTitles)
    if (next === current) {
      // Either already ours or a title we do not own; remember official values only.
      if (!current.endsWith(options.name)) lastOfficial = current
      return
    }
    lastOfficial = current
    applying = true
    document.title = next
    applying = false
  }
  applyTitle()
  const titleNode = document.head.querySelector('title')
  const observer = new MutationObserver(applyTitle)
  if (titleNode !== null) observer.observe(titleNode, { childList: true, characterData: true, subtree: true })
  observer.observe(document.head, { childList: true })

  const icons = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
  const previous = icons.map(link => ({ link, href: link.getAttribute('href'), type: link.getAttribute('type') }))
  let created: HTMLLinkElement | undefined
  if (icons.length === 0) {
    created = document.createElement('link')
    created.rel = 'icon'
    document.head.appendChild(created)
    icons.push(created)
  }
  for (const link of icons) {
    link.setAttribute('type', 'image/svg+xml')
    link.setAttribute('href', options.iconHref)
  }

  const manifest = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  const previousManifest = manifest?.getAttribute('href') ?? null
  if (manifest !== null && options.manifestHref !== undefined) manifest.setAttribute('href', options.manifestHref)

  return () => {
    observer.disconnect()
    if (manifest !== null && options.manifestHref !== undefined) {
      if (previousManifest === null) manifest.removeAttribute('href')
      else manifest.setAttribute('href', previousManifest)
    }
    if (document.title.endsWith(options.name)) document.title = lastOfficial
    for (const { link, href, type } of previous) {
      if (href === null) link.removeAttribute('href')
      else link.setAttribute('href', href)
      if (type === null) link.removeAttribute('type')
      else link.setAttribute('type', type)
    }
    created?.remove()
  }
}
