import { Battle } from '@pkmn/client';

import { gens } from './generations';

export interface ReplayError {
  /** 0-indexed line number within the log. */
  line: number;
  content: string;
  message: string;
}

export interface ReplayResult {
  /** The battle as it stood when replay stopped — complete, or at the error. */
  battle: Battle;
  linesProcessed: number;
  /** Whether a `|win|` or `|tie|` line was seen. False on a truncated log. */
  reachedEnd: boolean;
  error?: ReplayError;
}

/**
 * Feed an entire Showdown protocol log — e.g. the `log` field from the replay
 * JSON API — through a fresh `Battle`, line by line.
 *
 * Stops at the first line `Battle.add` throws on, rather than pressing on past
 * a state it didn't understand. A state machine that limps forward after an
 * error it swallowed is worse than one that fails loudly: it would hide
 * exactly the protocol gaps this replay corpus exists to surface, and this
 * function is the thing standing between "battle state is wrong" and "the app
 * crashes mid-match" once this is wired to a live connection.
 */
export function replayLog(log: string): ReplayResult {
  const battle = new Battle(gens);
  const lines = log.split('\n');
  let reachedEnd = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('|win|') || line.startsWith('|tie|')) reachedEnd = true;
    try {
      battle.add(line);
    } catch (cause) {
      return {
        battle,
        linesProcessed: i,
        reachedEnd,
        error: {
          line: i,
          content: line,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  return { battle, linesProcessed: lines.length, reachedEnd };
}
