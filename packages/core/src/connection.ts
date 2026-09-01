import { BackoffOptions, DEFAULT_BACKOFF, backoffDelay } from './backoff';
import { Emitter } from './emitter';
import {
  ConnectionState,
  DEFAULT_SERVER_URL,
  WebSocketFactory,
  WebSocketLike,
} from './types';

// A type alias rather than an interface: only aliases get the implicit index
// signature that `Emitter`'s `Record<string, unknown>` constraint requires.
export type ConnectionEvents = {
  /** Socket opened. Fires again after every successful reconnect. */
  open: void;
  /** A raw message frame from the server, exactly as received. */
  message: string;
  /** Socket closed. `willReconnect` distinguishes a blip from a teardown. */
  close: { code?: number; reason?: string; willReconnect: boolean };
  /** Waiting `delay` ms before retry number `attempt` (0-indexed). */
  reconnecting: { attempt: number; delay: number };
  /** Retries exhausted; the connection is now idle and will not retry itself. */
  gaveUp: { attempts: number };
  state: ConnectionState;
  error: unknown;
};

export interface ConnectionOptions {
  url?: string;
  webSocketFactory?: WebSocketFactory;
  backoff?: Partial<BackoffOptions>;
  /**
   * Force a reconnect if no frame arrives for this many ms. 0 disables it.
   *
   * Mobile networks drop sockets without sending a FIN, so a socket can look
   * `open` forever while being dead. A watchdog is the only reliable detection.
   *
   * Left disabled by default: the correct value depends on how often the server
   * actually emits unsolicited traffic, which has not been measured against the
   * live server yet. Enabling it with too tight a value causes reconnect loops.
   */
  idleTimeout?: number;
}

const OPEN = 1;

/**
 * Owns the WebSocket and nothing else: lifecycle, backoff and liveness.
 *
 * Deliberately knows nothing about Showdown's protocol or authentication, so
 * that reconnect behaviour can be tested without a server or a login.
 */
export class ShowdownConnection extends Emitter<ConnectionEvents> {
  readonly url: string;

  private readonly webSocketFactory: WebSocketFactory;
  private readonly backoff: BackoffOptions;
  private readonly idleTimeout: number;

  private socket: WebSocketLike | null = null;
  private currentState: ConnectionState = 'idle';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set while tearing down deliberately, so `onclose` does not reconnect. */
  private intentionalClose = false;

  constructor(options: ConnectionOptions = {}) {
    super();
    this.url = options.url ?? DEFAULT_SERVER_URL;
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.idleTimeout = options.idleTimeout ?? 0;

    const factory = options.webSocketFactory ?? defaultWebSocketFactory();
    if (!factory) {
      throw new Error(
        'No WebSocket implementation found. Pass `webSocketFactory` explicitly ' +
          '(React Native and browsers provide a global WebSocket; Node needs `ws`).',
      );
    }
    this.webSocketFactory = factory;
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === OPEN;
  }

  /** Open the socket. No-op if already connecting or open. */
  connect(): void {
    if (this.currentState === 'connecting' || this.currentState === 'open') return;
    this.clearReconnectTimer();
    this.openSocket();
  }

  /**
   * Send a raw frame.
   *
   * Returns `false` if the socket is not open. Frames are intentionally *not*
   * queued: a queue would replay stale chat into a room after a long outage,
   * and would silently replay authentication commands that are only valid for
   * the connection they were built for. Callers decide what to retry.
   */
  send(data: string): boolean {
    if (!this.isOpen) return false;
    try {
      this.socket!.send(data);
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /** Close and stop retrying. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.clearIdleTimer();
    this.teardownSocket();
    this.setState('idle');
  }

  /**
   * Hold the connection closed until `resume()`.
   *
   * Call this when the app is backgrounded: mobile OSes suspend timers and kill
   * sockets anyway, and a socket held open in the background burns battery for
   * traffic nobody is reading.
   */
  suspend(): void {
    if (this.currentState === 'suspended') return;
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.clearIdleTimer();
    this.teardownSocket();
    this.setState('suspended');
  }

  /**
   * Reconnect immediately after `suspend()`.
   *
   * The backoff counter is reset deliberately: the user just foregrounded the
   * app, so making them wait out a delay accumulated while it was backgrounded
   * would be the worst possible moment to be slow.
   */
  resume(): void {
    if (this.currentState !== 'suspended') return;
    this.attempt = 0;
    this.openSocket();
  }

  private openSocket(): void {
    this.intentionalClose = false;
    this.setState('connecting');

    let socket: WebSocketLike;
    try {
      socket = this.webSocketFactory(this.url);
    } catch (error) {
      this.emit('error', error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setState('open');
      this.resetIdleTimer();
      this.emit('open', undefined);
    };

    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.resetIdleTimer();
      if (typeof event.data === 'string') this.emit('message', event.data);
    };

    socket.onerror = error => {
      if (this.socket !== socket) return;
      this.emit('error', error);
      // Do not reconnect here: `onerror` is always followed by `onclose`, and
      // reconnecting from both would open two sockets.
    };

    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearIdleTimer();
      const willReconnect = !this.intentionalClose && this.attempt < this.backoff.maxAttempts;
      this.emit('close', { ...event, willReconnect });
      if (this.intentionalClose) return;
      if (willReconnect) {
        this.scheduleReconnect();
      } else {
        this.setState('idle');
        this.emit('gaveUp', { attempts: this.attempt });
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.attempt >= this.backoff.maxAttempts) {
      this.setState('idle');
      this.emit('gaveUp', { attempts: this.attempt });
      return;
    }
    const delay = backoffDelay(this.attempt, this.backoff);
    this.emit('reconnecting', { attempt: this.attempt, delay });
    this.attempt++;
    this.setState('reconnecting');
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleTimeout <= 0) return;
    this.idleTimer = setTimeout(() => {
      // Force the normal close path, which schedules a reconnect.
      this.teardownSocketExpectingReconnect();
    }, this.idleTimeout);
  }

  private teardownSocketExpectingReconnect(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    detach(socket);
    try {
      socket.close(4000, 'idle timeout');
    } catch {
      // Already closing; the reconnect below is what matters.
    }
    this.emit('close', { code: 4000, reason: 'idle timeout', willReconnect: true });
    this.scheduleReconnect();
  }

  private teardownSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    detach(socket);
    try {
      socket.close();
    } catch {
      // Nothing useful to do if close throws on an already-dead socket.
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.emit('state', state);
  }
}

function detach(socket: WebSocketLike): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
}

function defaultWebSocketFactory(): WebSocketFactory | null {
  const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return ctor ? (url: string) => new ctor(url) : null;
}
