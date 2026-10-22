export interface DraftMetrics {
  readonly characters: number
  readonly lines: number
  readonly attachments: number
  readonly references: number
}

export function draftMetrics(text: string, attachments: number, references: number): DraftMetrics {
  return {
    characters: Array.from(text).length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length,
    attachments: Math.max(0, Math.trunc(attachments)),
    references: Math.max(0, Math.trunc(references)),
  }
}
