export interface CodeBackgroundPrefs {
  readonly enabled: boolean
  readonly intensity: number
  readonly interactive: boolean
}

export const CODE_BACKGROUND_DEFAULTS: CodeBackgroundPrefs = Object.freeze({
  enabled: false,
  intensity: 0.45,
  interactive: true,
})
