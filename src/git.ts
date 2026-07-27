/**
 * Git fingerprint helpers for attestation artifacts.
 * Best-effort: missing git is not fatal; we still capture what we can.
 */

import { execFileSync } from "node:child_process";
import type { GitFingerprint } from "./types.ts";

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

export function captureGitFingerprint(cwd: string): GitFingerprint {
  const head = tryGit(cwd, ["rev-parse", "HEAD"]);
  const branch = tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = tryGit(cwd, ["status", "--porcelain"]) ?? "(git unavailable)";
  const dirty = status !== "(git unavailable)" && status.length > 0;

  return {
    head,
    branch,
    status: status || "(clean)",
    dirty,
  };
}

/** Unified git diff against HEAD (tracked changes + untracked names only). */
export function captureGitDiff(cwd: string, maxChars = 80_000): string {
  const diff = tryGit(cwd, ["diff", "HEAD"]);
  const untracked = tryGit(cwd, ["ls-files", "--others", "--exclude-standard"]);
  const parts: string[] = [];
  if (diff) parts.push(diff);
  if (untracked) {
    parts.push("\n# Untracked files:\n" + untracked.split("\n").map((f) => `? ${f}`).join("\n"));
  }
  let out = parts.join("\n") || "(no diff)";
  if (out.length > maxChars) {
    out = out.slice(0, maxChars) + `\n… [truncated, ${out.length} chars total]`;
  }
  return out;
}
