/** Tuning for reconnect delays. */
export interface BackoffOptions {
  /** Delay before the first retry, in ms. */
  initialDelay: number;
  /** Ceiling for any single delay, in ms. */
  maxDelay: number;
  /** Multiplier applied per consecutive failure. */
  factor: number;
  /**
   * Fraction of each delay that is randomised, in [0, 1].
   *
   * Showdown drops every socket on a server restart, so without jitter the
   * entire mobile userbase would retry in lockstep and re-DDoS the server as it
   * comes back up. 0.5 keeps delays within [50%, 100%] of the nominal value.
   */
  jitter: number;
  /** Give up after this many consecutive failures. `Infinity` retries forever. */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialDelay: 1_000,
  maxDelay: 30_000,
  factor: 2,
  jitter: 0.5,
  maxAttempts: Infinity,
};

/**
 * Delay before retry number `attempt` (0-indexed: 0 is the first retry).
 *
 * `random` is injectable so tests can assert exact values instead of ranges.
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const nominal = Math.min(options.initialDelay * options.factor ** attempt, options.maxDelay);
  const randomised = nominal * (1 - options.jitter * random());
  return Math.round(randomised);
}
