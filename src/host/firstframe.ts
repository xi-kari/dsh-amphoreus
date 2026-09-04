import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { GLOBAL_WALLPAPERS, HERO_VISUALS } from '../shared/heroes.ts'
import type { AmphoreusBoot, WorkbenchPublicConfig } from '../shared/api.ts'
import type { AmphoreusConfig } from './config.ts'
import type { SuiteSnapshot } from './suite/types.ts'

const SEAT_BASE_STYLES = HERO_VISUALS
  .filter(hero => hero.heroId !== 'cyrene')
  .flatMap(hero => [
    `body[data-amphoreus-seat="${hero.heroId}"] #amphoreus-wallpaper { background-color: ${hero.palette.lightBase}; }`,
    `body[data-ds-dark-theme][data-amphoreus-seat="${hero.heroId}"] #amphoreus-wallpaper { background-color: ${hero.palette.darkBase}; }`,
  ])
  .join('\n')

const WALLPAPER_STYLE = `
body:not([data-ds-dark-theme]) {
  --amphoreus-wallpaper-veil-rgb: 250, 248, 242;
  --amphoreus-wallpaper-mask: var(--amphoreus-light-mask, .03);
}
body[data-ds-dark-theme] {
  --amphoreus-wallpaper-veil-rgb: 55, 48, 94;
  --amphoreus-wallpaper-mask: var(--amphoreus-dark-mask, .18);
}
#amphoreus-wallpaper {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 1;
  overflow: hidden;
  background-color: #f4f2f8;
  background-image: var(--amphoreus-wallpaper-url, radial-gradient(circle at 72% 18%, #d8d1e2 0, #8f82aa 44%, #37305e 100%));
  background-position: center 42%;
  background-repeat: no-repeat;
  background-size: cover;
  transition: opacity 240ms ease;
}
body[data-ds-dark-theme] #amphoreus-wallpaper { background-color: #1a1631; }
#amphoreus-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  background-image: linear-gradient(112deg,
    rgba(var(--amphoreus-wallpaper-veil-rgb), calc(var(--amphoreus-wallpaper-mask) * .72)) 0%,
    rgba(var(--amphoreus-wallpaper-veil-rgb), calc(var(--amphoreus-wallpaper-mask) * .22)) 58%,
    rgba(var(--amphoreus-wallpaper-veil-rgb), calc(var(--amphoreus-wallpaper-mask) * .5)) 100%);
  background-size: 100% 100%;
}
#amphoreus-wallpaper > .amphoreus-seat-layer {
  position: absolute;
  inset: 0;
  opacity: 0;
  background-position: center 30%;
  background-repeat: no-repeat;
  background-size: cover;
  transition: opacity 240ms ease;
}
#amphoreus-wallpaper > .amphoreus-seat-layer[data-active] { opacity: 1; z-index: 2; }
#amphoreus-wallpaper > .amphoreus-seat-layer[data-incoming] { z-index: 3; }
body[data-amphoreus-seat] #amphoreus-wallpaper { --amphoreus-wallpaper-url: none; }
${SEAT_BASE_STYLES}
[data-amphoreus-sidebar-surface] {
  background-color: #f4f2f8 !important;
  background-image:
    linear-gradient(180deg,
      rgba(var(--amphoreus-wallpaper-veil-rgb), calc(var(--amphoreus-wallpaper-mask) * .46)) 0%,
      rgba(var(--amphoreus-wallpaper-veil-rgb), calc(var(--amphoreus-wallpaper-mask) * .7)) 100%),
    var(--amphoreus-sidebar-wallpaper-url, linear-gradient(160deg, #ece7f1 0%, #b3a8c4 52%, #37305e 100%)) !important;
  background-position: center, 62% center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100%, cover !important;
  transition: background-image 240ms ease;
}
body[data-ds-dark-theme] [data-amphoreus-sidebar-surface] { background-color: #1a1631 !important; }
body[data-amphoreus-wallpaper='off'] [data-amphoreus-sidebar-surface] {
  background-color: transparent !important;
  background-image: none !important;
}
body > #root { position: relative; z-index: 1; }
@media (prefers-reduced-motion: reduce) {
  #amphoreus-wallpaper, #amphoreus-wallpaper > .amphoreus-seat-layer, [data-amphoreus-sidebar-surface] { transition: none; }
}
`.trim()

const WALLPAPER_SCRIPT = `
(() => {
  const boot = globalThis.__AMPHOREUS_BOOT__;
  const layer = document.getElementById('amphoreus-wallpaper');
  if (!boot || !layer) return;
  document.body.style.setProperty('--amphoreus-dark-mask', String(boot.wallpaper.darkMask));
  document.body.style.setProperty('--amphoreus-light-mask', String(boot.wallpaper.lightMask));
  let seat = null;
  try { seat = localStorage.getItem('dsh-amphoreus:last-seat'); } catch {}
  if (seat && seat.startsWith('seat:')) seat = seat.slice(5);
  if (seat === 'all' || seat === 'cyrene') seat = null;
  if (seat) document.body.dataset.amphoreusSeat = seat;
  if (boot.wallpaper.url && !seat) layer.style.setProperty('--amphoreus-wallpaper-url', 'url("' + boot.wallpaper.url.replaceAll('"', '%22') + '")');
  if (boot.wallpaper.sidebarUrl) document.body.style.setProperty('--amphoreus-sidebar-wallpaper-url', 'url("' + boot.wallpaper.sidebarUrl.replaceAll('"', '%22') + '")');
  const bindSidebarSurface = () => {
    const root = document.getElementById('root');
    if (!root) return false;
    const frames = root.querySelectorAll('div');
    for (const frame of frames) {
      if (!(frame instanceof HTMLElement) || frame.children.length < 3) continue;
      const computed = getComputedStyle(frame);
      if (computed.display !== 'grid' || computed.gridTemplateColumns === 'none') continue;
      const sidebar = frame.firstElementChild;
      if (!(sidebar instanceof HTMLElement)) continue;
      sidebar.dataset.amphoreusSidebarSurface = '';
      return true;
    }
    return false;
  };
  const mountSidebarSurface = () => {
    const root = document.getElementById('root');
    if (!root) {
      requestAnimationFrame(mountSidebarSurface);
      return;
    }
    if (bindSidebarSurface()) return;
    const observer = new MutationObserver(() => {
      if (bindSidebarSurface()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
  };
  mountSidebarSurface();
})();
`.trim()

export interface FirstFrameOptions {
  readonly config: AmphoreusConfig
  readonly nonce: string
  readonly current: () => SuiteSnapshot | undefined
  readonly wallpaperIndex?: number
  readonly derivedWallpaper?: (index: number) => string | null
}

export function createBootPayload(options: FirstFrameOptions): AmphoreusBoot {
  const snapshot = options.current()
  const index = options.config.wallpaper.global === 'fixed'
    ? options.config.wallpaper.globalIndex
    : (options.wallpaperIndex ?? 0) % GLOBAL_WALLPAPERS.length
  const assetsConfigured = options.config.assetsRoot.trim() !== ''
  const url = options.derivedWallpaper?.(index) ?? (assetsConfigured ? wallpaperUrl(index) : undefined)
  const sidebarUrl = options.derivedWallpaper?.(options.config.wallpaper.sidebarIndex)
    ?? (assetsConfigured ? wallpaperUrl(options.config.wallpaper.sidebarIndex) : undefined)
  return {
    revision: snapshot?.generation ?? 0,
    nonce: options.nonce,
    level: snapshot?.level ?? 'loading',
    workbench: publicWorkbench(options.config),
    wallpaper: {
      enabled: options.config.wallpaper.enabled,
      darkMask: options.config.wallpaper.darkMask,
      lightMask: options.config.wallpaper.lightMask,
      ...(url === undefined ? {} : { url }),
      ...(sidebarUrl === undefined ? {} : { sidebarUrl }),
    },
  }
}

function wallpaperUrl(index: number): string {
  return `/amphoreus/wallpaper/${encodeURIComponent(GLOBAL_WALLPAPERS[index]!)}`
}

export function createFirstFrameRows(options: FirstFrameOptions): IndexInjection[] {
  const rows: IndexInjection[] = [{ kind: 'global', name: '__AMPHOREUS_BOOT__', value: createBootPayload(options) }]
  if (!options.config.wallpaper.enabled) return rows
  rows.push(
    { kind: 'style', text: WALLPAPER_STYLE },
    { kind: 'html', placement: 'body', html: '<div id="amphoreus-wallpaper" aria-hidden="true"><div class="amphoreus-seat-layer" data-slot="0"></div><div class="amphoreus-seat-layer" data-slot="1"></div></div>' },
    { kind: 'script', placement: 'body', text: WALLPAPER_SCRIPT },
  )
  return rows
}

export function registerFirstFrame(ctx: Context, options: FirstFrameOptions): () => void {
  return ctx.on('webserver/index-inject', table => {
    table.push(...createFirstFrameRows(options))
  })
}

export function publicWorkbench(config: AmphoreusConfig): WorkbenchPublicConfig {
  const { enabled, host, defaultView, cardTextLimit, autoProjection } = config.workbench
  return { enabled, host, defaultView, cardTextLimit, autoProjection }
}
