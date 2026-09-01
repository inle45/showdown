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
    return text ? stripSpoilerMarkup(text) : text;
  }
}

/**
 * Strips Showdown's Discord-style spoiler markup, `||hover-text||visible-text||`.
 *
 * `@pkmn/client`'s `Battle.damagePercentage()` (used as `LogFormatter`'s
 * `Tracker`) deliberately emits this whenever a Pokémon's max HP isn't
 * normalized to 100 — which is essentially always for a live player's own
 * side, since a connected player always sees their own HP as an exact
 * fraction regardless of a format's "HP Percentage Mod" rule (that rule
 * only affects what the *opponent* sees). Confirmed empirically: every
 * `-damage` line in the real replay corpus with a non-100 max HP produces
 * this wrapped form, not just an edge case.
 *
 * The official web client renders this as a tap/hover-to-reveal spoiler
 * (the feature this syntax was added for). A plain-text log doesn't have
 * that interaction, so this keeps only the visible half — e.g.
 * `"(Ceruledge lost ||−245/245||100%|| of its health!)"` becomes
 * `"(Ceruledge lost 100% of its health!)"` — rather than leaking the raw
 * markup as if it were a formatting bug.
 */
function stripSpoilerMarkup(text: string): string {
  return text.replace(/\|\|.*?\|\|(.*?)\|\|/g, '$1');
}
