import { describe, expect, it } from 'vitest';

import { DEFAULT_BACKOFF, backoffDelay } from '../backoff.js';

describe('backoffDelay', () => {
  const noJitter = () => 0;

  it('grows exponentially', () => {
    expect(backoffDelay(0, DEFAULT_BACKOFF, noJitter)).toBe(1_000);
    expect(backoffDelay(1, DEFAULT_BACKOFF, noJitter)).toBe(2_000);
    expect(backoffDelay(2, DEFAULT_BACKOFF, noJitter)).toBe(4_000);
    expect(backoffDelay(3, DEFAULT_BACKOFF, noJitter)).toBe(8_000);
  });

  it('caps at maxDelay so a long outage never parks the client for hours', () => {
    expect(backoffDelay(50, DEFAULT_BACKOFF, noJitter)).toBe(DEFAULT_BACKOFF.maxDelay);
  });

  it('subtracts up to `jitter` of the delay so clients do not retry in lockstep', () => {
    // A server restart drops every client at once; without jitter they would
    // all come back simultaneously and knock it over again.
    expect(backoffDelay(0, DEFAULT_BACKOFF, () => 1)).toBe(500);
    expect(backoffDelay(0, DEFAULT_BACKOFF, () => 0.5)).toBe(750);
  });

  it('stays within [50%, 100%] of nominal across many random draws', () => {
    for (let i = 0; i < 200; i++) {
      const delay = backoffDelay(2, DEFAULT_BACKOFF);
      expect(delay).toBeGreaterThanOrEqual(2_000);
      expect(delay).toBeLessThanOrEqual(4_000);
    }
  });
});
