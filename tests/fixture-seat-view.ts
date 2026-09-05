import type { SeatView } from '../src/client/seat-model.ts'

/** Minimal deployed, visible SeatView for seat-switch tests. */
export function fixtureView(skillName: string, overrides: Partial<SeatView> = {}): SeatView {
  return {
    skillName,
    heroId: null,
    displayName: skillName,
    duty: undefined,
    deployed: true,
    hidden: false,
    order: 0,
    visual: undefined,
    accent: '#000',
    accent2: '#111',
    hue: null,
    stickerUrl: null,
    sessionIds: [],
    ...overrides,
  }
}
