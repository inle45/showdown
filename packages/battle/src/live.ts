import { Battle } from '@pkmn/client';
import type { ArgType, KWArgType } from '@pkmn/protocol';
import type { SideID } from '@pkmn/types';
import { LogFormatter } from '@pkmn/view';

import { gens } from './generations';

/**
 * A `Battle` paired with a `LogFormatter` for a single live match.
 *
 * `LogFormatter` must see each protocol message *before* `Battle` mutates
 * state for it — it renders human text from the pre-update state (Showdown's
 * protocol encodes the state a message describes leaving, not the state it
 * describes arriving in) — so `feed()` exists specifically to get that
 * ordering right in one place rather than relying on every caller to
 * remember it.
 */
export class LiveBattle {
  readonly battle: Battle;
  readonly formatter: LogFormatter;

  constructor(perspective: SideID = 'p1') {
    this.battle = new Battle(gens);
    this.formatter = new LogFormatter(perspective, this.battle);
  }

  /**
   * Which side's-eye-view the log text is written from — e.g. "you" vs "the
   * opposing X". Update this once the connected account's own username is
   * known to match one of `battle.p1.name` / `battle.p2.name`; until then,
   * text renders from the default perspective passed to the constructor.
   */
  setPerspective(side: SideID): void {
    this.formatter.perspective = side;
  }

  /**
   * Feed one live protocol message. Returns the formatted log line for it,
   * if the message produces user-facing text (many protocol messages, like
   * `|request|`, don't).
   */
  feed(args: ArgType, kwArgs: KWArgType = {}): string {
    const text = this.formatter.formatText(args, kwArgs);
    this.battle.add(args, kwArgs);
    return text;
  }
}
