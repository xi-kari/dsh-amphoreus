import type { CSSProperties } from 'react'
import { heroVisualById } from '../shared/heroes.ts'
import { motifDataUri } from '../shared/motifs.ts'

/** Inline motif custom property shared by host-shell surfaces. */
export function seatMotifStyle(heroId: string, dark: boolean): CSSProperties | undefined {
  const visual = heroVisualById(heroId)
  if (visual === undefined) return undefined
  return {
    ['--amphoreus-motif-url' as string]: motifDataUri(visual.motif, {
      color: dark ? visual.palette.accent2 : visual.palette.accent,
      opacity: dark ? 0.16 : 0.12,
    }),
  }
}
