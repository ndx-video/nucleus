/**
 * Independent re-execution of attested commands (Phase 1.2).
 *
 * Additional honesty layer on top of HMAC integrity:
 * - Integrity proves the artifact was written by the harness with those fields.
 * - Re-execution checks whether the same command still produces comparable results
 *   in the current tree (catches stale artifacts and some environment lies).
 *
 * Residual: flaky tests / non-deterministic stdout can yield output_mismatch
 * without fabrication; exit-code mismatch is the stronger signal.
 */

import type { AttestationArtifact } from "../types.ts";
import { runCommand } from "./exec.ts";
import {
  listAttestations,
  loadAttestation,
} from "./index.ts";

export type IndependentVerdict =
  | "match"
  | "exit_mismatch"
  | "output_mismatch"
  | "error";

export interface IndependentVerification {
  attestationId: string;
  command: string;
  cwd: string;
  original: {
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  reexec: {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  exitCodeMatch: boolean;
  stdoutMatch: boolean;
  stderrMatch: boolean;
  verdict: IndependentVerdict;
  notes: string[];
  verifiedAt: string;
}

/** Normalize for comparison (line endings + trailing whitespace). */
export function normalizeOutput(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
}

export function compareAttestationToReexec(
  artifact: AttestationArtifact,
  reexec: { stdout: string; stderr: string; exitCode: number; durationMs: number },
): IndependentVerification {
  const notes: string[] = [];
  const exitCodeMatch = artifact.exitCode === reexec.exitCode;
  const stdoutMatch =
    normalizeOutput(artifact.stdout) === normalizeOutput(reexec.stdout);
  const stderrMatch =
    normalizeOutput(artifact.stderr) === normalizeOutput(reexec.stderr);

  let verdict: IndependentVerdict;
  if (!exitCodeMatch) {
    verdict = "exit_mismatch";
    notes.push(
      `Exit code mismatch: attested ${artifact.exitCode} vs re-exec ${reexec.exitCode}. Strong evidence against the claim.`,
    );
  } else if (!stdoutMatch || !stderrMatch) {
    verdict = "output_mismatch";
    if (!stdoutMatch) notes.push("stdout differs from attestation (after normalize).");
    if (!stderrMatch) notes.push("stderr differs from attestation (after normalize).");
    notes.push(
      "Exit codes match but output differs — treat as suspicious (flaky tests, non-determinism, or drift).",
    );
  } else {
    verdict = "match";
    notes.push("Independent re-execution matches attested exit code and output.");
  }

  return {
    attestationId: artifact.id,
    command: artifact.command,
    cwd: artifact.cwd,
    original: {
      exitCode: artifact.exitCode,
      stdout: artifact.stdout,
      stderr: artifact.stderr,
    },
    reexec: {
      exitCode: reexec.exitCode,
      stdout: reexec.stdout,
      stderr: reexec.stderr,
      durationMs: reexec.durationMs,
    },
    exitCodeMatch,
    stdoutMatch,
    stderrMatch,
    verdict,
    notes,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Load a verified attestation and re-run its exact command.
 * Returns null if the attestation cannot be loaded (integrity failure / missing).
 */
export async function reexecuteAttestation(
  projectCwd: string,
  attestationId: string,
  options?: { storePath?: string; timeout_ms?: number },
): Promise<IndependentVerification | null> {
  const artifact = loadAttestation(projectCwd, attestationId, options?.storePath);
  if (!artifact) return null;

  const timeout = options?.timeout_ms ?? 120_000;
  const reexec = await runCommand(
    artifact.command,
    artifact.cwd,
    timeout,
    "nucleus_verify",
  );
  return compareAttestationToReexec(artifact, reexec);
}

/** Re-execute every currently verified attestation for this change. */
export async function reexecuteAllVerified(
  projectCwd: string,
  options?: { storePath?: string; timeout_ms?: number },
): Promise<IndependentVerification[]> {
  const ids = listAttestations(projectCwd, options?.storePath);
  const out: IndependentVerification[] = [];
  for (const id of ids) {
    const v = await reexecuteAttestation(projectCwd, id, options);
    if (v) out.push(v);
  }
  return out;
}

export function formatVerification(v: IndependentVerification): string {
  const badge =
    v.verdict === "match"
      ? "MATCH"
      : v.verdict === "exit_mismatch"
        ? "EXIT MISMATCH"
        : v.verdict === "output_mismatch"
          ? "OUTPUT MISMATCH"
          : "ERROR";

  return [
    `### Independent re-execution: ${v.attestationId} — **${badge}**`,
    "",
    `- **command:** \`${v.command}\``,
    `- **cwd:** ${v.cwd}`,
    `- **verifiedAt:** ${v.verifiedAt}`,
    `- **exitCode:** attested ${v.original.exitCode} vs re-exec ${v.reexec.exitCode} → ${v.exitCodeMatch ? "MATCH" : "MISMATCH"}`,
    `- **stdout:** ${v.stdoutMatch ? "MATCH" : "DIFFERS"}`,
    `- **stderr:** ${v.stderrMatch ? "MATCH" : "DIFFERS"}`,
    `- **reexec durationMs:** ${v.reexec.durationMs}`,
    "",
    "**Notes:**",
    ...v.notes.map((n) => `- ${n}`),
    "",
    "Re-exec stdout:",
    "```",
    v.reexec.stdout || "(empty)",
    "```",
    "Re-exec stderr:",
    "```",
    v.reexec.stderr || "(empty)",
    "```",
  ].join("\n");
}

export function formatVerificationSummary(v: IndependentVerification): string {
  return [
    `nucleus_verify ${v.attestationId} → ${v.verdict.toUpperCase()}`,
    `  command: ${v.command}`,
    `  exit: attested=${v.original.exitCode} reexec=${v.reexec.exitCode} (${v.exitCodeMatch ? "match" : "MISMATCH"})`,
    `  stdout: ${v.stdoutMatch ? "match" : "DIFFERS"}  stderr: ${v.stderrMatch ? "match" : "DIFFERS"}`,
    ...v.notes.map((n) => `  · ${n}`),
  ].join("\n");
}
