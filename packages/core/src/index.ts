export { ShowdownClient } from './client.js';
export type {
  ClientEvents,
  ParsedMessage,
  SessionState,
  ShowdownClientOptions,
} from './client.js';

export { ShowdownConnection } from './connection.js';
export type { ConnectionEvents, ConnectionOptions } from './connection.js';

export { resolveLoginCommand } from './auth.js';
export type { AuthOptions } from './auth.js';

export { DEFAULT_BACKOFF, backoffDelay } from './backoff.js';
export type { BackoffOptions } from './backoff.js';

export { Emitter } from './emitter.js';
export type { Listener } from './emitter.js';

export {
  DEFAULT_LOGIN_URL,
  DEFAULT_SERVER_URL,
  ShowdownAuthError,
} from './types.js';
export type {
  ConnectionState,
  Credentials,
  FetchLike,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';
