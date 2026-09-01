import { Actions } from '@pkmn/login';

import { Credentials, FetchLike, ShowdownAuthError } from './types';

export interface AuthOptions {
  /** Override the login server (self-hosted servers use their own). */
  loginUrl?: string;
  /** Server id expected by the login server. */
  serverId?: string;
}

/**
 * Exchange a `challstr` for the WebSocket command that completes login.
 *
 * Returns a ready-to-send frame, e.g. `|/trn user,0,<assertion>` — `@pkmn/login`
 * assembles the command itself, so callers must send the result verbatim rather
 * than re-wrapping the assertion.
 *
 * `@pkmn/login` is deliberately network-agnostic: it describes the HTTP request
 * to make instead of making it, which is what lets this run unchanged on React
 * Native's `fetch`. We supply the network layer.
 *
 * `Actions.login` transparently falls back to a `getassertion` "rename" request
 * when no password is given, so both registered and guest names go through here.
 *
 * A `challstr` is issued per connection, so this must be redone on every
 * reconnect. See `ShowdownClient`.
 */
export async function resolveLoginCommand(
  credentials: Credentials,
  challstr: string,
  fetchImpl: FetchLike,
  options: AuthOptions = {},
): Promise<string> {
  const action = Actions.login({
    username: credentials.username,
    challstr,
    ...(credentials.password ? { password: credentials.password } : {}),
    ...(options.loginUrl ? { url: options.loginUrl } : {}),
    ...(options.serverId ? { serverid: options.serverId } : {}),
  });

  let body: string;
  try {
    const response = await fetchImpl(action.url, {
      method: action.method,
      headers: normaliseHeaders(action.headers),
      ...(action.method === 'POST' ? { body: action.data } : {}),
    });
    if (!response.ok) {
      throw new ShowdownAuthError(`Login server returned HTTP ${response.status}`);
    }
    body = await response.text();
  } catch (error) {
    if (error instanceof ShowdownAuthError) throw error;
    throw new ShowdownAuthError('Could not reach the login server', error);
  }

  let command: string | undefined;
  try {
    command = action.onResponse(body);
  } catch (error) {
    // `onResponse` throws carrying the login server's own message, which is the
    // actionable one (wrong password, name taken, rate limited).
    throw new ShowdownAuthError(errorMessage(error), error);
  }

  if (!command) {
    throw new ShowdownAuthError(
      'Login server did not return an assertion. Usually this means the password ' +
        'was wrong, or the name is registered and no password was supplied.',
    );
  }
  return command;
}

function normaliseHeaders(headers: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  return out;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Login failed';
}
