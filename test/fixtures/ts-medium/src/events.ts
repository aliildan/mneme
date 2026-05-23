export type EventName = string;
export type Listener<T = unknown> = (data: T) => void | Promise<void>;

export interface EventEmitterOptions {
  maxListeners?: number;
}

export class EventEmitter<Events extends Record<string, unknown> = Record<string, unknown>> {
  private listeners = new Map<EventName, Listener[]>();
  private maxListeners: number;

  constructor(opts: EventEmitterOptions = {}) {
    this.maxListeners = opts.maxListeners ?? 10;
  }

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    const key = String(event);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    const list = this.listeners.get(key)!;
    if (list.length >= this.maxListeners) {
      console.warn(`MaxListenersExceededWarning: ${key}`);
    }
    list.push(listener as Listener);
    return this;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    const key = String(event);
    const list = this.listeners.get(key);
    if (!list) return this;
    const idx = list.indexOf(listener as Listener);
    if (idx !== -1) list.splice(idx, 1);
    return this;
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    const wrapper: Listener = (data) => {
      this.off(event, wrapper as Listener<Events[K]>);
      (listener as Listener)(data);
    };
    return this.on(event, wrapper as Listener<Events[K]>);
  }

  async emit<K extends keyof Events>(event: K, data: Events[K]): Promise<void> {
    const key = String(event);
    const list = this.listeners.get(key) ?? [];
    await Promise.all(list.map((fn) => fn(data)));
  }

  listenerCount(event: EventName): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

export type AppEvents = {
  "user:login": { userId: string; timestamp: number };
  "user:logout": { userId: string };
  error: { code: string; message: string };
};

export const appEvents = new EventEmitter<AppEvents>();
