import type { Protocol } from '@pkmn/protocol';
import { ChoiceBuilder } from '@pkmn/view';

export interface MoveModifiers {
  mega?: boolean;
  zmove?: boolean;
  max?: boolean;
  /**
   * Spelled `terastallize` (two Ls) to match what the live server's `/choose`
   * parser actually accepts (`sim/side.ts`'s `chooseMove`) — verified against
   * the server source directly because Showdown's own SIM-PROTOCOL.md
   * documents `terastalize` (one L), which the parser does not recognize.
   * `@pkmn/view`'s `ChoiceBuilder` already emits the correct two-L form; this
   * type just keeps that spelling load-bearing rather than accidentally
   * "fixed" back to the documented-but-wrong one L.
   */
  terastallize?: boolean;
}

/** Build the `/choose move N [modifiers]|RQID` command for a singles choice. */
export function chooseMove(request: Protocol.Request, slot: number, modifiers: MoveModifiers = {}): string {
  const suffix = [
    modifiers.mega && 'mega',
    modifiers.zmove && 'zmove',
    modifiers.max && 'max',
    modifiers.terastallize && 'terastallize',
  ]
    .filter(Boolean)
    .join(' ');
  return finalize(request, `move ${slot}${suffix ? ` ${suffix}` : ''}`);
}

/** Build the `/choose switch N|RQID` command. */
export function chooseSwitch(request: Protocol.Request, slot: number): string {
  return finalize(request, `switch ${slot}`);
}

/**
 * Build the `/choose team ...|RQID` command for team preview.
 *
 * `order` is the desired lead order as 1-based team slots, e.g. `[3, 1, 2]`
 * to lead with the third Pokémon, then the first, then the second.
 *
 * Unlike moves and switches, team order is *not* one combined numeric
 * string: `ChoiceBuilder` parses `team 21` as "pick slot 21" (a single
 * `parseInt` on the whole remainder), not "slot 2, then slot 1" — verified
 * by trying the concatenated form and getting exactly that error. Each
 * position has to be its own `addChoice('team N')` call, threaded through
 * one `ChoiceBuilder` so it can track which slots are already spoken for.
 */
export function chooseTeamOrder(request: Protocol.Request, order: number[]): string {
  return finalize(request, order.map(slot => `team ${slot}`));
}

/**
 * Runs one or more choices through `ChoiceBuilder` (which validates each
 * against the request and guards against the wrong response type for what's
 * being asked) and appends the request ID.
 *
 * The `|RQID` suffix has to be added here rather than inside `ChoiceBuilder`
 * — its `toString()` doesn't include it — and is what stops a slow "Undo" or
 * a race after a reconnect from having a stale choice applied to the wrong
 * turn (see SIM-PROTOCOL.md's "Choice requests" section).
 *
 * Note `ChoiceBuilder` does not bounds-check a move/switch slot against how
 * many moves or team members actually exist — verified by hand, an
 * out-of-range slot passes through unrejected. The server is the real
 * validator; an illegal choice comes back as `|error|[Invalid choice]`
 * followed by a fresh `|request|`, which `LiveBattle.feed` already handles
 * the same as any other request update.
 */
function finalize(request: Protocol.Request, choiceStrings: string | string[]): string {
  const builder = new ChoiceBuilder(request);
  for (const choiceString of Array.isArray(choiceStrings) ? choiceStrings : [choiceStrings]) {
    const error = builder.addChoice(choiceString);
    if (error) throw new Error(error);
  }
  if (!builder.isDone()) {
    throw new Error(
      `Choice incomplete: this request needs more picks than were given ` +
        '(doubles/triples need one addChoice call per active slot).',
    );
  }
  const command = builder.toString();
  return request.rqid !== undefined ? `${command}|${request.rqid}` : command;
}
