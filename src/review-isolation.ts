/**
 * Phase 2.0 — True Reviewer Isolation helpers.
 *
 * Preferred path: start a blank Pi session via ctx.newSession() and inject only
 * the Review Bundle (Spec + Diff + verified Attestations + independent re-exec).
 *
 * Residual limitations (documented honestly):
 * - Project-level system context (AGENTS.md, skills, prompts) may still load in
 *   the new session — that is ambient project rules, not Implementer chat history.
 * - parentSession is recorded as metadata only; conversation history is not copied.
 * - If newSession is unavailable/cancelled, we fall back to same-session injection
 *   (hybrid isolation) and record that fact.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  ensureNucleusLayout,
  reviewBundlePath,
  reviewSessionPath,
  toProjectRelative,
} from "./paths.ts";
import type { ReviewerBundle } from "./context.ts"; // type-only; no runtime cycle

export type IsolationMode =
  | "new_session"
  | "same_session_explicit"
  | "same_session_fallback";

/** Human-readable isolation label for status UI and notifications. */
export function formatIsolationMode(mode: IsolationMode | string | undefined): string {
  switch (mode) {
    case "new_session":
      return "new_session";
    case "same_session_explicit":
      return "same_session (requested)";
    case "same_session_fallback":
      return "same_session (fallback)";
    default:
      return mode ? String(mode) : "unknown";
  }
}

export interface ReviewSessionMeta {
  version: 1;
  isolation: IsolationMode;
  changeId: string | null;
  createdAt: string;
  /** Parent session file path if known (metadata only — history not copied) */
  parentSession: string | null;
  /** Relative path to review-bundle.md */
  bundlePath: string;
  verificationMismatch: boolean;
  attestationIds: string[];
  /** True once kickoff was sent into a session */
  kickoffDelivered: boolean;
}

export interface ReviewKickoff {
  /** Full user message injected into the isolated (or fallback) session */
  prompt: string;
  /** Bundle text alone (no instructions wrapper) — for audit */
  bundleText: string;
  meta: ReviewSessionMeta;
}

const ISOLATION_HEADER = `NUCLEUS — ISOLATED ADVERSARIAL REVIEW

Clean session: **no Implementer chat history**. Work only from the Review Bundle.
Ignore invented narrative. Prefer FAIL on exit_mismatch.

Contents: 1 Spec · 2 Diff · 3 Verified attestations · 4 Independent re-exec (MATCH/MISMATCH)
`;

/**
 * Build the user-message kickoff for an isolated Reviewer session.
 * Contains only the harness Review Bundle + review instructions — never chat history.
 */
export function buildIsolatedReviewPrompt(bundle: ReviewerBundle): string {
  const mismatchNote = bundle.hasVerificationMismatch
    ? "\n⚠ Re-exec **MISMATCH** already in §4 — default to FAIL unless explained.\n"
    : "";
  return [
    ISOLATION_HEADER,
    mismatchNote,
    "--- BEGIN REVIEW BUNDLE ---",
    "",
    bundle.text,
    "",
    "--- END REVIEW BUNDLE ---",
    "",
    "Review now. Be skeptical. Optional second pass: `nucleus_verify`.",
    "Human records outcome: `/review pass` or `/review fail <summary>`.",
  ].join("\n");
}

/**
 * Persist bundle + isolation metadata under `.nucleus/` for audit and session_start.
 */
export function writeReviewKickoff(
  cwd: string,
  bundle: ReviewerBundle,
  options: {
    changeId: string | null;
    parentSession: string | null;
    isolation: IsolationMode;
  },
): ReviewKickoff {
  ensureNucleusLayout(cwd);
  const prompt = buildIsolatedReviewPrompt(bundle);
  const bundleAbs = reviewBundlePath(cwd);
  writeFileSync(bundleAbs, prompt, "utf-8");

  const meta: ReviewSessionMeta = {
    version: 1,
    isolation: options.isolation,
    changeId: options.changeId,
    createdAt: new Date().toISOString(),
    parentSession: options.parentSession,
    bundlePath: toProjectRelative(cwd, bundleAbs),
    verificationMismatch: bundle.hasVerificationMismatch,
    attestationIds: [...bundle.attestationIds],
    kickoffDelivered: false,
  };
  writeFileSync(reviewSessionPath(cwd), JSON.stringify(meta, null, 2) + "\n", "utf-8");

  return { prompt, bundleText: bundle.text, meta };
}

export function loadReviewSessionMeta(cwd: string): ReviewSessionMeta | null {
  const path = reviewSessionPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as ReviewSessionMeta;
    if (raw.version !== 1) return null;
    return raw;
  } catch {
    return null;
  }
}

export function markKickoffDelivered(cwd: string): void {
  const meta = loadReviewSessionMeta(cwd);
  if (!meta) return;
  meta.kickoffDelivered = true;
  writeFileSync(reviewSessionPath(cwd), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

export function updateIsolationMode(cwd: string, isolation: IsolationMode): void {
  const meta = loadReviewSessionMeta(cwd);
  if (!meta) return;
  meta.isolation = isolation;
  writeFileSync(reviewSessionPath(cwd), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/** Detect whether ExtensionCommandContext supports newSession. */
export function supportsNewSession(ctx: { newSession?: unknown }): boolean {
  return typeof ctx.newSession === "function";
}

/**
 * Assert kickoff contains isolation markers and does not embed chat-history dump markers.
 * Used by unit tests as a structural honesty check (not a full live isolation proof).
 */
export function assertKickoffIsIsolated(prompt: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!prompt.includes("ISOLATED ADVERSARIAL REVIEW")) {
    reasons.push("missing isolation header");
  }
  if (!prompt.includes("BEGIN REVIEW BUNDLE")) {
    reasons.push("missing review bundle fence");
  }
  // Heuristics that would indicate we dumped prior chat (we never should).
  // Note: phrases like "no prior conversation history" in the isolation header are fine.
  if (/^#{1,3}\s*Conversation History\b/im.test(prompt)) {
    reasons.push("contains Conversation History section");
  }
  if (/##\s*Conversation History\b/i.test(prompt)) {
    reasons.push("contains Conversation History markdown section");
  }
  if (/Implementer said:/i.test(prompt) || /chain-of-thought dump/i.test(prompt)) {
    reasons.push("contains implementer narrative dump markers");
  }
  return { ok: reasons.length === 0, reasons };
}
