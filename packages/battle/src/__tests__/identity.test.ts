import { describe, expect, it } from 'vitest';

import { isSameUser } from '../identity';

describe('isSameUser', () => {
  it('matches a guest despite the leading-space rank placeholder', () => {
    // The exact real-world values: connected live to sim3.psim.us as a
    // guest and compared the raw |updateuser| line against the |player|
    // line for that same account in a battle it started.
    expect(isSameUser(' Guest 38980330', 'Guest 38980330')).toBe(true);
  });

  it('matches a ranked account despite the rank-symbol prefix', () => {
    expect(isSameUser('+SomeDriver', 'SomeDriver')).toBe(true);
    expect(isSameUser('%SomeMod', 'SomeMod')).toBe(true);
  });

  it('is case-insensitive, matching Showdown identity semantics', () => {
    expect(isSameUser('Guest 123', 'guest 123')).toBe(true);
  });

  it('does not match different accounts', () => {
    expect(isSameUser(' Guest 38980330', 'Guest 12345678')).toBe(false);
  });
});
