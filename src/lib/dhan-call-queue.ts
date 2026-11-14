/**
 * One queue for Dhan's chart-history calls across every request in the process. Measured: back-to-back calls for
 * a fortnight's windows draw a 429, so calls run one at a time with a gap, and a 429 is retried once after a pause.
 */

const CALL_GAP_MS = 400;
const RATE_LIMIT_PAUSE_MS = 2_500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let gate: Promise<unknown> = Promise.resolve();

const queued = <T>(task: () => Promise<T>): Promise<T> => {
  const run = gate.then(task);
  gate = run.then(() => sleep(CALL_GAP_MS), () => sleep(CALL_GAP_MS));
  return run;
};

const isRateLimited = (error: unknown): boolean => error instanceof Error && error.message.includes("429");

export const callDhan = async <T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await queued(task);
  } catch (error) {
    if (!isRateLimited(error)) throw error;
    await sleep(RATE_LIMIT_PAUSE_MS);
    return queued(task);
  }
};
