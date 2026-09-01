import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { replayLog } from '../replay';

/**
 * Every real fixture in `fixtures/` gets replayed through the battle state
 * machine and must reach a clean `|win|`/`|tie|` without `Battle.add`
 * throwing, with the winner it names actually being one of the two players
 * `Battle` tracked.
 *
 * This is the regression corpus every prior open-source Showdown client
 * stalled on: getting chat working is easy, getting the battle state
 * machine right across generations, doubles, and random formats is where
 * they all stopped shipping. A change here failing this suite means a real
 * match would have broken client-side, not a contrived edge case.
 *
 * What this does *not* prove: `Battle.add` is deliberately tolerant of
 * messages it doesn't recognize — it degrades to placeholder data rather
 * than throwing, so this corpus cannot catch a subtly wrong HP value, status,
 * or side condition. It catches crashes and misidentified outcomes, not
 * every possible state-tracking bug. A value-level oracle (asserting exact
 * per-turn state against a known-correct source) would catch more but is a
 * separate, larger effort than this in-progress test purports to be.
 *
 * Refresh the corpus with `npm run fetch-fixtures` in this package.
 */

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));
const fixtureFiles = readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

// A corpus this small stops meaning anything if it silently shrinks to zero
// (e.g. .gitignore swallowing the fixtures, or a bad refresh). Fail loudly
// rather than have every `it.each` below vacuously pass on an empty list.
if (fixtureFiles.length === 0) {
  throw new Error(
    `No fixtures found in ${fixturesDir}. Run \`npm run fetch-fixtures\` in packages/battle first.`,
  );
}

describe('replay corpus', () => {
  it.each(fixtureFiles)('replays %s to a clean finish', filename => {
    const fixture = JSON.parse(readFileSync(`${fixturesDir}/${filename}`, 'utf8')) as {
      id: string;
      formatid: string;
      log: string;
    };

    const result = replayLog(fixture.log);

    if (result.error) {
      throw new Error(
        `${fixture.id} (${fixture.formatid}) failed at line ${result.error.line}: ` +
          `${result.error.message}\n  ${result.error.content}`,
      );
    }
    expect(result.reachedEnd).toBe(true);

    const winnerLine = fixture.log.split('\n').find(line => line.startsWith('|win|'));
    if (winnerLine) {
      const winner = winnerLine.slice('|win|'.length);
      // The winner the server announced must be a player Battle actually
      // tracked — a real identity-tracking check, not just "didn't crash".
      expect([result.battle.p1.name, result.battle.p2.name]).toContain(winner);
    }
  });

  it('covers more than one generation and game type', () => {
    // A corpus that's accidentally all gen9ou proves nothing about whether
    // the client handles anything else.
    const formats = new Set(
      fixtureFiles.map(f => {
        const fixture = JSON.parse(readFileSync(`${fixturesDir}/${f}`, 'utf8')) as {
          formatid: string;
        };
        return fixture.formatid;
      }),
    );
    expect(formats.size).toBeGreaterThanOrEqual(4);
  });
});
