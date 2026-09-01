import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  LiveBattle,
  chooseMove as buildChooseMove,
  chooseSwitch as buildChooseSwitch,
  chooseTeamOrder as buildChooseTeamOrder,
  type MoveModifiers,
} from '@showdown-mobile/battle';
import type { ShowdownClient } from '@showdown-mobile/core';
import type { Protocol } from '@pkmn/protocol';
import type { SideID } from '@pkmn/types';

export interface BattleLogLine {
  id: number;
  text: string;
}

export interface BattleHandle {
  battle: LiveBattle['battle'];
  log: BattleLogLine[];
  /** The pending choice request, if the server is waiting on one from us. */
  request: Protocol.Request | undefined;
  /** Which side is the connected account, once both players are known. */
  perspective: SideID | undefined;
  chooseMove(slot: number, modifiers?: MoveModifiers): void;
  chooseSwitch(slot: number): void;
  chooseTeamOrder(order: number[]): void;
}

const LOG_LIMIT = 500;

/**
 * Tracks one live battle in `roomid`, or nothing if `roomid` is null.
 *
 * A battle room gets no explicit `/join` — the server starts routing
 * messages to it the moment the match exists — so this hook's only job is to
 * filter `client`'s message stream down to this one room and feed it to a
 * `LiveBattle`, which does the actual state tracking and text formatting
 * (`packages/battle`, verified against 30 real replays and the live server's
 * actual `/choose` parser — see that package for why it isn't hand-rolled).
 */
export function useBattle(client: ShowdownClient, roomid: string | null): BattleHandle | null {
  const liveBattle = useMemo(() => (roomid ? new LiveBattle() : null), [roomid]);
  const nextLogId = useRef(0);
  const [log, setLog] = useState<BattleLogLine[]>([]);
  const [perspective, setPerspective] = useState<SideID | undefined>(undefined);
  // `LiveBattle`/`Battle` mutate in place rather than producing new objects
  // per update, so React has no prop/state change to notice on its own —
  // this counter is what forces a re-render after each `feed()`.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const perspectiveResolved = useRef(false);

  useEffect(() => {
    if (!roomid || !liveBattle) return;
    setLog([]);
    setPerspective(undefined);
    perspectiveResolved.current = false;

    const unsubscribe = client.on('message', message => {
      if (message.roomid !== roomid) return;

      const text = liveBattle.feed(message.args, message.kwArgs);
      if (text) {
        const line = { id: nextLogId.current++, text: text.trimEnd() };
        setLog(entries => {
          const next = [...entries, line];
          return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
        });
      }

      // Resolve "which side is me" as soon as both players are named, so log
      // text reads "you" rather than a spectator's neutral third-person view.
      if (!perspectiveResolved.current) {
        const { p1, p2 } = liveBattle.battle;
        if (p1.name && p1.name === client.username) {
          liveBattle.setPerspective('p1');
          perspectiveResolved.current = true;
          setPerspective('p1');
        } else if (p2.name && p2.name === client.username) {
          liveBattle.setPerspective('p2');
          perspectiveResolved.current = true;
          setPerspective('p2');
        }
      }

      forceRender();
    });

    return unsubscribe;
  }, [client, roomid, liveBattle]);

  const send = useCallback(
    (command: string) => {
      if (!roomid) return;
      // `/choose` (or its bare `/move`, `/switch` shortcuts) is a client chat
      // command, not part of the choice string itself — ChoiceBuilder's
      // output is the bare "move 1|4" the command takes as an argument.
      client.say(roomid, `/choose ${command}`);
    },
    [client, roomid],
  );

  const chooseMove = useCallback(
    (slot: number, modifiers?: MoveModifiers) => {
      if (!liveBattle?.battle.request) return;
      send(buildChooseMove(liveBattle.battle.request, slot, modifiers));
    },
    [liveBattle, send],
  );

  const chooseSwitch = useCallback(
    (slot: number) => {
      if (!liveBattle?.battle.request) return;
      send(buildChooseSwitch(liveBattle.battle.request, slot));
    },
    [liveBattle, send],
  );

  const chooseTeamOrder = useCallback(
    (order: number[]) => {
      if (!liveBattle?.battle.request) return;
      send(buildChooseTeamOrder(liveBattle.battle.request, order));
    },
    [liveBattle, send],
  );

  if (!roomid || !liveBattle) return null;
  return {
    battle: liveBattle.battle,
    log,
    request: liveBattle.battle.request,
    perspective,
    chooseMove,
    chooseSwitch,
    chooseTeamOrder,
  };
}
