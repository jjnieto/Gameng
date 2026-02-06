/**
 * E2E verbose step logger.
 *
 * - step(name, fn): prints start/end with duration
 * - logReq/logRes: pretty-prints HTTP traffic, redacts Authorization
 * - serverLogs buffer: captures server stdout/stderr for dump on failure
 */

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

// ---------------------------------------------------------------------------
// Authorization redaction
// ---------------------------------------------------------------------------

function redactAuth(value: string): string {
  // Show "Bearer ab…" (first 2 chars) for debugging, hide the rest
  const match = /^(Bearer\s+)(.+)$/i.exec(value);
  if (!match) return "***";
  const prefix = match[1];
  const token = match[2];
  if (token.length <= 4) return `${prefix}****`;
  return `${prefix}${token.slice(0, 4)}****`;
}

function redactHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...headers };
  if (out.authorization) out.authorization = redactAuth(out.authorization);
  if (out.Authorization) out.Authorization = redactAuth(out.Authorization);
  return out;
}

// ---------------------------------------------------------------------------
// Request / Response logging
// ---------------------------------------------------------------------------

export interface LoggedRequest {
  method: string;
  url: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface LoggedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  durationMs: number;
}

let lastRequest: LoggedRequest | undefined;
let lastResponse: LoggedResponse | undefined;

export function logReq(req: LoggedRequest): void {
  lastRequest = req;
  const hdrs = req.headers ? redactHeaders(req.headers) : {};
  console.log(
    `${CYAN}    --> ${req.method} ${req.url}${RESET}`,
  );
  if (Object.keys(hdrs).length > 0) {
    console.log(`${DIM}        headers: ${JSON.stringify(hdrs)}${RESET}`);
  }
  if (req.body !== undefined) {
    console.log(
      `${DIM}        body: ${JSON.stringify(req.body, null, 2).split("\n").join("\n        ")}${RESET}`,
    );
  }
}

export function logRes(res: LoggedResponse): void {
  lastResponse = res;
  const color = res.status < 400 ? GREEN : RED;
  console.log(
    `${color}    <-- ${String(res.status)} (${String(res.durationMs)}ms)${RESET}`,
  );
  if (res.body !== undefined) {
    const bodyStr = JSON.stringify(res.body, null, 2).split("\n").join("\n        ");
    console.log(`${DIM}        body: ${bodyStr}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Server log buffer
// ---------------------------------------------------------------------------

export class ServerLogBuffer {
  private lines: string[] = [];
  private maxLines = 200;

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  dump(label: string, lastN = 30): void {
    const tail = this.lines.slice(-lastN);
    if (tail.length === 0) {
      console.log(`${YELLOW}  [${label}] (no output)${RESET}`);
      return;
    }
    console.log(`${YELLOW}  [${label}] last ${String(tail.length)} lines:${RESET}`);
    for (const line of tail) {
      console.log(`${DIM}    | ${line}${RESET}`);
    }
  }

  clear(): void {
    this.lines = [];
  }
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

export async function step<T>(
  name: string,
  fn: () => T | Promise<T>,
  serverLogs?: ServerLogBuffer,
): Promise<T> {
  const t0 = performance.now();
  console.log(`\n${BOLD}  STEP: ${name}${RESET}`);
  try {
    const result = await fn();
    const ms = (performance.now() - t0).toFixed(0);
    console.log(`${GREEN}  DONE: ${name} (${ms}ms)${RESET}`);
    return result;
  } catch (err) {
    const ms = (performance.now() - t0).toFixed(0);
    console.log(`${RED}  FAIL: ${name} (${ms}ms)${RESET}`);

    // Dump last req/res for debugging
    if (lastRequest) {
      console.log(`${RED}  Last request: ${lastRequest.method} ${lastRequest.url}${RESET}`);
    }
    if (lastResponse) {
      console.log(
        `${RED}  Last response: ${String(lastResponse.status)} ${JSON.stringify(lastResponse.body)}${RESET}`,
      );
    }

    // Dump server logs if available
    if (serverLogs) {
      serverLogs.dump("SERVER", 40);
    }

    throw err;
  }
}
