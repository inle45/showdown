import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShowdownClient } from '../client';
import type { FetchLike } from '../types';
import { MockWebSocket } from './mock-websocket';

/** What Showdown's login server returns for a successful password login. */
const LOGIN_OK = ']{"curuser":{"loggedin":true},"assertion":"ASSERTION123"}';
const EXPECTED_TRN = '|/trn tester,0,ASSERTION123';

interface MockFetch extends FetchLike {
  calls: { url: string; body?: string }[];
}

function mockFetch(body: string = LOGIN_OK, ok = true): MockFetch {
  const calls: { url: string; body?: string }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body });
    return { ok, status: ok ? 200 : 503, text: async () => body };
  };
  return Object.assign(fn, { calls });
}

function makeClient(fetchImpl: FetchLike, credentials?: { username: string; password?: string }) {
  return new ShowdownClient({
    url: 'wss://test.invalid/showdown/websocket',
    webSocketFactory: MockWebSocket.factory,
    fetchImpl,
    ...(credentials ? { credentials } : {}),
    // Keep retries instant so tests do not sleep.
    backoff: { initialDelay: 1, maxDelay: 2, factor: 1, jitter: 0, maxAttempts: Infinity },
  });
}

/** Drive a full server-side handshake on the newest socket. */
async function completeHandshake(expectLogin = true): Promise<void> {
  MockWebSocket.last.accept();
  MockWebSocket.last.receive('|challstr|4|0123456789abcdef');
  if (expectLogin) {
    await vi.waitFor(() => expect(MockWebSocket.last.sent).toContain(EXPECTED_TRN));
  }
  MockWebSocket.last.receive('|updateuser|tester|1|170|{}');
}

describe('ShowdownClient', () => {
  beforeEach(() => {
    MockWebSocket.reset();
  });

  it('exchanges challstr for a login command and sends it verbatim', async () => {
    const fetchImpl = mockFetch();
    const client = makeClient(fetchImpl, { username: 'tester', password: 'hunter2' });

    client.connect();
    MockWebSocket.last.accept();
    MockWebSocket.last.receive('|challstr|4|0123456789abcdef');

    await vi.waitFor(() => expect(fetchImpl.calls).toHaveLength(1));
    expect(fetchImpl.calls[0]!.body).toContain('challstr=');

    // @pkmn/login builds the whole command; sending only the assertion, or
    // re-wrapping it, would produce a malformed frame.
    await vi.waitFor(() => expect(MockWebSocket.last.sent).toContain(EXPECTED_TRN));
  });

  it('becomes ready once the server confirms the name', async () => {
    const client = makeClient(mockFetch(), { username: 'tester', password: 'hunter2' });
    const ready = vi.fn();
    client.on('ready', ready);

    client.connect();
    await completeHandshake();

    expect(client.session).toBe('ready');
    expect(client.username).toBe('tester');
    expect(ready).toHaveBeenCalledWith({ username: 'tester', named: true });
  });

  it('ignores the guest updateuser that precedes a successful /trn', async () => {
    const client = makeClient(mockFetch(), { username: 'tester', password: 'hunter2' });
    client.connect();
    MockWebSocket.last.accept();

    // Showdown assigns a guest name before login completes.
    MockWebSocket.last.receive('|updateuser| Guest 12345|0|1|{}');
    expect(client.session).not.toBe('ready');

    MockWebSocket.last.receive('|challstr|4|0123456789abcdef');
    await vi.waitFor(() => expect(MockWebSocket.last.sent).toContain(EXPECTED_TRN));
    MockWebSocket.last.receive('|updateuser|tester|1|170|{}');
    expect(client.session).toBe('ready');
  });

  it('connects as a guest without contacting the login server', async () => {
    const fetchImpl = mockFetch();
    const client = makeClient(fetchImpl);

    client.connect();
    MockWebSocket.last.accept();
    MockWebSocket.last.receive('|challstr|4|0123456789abcdef');

    await vi.waitFor(() => expect(client.session).toBe('ready'));
    expect(fetchImpl.calls).toHaveLength(0);
  });

  describe('reconnect', () => {
    it('re-authenticates, because challstr is bound to the socket that issued it', async () => {
      const fetchImpl = mockFetch();
      const client = makeClient(fetchImpl, { username: 'tester', password: 'hunter2' });

      client.connect();
      await completeHandshake();
      expect(fetchImpl.calls).toHaveLength(1);

      MockWebSocket.last.drop();
      expect(client.session).toBe('offline');

      await vi.waitFor(() => expect(MockWebSocket.count).toBe(2));
      await completeHandshake();

      // A second full login round-trip: Showdown has no session resume.
      expect(fetchImpl.calls).toHaveLength(2);
      expect(client.session).toBe('ready');
    });

    it('re-joins rooms, because the server remembers nothing about a dropped client', async () => {
      const client = makeClient(mockFetch(), { username: 'tester', password: 'hunter2' });
      const resynced = vi.fn();
      client.on('resynced', resynced);

      client.connect();
      await completeHandshake();

      client.join('lobby');
      client.join('ou');
      expect(MockWebSocket.last.sent).toContain('|/join lobby');

      const firstSocket = MockWebSocket.last;
      firstSocket.drop();

      await vi.waitFor(() => expect(MockWebSocket.count).toBe(2));
      await completeHandshake();

      const secondSocket = MockWebSocket.last;
      expect(secondSocket).not.toBe(firstSocket);
      expect(secondSocket.sent).toContain('|/join lobby');
      expect(secondSocket.sent).toContain('|/join ou');
      expect(resynced).toHaveBeenCalledWith({ rooms: ['lobby', 'ou'] });
    });

    it('does not re-join a room left while offline', async () => {
      const client = makeClient(mockFetch(), { username: 'tester', password: 'hunter2' });

      client.connect();
      await completeHandshake();
      client.join('lobby');
      client.join('ou');

      MockWebSocket.last.drop();
      client.leave('ou');

      await vi.waitFor(() => expect(MockWebSocket.count).toBe(2));
      await completeHandshake();

      expect(MockWebSocket.last.sent).toContain('|/join lobby');
      expect(MockWebSocket.last.sent).not.toContain('|/join ou');
      expect(client.rooms).toEqual(['lobby']);
    });

    it('discards an assertion that arrives after its socket died', async () => {
      let release!: (body: string) => void;
      const pending = new Promise<string>(resolve => {
        release = resolve;
      });
      const fetchImpl: FetchLike = async () => ({
        ok: true,
        status: 200,
        text: () => pending,
      });

      const client = makeClient(fetchImpl, { username: 'tester', password: 'hunter2' });
      client.connect();
      const firstSocket = MockWebSocket.last;
      firstSocket.accept();
      firstSocket.receive('|challstr|4|0123456789abcdef');

      // The socket dies while the login request is still in flight.
      firstSocket.drop();
      release(LOGIN_OK);
      await vi.waitFor(() => expect(MockWebSocket.count).toBe(2));

      // The stale assertion must not be sent on the new socket: it was built
      // from a challstr the server has already forgotten.
      expect(MockWebSocket.last.sent).not.toContain(EXPECTED_TRN);
    });
  });

  describe('authentication failures', () => {
    it('surfaces the login server error message', async () => {
      const fetchImpl = mockFetch(']{"actionerror":"Wrong password."}');
      const client = makeClient(fetchImpl, { username: 'tester', password: 'wrong' });
      const authError = vi.fn();
      client.on('authError', authError);

      client.connect();
      MockWebSocket.last.accept();
      MockWebSocket.last.receive('|challstr|4|0123456789abcdef');

      await vi.waitFor(() => expect(authError).toHaveBeenCalled());
      expect(authError.mock.calls[0]![0].message).toBe('Wrong password.');
      expect(client.session).not.toBe('ready');
    });

    it('surfaces an unreachable login server', async () => {
      const client = makeClient(mockFetch('', false), {
        username: 'tester',
        password: 'hunter2',
      });
      const authError = vi.fn();
      client.on('authError', authError);

      client.connect();
      MockWebSocket.last.accept();
      MockWebSocket.last.receive('|challstr|4|0123456789abcdef');

      await vi.waitFor(() => expect(authError).toHaveBeenCalled());
      expect(authError.mock.calls[0]![0].message).toContain('503');
    });
  });

  it('forwards private messages', async () => {
    const client = makeClient(mockFetch(), { username: 'tester', password: 'hunter2' });
    const pm = vi.fn();
    client.on('pm', pm);

    client.connect();
    await completeHandshake();
    MockWebSocket.last.receive('|pm| someone| tester|hey');

    expect(pm).toHaveBeenCalledWith({ from: ' someone', to: ' tester', message: 'hey' });
  });

  it('retains room intent across a suspend/resume cycle', async () => {
    const client = makeClient(mockFetch(), { username: 'tester', password: 'hunter2' });

    client.connect();
    await completeHandshake();
    client.join('lobby');

    client.suspend();
    expect(client.rooms).toEqual(['lobby']);

    client.resume();
    await completeHandshake();
    expect(MockWebSocket.last.sent).toContain('|/join lobby');
  });
});
