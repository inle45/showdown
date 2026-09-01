import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  ShowdownClient,
  type ConnectionState,
  type Credentials,
  type SessionState,
} from '@showdown-mobile/core';

export interface LogEntry {
  id: number;
  roomid: string;
  text: string;
}

export interface ShowdownClientHandle {
  /** The underlying client, for hooks (like `useBattle`) that need their own subscriptions. */
  client: ShowdownClient;
  connectionState: ConnectionState;
  session: SessionState;
  username: string | null;
  authError: string | null;
  log: LogEntry[];
  /**
   * Roomid of the most recent battle still in progress, or null.
   *
   * A battle room needs no `/join`: the server creates it and starts routing
   * messages to it the moment a match is found or a challenge is accepted, so
   * this is discovered by watching for its `|init|battle` rather than by any
   * action the client takes. Tracks only the latest one — on mobile a player
   * is realistically in at most one battle at a time; multi-battle support
   * would need a set instead of a single id.
   */
  battleRoomId: string | null;
  join(roomid: string): void;
  say(roomid: string, message: string): void;
}

const LOG_LIMIT = 200;

/**
 * Owns one `ShowdownClient` for the app's lifetime and keeps it in step with
 * `AppState`.
 *
 * This is the mobile-specific behaviour a browser tab cannot give you: when the
 * app is backgrounded, iOS/Android will kill the socket within seconds anyway,
 * so `suspend()` closes it deliberately instead of burning battery on a socket
 * the OS is about to sever. `resume()` reconnects immediately on foreground —
 * `ShowdownConnection.resume()` resets backoff for exactly this reason, so
 * returning to the app is never met with a multi-second retry delay.
 */
export function useShowdownClient(credentials?: Credentials): ShowdownClientHandle {
  // Credentials are only read on first render: swapping accounts is not a
  // supported live transition here, it means reconnecting as someone else,
  // which is out of scope for this screen.
  const client = useMemo(() => new ShowdownClient({ credentials }), []);
  const nextLogId = useRef(0);

  const [connectionState, setConnectionState] = useState<ConnectionState>(client.connection.state);
  const [session, setSession] = useState<SessionState>(client.session);
  const [username, setUsername] = useState<string | null>(client.username);
  const [authError, setAuthError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [battleRoomId, setBattleRoomId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribers = [
      client.on('connection', setConnectionState),
      client.on('session', setSession),
      client.on('ready', ({ username: name }) => setUsername(name)),
      client.on('authError', error => setAuthError(error.message)),
      client.on('pm', ({ from, message }) =>
        appendLog(setLog, nextLogId, 'pm', `${from} (PM): ${message}`),
      ),
      client.on('message', ({ roomid, args }) => {
        // Chat lines. @pkmn/protocol normalises the wire shorthand (`|c|`) to
        // `"chat"`; `"c:"` is the distinct timestamped form used for room
        // history on join and has no long form.
        if (args[0] === 'chat') {
          appendLog(setLog, nextLogId, roomid, `${args[1]}: ${args[2]}`);
        } else if (args[0] === 'c:') {
          appendLog(setLog, nextLogId, roomid, `${args[2]}: ${args[3]}`);
        } else if (args[0] === 'init' && args[1] === 'battle') {
          setBattleRoomId(roomid);
        } else if (args[0] === 'deinit') {
          setBattleRoomId(current => (current === roomid ? null : current));
        }
      }),
    ];

    client.connect();

    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        client.resume();
      } else if (next === 'background') {
        // Deliberately not 'inactive': that's the brief transition state (e.g.
        // an iOS system dialog), not an actual background, and suspending on it
        // would drop the connection during normal interaction.
        client.suspend();
      }
    });

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      appStateSub.remove();
      client.disconnect();
    };
  }, [client]);

  // Stable identities: consumers pass these to `useEffect` deps (e.g. to
  // (re-)join a room whenever `session` becomes 'ready'), and an inline arrow
  // here would change identity on every render — including on every incoming
  // chat message — re-firing that effect and re-sending the command each time.
  const join = useCallback((roomid: string) => client.join(roomid), [client]);
  const say = useCallback((roomid: string, message: string) => client.say(roomid, message), [
    client,
  ]);

  return { client, connectionState, session, username, authError, log, battleRoomId, join, say };
}

function appendLog(
  setLog: React.Dispatch<React.SetStateAction<LogEntry[]>>,
  nextId: React.MutableRefObject<number>,
  roomid: string,
  text: string,
): void {
  setLog(entries => {
    const next = [...entries, { id: nextId.current++, roomid, text }];
    return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
  });
}
