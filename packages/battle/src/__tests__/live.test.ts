import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Protocol } from '@pkmn/protocol';
import { describe, expect, it } from 'vitest';

import { LiveBattle } from '../live';

/** Parse a raw wire-format line the way real server traffic arrives. */
function feedLine(live: LiveBattle, line: string): string {
  const { args, kwArgs } = Protocol.parseBattleLine(line);
  return live.feed(args, kwArgs);
}

describe('LiveBattle.feed', () => {
  it('strips the spoiler markup from a damage line with exact HP', () => {
    const live = new LiveBattle();
    feedLine(live, '|switch|p1a: Ceruledge|Ceruledge, L88|245/245');
    const text = feedLine(live, '|-damage|p1a: Ceruledge|0 fnt');
    // The real bytes captured live: @pkmn/client emits
    // "  (Ceruledge lost ||−245/245||100%|| of its health!)" here.
    expect(text).toContain('lost 100% of its health');
    expect(text).not.toContain('||');
  });

  it('leaves ordinary text untouched', () => {
    const live = new LiveBattle();
    const text = feedLine(live, '|join|Someone');
    expect(text).not.toContain('||');
  });
});

/**
 * Runs every real replay fixture through `LiveBattle.feed()` — not just
 * `Battle.add()`, which `replay-corpus.test.ts` already covers — because
 * that's the only path that exercises `LogFormatter`, and it's exactly
 * where the spoiler-markup bug above was found: a device screenshot showed
 * raw `||−245/245||100%||` in the battle log, `Battle.add()` alone would
 * never have caught it since it never touches formatted text at all.
 */
describe('LiveBattle.feed corpus scan', () => {
  const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));
  const fixtureFiles = readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

  it.each(fixtureFiles)('produces no raw spoiler markup in %s', filename => {
    const fixture = JSON.parse(readFileSync(`${fixturesDir}/${filename}`, 'utf8')) as {
      log: string;
    };
    const live = new LiveBattle();

    for (const { args, kwArgs } of Protocol.parse(fixture.log)) {
      const text = live.feed(args, kwArgs);
      if (text) expect(text).not.toContain('||');
    }
  });
});
