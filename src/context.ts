/**
 * Restricted context for the Adversarial Reviewer:
 * Spec + Diff + Attestation only (no Implementer chat history).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAttestation, listAttestations } from "./attestation/index.ts";
import { captureGitDiff } from "./git.ts";
import { loadState } from "./state.ts";
import type { NucleusConfig } from "./types.ts";

export interface ReviewerBundle {
  text: string;
  specPath: string | null;
  attestationIds: string[];
  hasSpec: boolean;
  hasAttestation: boolean;
  hasDiff: boolean;
}

export function buildReviewerContext(
  cwd: string,
  config: NucleusConfig | null,
): ReviewerBundle {
  const state = loadState(cwd);
  const storePath = config?.attestation.store_path;

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

  const ids =
    state.attestationIds.length > 0
      ? state.attestationIds
      : listAttestations(cwd, storePath);

  const attParts: string[] = [];
  for (const id of ids) {
    const a = loadAttestation(cwd, id, storePath);
    if (!a) {
      attParts.push(`### ${id}\n(missing or invalid artifact — possible forgery or deleted file)\n`);
      continue;
    }
    attParts.push(
      [
        `### ${a.id}`,
        `- timestamp: ${a.timestamp}`,
        `- command: \`${a.command}\``,
        `- exitCode: ${a.exitCode}`,
        `- durationMs: ${a.durationMs}`,
        `- cwd: ${a.cwd}`,
        `- capturedBy: ${a.capturedBy}`,
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
      ].join("\n"),
    );
  }

  const hasAttestation = ids.length > 0 && attParts.some((p) => !p.includes("missing or invalid"));

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
    "## 3. Attestations",
    "",
    ids.length === 0
      ? "(no attestations recorded — treat any test-pass claims as UNVERIFIED)"
      : attParts.join("\n\n"),
    "",
    "## Required output",
    "",
    "Return:",
    "1. **Verdict:** PASS or FAIL",
    "2. **Findings:** bullet list (fabrication, missing evidence, scope drift, Spec violations)",
    "3. **Evidence notes:** which attestation fields you inspected",
    "4. **Recommended next step:** Accept / Reject / Request re-implement / Request re-attest",
  ].join("\n");

  return {
    text,
    specPath: state.specPath,
    attestationIds: ids,
    hasSpec,
    hasAttestation,
    hasDiff,
  };
}

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
