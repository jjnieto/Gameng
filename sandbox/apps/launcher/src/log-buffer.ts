/**
 * Ring buffer for engine log lines.
 * Stores up to `maxLines` entries, oldest evicted first.
 */

export interface LogEntry {
  /** ISO timestamp */
  ts: string;
  /** "stdout" | "stderr" */
  stream: string;
  /** Raw line content */
  line: string;
}

export class LogBuffer {
  private readonly buf: LogEntry[] = [];
  private readonly maxLines: number;

  constructor(maxLines = 2000) {
    this.maxLines = maxLines;
  }

  push(stream: "stdout" | "stderr", line: string): void {
    this.buf.push({ ts: new Date().toISOString(), stream, line });
    while (this.buf.length > this.maxLines) {
      this.buf.shift();
    }
  }

  /** Return last `limit` entries (default: all). */
  tail(limit?: number): LogEntry[] {
    if (limit == null || limit >= this.buf.length) {
      return [...this.buf];
    }
    return this.buf.slice(-limit);
  }

  clear(): void {
    this.buf.length = 0;
  }

  get size(): number {
    return this.buf.length;
  }
}
