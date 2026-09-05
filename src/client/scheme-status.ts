/**
 * Pure state machine behind the visual-scheme panel's success line.
 *
 * Inputs come from the settings page each render:
 * - `active`  — which scheme action the page's `run()` lock is executing right now (or none);
 * - `acting`  — whether *any* settings action is running (grammar slider, wallpaper upload, …);
 * - `errored` — whether the page-level action line currently shows an error.
 *
 * The success line appears when a scheme action finishes without an error, and disappears as soon
 * as another action starts or an error shows up. A background `refresh()` (SSE-triggered) is not
 * an "action" — it must not wipe the line, which is why the input is `acting`, not `busy`.
 */

export type SchemeAction = 'export' | 'import'

export interface SchemeStatus {
  /** Scheme action currently running, remembered so its completion can be recognised. */
  readonly running: SchemeAction | undefined
  /** Which success line is shown, if any. */
  readonly done: SchemeAction | undefined
}

export interface SchemeStatusInput {
  readonly active: SchemeAction | undefined
  readonly acting: boolean
  readonly errored: boolean
}

export const SCHEME_STATUS_IDLE: SchemeStatus = { running: undefined, done: undefined }

/**
 * Advance the status for one render's inputs. Returns the same object when nothing changes so a
 * `useState` setter can bail out.
 * @param status - previous status.
 * @param input - this render's inputs.
 * @returns the next status.
 */
export function reduceSchemeStatus(status: SchemeStatus, input: SchemeStatusInput): SchemeStatus {
  if (input.active !== undefined) {
    if (status.running === input.active && status.done === undefined) return status
    return { running: input.active, done: undefined }
  }
  if (status.running !== undefined) {
    return { running: undefined, done: input.errored ? undefined : status.running }
  }
  if ((input.acting || input.errored) && status.done !== undefined) return SCHEME_STATUS_IDLE
  return status
}
