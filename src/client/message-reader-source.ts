export interface ReaderCode {
  readonly id: string
  readonly language: string
  readonly info: string
  readonly code: string
  readonly startLine: number
}

export function extractReaderCode(text: string): readonly ReaderCode[] {
  const blocks: ReaderCode[] = []
  let opening: { info: string; line: number; bodyStart: number; marker: string } | undefined
  let lineNumber = 0
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (match[0] === '') continue
    lineNumber++
    const line = match[0].replace(/[\r\n]+$/, '')
    if (opening !== undefined) {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1]
      if (closing !== undefined && closing[0] === opening.marker[0] && closing.length >= opening.marker.length) {
        blocks.push({
          id: `code-${opening.line}`, language: opening.info.split(/\s+/)[0] ?? '',
          info: opening.info, code: text.slice(opening.bodyStart, match.index), startLine: opening.line,
        })
        opening = undefined
      }
      continue
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence?.[1]?.startsWith('`') && fence[2]?.includes('`')) continue
    if (fence !== null) opening = {
      marker: fence[1] ?? '', info: (fence[2] ?? '').trim(), line: lineNumber,
      bodyStart: match.index + match[0].length,
    }
  }
  if (opening !== undefined) blocks.push({
    id: `code-${opening.line}`, language: opening.info.split(/\s+/)[0] ?? '',
    info: opening.info, code: text.slice(opening.bodyStart), startLine: opening.line,
  })
  return blocks
}
