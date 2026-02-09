import type { FastifyReply } from "fastify";

export interface ProxyOptions {
  engineUrl: string;
  path: string;
  method: string;
  body?: unknown;
  apiKey?: string;
  authHeader?: string;
  timeoutMs?: number;
}

/**
 * Forward a request to the Gameng engine.
 *
 * In Slice 0 (passthrough mode) the caller passes `authHeader` directly
 * from the client request. In later slices the caller passes `apiKey`
 * which the BFF injects as the Authorization header.
 */
export async function proxyToEngine(
  opts: ProxyOptions,
  reply: FastifyReply,
): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  } else if (opts.authHeader) {
    headers["Authorization"] = opts.authHeader;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${opts.engineUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body:
        opts.method === "POST" && opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch {
    void reply.code(502).send({
      errorCode: "ENGINE_UNREACHABLE",
      errorMessage: "Could not connect to the game engine.",
    });
    return;
  }

  const body = await upstream.text();
  void reply
    .code(upstream.status)
    .header(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/json",
    )
    .send(body);
}
