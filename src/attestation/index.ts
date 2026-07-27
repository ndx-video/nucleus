/**
 * nucleus_attest — harness-owned real execution capture.
 *
 * The model cannot forge this casually: the harness executes the command,
 * writes stdout/stderr/exit code/git fingerprint/file hashes, and tags the
 * artifact with an HMAC over those fields using a project-local secret.
 *
 * See integrity.ts for residual trust limits (not unforgeable against full FS access).
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureGitFingerprint } from "../git.ts";
import { attestationsDir, ensureNucleusLayout, toProjectRelative } from "../paths.ts";
import { ensureChangeId, loadState, recordAttestation } from "../state.ts";
import type { AttestationArtifact, NucleusConfig } from "../types.ts";
import { runCommand } from "./exec.ts";
import {
  ensureAttestSecret,
  readAttestSecret,
  signArtifact,
  verifyArtifactIntegrity,
} from "./integrity.ts";

export { runCommand } from "./exec.ts";

export interface AttestOptions {
  /** Shell command to run (passed to `sh -c`) */
  command: string;
  /** Optional label for humans / reviewer */
  label?: string;
  /** Optional file paths (relative to cwd) to hash into the artifact */
  hash_files?: string[];
  /** Working directory override (defaults to project cwd) */
  cwd?: string;
  /** Timeout in ms (default 120s) */
  timeout_ms?: number;
}

export interface AttestResult {
  artifact: AttestationArtifact;
  jsonPath: string;
  mdPath: string;
}

function newAttestationId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = randomBytes(4).toString("hex");
  return `att-${ts}-${rand}`;
}

function sha256File(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const buf = readFileSync(path);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

export function hashFiles(cwd: string, paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    const abs = resolve(cwd, p);
    const hash = sha256File(abs);
    const rel = toProjectRelative(cwd, abs);
    out[rel] = hash ?? "(missing)";
  }
  return out;
}

const MAX_CAPTURE_CHARS = 200_000;

function truncateCapture(text: string): string {
  if (text.length <= MAX_CAPTURE_CHARS) return text;
  return (
    text.slice(0, MAX_CAPTURE_CHARS) +
    `\n… [truncated by nucleus_attest, original ${text.length} chars]`
  );
}

export function artifactToMarkdown(a: AttestationArtifact): string {
  return [
    `# Attestation \`${a.id}\``,
    "",
    `- **timestamp:** ${a.timestamp}`,
    `- **cwd:** ${a.cwd}`,
    `- **command:** \`${a.command}\``,
    a.label ? `- **label:** ${a.label}` : null,
    `- **exitCode:** ${a.exitCode}`,
    `- **durationMs:** ${a.durationMs}`,
    `- **changeId:** ${a.changeId ?? "(none)"}`,
    `- **capturedBy:** ${a.capturedBy}`,
    `- **integrity:** \`${a.integrity}\``,
    `- **version:** ${a.version}`,
    "",
    "## Git",
    "",
    `- **head:** ${a.git.head ?? "(unknown)"}`,
    `- **branch:** ${a.git.branch ?? "(unknown)"}`,
    `- **dirty:** ${a.git.dirty}`,
    "",
    "```",
    a.git.status,
    "```",
    "",
    "## File hashes",
    "",
    Object.keys(a.fileHashes).length
      ? Object.entries(a.fileHashes)
          .map(([p, h]) => `- \`${p}\`: \`${h}\``)
          .join("\n")
      : "(none)",
    "",
    "## stdout",
    "",
    "```",
    a.stdout || "(empty)",
    "```",
    "",
    "## stderr",
    "",
    "```",
    a.stderr || "(empty)",
    "```",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Execute a command and write a real attestation artifact.
 * This is the honesty core — never write artifacts without actually running.
 */
export async function createAttestation(
  projectCwd: string,
  options: AttestOptions,
  config: NucleusConfig | null,
): Promise<AttestResult> {
  if (!options.command || !options.command.trim()) {
    throw new Error("nucleus_attest requires a non-empty command");
  }

  const storePath = config?.attestation.store_path;
  ensureNucleusLayout(projectCwd, storePath);
  const state = ensureChangeId(projectCwd);
  const runCwd = options.cwd ? resolve(projectCwd, options.cwd) : projectCwd;
  const timeout = options.timeout_ms ?? 120_000;

  const { stdout, stderr, exitCode, durationMs } = await runCommand(
    options.command,
    runCwd,
    timeout,
    "nucleus_attest",
  );

  const git = captureGitFingerprint(runCwd);
  const fileHashes = hashFiles(runCwd, options.hash_files ?? []);

  const id = newAttestationId();
  // Build body first; sign only after any post-processing mutates stderr/etc.
  const unsigned: Omit<AttestationArtifact, "integrity"> = {
    id,
    timestamp: new Date().toISOString(),
    cwd: runCwd,
    command: options.command,
    ...(options.label ? { label: options.label } : {}),
    exitCode,
    stdout: truncateCapture(stdout),
    stderr: truncateCapture(stderr),
    durationMs,
    git,
    fileHashes,
    capturedBy: "nucleus_attest",
    version: 2,
    changeId: state.changeId,
  };

  // Soft check: require_real_stdout — still write artifact but flag in stderr note.
  if (
    config?.attestation.require_real_stdout &&
    exitCode === 0 &&
    !stdout.trim() &&
    !stderr.trim()
  ) {
    unsigned.stderr =
      (unsigned.stderr ? unsigned.stderr + "\n" : "") +
      "[nucleus_attest] warning: command exited 0 with empty stdout/stderr (require_real_stdout)";
  }

  const secret = ensureAttestSecret(projectCwd);
  const artifact: AttestationArtifact = {
    ...unsigned,
    integrity: signArtifact(unsigned, secret),
  };

  const dir = attestationsDir(projectCwd, storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const jsonPath = resolve(dir, `${id}.json`);
  const mdPath = resolve(dir, `${id}.md`);
  writeFileSync(jsonPath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");
  writeFileSync(mdPath, artifactToMarkdown(artifact), "utf-8");

  recordAttestation(projectCwd, id);

  return { artifact, jsonPath, mdPath };
}

/**
 * Load and verify an attestation.
 * Rejects missing files, missing/forged capturedBy, missing integrity, or MAC failure.
 */
export function loadAttestation(
  projectCwd: string,
  id: string,
  storePath?: string,
): AttestationArtifact | null {
  const dir = attestationsDir(projectCwd, storePath);
  const jsonPath = resolve(dir, `${id}.json`);
  if (!existsSync(jsonPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as AttestationArtifact;
    // Fast filter (still required)
    if (raw.capturedBy !== "nucleus_attest") {
      return null;
    }
    // Integrity required (Phase 1.1) — marker alone is not enough
    const secret = readAttestSecret(projectCwd);
    if (!verifyArtifactIntegrity(raw, secret)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * State-tracked attestation IDs that still load with a valid integrity MAC.
 * Raw state.attestationIds alone is not trustworthy for gates or status counts.
 */
export function listAttestations(
  projectCwd: string,
  storePath?: string,
): string[] {
  const state = loadState(projectCwd);
  return state.attestationIds.filter((id) => loadAttestation(projectCwd, id, storePath) !== null);
}

/** Load every integrity-verified attestation for the current change (order preserved). */
export function getVerifiedAttestations(
  projectCwd: string,
  storePath?: string,
): AttestationArtifact[] {
  const out: AttestationArtifact[] = [];
  for (const id of listAttestations(projectCwd, storePath)) {
    const a = loadAttestation(projectCwd, id, storePath);
    if (a) out.push(a);
  }
  return out;
}

export function countVerifiedAttestations(
  projectCwd: string,
  storePath?: string,
): number {
  return listAttestations(projectCwd, storePath).length;
}

export function hasVerifiedAttestation(
  projectCwd: string,
  storePath?: string,
): boolean {
  return countVerifiedAttestations(projectCwd, storePath) > 0;
}

/** Latest verified id, or null. */
export function latestVerifiedAttestationId(
  projectCwd: string,
  storePath?: string,
): string | null {
  const ids = listAttestations(projectCwd, storePath);
  return ids.length > 0 ? ids[ids.length - 1]! : null;
}

export function formatAttestationSummary(a: AttestationArtifact): string {
  const ok = a.exitCode === 0 ? "OK" : "FAIL";
  return [
    `Attestation ${a.id} [${ok}]`,
    `  command: ${a.command}`,
    `  exitCode: ${a.exitCode}  durationMs: ${a.durationMs}`,
    `  integrity: ${a.integrity.slice(0, 27)}… (verified on load)`,
    `  git: ${a.git.branch ?? "?"}@${(a.git.head ?? "unknown").slice(0, 8)}${a.git.dirty ? " (dirty)" : ""}`,
    `  stdout lines: ${a.stdout.split("\n").length}  stderr lines: ${a.stderr.split("\n").length}`,
  ].join("\n");
}
