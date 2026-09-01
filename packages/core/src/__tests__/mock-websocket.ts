import type { WebSocketLike } from '../types.js';

/**
 * A WebSocket the test drives by hand.
 *
 * Every reconnect test in this suite exists because the real failure mode is
 * invisible without one: a socket that silently drops mid-session is exactly
 * what a phone does when it moves between WiFi and cellular.
 */
export class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static get last(): MockWebSocket {
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!socket) throw new Error('No MockWebSocket has been created yet');
    return socket;
  }

  static get count(): number {
    return MockWebSocket.instances.length;
  }

  static factory = (url: string): MockWebSocket => new MockWebSocket(url);

  readyState = 0;
  readonly sent: string[] = [];

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  // --- test drivers ---

  /** Complete the handshake. */
  accept(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Deliver a frame from the server. */
  receive(data: string): void {
    this.onmessage?.({ data });
  }

  /** Drop the socket the way a network blip does: no warning, code 1006. */
  drop(code = 1006, reason = 'abnormal closure'): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** Frames sent by the client, for assertions. */
  get lastSent(): string | undefined {
    return this.sent[this.sent.length - 1];
  }
}
