/** The official sim server. */
export const DEFAULT_SERVER_URL = 'wss://sim3.psim.us/showdown/websocket';

/** Showdown's login server. Overridable for self-hosted servers. */
export const DEFAULT_LOGIN_URL = 'https://play.pokemonshowdown.com/api/login';

/**
 * The subset of the WHATWG WebSocket API this package relies on.
 *
 * We use the `on*` handler properties rather than `addEventListener` because
 * that is the intersection supported by React Native, browsers and `ws`.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** Minimal `fetch` shape, so RN's global fetch satisfies it without DOM lib types. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ConnectionState =
  /** Never connected, or explicitly disconnected. */
  | 'idle'
  /** Socket is being opened. */
  | 'connecting'
  /** Socket is open. Does not imply the user is authenticated. */
  | 'open'
  /** Waiting out a backoff delay before the next attempt. */
  | 'reconnecting'
  /** Deliberately held closed (app backgrounded); will not auto-reconnect. */
  | 'suspended';

/** Credentials for `/trn`. Omit `password` to connect as an unregistered guest. */
export interface Credentials {
  username: string;
  password?: string;
}

export class ShowdownAuthError extends Error {
  override readonly name = 'ShowdownAuthError';
  constructor(message: string, cause?: unknown) {
    // Uses the standard ES2022 `cause` rather than shadowing it with a field.
    super(message, { cause });
  }
}
