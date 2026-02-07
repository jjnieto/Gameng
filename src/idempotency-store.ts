export interface TxIdCacheEntry {
  txId: string;
  statusCode: number;
  body: Record<string, unknown>;
}

export const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 1000;

export class IdempotencyStore {
  private readonly cache: TxIdCacheEntry[];
  private readonly index: Map<string, TxIdCacheEntry>;
  readonly maxEntries: number;

  constructor(
    cache: TxIdCacheEntry[],
    maxEntries = DEFAULT_MAX_IDEMPOTENCY_ENTRIES,
  ) {
    this.cache = cache;
    this.maxEntries = maxEntries;
    this.index = new Map();
    for (const entry of cache) {
      this.index.set(entry.txId, entry);
    }
  }

  get(txId: string): TxIdCacheEntry | undefined {
    return this.index.get(txId);
  }

  record(txId: string, statusCode: number, body: Record<string, unknown>): void {
    if (this.index.has(txId)) return;

    const entry: TxIdCacheEntry = { txId, statusCode, body };
    this.cache.push(entry);
    this.index.set(txId, entry);

    while (this.cache.length > this.maxEntries) {
      const evicted = this.cache.shift()!;
      this.index.delete(evicted.txId);
    }
  }

  get size(): number {
    return this.index.size;
  }
}
