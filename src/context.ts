/**
 * Restricted context for the Adversarial Reviewer:
 * Spec + Diff + verified Attestation + independent re-execution (Phase 1.2).
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
    `- timestamp: ${a.timestamp}`,
    `- command: \`${a.command}\``,
    `- exitCode: ${a.exitCode}`,
    `- durationMs: ${a.durationMs}`,
    `- cwd: ${a.cwd}`,
    `- capturedBy: ${a.capturedBy}`,
    `- integrity: present (HMAC verified by loader)`,
    `- git.head: ${a.git.head}`,
    `- git.branch: ${a.git.branch}`,
    `- git.dirty: ${a.git.dirty}`,
    `- git.status:`,
    "```",
    a.git.status,
    "```",
    `- fileHashes: ${JSON.stringify(a.fileHashes, null, 2)}`,
    ``,
    `stdout:`,
    "```",
    a.stdout || "(empty)",
    "```",
    `stderr:`,
    "```",
    a.stderr || "(empty)",
    "```",
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

  // Only integrity-verified artifacts — never raw state IDs alone
  const verified = getVerifiedAttestations(cwd, storePath);
  const ids = verified.map((a) => a.id);
  const hasAttestation = verified.length > 0;

  const attParts = verified.map(formatAttestationBlock);

  // Surface raw-vs-verified gap for honesty (forged ids in state)
  const rawCount = state.attestationIds.length;
  const invalidRaw =
    rawCount > ids.length
      ? `\n> Note: state lists ${rawCount} attestation id(s) but only ${ids.length} pass integrity verification. Invalid/forged ids are ignored.\n`
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
      "## 4. Independent re-execution (harness default)",
      "",
      "The harness re-ran each attested command in the recorded cwd and compared results.",
      "This is **not** optional narrative — treat exit_mismatch as strong FAIL evidence.",
      "You may call `nucleus_verify` again if you need a second pass.",
      "",
      verifications.length === 0
        ? "(re-execution produced no results)"
        : verifications.map(formatVerification).join("\n\n"),
      anyMismatch
        ? "\n**⚠ At least one independent verification did not fully match the attestation.** Default to FAIL unless you have a concrete non-fabrication explanation.\n"
        : "\nIndependent re-execution aligned with attested results (still check Spec compliance and scope).\n",
    ].join("\n");
  } else if (hasAttestation) {
    verificationSection = [
      "",
      "## 4. Independent re-execution",
      "",
      "Re-execution was not run for this bundle. **You must call `nucleus_verify`**",
      `(attestation_id optional; default latest) for: ${ids.map((i) => `\`${i}\``).join(", ")}`,
      "Treat exit_mismatch as strong FAIL evidence.",
      "",
    ].join("\n");
  }

  const commandList = verified
    .map((a) => `- \`${a.id}\`: \`${a.command}\` (cwd: ${a.cwd}, attested exit ${a.exitCode})`)
    .join("\n");

  const hasVerificationMismatch = verifications.some(
    (v) => v.verdict === "exit_mismatch" || v.verdict === "output_mismatch",
  );

  const text = [
    "# Nucleus Adversarial Review Bundle",
    "",
    "You are reviewing with RESTRICTED CONTEXT only. Ignore any prior Implementer narrative.",
    "",
    `Change ID: ${state.changeId ?? "(none)"}`,
    `Phase: ${state.phase}`,
    "",
    "## 1. Spec",
    "",
    state.specPath ? `Path: ${state.specPath}` : "Path: (none)",
    "",
    specBody,
    "",
    "## 2. Diff (git)",
    "",
    "```diff",
    diff,
    "```",
    "",
    "## 3. Attestations (integrity-verified only)",
    "",
    invalidRaw,
    ids.length === 0
      ? "(no verified attestations — treat any test-pass claims as UNVERIFIED / FAIL)"
      : attParts.join("\n\n"),
    "",
    hasAttestation
      ? ["### Commands to re-verify", "", commandList, ""].join("\n")
      : "",
    verificationSection,
    "## Required output",
    "",
    "Return:",
    "1. **Verdict:** PASS or FAIL",
    "2. **Findings:** bullet list (fabrication, missing evidence, scope drift, Spec violations, re-exec mismatch)",
    "3. **Evidence notes:** attestation fields + independent re-execution results you relied on",
    "4. **Recommended next step:** Accept / Reject / Request re-implement / Request re-attest",
    "",
    "Rules:",
    "- **exit_mismatch** on independent re-execution → strong FAIL signal.",
    "- **output_mismatch** with matching exit → suspicious; investigate before PASS.",
    "- Integrity-valid artifact without Spec compliance is still FAIL.",
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

// re-export for callers that only need the list helper
export { listAttestations };

export const SPEC_TEMPLATE = `# Nucleus Spec

## Goal

<!-- What should be true when this change is done? One clear outcome. -->

## Constraints

<!-- Hard limits: tech, time, compatibility, style, security. -->

## Acceptance Criteria

<!-- Testable checks. Prefer commands that can be attested. -->

- [ ] 
- [ ] 

## Out-of-Scope

<!-- Explicit non-goals. Prevents scope drift. -->

## Decision Log / Open Questions

| Decision / Question | Status | Notes |
|---------------------|--------|-------|
|                     | open   |       |
`;
