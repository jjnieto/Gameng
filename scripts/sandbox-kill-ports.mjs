/**
 * Kill processes occupying the sandbox ports (4000, 4010).
 * Cross-platform: uses netstat+taskkill on Windows, lsof+kill on Unix.
 * Run with: node scripts/sandbox-kill-ports.mjs
 */

import { execSync } from "node:child_process";

const PORTS = [4000, 4010];
const isWin = process.platform === "win32";

function killPort(port) {
  if (isWin) {
    try {
      const out = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: "utf8" },
      );
      const pids = new Set();
      for (const line of out.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`  Killed PID ${pid} (port ${port})`);
        } catch {
          // already dead
        }
      }
      if (pids.size === 0) {
        console.log(`  Port ${port}: free`);
      }
    } catch {
      console.log(`  Port ${port}: free`);
    }
  } else {
    try {
      const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" });
      const pids = out
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: "ignore" });
          console.log(`  Killed PID ${pid} (port ${port})`);
        } catch {
          // already dead
        }
      }
    } catch {
      console.log(`  Port ${port}: free`);
    }
  }
}

console.log("Freeing sandbox ports...");
for (const port of PORTS) {
  killPort(port);
}
console.log("Done.");
