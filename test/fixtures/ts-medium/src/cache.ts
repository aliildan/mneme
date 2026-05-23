export interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
}

export interface CacheOptions {
  defaultTtlMs?: number;
  maxSize?: number;
}

export class Cache<K = string, V = unknown> {
  private store = new Map<K, CacheEntry<V>>();
  private defaultTtlMs: number | null;
  private maxSize: number;

  constructor(opts: CacheOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? null;
    this.maxSize = opts.maxSize ?? Infinity;
  }

  set(key: K, value: V, ttlMs?: number): this {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: effectiveTtl != null ? Date.now() + effectiveTtl : null,
    });
    return this;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
  keyFn: (...args: A) => string = (...args) => JSON.stringify(args),
  ttlMs?: number
): (...args: A) => R {
  const cache = new Cache<string, R>({ defaultTtlMs: ttlMs });
  return (...args: A): R => {
    const key = keyFn(...args);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}
