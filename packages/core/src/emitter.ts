/**
 * Minimal typed event emitter.
 *
 * Deliberately hand-rolled rather than using Node's `events`: this package must
 * run unmodified under React Native's Hermes runtime, which has no Node builtins.
 */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const dispose = this.on(event, payload => {
      dispose();
      listener(payload);
    });
    return dispose;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy before iterating: listeners commonly unsubscribe themselves (see `once`).
    for (const listener of [...set]) {
      (listener as Listener<Events[K]>)(payload);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
