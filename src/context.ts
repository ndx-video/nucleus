/**
 * Restricted context for the Adversarial Reviewer:
 * Spec + Diff + verified Attestation + independent re-execution.
 * Phase 2.0 injects this bundle into a clean session (no Implementer history).
 * Phase 2.1: scannable section layout for humans and models.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getVerifiedAttestations,
  loadAttestation,
  listAttestations,
} from "./attestation/index.ts";
import {
  formatVerification,
  reexecuteAllVerified,
  type IndependentVerification,
} from "./attestation/verify.ts";
import { captureGitDiff } from "./git.ts";
import { loadState } from "./state.ts";
import type { NucleusConfig } from "./types.ts";

export interface ReviewerBundle {
  text: string;
  specPath: string | null;
  /** Integrity-verified attestation ids only */
  attestationIds: string[];
  hasSpec: boolean;
  hasAttestation: boolean;
  hasDiff: boolean;
  /** Independent re-execution results (when reverify enabled) */
  verifications: IndependentVerification[];
  /** True if any re-execution reported exit or output mismatch */
  hasVerificationMismatch: boolean;
}

export interface BuildReviewerOptions {
  /**
   * When true (default for /review), harness re-executes each verified
   * attestation command and embeds the comparison in the bundle.
   */
  reverify?: boolean;
  timeout_ms?: number;
}

function formatAttestationBlock(
  a: NonNullable<ReturnType<typeof loadAttestation>>,
): string {
  return [
    `### ${a.id}`,
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| command | \`${a.command}\` |`,
    `| exitCode | **${a.exitCode}** |`,
    `| durationMs | ${a.durationMs} |`,
    `| timestamp | ${a.timestamp} |`,
    `| cwd | ${a.cwd} |`,
    `| integrity | HMAC verified |`,
    `| git | ${(a.git.branch ?? "?") + "@" + (a.git.head ?? "unknown").slice(0, 8)}${a.git.dirty ? " dirty" : ""} |`,
    "",
    "**stdout**",
    "```",
    a.stdout || "(empty)",
    "```",
    "",
    "**stderr**",
    "```",
    a.stderr || "(empty)",
    "```",
  ].join("\n");
}

function reexecSummaryTable(verifications: IndependentVerification[]): string {
  if (verifications.length === 0) return "(no re-exec results)";
  const rows = verifications.map((v) => {
    const badge =
      v.verdict === "match"
        ? "**MATCH**"
        : v.verdict === "exit_mismatch"
          ? "**EXIT MISMATCH**"
          : v.verdict === "output_mismatch"
            ? "**OUTPUT MISMATCH**"
            : "**ERROR**";
    const shortId = v.attestationId.length > 28 ? v.attestationId.slice(0, 28) + "…" : v.attestationId;
    return `| \`${shortId}\` | ${badge} | ${v.original.exitCode}→${v.reexec.exitCode} | ${v.stdoutMatch ? "ok" : "DIFF"} | ${v.stderrMatch ? "ok" : "DIFF"} |`;
  });
  return [
    "| Attestation | Verdict | Exit | Stdout | Stderr |",
    "|-------------|---------|------|--------|--------|",
    ...rows,
  ].join("\n");
}

export async function buildReviewerContext(
  cwd: string,
  config: NucleusConfig | null,
  options?: BuildReviewerOptions,
): Promise<ReviewerBundle> {
  const state = loadState(cwd);
  const storePath = config?.attestation.store_path;
  const reverify = options?.reverify !== false;

  let specBody = "(no spec on file)";
  let hasSpec = false;
  if (state.specPath) {
    const abs = resolve(cwd, state.specPath);
    if (existsSync(abs)) {
      specBody = readFileSync(abs, "utf-8");
      hasSpec = true;
    } else {
      specBody = `(spec path missing on disk: ${state.specPath})`;
    }
  }

  const diff = captureGitDiff(cwd);
  const hasDiff = diff !== "(no diff)";

  const verified = getVerifiedAttestations(cwd, storePath);
  const ids = verified.map((a) => a.id);
  const hasAttestation = verified.length > 0;
  const attParts = verified.map(formatAttestationBlock);

  const rawCount = state.attestationIds.length;
  const invalidRaw =
    rawCount > ids.length
      ? `> ⚠ State lists **${rawCount}** id(s); only **${ids.length}** pass integrity. Forged/invalid ids ignored.\n`
      : "";

  let verifications: IndependentVerification[] = [];
  let verificationSection = "";

  if (reverify && hasAttestation) {
    verifications = await reexecuteAllVerified(cwd, {
      storePath,
      timeout_ms: options?.timeout_ms,
    });
    const anyMismatch = verifications.some(
      (v) => v.verdict === "exit_mismatch" || v.verdict === "output_mismatch",
    );
    verificationSection = [
      "",
      "## 4. Independent re-execution",
      "",
      "Harness re-ran each attested command. **exit_mismatch → strong FAIL.**",
      "Optional second pass: tool `nucleus_verify`.",
      "",
      "### Summary",
      "",
      reexecSummaryTable(verifications),
      "",
      anyMismatch
        ? "> ⚠ **MISMATCH present** — default to FAIL unless you have a non-fabrication explanation.\n"
        : "> Re-exec aligned with attestations (still check Spec compliance).\n",
      "### Details",
      "",
      verifications.length === 0
        ? "(no results)"
        : verifications.map(formatVerification).join("\n\n"),
      "",
    ].join("\n");
  } else if (hasAttestation) {
    verificationSection = [
      "",
      "## 4. Independent re-execution",
      "",
      "Not run for this bundle. Call **`nucleus_verify`** for:",
      ...ids.map((i) => `- \`${i}\``),
      "",
      "Treat **exit_mismatch** as strong FAIL.",
      "",
    ].join("\n");
  }

  const hasVerificationMismatch = verifications.some(
    (v) => v.verdict === "exit_mismatch" || v.verdict === "output_mismatch",
  );

  const atAGlance = [
    "| | |",
    "|--|--|",
    `| Change | ${state.changeId ?? "—"} |`,
    `| Phase | ${state.phase} |`,
    `| Spec | ${state.specPath ?? "—"} ${hasSpec ? "✓" : "✗"} |`,
    `| Diff | ${hasDiff ? "present" : "empty"} |`,
    `| Verified attestations | ${ids.length} |`,
    `| Re-exec | ${
      verifications.length === 0
        ? reverify
          ? "n/a"
          : "not run"
        : hasVerificationMismatch
          ? "**MISMATCH**"
          : "**MATCH**"
    } |`,
  ].join("\n");

  const text = [
    "# Nucleus Review Bundle",
    "",
    "Working set only: Spec · Diff · verified Attestation · re-exec. No Implementer chat.",
    "",
    "## At a glance",
    "",
    atAGlance,
    "",
    "---",
    "",
    "## 1. Spec",
    "",
    state.specPath ? `Path: \`${state.specPath}\`` : "Path: (none)",
    "",
    specBody,
    "",
    "---",
    "",
    "## 2. Diff (git)",
    "",
    "```diff",
    diff,
    "```",
    "",
    "---",
    "",
    "## 3. Attestations (integrity-verified only)",
    "",
    invalidRaw,
    ids.length === 0
      ? "(none — treat test-pass claims as UNVERIFIED / FAIL)"
      : attParts.join("\n\n"),
    verificationSection,
    "---",
    "",
    "## Required output",
    "",
    "1. **Verdict:** PASS or FAIL",
    "2. **Findings:** bullets (fabrication, missing evidence, drift, Spec, re-exec)",
    "3. **Evidence notes:** which att + re-exec fields you used",
    "4. **Next step:** Accept / Reject / Re-implement / Re-attest",
    "",
    "**Rules:** exit_mismatch → strong FAIL · output_mismatch → suspicious · Spec drift → FAIL",
  ].join("\n");

  return {
    text,
    specPath: state.specPath,
    attestationIds: ids,
    hasSpec,
    hasAttestation,
    hasDiff,
    verifications,
    hasVerificationMismatch,
  };
}

export { listAttestations };

export const SPEC_TEMPLATE = `# Nucleus Spec

## Goal

<!-- What should be true when this change is done? One clear outcome. -->

## Constraints

<!-- Hard limits: tech, time, compatibility, style, security. -->

## Acceptance Criteria

<!-- Testable checks. Prefer commands that can be attested via nucleus_attest. -->

- [ ] 
- [ ] 

## Out-of-Scope

<!-- Explicit non-goals. Prevents scope drift. -->

## Decision Log / Open Questions

| Decision / Question | Status | Notes |
|---------------------|--------|-------|
|                     | open   |       |
`;
