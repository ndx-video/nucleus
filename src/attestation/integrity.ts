/**
 * Attestation integrity (Phase 1.1).
 *
 * Lightweight HMAC-SHA256 over critical fields, keyed by a project-local
 * secret that only the harness creates and uses when writing artifacts.
 *
 * Trust model (honest residual limits):
 * - Stops casual model forgery (hand-written JSON with only `capturedBy`).
 * - Does NOT provide cryptographic unforgeability against a malicious process
 *   with full filesystem access (it can read `.nucleus/attest.key`).
 * - Local-first: secret never leaves the project tree; no external KMS.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nucleusRoot } from "../paths.ts";
import type { AttestationArtifact, GitFingerprint } from "../types.ts";

export const INTEGRITY_PREFIX = "hmac-sha256:";
export const ATTEST_KEY_FILENAME = "attest.key";

/** Fields covered by the integrity MAC (order fixed for stability). */
export interface IntegrityPayload {
  id: string;
  timestamp: string;
  cwd: string;
  command: string;
  label: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  git: GitFingerprint;
  fileHashes: Record<string, string>;
  capturedBy: "nucleus_attest";
  version: number;
  changeId: string | null;
}

export function attestKeyPath(cwd: string): string {
  return join(nucleusRoot(cwd), ATTEST_KEY_FILENAME);
}

/**
 * Load or create the project-local attest secret.
 * Created only by the harness write path; models should never need this file.
 */
export function ensureAttestSecret(cwd: string): Buffer {
  const path = attestKeyPath(cwd);
  if (existsSync(path)) {
    return readAttestSecret(cwd)!;
  }
  const root = nucleusRoot(cwd);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  const secret = randomBytes(32);
  writeFileSync(path, secret.toString("hex") + "\n", { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }
  return secret;
}

export function readAttestSecret(cwd: string): Buffer | null {
  const path = attestKeyPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf-8").trim();
    if (!/^[0-9a-fA-F]+$/.test(text) || text.length < 32) {
      return null;
    }
    return Buffer.from(text, "hex");
  } catch {
    return null;
  }
}

/** Stable JSON for MAC input — sorted fileHashes keys, fixed field order via array. */
export function canonicalIntegrityBytes(payload: IntegrityPayload): Buffer {
  const sortedHashes: Record<string, string> = {};
  for (const key of Object.keys(payload.fileHashes).sort()) {
    sortedHashes[key] = payload.fileHashes[key]!;
  }
  // Array form avoids key-order ambiguity across JSON serializers
  const canonical = [
    payload.id,
    payload.timestamp,
    payload.cwd,
    payload.command,
    payload.label,
    payload.exitCode,
    payload.stdout,
    payload.stderr,
    payload.durationMs,
    payload.git.head,
    payload.git.branch,
    payload.git.status,
    payload.git.dirty,
    sortedHashes,
    payload.capturedBy,
    payload.version,
    payload.changeId,
  ];
  return Buffer.from(JSON.stringify(canonical), "utf-8");
}

export function artifactToIntegrityPayload(
  a: Omit<AttestationArtifact, "integrity">,
): IntegrityPayload {
  return {
    id: a.id,
    timestamp: a.timestamp,
    cwd: a.cwd,
    command: a.command,
    label: a.label ?? null,
    exitCode: a.exitCode,
    stdout: a.stdout,
    stderr: a.stderr,
    durationMs: a.durationMs,
    git: {
      head: a.git.head,
      branch: a.git.branch,
      status: a.git.status,
      dirty: a.git.dirty,
    },
    fileHashes: { ...a.fileHashes },
    capturedBy: "nucleus_attest",
    version: a.version,
    changeId: a.changeId,
  };
}

export function signIntegrityPayload(payload: IntegrityPayload, secret: Buffer): string {
  const mac = createHmac("sha256", secret)
    .update(canonicalIntegrityBytes(payload))
    .digest("hex");
  return `${INTEGRITY_PREFIX}${mac}`;
}

export function signArtifact(
  artifact: Omit<AttestationArtifact, "integrity">,
  secret: Buffer,
): string {
  return signIntegrityPayload(artifactToIntegrityPayload(artifact), secret);
}

/**
 * Verify integrity field against project secret.
 * Returns false for missing marker, missing/invalid integrity, missing secret, or MAC mismatch.
 */
export function verifyArtifactIntegrity(
  artifact: AttestationArtifact,
  secret: Buffer | null,
): boolean {
  if (artifact.capturedBy !== "nucleus_attest") return false;
  if (!secret) return false;
  if (typeof artifact.integrity !== "string" || !artifact.integrity.startsWith(INTEGRITY_PREFIX)) {
    return false;
  }
  const expected = signArtifact(artifact, secret);
  try {
    const a = Buffer.from(expected, "utf-8");
    const b = Buffer.from(artifact.integrity, "utf-8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Ensure parent dir exists for key path (used by tests). */
export function ensureKeyDir(cwd: string): void {
  const dir = dirname(attestKeyPath(cwd));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
