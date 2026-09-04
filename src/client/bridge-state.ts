import type { FeatureSwitches } from '../host/suite/types.ts'
import type { AmphoreusState, PublicSuite } from '../shared/api.ts'

const FEATURES_OFF: FeatureSwitches = {
  provider: false,
  autoInject: false,
  seatSync: false,
  dispatchHints: false,
  pipelines: false,
  handoffButtons: false,
  receiptDetection: false,
  salonHints: false,
}

export interface AmphoreusStateMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:state'
  readonly revision: number
  readonly features: FeatureSwitches
  readonly dispatch: PublicSuite['dispatch']
  readonly pipelines: PublicSuite['pipelines']
  readonly cards: readonly Pick<PublicSuite['cards'][number], 'name' | 'displayName' | 'aliases' | 'faces' | 'status'>[]
  readonly seats: AmphoreusState['seats']
  readonly bindings: AmphoreusState['bindings']
  readonly observations: AmphoreusState['observations']
  readonly memory: AmphoreusState['memory']
  readonly effectiveConfig: AmphoreusState['effectiveConfig']
  readonly firewallWords: readonly string[]
}

export function buildStateMessage(state: AmphoreusState): AmphoreusStateMessage {
  return {
    source: 'dsh-amphoreus',
    type: 'amphoreus:state',
    revision: state.revision,
    features: state.suite?.features ?? FEATURES_OFF,
    dispatch: state.suite?.dispatch ?? [],
    pipelines: state.suite?.pipelines ?? [],
    cards: (state.suite?.cards ?? []).map(card => ({
      name: card.name,
      displayName: card.displayName,
      aliases: card.aliases,
      faces: card.faces,
      status: card.status,
    })),
    seats: state.seats,
    bindings: state.bindings,
    observations: state.observations,
    memory: state.memory,
    effectiveConfig: state.effectiveConfig,
    firewallWords: state.suite?.contracts?.firewallWords ?? [],
  }
}
