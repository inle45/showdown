import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShowdownConnection } from '../connection';
import { MockWebSocket } from './mock-websocket';

function makeConnection(overrides: Partial<ConstructorParameters<typeof ShowdownConnection>[0]> = {}) {
  return new ShowdownConnection({
    url: 'wss://test.invalid/showdown/websocket',
    webSocketFactory: MockWebSocket.factory,
    backoff: { initialDelay: 1_000, maxDelay: 30_000, factor: 2, jitter: 0, maxAttempts: Infinity },
    ...overrides,
  });
}

describe('ShowdownConnection', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a socket and reports state', () => {
    const connection = makeConnection();
    const states: string[] = [];
    connection.on('state', s => states.push(s));

    connection.connect();
    expect(MockWebSocket.count).toBe(1);

    MockWebSocket.last.accept();
    expect(connection.state).toBe('open');
    expect(connection.isOpen).toBe(true);
    expect(states).toEqual(['connecting', 'open']);
  });

  it('forwards server frames', () => {
    const connection = makeConnection();
    const frames: string[] = [];
    connection.on('message', f => frames.push(f));

    connection.connect();
    MockWebSocket.last.accept();
    MockWebSocket.last.receive('|challstr|4|abc');

    expect(frames).toEqual(['|challstr|4|abc']);
  });

  it('reconnects after an unexpected drop, waiting out the backoff', () => {
    const connection = makeConnection();
    connection.connect();
    MockWebSocket.last.accept();

    const attempts: number[] = [];
    connection.on('reconnecting', e => attempts.push(e.delay));

    MockWebSocket.last.drop();
    expect(attempts).toEqual([1_000]);
    // Still waiting: no new socket until the delay elapses.
    expect(MockWebSocket.count).toBe(1);

    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.count).toBe(2);
  });

  it('backs off further on each consecutive failure, then resets after success', () => {
    const connection = makeConnection();
    const delays: number[] = [];
    connection.on('reconnecting', e => delays.push(e.delay));

    connection.connect();
    MockWebSocket.last.accept();

    // Three failures in a row.
    MockWebSocket.last.drop();
    vi.advanceTimersByTime(1_000);
    MockWebSocket.last.drop();
    vi.advanceTimersByTime(2_000);
    MockWebSocket.last.drop();
    vi.advanceTimersByTime(4_000);
    expect(delays).toEqual([1_000, 2_000, 4_000]);

    // A successful connection resets the counter, so the next blip retries fast.
    MockWebSocket.last.accept();
    MockWebSocket.last.drop();
    expect(delays).toEqual([1_000, 2_000, 4_000, 1_000]);
  });

  it('does not reconnect after an explicit disconnect', () => {
    const connection = makeConnection();
    connection.connect();
    MockWebSocket.last.accept();

    connection.disconnect();
    expect(connection.state).toBe('idle');

    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.count).toBe(1);
  });

  it('gives up after maxAttempts instead of retrying forever', () => {
    const connection = makeConnection({
      backoff: { initialDelay: 1_000, maxDelay: 30_000, factor: 2, jitter: 0, maxAttempts: 2 },
    });
    const gaveUp = vi.fn();
    connection.on('gaveUp', gaveUp);

    connection.connect();
    MockWebSocket.last.accept();

    MockWebSocket.last.drop();
    vi.advanceTimersByTime(1_000);
    MockWebSocket.last.drop();
    vi.advanceTimersByTime(2_000);
    MockWebSocket.last.drop();

    expect(gaveUp).toHaveBeenCalledWith({ attempts: 2 });
    expect(connection.state).toBe('idle');
  });

  describe('backgrounding', () => {
    it('suspend() closes the socket and stays closed', () => {
      const connection = makeConnection();
      connection.connect();
      MockWebSocket.last.accept();

      connection.suspend();
      expect(connection.state).toBe('suspended');

      vi.advanceTimersByTime(60_000);
      expect(MockWebSocket.count).toBe(1);
    });

    it('resume() reconnects immediately rather than waiting out accumulated backoff', () => {
      const connection = makeConnection();
      connection.connect();
      MockWebSocket.last.accept();

      // Burn several attempts so the nominal delay is large.
      MockWebSocket.last.drop();
      vi.advanceTimersByTime(1_000);
      MockWebSocket.last.drop();
      vi.advanceTimersByTime(2_000);

      connection.suspend();
      connection.resume();

      // The user just foregrounded the app: reconnect now, do not make them wait.
      expect(MockWebSocket.count).toBe(4);
      expect(connection.state).toBe('connecting');
    });

    it('resume() is a no-op when not suspended', () => {
      const connection = makeConnection();
      connection.connect();
      MockWebSocket.last.accept();

      connection.resume();
      expect(MockWebSocket.count).toBe(1);
    });
  });

  describe('idle watchdog', () => {
    it('reconnects when no frame arrives within idleTimeout', () => {
      const connection = makeConnection({ idleTimeout: 10_000 });
      connection.connect();
      MockWebSocket.last.accept();

      // A phone that changed networks leaves a socket that looks open forever.
      vi.advanceTimersByTime(10_000);
      expect(connection.state).toBe('reconnecting');

      vi.advanceTimersByTime(1_000);
      expect(MockWebSocket.count).toBe(2);
    });

    it('is held off by incoming traffic', () => {
      const connection = makeConnection({ idleTimeout: 10_000 });
      connection.connect();
      MockWebSocket.last.accept();

      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(9_000);
        MockWebSocket.last.receive('|usercount|1234');
      }

      expect(connection.state).toBe('open');
      expect(MockWebSocket.count).toBe(1);
    });
  });

  it('send() reports failure instead of silently dropping frames', () => {
    const connection = makeConnection();
    expect(connection.send('|/join lobby')).toBe(false);

    connection.connect();
    MockWebSocket.last.accept();
    expect(connection.send('|/join lobby')).toBe(true);
    expect(MockWebSocket.last.sent).toEqual(['|/join lobby']);
  });
});
