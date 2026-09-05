/**
 * The ONE permitted hardcoded correspondence between skill names and visual
 * assets (设计底账 05 §1.1 第 9 条). It holds no Chinese display names, no
 * dispatch words, no pipelines, no handoff edges: those come from parsing the
 * skill suite at runtime. Palette and motif per seat follow 设计底账 06 §3
 * (CHRYSOS magazine volumes) as the single visual source.
 */

/** Asset id shared with the delta-me13-skill (formerly amphoreus-skill-suite) `assets/` naming. */
export type HeroId =
  | 'aglaea' | 'tribbie' | 'mydei' | 'castorice' | 'anaxa' | 'hyacine' | 'cipher'
  | 'cerydra' | 'hysilens' | 'march7th' | 'terrae' | 'phainon' | 'cyrene'

/** Natural luminance of the hero's magazine volume (decides light/dark synthesis direction). */
export type VolumeMode = 'light' | 'mid' | 'dark'

export interface HeroPalette {
  /** Primary accent (hex). */
  accent: string
  /** Secondary accent (hex). */
  accent2: string
  /** Optional third accent. */
  accent3?: string
  /** Light-scheme surface tint under the base alias. */
  lightBase: string
  /** Dark-scheme surface tint under the base alias. */
  darkBase: string
  mode: VolumeMode
}

export type HeroMotif =
  | 'gold-thread' | 'stars' | 'lion' | 'butterfly' | 'astrolabe' | 'clouds' | 'coins'
  | 'arches' | 'waves' | 'checker' | 'film' | 'scales' | 'ripples'

export interface HeroVisual {
  readonly skill: string
  readonly heroId: HeroId
  /** Default seat order (翁法罗斯月序; 0 = cover/overview seat). */
  readonly order: number
  /** CHRYSOS magazine volume number (asset file naming only, never a seat index). */
  readonly volume: number
  /** Tileable motif family rendered as SVG/CSS pattern. */
  readonly motif: HeroMotif
  readonly palette: HeroPalette
  /** Private asset file names inside the user's assetsRoot (see README §素材包). */
  readonly assets: {
    readonly chronicle: string
    readonly calendar: string
    readonly card: string
    readonly magazineZip: string
    /** Signature sticker (表情包/) used as the seat's UI icon. */
    readonly sticker: string
    /** Folder under HOME_WALLPAPER_ROOT holding this seat's home-space wallpapers (any count, scanned at derive time). */
    readonly homeWallpaperDir: string
    /** Optional file inside homeWallpaperDir the user pinned as home-00 regardless of aspect ratio. */
    readonly homeWallpaperPin?: string
  }
  /** Face ids this seat can present (visual only; the suite decides semantics). */
  readonly faces?: readonly string[]
}

export const HERO_VISUALS: readonly HeroVisual[] = [
  { skill: 'amphoreus-cyrene', heroId: 'cyrene', order: 0, volume: 13, motif: 'ripples',
    palette: { accent: '#e1acd3', accent2: '#a7ddf8', accent3: '#9968b1', lightBase: '#f4eef6', darkBase: '#221a2b', mode: 'light' },
    assets: { chronicle: '13昔涟.jpg', calendar: '翁法罗斯2026一年历-封面-昔涟.jpg', card: '13昔涟.png', magazineZip: 'Vol.13_往昔的涟漪_昔涟_14张.zip', sticker: '昔涟-收到.png', homeWallpaperDir: '昔涟壁纸' } },
  { skill: 'amphoreus-tribbie', heroId: 'tribbie', order: 1, volume: 2, motif: 'stars',
    palette: { accent: '#a2323a', accent2: '#5668a0', accent3: '#b28f67', lightBase: '#f6efe4', darkBase: '#2a1a16', mode: 'light' },
    assets: { chronicle: '01缇宝.jpg', calendar: '1月-门关月-缇宝.jpg', card: '01缇宝.png', magazineZip: 'Vol.02_命运的三子_缇宝_11张.zip', sticker: '缇宝-睿智.png', homeWallpaperDir: '缇宝壁纸' },
    faces: ['an', 'ning'] },
  { skill: 'amphoreus-cerydra', heroId: 'cerydra', order: 2, volume: 10, motif: 'checker',
    palette: { accent: '#3452d4', accent2: '#f0dba6', accent3: '#6495dd', lightBase: '#eef1fa', darkBase: '#161a2e', mode: 'dark' },
    assets: { chronicle: '02刻律德菈.jpg', calendar: '2月-平衡月-刻律德菈.jpg', card: '02刻律德菈.png', magazineZip: 'Vol.10_执棋的君主_刻律德菈_12张.zip', sticker: '刻律德菈-将军.png', homeWallpaperDir: '刻律德菈壁纸' } },
  { skill: 'amphoreus-march7th', heroId: 'march7th', order: 3, volume: 11, motif: 'film',
    palette: { accent: '#6a5d9b', accent2: '#231829', accent3: '#d7b4cb', lightBase: '#f1ecf3', darkBase: '#1b1420', mode: 'dark' },
    assets: { chronicle: '03长夜月.jpg', calendar: '3月-长夜月-长夜月.jpg', card: '03长夜月.png', magazineZip: 'Vol.11_隐秘的陌客_长夜月_12张.zip', sticker: '长夜月-去吧.png', homeWallpaperDir: '三月七壁纸', homeWallpaperPin: 'Image_1788603038879_823.jpg' },
    faces: ['evernight'] },
  { skill: 'amphoreus-terrae', heroId: 'terrae', order: 4, volume: 12, motif: 'scales',
    palette: { accent: '#644d2e', accent2: '#2e5351', accent3: '#a98f5c', lightBase: '#f3efe6', darkBase: '#1d1a15', mode: 'light' },
    assets: { chronicle: '04丹恒.jpg', calendar: '4月-耕耘月-丹恒.jpg', card: '04丹恒.png', magazineZip: 'Vol.12_腾飞的荒龙_丹恒·腾荒_12张.zip', sticker: '丹恒-倾听.png', homeWallpaperDir: '丹恒壁纸' } },
  { skill: 'amphoreus-hysilens', heroId: 'hysilens', order: 5, volume: 9, motif: 'waves',
    palette: { accent: '#5759a4', accent2: '#1f2662', accent3: '#e4e9f8', lightBase: '#eeeff8', darkBase: '#151833', mode: 'dark' },
    assets: { chronicle: '05海瑟音.jpg', calendar: '5月-欢喜月-海瑟音.jpg', card: '05海瑟音.png', magazineZip: 'Vol.09_奏浪的剑骑_海瑟音_12张.zip', sticker: '海瑟音-哼歌.png', homeWallpaperDir: '海瑟音壁纸' } },
  { skill: 'amphoreus-hyacine', heroId: 'hyacine', order: 6, volume: 6, motif: 'clouds',
    palette: { accent: '#d06693', accent2: '#6891d6', accent3: '#dcb0d1', lightBase: '#f9f2f6', darkBase: '#2b1f2b', mode: 'light' },
    assets: { chronicle: '06风堇.jpg', calendar: '6月-长昼月-风堇.jpg', card: '06风堇.png', magazineZip: 'Vol.06_摇光的医师_雅辛忒丝_12张.zip', sticker: '风堇-治愈.png', homeWallpaperDir: '风堇壁纸' } },
  { skill: 'amphoreus-phainon', heroId: 'phainon', order: 7, volume: 8, motif: 'arches',
    palette: { accent: '#11195c', accent2: '#c9a75a', accent3: '#a0a9e3', lightBase: '#f2f3fa', darkBase: '#131627', mode: 'light' },
    assets: { chronicle: '07白厄.jpg', calendar: '7月-自由月-白厄.jpg', card: '07白厄.png', magazineZip: 'Vol.08_无名的英雄_白厄_12张.zip', sticker: '白厄-诶嘿.png', homeWallpaperDir: '白厄壁纸' } },
  { skill: 'amphoreus-anaxa', heroId: 'anaxa', order: 8, volume: 5, motif: 'astrolabe',
    palette: { accent: '#23664d', accent2: '#56271b', accent3: '#2e5c55', lightBase: '#eaf1ec', darkBase: '#151d19', mode: 'dark' },
    assets: { chronicle: '08那刻夏.jpg', calendar: '8月-收获月-那刻夏.jpg', card: '08那刻夏.png', magazineZip: 'Vol.05_殁世的学士_阿那克萨戈拉斯_12张.zip', sticker: '那刻夏-看穿.png', homeWallpaperDir: '那刻夏壁纸' } },
  { skill: 'amphoreus-aglaea', heroId: 'aglaea', order: 9, volume: 1, motif: 'gold-thread',
    palette: { accent: '#deb462', accent2: '#5f4c31', accent3: '#384759', lightBase: '#f6f2e6', darkBase: '#1f1a12', mode: 'light' },
    // Chronicle filename keeps the source typo 阿格莱呀 (real file on disk).
    assets: { chronicle: '09阿格莱呀.jpg', calendar: '9月-拾线月-阿格莱雅.jpg', card: '09阿格莱雅.png', magazineZip: 'Vol.01_黄金的织者_阿格莱雅_12张.zip', sticker: '阿格莱雅-设计.png', homeWallpaperDir: '阿格莱雅壁纸' } },
  { skill: 'amphoreus-mydei', heroId: 'mydei', order: 10, volume: 3, motif: 'lion',
    palette: { accent: '#9c6259', accent2: '#582926', accent3: '#ae8d70', lightBase: '#f5ece6', darkBase: '#221513', mode: 'mid' },
    assets: { chronicle: '10万敌.jpg', calendar: '10月-纷争月-万敌.jpg', card: '10万敌.png', magazineZip: 'Vol.03_亡国的王储_迈德漠斯_11张.zip', sticker: '万敌-狂.png', homeWallpaperDir: '万敌壁纸' } },
  { skill: 'amphoreus-castorice', heroId: 'castorice', order: 11, volume: 4, motif: 'butterfly',
    palette: { accent: '#a0a1d9', accent2: '#2e285b', accent3: '#605c9f', lightBase: '#f0eff8', darkBase: '#1a1730', mode: 'mid' },
    assets: { chronicle: '11遐蝶.jpg', calendar: '11月-哀悼月-遐蝶.jpg', card: '11遐蝶.png', magazineZip: 'Vol.04_死荫的侍女_遐蝶_14张.zip', sticker: '遐蝶-创作.png', homeWallpaperDir: '遐蝶壁纸' } },
  { skill: 'amphoreus-cipher', heroId: 'cipher', order: 12, volume: 7, motif: 'coins',
    palette: { accent: '#202d5b', accent2: '#d9b258', accent3: '#3153a0', lightBase: '#eef0f8', darkBase: '#12172c', mode: 'dark' },
    assets: { chronicle: '12赛飞儿.jpg', calendar: '12月-机缘月-赛飞儿.jpg', card: '12赛飞儿.png', magazineZip: 'Vol.07_捷足的羁客_赛法利娅_12张.zip', sticker: '赛飞儿-得手.png', homeWallpaperDir: '赛飞儿壁纸' } },
]

/** Non-seat visuals: the Trailblazer (the user) for avatars and empty states. */
export const TRAILBLAZER_ASSETS = {
  'trailblazer-stelle': { goldCard: '0开拓者女.png', stickers: ['开拓者女-记录.png', '开拓者女-重写.png'] },
  'trailblazer-caelus': { goldCard: '14开拓者男.png', stickers: ['开拓者男-记录.png', '开拓者男-重写.png'] },
} as const

/** Brand mark sticker (表情包/): the mini-Cyrene grin. */
export const BRAND_STICKER = '小昔涟-嘻嘻.png'

/** Chimera sticker set (表情包/奇美拉-*): whimsical folder/workspace icons. */
export const CHIMERA_STICKERS = [
  '奇美拉-万敌-蜜果羹-再战.png',
  '奇美拉-丹恒-暖龙龙-保护.png',
  '奇美拉-刻律德菈-奇兽爵-直视.png',
  '奇美拉-海瑟音-咕噜鱼儿-听歌.png',
  '奇美拉-白厄-比格椰-不知道.png',
  '奇美拉-缇宝-苹果糖-炸飞.png',
  '奇美拉-赛飞儿-喵咪神偷-夸夸.png',
  '奇美拉-遐蝶-蝶糕糕-起飞.png',
  '奇美拉-那刻夏-努努斯-喜爱.png',
  '奇美拉-长夜月-胶糖卷-捕捉.png',
  '奇美拉-阿格莱雅-燕麦粥-缠绕.png',
  '奇美拉-风堇-车厘比斯-安抚.png',
] as const

/** URL of one sticker file behind the plugin asset route. */
export function stickerAssetUrl(fileName: string): string {
  return `/amphoreus/assets/${encodeURIComponent('表情包')}/${encodeURIComponent(fileName)}`
}

/** Original calendar artwork used when no derived wide cover is available. */
export function seatWallpaperUrl(hero: HeroVisual): string {
  return `/amphoreus/assets/${encodeURIComponent('翁法罗斯日历')}/${encodeURIComponent(hero.assets.calendar)}`
}

const BY_SKILL = new Map(HERO_VISUALS.map(h => [h.skill, h]))
const BY_HERO = new Map<string, HeroVisual>(HERO_VISUALS.map(h => [h.heroId, h]))

/** Visual record for a skill name, or undefined for a card the suite added later (generic placeholder). */
export function heroVisualOf(skill: string): HeroVisual | undefined {
  return BY_SKILL.get(skill)
}

export function heroVisualById(heroId: string): HeroVisual | undefined {
  return BY_HERO.get(heroId)
}

/** Root folder of the per-seat home-space wallpaper batch (`13黄金裔壁纸/<角色>壁纸/`). */
export const HOME_WALLPAPER_ROOT = '13黄金裔壁纸'

/** Folder (under HOME_WALLPAPER_ROOT) whose images serve the all-seat / portal spaces. */
export const GLOBAL_HOME_DIR = '黄金裔全家福与合影'

/**
 * Seats whose home-wallpaper folder is parked: files stay on disk and are still derived,
 * but the shell falls back to the magazine cover until the user is happy with the batch
 * (user decision 2026-09-05: 赛飞儿 / 万敌 / 白厄).
 */
export const HOME_WALLPAPER_PARKED: readonly HeroId[] = ['cipher', 'mydei', 'phainon']

/** Image extensions scanned inside home wallpaper folders (lower-case, with dot). */
export const HOME_WALLPAPER_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp']

/**
 * Where the six GLOBAL_WALLPAPERS may live, first match wins: the 2026-09-05
 * batch moved `昔涟壁纸/` under `13黄金裔壁纸/`; the flat legacy location stays supported.
 */
export const GLOBAL_WALLPAPER_DIRS: readonly (readonly string[])[] = [
  [HOME_WALLPAPER_ROOT, '昔涟壁纸'],
  ['昔涟壁纸'],
]

/** Global wallpaper files (昔涟壁纸/), in the ledger's filename order. */
export const GLOBAL_WALLPAPERS = [
  'Image_1788022237216_660.png',
  'Image_1788022238729_461.png',
  'Image_1788022241165_565.png',
  'Image_1788022242885_262.png',
  'Image_1788022248464_572.png',
  'Image_1788022255434_340.png',
] as const

/** Derived-cache file name of the n-th (0-based) home wallpaper: `home-00.webp`, `home-01.webp`, … */
export function homeWallpaperFile(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 99) throw new RangeError(`invalid home wallpaper index: ${index}`)
  return `home-${String(index).padStart(2, '0')}.webp`
}

/** Stable pick among n home wallpapers for a seed string (session id); empty seed → 0. */
export function homeWallpaperIndex(seed: string | undefined, count: number): number {
  if (count <= 0) return 0
  if (seed === undefined || seed === '') return 0
  let h = 0
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return h % count
}

/** Deterministic neutral hue for a seat without a visual record (hash of the skill name). */
export function fallbackHue(skill: string): number {
  let h = 0
  for (const ch of skill) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return h % 360
}
