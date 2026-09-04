export interface DispatchCandidate {
  readonly skill: string
  readonly face?: string
  readonly roleText: string
  readonly score: number
  readonly hits: string[]
}

interface DispatchRow {
  readonly needs: readonly string[]
  readonly roleText: string
  readonly skill: string
  readonly face?: string
}

interface DispatchCard {
  readonly name: string
  readonly displayName: string
  readonly aliases: readonly string[]
}

interface CandidateState extends DispatchCandidate {
  readonly index: number
  readonly bestRowScore: number
  readonly bestFaceMatch: boolean
  readonly hitKeys: ReadonlySet<string>
  readonly named: boolean
}

export function suggestSeats(
  text: string,
  dispatch: readonly DispatchRow[],
  cards: readonly DispatchCard[],
  limit = 3,
): DispatchCandidate[] {
  const hay = text.trim().toLowerCase()
  if (hay === '') return []
  const byName = new Map(cards.map(card => [card.name, card]))
  const best = new Map<string, CandidateState>()

  dispatch.forEach((row, index) => {
    const card = byName.get(row.skill)
    const names = card === undefined
      ? row.roleText.split('／').map(name => name.trim())
      : [card.displayName, ...card.aliases]
    const matchedName = names.find(name => {
      const normalized = name.toLowerCase()
      return normalized.length >= 2 && hay.includes(normalized)
    })
    const matchedNeeds = row.needs.filter(need => {
      const normalized = need.toLowerCase()
      return normalized !== '' && hay.includes(normalized)
    })
    const rowScore = matchedNeeds.reduce((score, need) => score + need.toLowerCase().length, 0)
      + (matchedName === undefined ? 0 : 100)
    const faceMatch = matchedName !== undefined
      && row.face?.toLowerCase() === matchedName.toLowerCase()
    if (rowScore === 0) return

    const previous = best.get(row.skill)
    const hitKeys = new Set(previous?.hitKeys ?? [])
    const hits = [...(previous?.hits ?? [])]
    let score = previous?.score ?? 0
    for (const need of matchedNeeds) {
      const key = need.toLowerCase()
      if (hitKeys.has(key)) continue
      hitKeys.add(key)
      hits.push(need)
      score += key.length
    }
    let named = previous?.named ?? false
    if (matchedName !== undefined) {
      const key = matchedName.toLowerCase()
      if (!hitKeys.has(key)) {
        hitKeys.add(key)
        hits.push(matchedName)
      }
      if (!named) {
        named = true
        score += 100
      }
    }

    const rowWins = previous === undefined
      || rowScore > previous.bestRowScore
      || (rowScore === previous.bestRowScore && faceMatch && !previous.bestFaceMatch)
    best.set(row.skill, {
      skill: row.skill,
      roleText: rowWins ? row.roleText : previous.roleText,
      score,
      hits,
      ...(rowWins
        ? row.face === undefined ? {} : { face: row.face }
        : previous.face === undefined ? {} : { face: previous.face }),
      index: rowWins ? index : previous.index,
      bestRowScore: rowWins ? rowScore : previous.bestRowScore,
      bestFaceMatch: rowWins ? faceMatch : previous.bestFaceMatch,
      hitKeys,
      named,
    })
  })

  return [...best.values()]
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ index: _index, bestRowScore: _bestRowScore, bestFaceMatch: _bestFaceMatch, hitKeys: _hitKeys, named: _named, ...candidate }) => candidate)
}
