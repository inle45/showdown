import type { ID, Protocol } from '@pkmn/protocol';
import { describe, expect, it } from 'vitest';

import { chooseMove, chooseSwitch, chooseTeamOrder } from '../choice';

/**
 * A hand-built request matching the schema documented in
 * SIM-PROTOCOL.md's "Choice requests" section — public replays never
 * contain `|request|` lines (it's private, per-player information stripped
 * before a battle log is made public), so there is no real fixture to pull
 * this from.
 */
const moveRequest: Protocol.Request = {
  requestType: 'move',
  rqid: 4,
  side: {
    name: 'tester' as Protocol.Username,
    id: 'p1',
    pokemon: [
      {
        ident: 'p1: Gyarados' as Protocol.PokemonIdent,
        details: 'Gyarados' as Protocol.PokemonDetails,
        condition: '100/100' as Protocol.PokemonHPStatus,
        active: true,
        stats: { atk: 200, def: 150, spa: 100, spd: 120, spe: 130 },
        moves: ['waterfall', 'earthquake', 'icefang', 'dragondance'],
        baseAbility: 'intimidate',
        ability: 'intimidate',
        item: 'leftovers',
        pokeball: 'pokeball',
        teraType: 'Water',
      },
      {
        ident: 'p1: Ferrothorn' as Protocol.PokemonIdent,
        details: 'Ferrothorn' as Protocol.PokemonDetails,
        condition: '100/100' as Protocol.PokemonHPStatus,
        stats: { atk: 94, def: 131, spa: 54, spd: 116, spe: 20 },
        moves: ['leechseed', 'gyroball', 'stealthrock', 'protect'],
        baseAbility: 'ironbarbs',
        ability: 'ironbarbs',
        item: 'leftovers',
        pokeball: 'pokeball',
      },
    ],
  },
  active: [
    {
      moves: [
        { name: 'Waterfall' as Protocol.MoveName, id: 'waterfall' as ID, pp: 24, maxpp: 24, target: 'normal' },
        { name: 'Earthquake' as Protocol.MoveName, id: 'earthquake' as ID, pp: 16, maxpp: 16, target: 'allAdjacent' },
        { name: 'Ice Fang' as Protocol.MoveName, id: 'icefang' as ID, pp: 24, maxpp: 24, target: 'normal' },
        { name: 'Dragon Dance' as Protocol.MoveName, id: 'dragondance' as ID, pp: 32, maxpp: 32, target: 'self' },
      ],
      canTerastallize: 'Water',
    },
  ],
} as Protocol.Request;

describe('chooseMove', () => {
  it('builds a plain move choice with the rqid appended', () => {
    expect(chooseMove(moveRequest, 1)).toBe('move 1|4');
  });

  it('spells the Terastallize modifier with two Ls, matching the live server', () => {
    // Verified against sim/side.ts directly: the server's `/choose` parser
    // only recognizes `terastal` or `terastallize` (two Ls) as suffixes —
    // NOT `terastalize` (one L), despite that being what SIM-PROTOCOL.md
    // documents. This assertion pins @pkmn/view's ChoiceBuilder output,
    // which already gets this right, against ever silently regressing to
    // the documented-but-non-functional spelling.
    const command = chooseMove(moveRequest, 1, { terastallize: true });
    expect(command).toBe('move 1 terastallize|4');
    expect(command).not.toContain('terastalize|'); // the one-L, non-functional spelling
  });

  it('does not bounds-check the slot client-side — the server validates it', () => {
    // Verified by hand: ChoiceBuilder does a bare parseInt on a numeric slot
    // with no check against how many moves actually exist. An illegal slot
    // reaches the server, which replies with |error|[Invalid choice] and a
    // fresh |request| rather than the client silently doing nothing.
    expect(chooseMove(moveRequest, 9)).toBe('move 9|4');
  });
});

describe('chooseSwitch', () => {
  it('builds a switch choice with the rqid appended', () => {
    expect(chooseSwitch(moveRequest, 2)).toBe('switch 2|4');
  });
});

describe('chooseTeamOrder', () => {
  it('builds one addChoice call per lead-order slot, not a concatenated string', () => {
    // "team 21" parses as slot 21 (a bare parseInt on the whole remainder),
    // not "lead with slot 2, then slot 1" — each position needs its own
    // addChoice('team N') call. This is the behavior that made the naive
    // single-string version fail against the real ChoiceBuilder.
    const teamRequest: Protocol.Request = { ...moveRequest, requestType: 'team' } as Protocol.Request;
    expect(chooseTeamOrder(teamRequest, [2, 1])).toBe('team 2, 1|4');
  });
});
