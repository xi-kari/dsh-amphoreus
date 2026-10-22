import { wallpaperUploadMime } from '../shared/wallpaper-media.ts'

const VALIDATION_TIMEOUT = 15_000

export async function prepareWallpaperUpload(file: File, signal?: AbortSignal): Promise<string> {
  if (file.size === 0) throw new Error('文件为空，请重新选择图片或视频；原壁纸未改变。')
  const mime = wallpaperUploadMime(file)
  if (mime === undefined) throw new Error('不支持此文件类型。请使用 PNG、JPG、WebP、GIF、AVIF、APNG、MP4 或 WebM；原壁纸未改变。')
  signal?.throwIfAborted()
  const url = URL.createObjectURL(file)
  const video = mime.startsWith('video/') ? document.createElement('video') : undefined
  const image = video === undefined ? new Image() : undefined
  let timer: number | undefined
  let cleanup = () => {}
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(new Error(video === undefined
        ? '浏览器无法读取这张图片。请重新导出为 PNG、JPG 或 WebP 后再试；原壁纸未改变。'
        : '浏览器无法播放此视频。请使用 H.264 编码的 MP4 或 VP9/VP8 编码的 WebM；原壁纸未改变。'))
      const aborted = () => reject(signal?.reason ?? new Error('壁纸上传已取消'))
      const ready = () => {
        if (video !== undefined && (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0)) return
        resolve()
      }
      signal?.addEventListener('abort', aborted, { once: true })
      timer = window.setTimeout(() => reject(new Error('媒体读取超时，请检查文件或换用较短的视频后重试；原壁纸未改变。')), VALIDATION_TIMEOUT)
      cleanup = () => {
        signal?.removeEventListener('abort', aborted)
        video?.removeEventListener('loadeddata', ready)
        video?.removeEventListener('error', failed)
      }
      if (video !== undefined) {
        video.muted = true
        video.preload = 'auto'
        video.playsInline = true
        video.addEventListener('loadeddata', ready)
        video.addEventListener('error', failed)
        video.src = url
        video.load()
      } else if (image !== undefined) {
        image.src = url
        void image.decode().then(() => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve() : failed(), failed)
      }
    })
    return mime
  } finally {
    cleanup()
    if (timer !== undefined) window.clearTimeout(timer)
    if (video !== undefined) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    if (image !== undefined) image.src = ''
    URL.revokeObjectURL(url)
  }
}
