import type { LongSide } from "./option-filter";

/**
 * Decides when a change in the long-option verdict is worth telling the user about. A verdict can flicker around
 * a threshold, so a new one must hold for a few readings and alerts are spaced out: nobody should get five
 * messages in a minute from one wobbling number.
 */

/** A new verdict must appear in this many readings in a row before it is announced. */
export const CONFIRM_READINGS = 2;
/** At most one alert per instrument in this time; a change that lands inside it is announced once it ends, if it still holds. */
export const ALERT_COOLDOWN_MS = 3 * 60_000;

export interface VerdictState {
  /** The verdict the user was last told, or first saw. Undefined until the first reading. */
  readonly announced: LongSide | undefined;
  readonly candidate: LongSide | undefined;
  readonly candidateReadings: number;
  readonly lastAlertAt: number;
}

export const INITIAL_VERDICT_STATE: VerdictState = { announced: undefined, candidate: undefined, candidateReadings: 0, lastAlertAt: Number.NEGATIVE_INFINITY };

/** Folds in one reading. `alert` is the verdict to announce now, if any. The first reading only sets the baseline. */
export const nextVerdictState = (state: VerdictState, side: LongSide, now: number): { readonly state: VerdictState; readonly alert: LongSide | undefined } => {
  if (state.announced === undefined) return { state: { ...state, announced: side }, alert: undefined };
  if (side === state.announced) return { state: { ...state, candidate: undefined, candidateReadings: 0 }, alert: undefined };
  const readings = state.candidate === side ? state.candidateReadings + 1 : 1;
  const isConfirmed = readings >= CONFIRM_READINGS;
  if (isConfirmed && now - state.lastAlertAt >= ALERT_COOLDOWN_MS) {
    return { state: { announced: side, candidate: undefined, candidateReadings: 0, lastAlertAt: now }, alert: side };
  }
  return { state: { ...state, candidate: side, candidateReadings: readings }, alert: undefined };
};
