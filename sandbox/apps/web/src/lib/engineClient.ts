// Typed client for the Gameng engine API.

import type { Settings } from "./useSettings.ts";
import type {
  HealthResponse,
  StateVersionResponse,
  TransactionRequest,
  TxResponse,
  PlayerState,
  StatsResponse,
  GameConfig,
  ErrorBody,
} from "./types.ts";

export class EngineClientError extends Error {
  readonly status: number;
  readonly body: ErrorBody | null;

  constructor(status: number, body: ErrorBody | null) {
    const msg = body?.errorMessage ?? body?.errorCode ?? body?.error ?? `HTTP ${String(status)}`;
    super(msg);
    this.name = "EngineClientError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // non-JSON error body
    }
    throw new EngineClientError(res.status, body);
  }
  return (await res.json()) as T;
}

export interface EngineClient {
  health(): Promise<HealthResponse>;
  getConfig(): Promise<GameConfig>;
  getStateVersion(): Promise<StateVersionResponse>;
  postTx(tx: TransactionRequest, opts?: { adminApiKey?: string; apiKey?: string }): Promise<TxResponse>;
  getPlayerState(playerId: string, apiKey: string): Promise<PlayerState>;
  getCharacterStats(characterId: string, apiKey: string): Promise<StatsResponse>;
}

/**
 * Returns the base URL for engine API calls.
 * When useProxy is on, routes through the launcher (/engine prefix).
 * When off, calls the engine directly.
 */
export function getEngineBaseUrl(settings: Settings): string {
  return settings.useProxy
    ? `${settings.launcherBaseUrl}/engine`
    : settings.engineBaseUrl;
}

export function createEngineClient(
  baseUrl: string,
  gameInstanceId: string,
): EngineClient {
  const base = `${baseUrl}/${gameInstanceId}`;

  return {
    health: () => request<HealthResponse>(`${baseUrl}/health`),

    getConfig: () => request<GameConfig>(`${base}/config`),

    getStateVersion: () => request<StateVersionResponse>(`${base}/stateVersion`),

    postTx: (tx, opts) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // Admin operations use adminApiKey, regular operations use apiKey
      const token = opts?.adminApiKey ?? opts?.apiKey;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      return request<TxResponse>(`${base}/tx`, {
        method: "POST",
        headers,
        body: JSON.stringify(tx),
      });
    },

    getPlayerState: (playerId, apiKey) =>
      request<PlayerState>(`${base}/state/player/${playerId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),

    getCharacterStats: (characterId, apiKey) =>
      request<StatsResponse>(`${base}/character/${characterId}/stats`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
  };
}
