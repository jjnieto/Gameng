import { describe, it, expect } from "vitest";
import {
  IdempotencyStore,
  type TxIdCacheEntry,
} from "../src/idempotency-store.js";

describe("IdempotencyStore", () => {
  it("get() returns undefined for unknown txId", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log);
    expect(store.get("unknown")).toBeUndefined();
  });

  it("record + get round-trip", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log);
    const body = { txId: "tx1", accepted: true, stateVersion: 1 };
    store.record("tx1", 200, body);
    const cached = store.get("tx1");
    expect(cached).toBeDefined();
    expect(cached!.txId).toBe("tx1");
    expect(cached!.statusCode).toBe(200);
    expect(cached!.body).toEqual(body);
  });

  it("duplicate record() is a no-op (does not overwrite)", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log);
    const body1 = { txId: "tx1", accepted: true, stateVersion: 1 };
    const body2 = { txId: "tx1", accepted: false, stateVersion: 2 };
    store.record("tx1", 200, body1);
    store.record("tx1", 200, body2);
    expect(store.size).toBe(1);
    expect(store.get("tx1")!.body).toEqual(body1);
    expect(log).toHaveLength(1);
  });

  it("size tracks entries", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log);
    expect(store.size).toBe(0);
    store.record("tx1", 200, {});
    expect(store.size).toBe(1);
    store.record("tx2", 200, {});
    expect(store.size).toBe(2);
  });

  it("FIFO eviction at capacity (maxEntries=3)", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log, 3);
    store.record("tx1", 200, { n: 1 });
    store.record("tx2", 200, { n: 2 });
    store.record("tx3", 200, { n: 3 });
    expect(store.size).toBe(3);

    // Adding a 4th should evict tx1
    store.record("tx4", 200, { n: 4 });
    expect(store.size).toBe(3);
    expect(store.get("tx1")).toBeUndefined();
    expect(store.get("tx2")).toBeDefined();
    expect(store.get("tx3")).toBeDefined();
    expect(store.get("tx4")).toBeDefined();
  });

  it("evicted entry is not found", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log, 2);
    store.record("tx1", 200, {});
    store.record("tx2", 200, {});
    store.record("tx3", 200, {});
    expect(store.get("tx1")).toBeUndefined();
    expect(log).toHaveLength(2);
  });

  it("constructor rebuilds index from pre-existing entries", () => {
    const log: TxIdCacheEntry[] = [
      { txId: "old1", statusCode: 200, body: { a: 1 } },
      { txId: "old2", statusCode: 200, body: { a: 2 } },
    ];
    const store = new IdempotencyStore(log);
    expect(store.size).toBe(2);
    expect(store.get("old1")!.body).toEqual({ a: 1 });
    expect(store.get("old2")!.body).toEqual({ a: 2 });
  });

  it("shared array reference: external code sees mutations via original array", () => {
    const log: TxIdCacheEntry[] = [];
    const store = new IdempotencyStore(log);
    store.record("tx1", 200, { val: 42 });
    // The original array should reflect the push
    expect(log).toHaveLength(1);
    expect(log[0].txId).toBe("tx1");
    expect(log[0].body).toEqual({ val: 42 });
  });
});
