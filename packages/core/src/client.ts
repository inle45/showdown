import { Protocol } from '@pkmn/protocol';

import { AuthOptions, resolveLoginCommand } from './auth';
import {
  ConnectionOptions,
  ConnectionEvents,
  ShowdownConnection,
} from './connection';
import { Emitter } from './emitter';
import {
  ConnectionState,
  Credentials,
  FetchLike,
  ShowdownAuthError,
} from './types';

export type SessionState =
  /** No usable socket. */
  | 'offline'
  /** Socket is open; exchanging challstr for an assertion. */
  | 'authenticating'
  /** Logged in and rooms have been (re)joined. */
  | 'ready';

// See the note on `ConnectionEvents`: an alias, not an interface, so that it
// satisfies `Emitter`'s index-signature constraint.
export type ClientEvents = {
  /** Logged in and all desired rooms re-joined. Fires again after each reconnect. */
  ready: { username: string; named: boolean };
  /** Authentication failed. Not retried automatically — credentials may be wrong. */
  authError: ShowdownAuthError;
  /** Every parsed protocol message, including battle lines. */
  message: ParsedMessage;
  /** Convenience view of `|pm|`. */
  pm: { from: string; to: string; message: string };
  session: SessionState;
  connection: ConnectionState;
  /** Rooms were re-joined after a reconnect. */
  resynced: { rooms: string[] };
  error: unknown;
};

export interface ParsedMessage {
  roomid: string;
  args: readonly string[];
  kwArgs: Record<string, unknown>;
}

export interface ShowdownClientOptions extends ConnectionOptions, AuthOptions {
  /** Omit to browse as an anonymous guest. */
  credentials?: Credentials;
  /** Defaults to the global `fetch` (present on React Native and Node >= 18). */
  fetchImpl?: FetchLike;
}

/**
 * Ties the socket, authentication and room membership together.
 *
 * The reason this class exists — and the reason reconnect had to be designed in
 * from the start rather than bolted on later — is that a Showdown session is
 * bound to its socket:
 *
 *   - `challstr` is issued per connection and is single-use, so **every**
 *     reconnect requires a fresh login round-trip. There is no session resume.
 *   - The server does not remember which rooms a dropped client was in, and
 *     replays nothing that was missed, so rooms must be re-joined explicitly.
 *
 * Callers therefore declare *intent* (`join`/`leave`) and this class keeps the
 * server in sync with that intent across arbitrarily many reconnects.
 */
export class ShowdownClient extends Emitter<ClientEvents> {
  readonly connection: ShowdownConnection;

  private readonly credentials?: Credentials;
  private readonly fetchImpl: FetchLike;
  private readonly authOptions: AuthOptions;

  /** Rooms the caller wants to be in, independent of current connectivity. */
  private readonly desiredRooms = new Set<string>();
  private currentSession: SessionState = 'offline';
  private currentUsername: string | null = null;
  /** Guards against a late assertion from a previous socket being applied. */
  private authEpoch = 0;

  constructor(options: ShowdownClientOptions = {}) {
    super();
    this.credentials = options.credentials;
    this.authOptions = { loginUrl: options.loginUrl, serverId: options.serverId };

    const fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error('No fetch implementation found. Pass `fetchImpl` explicitly.');
    }
    this.fetchImpl = fetchImpl;

    this.connection = new ShowdownConnection(options);
    this.connection.on('message', raw => this.handleRaw(raw));
    this.connection.on('open', () => this.setSession('authenticating'));
    this.connection.on('close', () => {
      // Invalidate any authentication still in flight for the dead socket.
      this.authEpoch++;
      this.currentUsername = null;
      this.setSession('offline');
    });
    this.connection.on('state', state => this.emit('connection', state));
    this.connection.on('error', error => this.emit('error', error));
  }

  get session(): SessionState {
    return this.currentSession;
  }

  get username(): string | null {
    return this.currentUsername;
  }

  /** Rooms the client will keep joined across reconnects. */
  get rooms(): string[] {
    return [...this.desiredRooms];
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  /** Background the connection. Room intent is retained for `resume()`. */
  suspend(): void {
    this.connection.suspend();
  }

  resume(): void {
    this.connection.resume();
  }

  /** Join a room now (if connected) and after every future reconnect. */
  join(roomid: string): void {
    this.desiredRooms.add(roomid);
    if (this.currentSession === 'ready') this.connection.send(`|/join ${roomid}`);
  }

  leave(roomid: string): void {
    this.desiredRooms.delete(roomid);
    if (this.currentSession === 'ready') this.connection.send(`|/leave ${roomid}`);
  }

  /** Send a chat message to a room. Returns false if not currently connected. */
  say(roomid: string, message: string): boolean {
    return this.connection.send(`${roomid}|${message}`);
  }

  /** Send a raw protocol frame. */
  send(data: string): boolean {
    return this.connection.send(data);
  }

  private handleRaw(raw: string): void {
    let parsed: ReturnType<typeof Protocol.parse>;
    try {
      parsed = Protocol.parse(raw);
    } catch (error) {
      this.emit('error', error);
      return;
    }

    for (const { roomid, args, kwArgs } of parsed) {
      this.emit('message', {
        roomid: roomid as string,
        args: args as readonly string[],
        kwArgs: kwArgs as Record<string, unknown>,
      });

      switch (args[0]) {
        case 'challstr':
          void this.authenticate(args[1]);
          break;
        case 'updateuser':
          this.handleUpdateUser(args[1], args[2] === '1');
          break;
        case 'pm':
          this.emit('pm', { from: args[1], to: args[2], message: args[3] });
          break;
        default:
          break;
      }
    }
  }

  private async authenticate(challstr: string): Promise<void> {
    const epoch = ++this.authEpoch;

    // No credentials: stay a guest. The server has already assigned a name.
    if (!this.credentials) {
      this.markReady(this.currentUsername ?? 'guest', false);
      return;
    }

    try {
      const command = await resolveLoginCommand(
        this.credentials,
        challstr,
        this.fetchImpl,
        this.authOptions,
      );
      // The socket may have died while the login request was in flight; sending
      // a command built from a stale challstr would fail confusingly.
      if (epoch !== this.authEpoch) return;
      this.connection.send(command);
    } catch (error) {
      if (epoch !== this.authEpoch) return;
      const authError =
        error instanceof ShowdownAuthError
          ? error
          : new ShowdownAuthError('Authentication failed', error);
      this.emit('authError', authError);
    }
  }

  private handleUpdateUser(username: string, named: boolean): void {
    this.currentUsername = username;

    // Showdown sends `updateuser` for the auto-assigned guest name too. When we
    // have credentials, only the named update means our `/trn` was accepted.
    if (this.credentials && !named) return;
    this.markReady(username, named);
  }

  private markReady(username: string, named: boolean): void {
    const wasReady = this.currentSession === 'ready';
    this.currentUsername = username;
    this.setSession('ready');
    if (!wasReady) {
      this.resyncRooms();
      this.emit('ready', { username, named });
    }
  }

  /**
   * Re-join every desired room.
   *
   * Safe to call when already in a room: Showdown treats a redundant `/join` as
   * a no-op rather than an error.
   */
  private resyncRooms(): void {
    const rooms = [...this.desiredRooms];
    for (const roomid of rooms) this.connection.send(`|/join ${roomid}`);
    if (rooms.length) this.emit('resynced', { rooms });
  }

  private setSession(state: SessionState): void {
    if (this.currentSession === state) return;
    this.currentSession = state;
    this.emit('session', state);
  }
}

export type { ConnectionEvents };
