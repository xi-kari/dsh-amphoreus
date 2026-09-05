/**
 * Per-seat visual grammar: the seven dimensions that make a seat readable at
 * a glance beyond its palette — corner scale, glass recipe, edge signature,
 * motif placement, typographic register, mascot behaviour and ambient motion —
 * plus a wallpaper treatment so portrait art never fights the transcript.
 *
 * Source: 2026-09-05 design synthesis (editorial-layout proposal, judged best
 * of three, with the judges' corrections applied: no per-bubble blur, masthead
 * off the title line, stickers strictly from heroes.ts, ambient motion only on
 * the wallpaper layer). Values are CSS-ready and consumed by grammar-layer.ts
 * (host shell) and mirrored to the workbench iframe. Only `--dsw-*` tokens and
 * `--amph-*` variables may appear in CSS strings; no webfonts, no bitmaps.
 */
import type { HeroId } from './heroes.ts'

export type AmbientName =
  | 'none' | 'ripple' | 'star-blink' | 'binary-ticker' | 'shard-drift' | 'ink-cloud'
  | 'tide' | 'bubble-rise' | 'prism-sweep' | 'astrolabe-spin' | 'gold-thread' | 'ember' | 'butterfly' | 'coin-glint'

export type DisplayRegister = 'serif' | 'sans' | 'mono'

export interface SeatGrammar {
  /** ≤4 CJK chars style name shown in settings/tooltips. */
  readonly styleName: string
  /** Surface radius (panes, composer, bubbles) in px. */
  readonly radiusPx: number
  /** Control radius (buttons, chips) in px. */
  readonly radiusSmPx: number
  /** Optional clip-path applied to the sidebar sheet and header card instead of rounding (mydei/cipher price-tag corners). */
  readonly clip?: string
  readonly glass: {
    /** Glass tint colours (hex) mixed into layer-1 for light/dark schemes. */
    readonly tintLight: string
    readonly tintDark: string
    /** Absolute fill opacity of panes (0.58–0.94); bubbles add +.06 and never blur. */
    readonly frost: number
    /** backdrop-filter blur radius in px for panes (0 = matte). */
    readonly blurPx: number
    /** Rim (hairline) colour expressions for light/dark; may use color-mix over --dsw/--amph vars. */
    readonly rimLight: string
    readonly rimDark: string
    /** Rim line style. */
    readonly rimStyle: 'solid' | 'dashed' | 'double' | 'none'
    readonly rimWidthPx: number
  }
  /** Signature box-shadow stack drawn on primary panes, light/dark (edge light + drop + any seat mark). */
  readonly edgeLight: string
  readonly edgeDark: string
  readonly typography: {
    readonly display: DisplayRegister
    readonly weight: number
    readonly letterSpacing: string
    readonly titleTransform: 'none' | 'uppercase' | 'lowercase'
    readonly italic: boolean
  }
  readonly motif: {
    readonly sizePx: number
    readonly opacity: number
    /** sidebar = tiled inside the sidebar sheet; stage = conversation column corner; both; header = header card only. */
    readonly placement: 'sidebar' | 'stage' | 'both' | 'header'
  }
  readonly ambient: AmbientName
  /** How the seat's home wallpaper is tamed behind text. */
  readonly wallpaper: {
    readonly blurPx: number
    readonly position: string
    /** Extra veil added to the first-frame mask (0–0.5). */
    readonly dim: number
    readonly saturate: number
  }
  /** Masthead badge text riding the header card's top edge (`CHRYSOS · No.NN`); empty hides it. */
  readonly masthead: string
  /** Feather the sidebar glass sheet into the page (castorice's frameless page). */
  readonly feather: boolean
  /** One-line signature detail (documentation / tooltip only). */
  readonly signature: string
}

const WHITE_EDGE = 'inset 0 1px 0 rgba(255, 255, 255, .55)'
const DIM_EDGE = 'inset 0 1px 0 rgba(255, 255, 255, .08)'
const DROP_LIGHT = '0 10px 32px color-mix(in srgb, var(--dsw-alias-bg-mask-2) 34%, transparent)'
const DROP_DARK = '0 10px 32px rgba(2, 6, 14, .42)'

/** Neutral grammar used for the global (Cyrene / all-seat) space and any unknown seat: Vol.13 终刊涟页. */
export const GLOBAL_GRAMMAR: SeatGrammar = {
  styleName: '终刊涟页',
  radiusPx: 18,
  radiusSmPx: 11,
  glass: {
    tintLight: 'color-mix(in srgb, #ffffff 74%, #e1acd3)',
    tintDark: 'color-mix(in srgb, #221a2b 82%, #7a87f1)',
    frost: 0.74,
    blurPx: 18,
    rimLight: 'color-mix(in srgb, #9968b1 30%, transparent)',
    rimDark: 'color-mix(in srgb, #a7ddf8 32%, transparent)',
    rimStyle: 'solid',
    rimWidthPx: 1,
  },
  edgeLight: `${WHITE_EDGE}, inset 0 -3px 0 color-mix(in srgb, #a7ddf8 55%, transparent), ${DROP_LIGHT}`,
  edgeDark: `${DIM_EDGE}, inset 0 -3px 0 color-mix(in srgb, #7a87f1 45%, transparent), ${DROP_DARK}`,
  typography: { display: 'sans', weight: 500, letterSpacing: '.06em', titleTransform: 'none', italic: false },
  motif: { sizePx: 96, opacity: 0.08, placement: 'stage' },
  ambient: 'ripple',
  wallpaper: { blurPx: 0, position: 'center 42%', dim: 0, saturate: 1 },
  masthead: 'CHRYSOS · No.13',
  feather: false,
  signature: '涟漪波纹页脚；期号下多一行「终刊号」',
}

export const SEAT_GRAMMARS: Readonly<Partial<Record<HeroId, SeatGrammar>>> = Object.freeze({
  tribbie: {
    styleName: '学园手账',
    radiusPx: 10,
    radiusSmPx: 6,
    glass: {
      tintLight: 'color-mix(in srgb, #f6efe4 84%, #b28f67)',
      tintDark: 'color-mix(in srgb, #2a1a16 84%, #a2323a)',
      frost: 0.82,
      blurPx: 10,
      rimLight: 'color-mix(in srgb, #a2323a 45%, transparent)',
      rimDark: 'color-mix(in srgb, #b28f67 45%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Sand-gold dashed ring 3px outside the rim: the sticker-sheet outline of the exercise book.
    edgeLight: `${WHITE_EDGE}, 0 0 0 3px transparent, 0 0 0 4px color-mix(in srgb, #b28f67 45%, transparent), ${DROP_LIGHT}`,
    edgeDark: `${DIM_EDGE}, 0 0 0 3px transparent, 0 0 0 4px color-mix(in srgb, #b28f67 35%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 600, letterSpacing: '.02em', titleTransform: 'none', italic: false },
    motif: { sizePx: 48, opacity: 0.14, placement: 'sidebar' },
    ambient: 'star-blink',
    wallpaper: { blurPx: 4, position: 'center 30%', dim: 0.06, saturate: 0.96 },
    masthead: 'CHRYSOS · No.02',
    feather: false,
    signature: '砂金虚线相框；星星贴纸只在侧栏右上闪',
  },
  cerydra: {
    styleName: '棋盘君主',
    radiusPx: 2,
    radiusSmPx: 2,
    glass: {
      tintLight: 'color-mix(in srgb, #eef1fa 86%, #3452d4)',
      tintDark: 'color-mix(in srgb, #161a2e 80%, #3452d4)',
      frost: 0.86,
      blurPx: 8,
      rimLight: '#3452d4',
      rimDark: '#6495dd',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Double frame: blue hairline + gold line 4px out (Vol.10 white-line photo frame).
    edgeLight: `${WHITE_EDGE}, 0 0 0 4px transparent, 0 0 0 5px color-mix(in srgb, #f0dba6 70%, transparent), ${DROP_LIGHT}`,
    edgeDark: `${DIM_EDGE}, 0 0 0 4px transparent, 0 0 0 5px color-mix(in srgb, #f0dba6 55%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 400, letterSpacing: '.18em', titleTransform: 'uppercase', italic: false },
    motif: { sizePx: 16, opacity: 0.06, placement: 'header' },
    ambient: 'binary-ticker',
    wallpaper: { blurPx: 6, position: 'center 24%', dim: 0.1, saturate: 0.94 },
    masthead: 'CHRYSOS · No.10',
    feather: false,
    signature: '侧栏左缘 6px 棋盘带；金色 0101 刻度带走马',
  },
  march7th: {
    styleName: '暗房胶片',
    radiusPx: 6,
    radiusSmPx: 4,
    glass: {
      tintLight: 'color-mix(in srgb, #f1ecf3 80%, #6a5d9b)',
      tintDark: 'color-mix(in srgb, #1b1420 86%, #6a5d9b)',
      frost: 0.78,
      blurPx: 14,
      rimLight: 'color-mix(in srgb, #6a5d9b 40%, transparent)',
      rimDark: 'color-mix(in srgb, #d7b4cb 22%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Red thread seam 3px outside (Vol.11 red string through the pages).
    edgeLight: `${WHITE_EDGE}, 0 0 0 3px transparent, 0 0 0 4px color-mix(in srgb, #b8323f 45%, transparent), ${DROP_LIGHT}`,
    edgeDark: `${DIM_EDGE}, 0 0 0 3px transparent, 0 0 0 4px color-mix(in srgb, #b8323f 55%, transparent), ${DROP_DARK}`,
    typography: { display: 'sans', weight: 700, letterSpacing: '.12em', titleTransform: 'uppercase', italic: false },
    motif: { sizePx: 64, opacity: 0.07, placement: 'sidebar' },
    ambient: 'shard-drift',
    wallpaper: { blurPx: 5, position: 'center 28%', dim: 0.1, saturate: 0.86 },
    masthead: 'CHRYSOS · No.11',
    feather: false,
    signature: '红丝线外缝；胶片带贴侧栏右缘',
  },
  terrae: {
    styleName: '青绢卷轴',
    radiusPx: 4,
    radiusSmPx: 3,
    glass: {
      tintLight: 'color-mix(in srgb, #f3efe6 82%, #a98f5c)',
      tintDark: 'color-mix(in srgb, #1d1a15 84%, #2e5351)',
      frost: 0.82,
      blurPx: 12,
      rimLight: 'color-mix(in srgb, #a98f5c 60%, transparent)',
      rimDark: 'color-mix(in srgb, #a98f5c 45%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Scroll mount: inner teal silk line 3px in, gold outer hairline.
    edgeLight: `${WHITE_EDGE}, inset 0 0 0 3px transparent, inset 0 0 0 4px color-mix(in srgb, #2e5351 35%, transparent), ${DROP_LIGHT}`,
    edgeDark: `${DIM_EDGE}, inset 0 0 0 3px transparent, inset 0 0 0 4px color-mix(in srgb, #2e5351 55%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 600, letterSpacing: '.06em', titleTransform: 'none', italic: false },
    motif: { sizePx: 72, opacity: 0.09, placement: 'header' },
    ambient: 'ink-cloud',
    wallpaper: { blurPx: 5, position: 'center 30%', dim: 0.06, saturate: 0.92 },
    masthead: 'CHRYSOS · No.12',
    feather: false,
    signature: '墨绿绢边金角；页码作竖印',
  },
  hysilens: {
    styleName: '不眠海宴',
    radiusPx: 22,
    radiusSmPx: 14,
    glass: {
      tintLight: 'color-mix(in srgb, #eeeff8 76%, #5759a4)',
      tintDark: 'color-mix(in srgb, #151833 76%, #5759a4)',
      frost: 0.7,
      blurPx: 22,
      rimLight: 'color-mix(in srgb, #5759a4 32%, transparent)',
      rimDark: 'color-mix(in srgb, #e4e9f8 32%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Underwater glow: the only seat with an outer halo.
    edgeLight: `${WHITE_EDGE}, 0 0 24px color-mix(in srgb, #5759a4 22%, transparent), ${DROP_LIGHT}`,
    edgeDark: `${DIM_EDGE}, 0 0 24px color-mix(in srgb, #5759a4 38%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 400, letterSpacing: '.01em', titleTransform: 'none', italic: true },
    motif: { sizePx: 96, opacity: 0.1, placement: 'stage' },
    ambient: 'tide',
    wallpaper: { blurPx: 6, position: 'center 22%', dim: 0.12, saturate: 0.95 },
    masthead: 'CHRYSOS · No.09',
    feather: false,
    signature: '靛紫水下辉光；波浪扇边页脚',
  },
  hyacine: {
    styleName: '云端病历',
    radiusPx: 28,
    radiusSmPx: 999,
    glass: {
      tintLight: 'color-mix(in srgb, #ffffff 80%, #dcb0d1)',
      tintDark: 'color-mix(in srgb, #2b1f2b 76%, #d06693)',
      frost: 0.78,
      blurPx: 16,
      rimLight: 'color-mix(in srgb, #d06693 45%, transparent)',
      rimDark: 'color-mix(in srgb, #dcb0d1 45%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 2,
    },
    // Rainbow ribbon along the top edge (4 hairlines stacked) + inner white edge.
    edgeLight: `inset 0 0 0 1px rgba(255, 255, 255, .65), inset 0 3px 0 color-mix(in srgb, #6891d6 55%, transparent), inset 0 5px 0 color-mix(in srgb, #a7ddf8 55%, transparent), inset 0 7px 0 color-mix(in srgb, #f2c9a0 55%, transparent), ${DROP_LIGHT}`,
    edgeDark: `inset 0 0 0 1px rgba(255, 255, 255, .12), inset 0 3px 0 color-mix(in srgb, #6891d6 55%, transparent), inset 0 5px 0 color-mix(in srgb, #a7ddf8 45%, transparent), inset 0 7px 0 color-mix(in srgb, #f2c9a0 45%, transparent), ${DROP_DARK}`,
    typography: { display: 'sans', weight: 600, letterSpacing: '.02em', titleTransform: 'none', italic: false },
    motif: { sizePx: 96, opacity: 0.12, placement: 'sidebar' },
    ambient: 'bubble-rise',
    wallpaper: { blurPx: 4, position: 'center 26%', dim: 0.04, saturate: 1 },
    masthead: 'CHRYSOS · No.06',
    feather: false,
    signature: '唯一 2px 粗描边 + 顶部彩虹带；控件全药丸',
  },
  phainon: {
    styleName: '白石拱廊',
    radiusPx: 0,
    radiusSmPx: 0,
    glass: {
      tintLight: 'color-mix(in srgb, #ffffff 84%, #f2f3fa)',
      tintDark: 'color-mix(in srgb, #131627 82%, #11195c)',
      frost: 0.9,
      blurPx: 6,
      rimLight: 'color-mix(in srgb, #11195c 22%, transparent)',
      rimDark: 'color-mix(in srgb, #a0a9e3 26%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Marble: gold line 6px out, faint drop (the most editorial, airy volume).
    edgeLight: `${WHITE_EDGE}, 0 0 0 6px transparent, 0 0 0 7px color-mix(in srgb, #c9a75a 55%, transparent), 0 8px 24px color-mix(in srgb, var(--dsw-alias-bg-mask-2) 22%, transparent)`,
    edgeDark: `${DIM_EDGE}, 0 0 0 6px transparent, 0 0 0 7px color-mix(in srgb, #c9a75a 45%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 400, letterSpacing: '.22em', titleTransform: 'uppercase', italic: false },
    motif: { sizePx: 120, opacity: 0.08, placement: 'sidebar' },
    ambient: 'prism-sweep',
    wallpaper: { blurPx: 3, position: 'center 22%', dim: 0.04, saturate: 0.95 },
    masthead: 'CHRYSOS · No.08',
    feather: false,
    signature: '侧栏玻璃片顶部半圆拱（唯一非矩形侧栏）',
  },
  anaxa: {
    styleName: '炼金星盘',
    radiusPx: 3,
    radiusSmPx: 2,
    glass: {
      tintLight: 'color-mix(in srgb, #eaf1ec 80%, #d9c9a8)',
      tintDark: 'color-mix(in srgb, #151d19 86%, #23664d)',
      frost: 0.86,
      blurPx: 10,
      rimLight: 'color-mix(in srgb, #56271b 55%, transparent)',
      rimDark: 'color-mix(in srgb, #2e5c55 60%, transparent)',
      rimStyle: 'double',
      rimWidthPx: 3,
    },
    // Parchment double frame + copper corner ticks are drawn by the rim style; keep a warm drop.
    edgeLight: `${WHITE_EDGE}, 0 0 0 2px color-mix(in srgb, #23664d 18%, transparent), ${DROP_LIGHT}`,
    edgeDark: `${DIM_EDGE}, 0 0 0 2px color-mix(in srgb, #23664d 30%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 500, letterSpacing: '.05em', titleTransform: 'none', italic: false },
    motif: { sizePx: 160, opacity: 0.1, placement: 'stage' },
    ambient: 'astrolabe-spin',
    wallpaper: { blurPx: 5, position: 'center 26%', dim: 0.1, saturate: 0.9 },
    masthead: 'CHRYSOS · No.05',
    feather: false,
    signature: '羊皮纸双线框；星盘大环慢转 120s/圈',
  },
  aglaea: {
    styleName: '金线织物',
    radiusPx: 12,
    radiusSmPx: 8,
    glass: {
      tintLight: 'color-mix(in srgb, #fbf7ec 84%, #deb462)',
      tintDark: 'color-mix(in srgb, #1f1a12 84%, #deb462)',
      frost: 0.78,
      blurPx: 12,
      rimLight: 'color-mix(in srgb, #deb462 55%, transparent)',
      rimDark: 'color-mix(in srgb, #deb462 45%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // The only gold (not white) edge light: gilt on parchment.
    edgeLight: `inset 0 1px 0 color-mix(in srgb, #deb462 60%, #ffffff), ${DROP_LIGHT}`,
    edgeDark: `inset 0 1px 0 color-mix(in srgb, #deb462 40%, transparent), ${DROP_DARK}`,
    typography: { display: 'serif', weight: 500, letterSpacing: '.08em', titleTransform: 'none', italic: false },
    motif: { sizePx: 64, opacity: 0.1, placement: 'sidebar' },
    ambient: 'gold-thread',
    wallpaper: { blurPx: 4, position: 'center 30%', dim: 0.05, saturate: 0.98 },
    masthead: 'CHRYSOS · No.01',
    feather: false,
    signature: '金色边缘光；页脚手写签名',
  },
  mydei: {
    styleName: '赭红竞技',
    radiusPx: 0,
    radiusSmPx: 0,
    clip: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
    glass: {
      tintLight: 'color-mix(in srgb, #f5ece6 80%, #ae8d70)',
      tintDark: 'color-mix(in srgb, #221513 84%, #9c6259)',
      frost: 0.86,
      blurPx: 0,
      rimLight: 'color-mix(in srgb, #582926 60%, transparent)',
      rimDark: 'color-mix(in srgb, #ae8d70 55%, transparent)',
      rimStyle: 'dashed',
      rimWidthPx: 1,
    },
    // Matte seat: no edge light, ochre bar on the left, hard short drop.
    edgeLight: 'inset 4px 0 0 #9c6259, 0 6px 18px color-mix(in srgb, var(--dsw-alias-bg-mask-2) 30%, transparent)',
    edgeDark: 'inset 4px 0 0 #9c6259, 0 6px 18px rgba(2, 6, 14, .5)',
    typography: { display: 'sans', weight: 800, letterSpacing: '.14em', titleTransform: 'uppercase', italic: false },
    motif: { sizePx: 96, opacity: 0.07, placement: 'sidebar' },
    ambient: 'ember',
    wallpaper: { blurPx: 3, position: 'center 24%', dim: 0.08, saturate: 1.02 },
    masthead: 'CHRYSOS · No.03',
    feather: false,
    signature: '八边形切角代替圆角；虚线相框；哑光无高光',
  },
  castorice: {
    styleName: '薄翼夜花',
    radiusPx: 16,
    radiusSmPx: 10,
    glass: {
      tintLight: 'color-mix(in srgb, #f0eff8 70%, #a0a1d9)',
      tintDark: 'color-mix(in srgb, #1a1730 72%, #605c9f)',
      frost: 0.66,
      blurPx: 26,
      rimLight: 'color-mix(in srgb, #a0a1d9 14%, transparent)',
      rimDark: 'color-mix(in srgb, #a0a1d9 18%, transparent)',
      rimStyle: 'none',
      rimWidthPx: 0,
    },
    // Frameless: text floats on violet haze; only a soft violet bloom.
    edgeLight: '0 18px 48px color-mix(in srgb, #2e285b 16%, transparent)',
    edgeDark: '0 18px 48px color-mix(in srgb, #605c9f 22%, transparent)',
    typography: { display: 'serif', weight: 300, letterSpacing: '.10em', titleTransform: 'none', italic: false },
    motif: { sizePx: 96, opacity: 0.1, placement: 'both' },
    ambient: 'butterfly',
    wallpaper: { blurPx: 6, position: 'center 26%', dim: 0.12, saturate: 0.92 },
    masthead: 'CHRYSOS · No.04',
    feather: true,
    signature: '无描边席，侧栏玻璃片羽化溶进页面',
  },
  cipher: {
    styleName: '藏蓝金铺',
    radiusPx: 8,
    radiusSmPx: 4,
    clip: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
    glass: {
      tintLight: 'color-mix(in srgb, #eef0f8 78%, #202d5b)',
      tintDark: 'color-mix(in srgb, #12172c 82%, #3153a0)',
      frost: 0.76,
      blurPx: 14,
      rimLight: 'color-mix(in srgb, #d9b258 55%, transparent)',
      rimDark: 'color-mix(in srgb, #d9b258 60%, transparent)',
      rimStyle: 'solid',
      rimWidthPx: 1,
    },
    // Metal bevel: bright top, dark bottom (the only asymmetric glass) + neon blue inner line.
    edgeLight: 'inset 0 1px 0 rgba(255, 235, 180, .55), inset 0 -1px 0 rgba(0, 0, 0, .18), inset 0 0 0 2px transparent, inset 0 0 0 3px color-mix(in srgb, #3153a0 35%, transparent), ' + DROP_LIGHT,
    edgeDark: 'inset 0 1px 0 rgba(255, 235, 180, .35), inset 0 -1px 0 rgba(0, 0, 0, .35), inset 0 0 0 2px transparent, inset 0 0 0 3px color-mix(in srgb, #3153a0 55%, transparent), ' + DROP_DARK,
    typography: { display: 'sans', weight: 600, letterSpacing: '.06em', titleTransform: 'uppercase', italic: true },
    motif: { sizePx: 64, opacity: 0.1, placement: 'stage' },
    ambient: 'coin-glint',
    wallpaper: { blurPx: 5, position: 'center 24%', dim: 0.12, saturate: 0.96 },
    masthead: 'CHRYSOS · No.07',
    feather: false,
    signature: '价签切角（仅左上/右下）；金属贝维尔玻璃',
  },
})

export function seatGrammarOf(heroId: string | null | undefined): SeatGrammar {
  if (heroId === null || heroId === undefined) return GLOBAL_GRAMMAR
  return SEAT_GRAMMARS[heroId as HeroId] ?? GLOBAL_GRAMMAR
}

const DISPLAY_STACKS: Readonly<Record<DisplayRegister, string>> = {
  serif: '"Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", ui-serif, Georgia, "Times New Roman", serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  mono: 'ui-monospace, "Cascadia Code", Consolas, "SFMono-Regular", monospace',
}

/** CSS custom properties derived from a grammar for one scheme; keys are `--amph-*`. */
export function grammarVariables(grammar: SeatGrammar, dark: boolean, accent: string, accent2: string): Record<string, string> {
  return {
    '--amph-radius': `${grammar.radiusPx}px`,
    '--amph-radius-sm': `${grammar.radiusSmPx}px`,
    '--amph-clip': grammar.clip ?? 'none',
    '--amph-glass-tint': dark ? grammar.glass.tintDark : grammar.glass.tintLight,
    '--amph-glass-frost': String(grammar.glass.frost),
    '--amph-glass-blur': `${grammar.glass.blurPx}px`,
    '--amph-glass-rim': dark ? grammar.glass.rimDark : grammar.glass.rimLight,
    '--amph-rim-style': grammar.glass.rimStyle === 'none' ? 'solid' : grammar.glass.rimStyle,
    '--amph-rim-width': grammar.glass.rimStyle === 'none' ? '0px' : `${grammar.glass.rimWidthPx}px`,
    '--amph-edge': dark ? grammar.edgeDark : grammar.edgeLight,
    '--amph-font-display': DISPLAY_STACKS[grammar.typography.display],
    '--amph-font-weight': String(grammar.typography.weight),
    '--amph-font-style': grammar.typography.italic ? 'italic' : 'normal',
    '--amph-letter-spacing': grammar.typography.letterSpacing,
    '--amph-title-transform': grammar.typography.titleTransform,
    '--amph-motif-size': `${grammar.motif.sizePx}px`,
    '--amph-motif-opacity': String(grammar.motif.opacity),
    '--amph-accent': accent,
    '--amph-accent2': accent2,
    '--amph-wp-blur': `${grammar.wallpaper.blurPx}px`,
    '--amph-wp-position': grammar.wallpaper.position,
    '--amph-wp-dim': String(grammar.wallpaper.dim),
    '--amph-wp-saturate': String(grammar.wallpaper.saturate),
    '--amph-masthead': JSON.stringify(grammar.masthead),
  }
}

/** Every variable name `grammarVariables` may write (for exact cleanup). */
export const GRAMMAR_VARIABLE_NAMES: readonly string[] = Object.keys(
  grammarVariables(GLOBAL_GRAMMAR, false, '#000000', '#000000'),
)
