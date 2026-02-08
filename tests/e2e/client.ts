/**
 * E2E HTTP client.
 *
 * - Real fetch against a running server.
 * - Auto-logs request/response via logger.ts.
 * - Typed helpers: tx(), getPlayer(), getStats().
 * - Assertion helpers: expectAccepted(), expectRejected(), expectHttp().
 */

import { expect } from "vitest";
import { logReq, logRes } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

export interface PlayerState {
  characters: Record<
    string,
    { classId: string; level: number; equipped: Record<string, string>; resources?: Record<string, number> }
  >;
  gear: Record<
    string,
    { gearDefId: string; level: number; equippedBy?: string | null }
  >;
  resources?: Record<string, number>;
}

export interface HttpResult<T = unknown> {
  status: number;
  body: T;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export async function request<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  opts: {
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<HttpResult<T>> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.headers ?? {}),
  };

  logReq({
    method,
    url: path,
    headers: opts.headers,
    body: opts.body,
  });

  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const durationMs = Math.round(performance.now() - t0);

  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }

  logRes({ status: res.status, body, durationMs });

  return { status: res.status, body, durationMs };
}

// ---------------------------------------------------------------------------
// Auth header builder
// ---------------------------------------------------------------------------

function authHeader(
  apiKey: string,
): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

export async function tx(
  baseUrl: string,
  apiKey: string | null,
  payload: Record<string, unknown>,
): Promise<HttpResult<TxResult>> {
  const instanceId =
    (payload.gameInstanceId as string | undefined) ?? "instance_001";
  return request<TxResult>(baseUrl, "POST", `/${instanceId}/tx`, {
    headers: apiKey ? authHeader(apiKey) : {},
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// GET helpers
// ---------------------------------------------------------------------------

export async function getPlayer(
  baseUrl: string,
  apiKey: string,
  instanceId: string,
  playerId: string,
): Promise<HttpResult<PlayerState>> {
  return request<PlayerState>(
    baseUrl,
    "GET",
    `/${instanceId}/state/player/${playerId}`,
    { headers: authHeader(apiKey) },
  );
}

export async function getStats(
  baseUrl: string,
  apiKey: string,
  instanceId: string,
  characterId: string,
): Promise<HttpResult<CharacterStats>> {
  return request<CharacterStats>(
    baseUrl,
    "GET",
    `/${instanceId}/character/${characterId}/stats`,
    { headers: authHeader(apiKey) },
  );
}

export async function getHealth(
  baseUrl: string,
): Promise<HttpResult<{ status: string }>> {
  return request<{ status: string }>(baseUrl, "GET", "/health");
}

export async function getStateVersion(
  baseUrl: string,
  instanceId: string,
): Promise<HttpResult<{ gameInstanceId: string; stateVersion: number }>> {
  return request<{ gameInstanceId: string; stateVersion: number }>(
    baseUrl,
    "GET",
    `/${instanceId}/stateVersion`,
  );
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export function expectAccepted(
  res: HttpResult<TxResult>,
  label?: string,
): void {
  const ctx = label ? ` [${label}]` : "";
  expect(res.status, `HTTP 200 expected${ctx}`).toBe(200);
  expect(res.body.accepted, `accepted=true expected${ctx}`).toBe(true);
  expect(res.body.errorCode, `no errorCode expected${ctx}`).toBeUndefined();
}

export function expectRejected(
  res: HttpResult<TxResult>,
  errorCode: string,
  label?: string,
): void {
  const ctx = label ? ` [${label}]` : "";
  expect(res.status, `HTTP 200 expected${ctx}`).toBe(200);
  expect(res.body.accepted, `accepted=false expected${ctx}`).toBe(false);
  expect(res.body.errorCode, `errorCode=${errorCode} expected${ctx}`).toBe(
    errorCode,
  );
}

export function expectHttp(
  res: HttpResult<{ errorCode?: string }>,
  status: number,
  errorCode?: string,
  label?: string,
): void {
  const ctx = label ? ` [${label}]` : "";
  expect(res.status, `HTTP ${String(status)} expected${ctx}`).toBe(status);
  if (errorCode) {
    expect(
      res.body.errorCode,
      `errorCode=${errorCode} expected${ctx}`,
    ).toBe(errorCode);
  }
}
