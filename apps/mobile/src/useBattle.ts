import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  LiveBattle,
  chooseMove as buildChooseMove,
  chooseSwitch as buildChooseSwitch,
  chooseTeamOrder as buildChooseTeamOrder,
  isSameUser,
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
 * Tracks whatever live battle is currently active on `client`, or null if
 * there isn't one.
 *
 * This hook owns battle-room *detection* itself, in the same subscription
 * that feeds the battle — not as two separate listeners coordinated through
 * React state. That split was tried first and broke: Showdown frequently
 * sends `|init|battle` together with the room's entire setup burst
 * (`|player|`, `|gen|`, `|tier|`, ... `|request|`) in one synchronous pass
 * over one WebSocket frame (`ShowdownClient.handleRaw` emits `message`
 * synchronously per parsed line, in a plain for-loop). A listener that only
 * starts once a *different* hook's React state has propagated the roomid
 * down as a prop is too late — by the time that re-render happens, the
 * burst has already fired past it with no one subscribed yet, and the
 * battle screen sits on "waiting to start" forever. Using a ref for the
 * active roomid, checked synchronously inside one persistent listener,
 * closes that gap: nothing between "the room was created" and "start
 * feeding it" can be missed, no matter how the server batches the frame.
 */
export function useBattle(client: ShowdownClient): BattleHandle | null {
  const roomIdRef = useRef<string | null>(null);
  const liveBattleRef = useRef<LiveBattle | null>(null);
  const nextLogId = useRef(0);
  const perspectiveResolved = useRef(false);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [log, setLog] = useState<BattleLogLine[]>([]);
  const [perspective, setPerspective] = useState<SideID | undefined>(undefined);
  // `LiveBattle`/`Battle` mutate in place rather than producing new objects
  // per update, so React has no prop/state change to notice on its own —
  // this counter is what forces a re-render after each `feed()`.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const unsubscribe = client.on('message', message => {
      if (roomIdRef.current === null) {
        if (message.args[0] === 'init' && message.args[1] === 'battle') {
          roomIdRef.current = message.roomid;
          liveBattleRef.current = new LiveBattle();
          nextLogId.current = 0;
          perspectiveResolved.current = false;
          setRoomId(message.roomid);
          setLog([]);
          setPerspective(undefined);
        }
        // The |init|battle line itself carries no battle state to feed.
        return;
      }

      if (message.roomid !== roomIdRef.current) return;

      if (message.args[0] === 'deinit') {
        roomIdRef.current = null;
        liveBattleRef.current = null;
        setRoomId(null);
        return;
      }

      const liveBattle = liveBattleRef.current!;
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
        const myUsername = client.username;
        // Raw name equality is wrong here: `|updateuser|` prefixes an
        // unranked username with a leading space (the empty rank-symbol
        // slot) that `|player|` doesn't carry, so `p.name === myUsername`
        // silently never matches for a guest — confirmed live, see
        // packages/battle's isSameUser for the exact bytes.
        if (myUsername && p1.name && isSameUser(p1.name, myUsername)) {
          liveBattle.setPerspective('p1');
          perspectiveResolved.current = true;
          setPerspective('p1');
        } else if (myUsername && p2.name && isSameUser(p2.name, myUsername)) {
          liveBattle.setPerspective('p2');
          perspectiveResolved.current = true;
          setPerspective('p2');
        }
      }

      forceRender();
    });

    return unsubscribe;
  }, [client]);

  const send = useCallback(
    (command: string) => {
      const activeRoomId = roomIdRef.current;
      if (!activeRoomId) return;
      // `/choose` (or its bare `/move`, `/switch` shortcuts) is a client chat
      // command, not part of the choice string itself — ChoiceBuilder's
      // output is the bare "move 1|4" the command takes as an argument.
      client.say(activeRoomId, `/choose ${command}`);
    },
    [client],
  );

  const chooseMove = useCallback(
    (slot: number, modifiers?: MoveModifiers) => {
      const request = liveBattleRef.current?.battle.request;
      if (!request) return;
      send(buildChooseMove(request, slot, modifiers));
    },
    [send],
  );

  const chooseSwitch = useCallback(
    (slot: number) => {
      const request = liveBattleRef.current?.battle.request;
      if (!request) return;
      send(buildChooseSwitch(request, slot));
    },
    [send],
  );

  const chooseTeamOrder = useCallback(
    (order: number[]) => {
      const request = liveBattleRef.current?.battle.request;
      if (!request) return;
      send(buildChooseTeamOrder(request, order));
    },
    [send],
  );

  if (!roomId || !liveBattleRef.current) return null;
  return {
    battle: liveBattleRef.current.battle,
    log,
    request: liveBattleRef.current.battle.request,
    perspective,
    chooseMove,
    chooseSwitch,
    chooseTeamOrder,
  };
}
