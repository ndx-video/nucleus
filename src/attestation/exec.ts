/**
 * Shared command execution for attestation capture and independent re-execution.
 */

import { spawn } from "node:child_process";

export function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  killLabel = "nucleus",
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      resolvePromise({
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      stderr += `\n[${killLabel}] killed after ${timeoutMs}ms timeout`;
      finish(124);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stderr += `\n[${killLabel}] spawn error: ${err.message}`;
      finish(127);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code ?? 1);
    });
  });
}
