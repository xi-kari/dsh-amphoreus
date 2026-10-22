export const WALLPAPER_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/apng': 'apng', 'video/mp4': 'mp4', 'video/webm': 'webm',
})

export const WALLPAPER_ACCEPT = Object.keys(WALLPAPER_MEDIA_TYPES).join(',')

export function wallpaperUploadMime(file: { readonly name: string; readonly type: string }): string | undefined {
  const mime = file.type.toLowerCase().split(';')[0]!.trim()
  if (Object.hasOwn(WALLPAPER_MEDIA_TYPES, mime)) return mime
  if (mime !== '' && mime !== 'application/octet-stream') return undefined
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (extension === 'jpeg') return 'image/jpeg'
  return Object.entries(WALLPAPER_MEDIA_TYPES).find(([, value]) => value === extension)?.[0]
}
