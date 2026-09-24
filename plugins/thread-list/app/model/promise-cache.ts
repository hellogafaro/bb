interface PromiseCacheEntry<T> {
  at: number;
  value: Promise<T>;
  resolved?: T;
}

export class PromiseCache<T> {
  private readonly entries = new Map<string, PromiseCacheEntry<T>>();

  constructor(
    private readonly limit = 128,
    private readonly ttl = 60_000,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  peek(key: string): T | undefined {
    return this.entries.get(key)?.resolved;
  }

  get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && now - existing.at < this.ttl) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.value;
    }
    const entry: PromiseCacheEntry<T> = {
      at: now,
      value: Promise.resolve().then(load),
      resolved: existing?.resolved,
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    entry.value.then(
      (value) => {
        entry.resolved = value;
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return entry.value;
  }
}
