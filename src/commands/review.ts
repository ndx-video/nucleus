/**
 * /review — Adversarial Reviewer with true session isolation (Phase 2.0).
 *
 * Preferred: ctx.newSession() → blank session → inject only Review Bundle.
 * Fallback: same-session injection if newSession unavailable/cancelled.
 *
 * Preserves Phase 1.1 HMAC gates and Phase 1.2 independent re-execution.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  countVerifiedAttestations,
  hasVerifiedAttestation,
} from "../attestation/index.ts";
import type { LoadConfigResult } from "../config.ts";
import { buildReviewerContext } from "../context.ts";
import {
  markKickoffDelivered,
  supportsNewSession,
  updateIsolationMode,
  writeReviewKickoff,
  type IsolationMode,
} from "../review-isolation.ts";
import { applyRole } from "../roles/index.ts";
import { loadState, saveState, setRole, transitionPhase } from "../state.ts";
import type { ReviewResult } from "../types.ts";

export function registerReviewCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("review", {
    description:
      "Isolated adversarial review (new session: Spec+Diff+Attestation+re-exec). Args: pass | fail | same",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      const trimmed = (args ?? "").trim();
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      if (sub === "pass" || sub === "fail") {
        await recordVerdict(pi, ctx, sub, parts.slice(1).join(" "));
        return;
      }

      // Force same-session hybrid isolation (debug / environments without newSession)
      const forceSameSession = sub === "same" || sub === "--same-session";

      const state = loadState(ctx.cwd);
      const storePath = configResult.config?.attestation.store_path;
      const verifiedCount = countVerifiedAttestations(ctx.cwd, storePath);
      const hasVerified = verifiedCount > 0;
      const rawCount = state.attestationIds.length;

      const attRequired = configResult.config?.attestation.required !== false;
      if (attRequired && !hasVerified) {
        const detail =
          rawCount > 0
            ? `Review blocked: ${rawCount} attestation id(s) in state but none pass integrity verification (forged/corrupt/missing). Produce a real nucleus_attest capture.`
            : "Review blocked: no verified attestation. Implementer must call nucleus_attest before /review.";
        ctx.ui.notify(detail, "error");
        pi.sendMessage({
          customType: "nucleus-review-blocked",
          content: detail,
          display: true,
        });
        return;
      }

      const phase = state.phase;
      const canStartReview =
        phase === "Attested" ||
        phase === "Reviewing" ||
        (phase === "Implementing" && hasVerified);

      if (!canStartReview) {
        ctx.ui.notify(
          `Cannot /review from phase ${phase}. Need Attested (after nucleus_attest with verified artifact).`,
          "error",
        );
        return;
      }

      // Advance phase + role on disk (survives session replacement)
      if (phase === "Implementing" && hasVerified) {
        transitionPhase(ctx.cwd, "Attested", {
          note: "verified attestation present before review",
        });
      }
      const s2 = loadState(ctx.cwd);
      if (s2.phase === "Attested") {
        transitionPhase(ctx.cwd, "Reviewing", {
          role: "reviewer",
          note: "adversarial review started (Phase 2.0 isolation)",
        });
      } else {
        setRole(ctx.cwd, "reviewer");
      }

      // Build bundle with independent re-execution BEFORE session switch
      // (plain data only survives into withSession)
      const bundle = await buildReviewerContext(ctx.cwd, configResult.config, {
        reverify: true,
      });

      if (!bundle.hasSpec) {
        ctx.ui.notify("Warning: no Spec content found for review.", "warning");
      }
      if (!bundle.hasAttestation) {
        ctx.ui.notify("Warning: no verified attestation artifacts found.", "warning");
      }
      if (bundle.hasVerificationMismatch) {
        ctx.ui.notify(
          "Independent re-execution mismatch detected — Reviewer should default to FAIL.",
          "warning",
        );
      }

      let parentSession: string | null = null;
      try {
        parentSession = ctx.sessionManager.getSessionFile() ?? null;
      } catch {
        parentSession = null;
      }

      const nextState = loadState(ctx.cwd);
      const preferIsolated = !forceSameSession && supportsNewSession(ctx);

      // Write kickoff assuming preferred mode; may update to fallback
      let isolation: IsolationMode = preferIsolated
        ? "new_session"
        : "same_session_fallback";
      const kickoff = writeReviewKickoff(ctx.cwd, bundle, {
        changeId: nextState.changeId,
        parentSession,
        isolation,
      });

      if (preferIsolated) {
        try {
          // Capture plain strings only — do not use old pi/ctx inside withSession
          const promptText = kickoff.prompt;
          const mismatch = bundle.hasVerificationMismatch;

          const result = await ctx.newSession({
            parentSession: parentSession ?? undefined,
            withSession: async (newCtx) => {
              // New extension instance already ran session_start (applies reviewer role/tools).
              // Inject ONLY the Review Bundle as the first user message.
              await newCtx.sendUserMessage(promptText);
              markKickoffDelivered(newCtx.cwd);
              newCtx.ui.notify(
                "Nucleus: isolated Reviewer session — Spec+Diff+Attestation+re-exec only (no Implementer history)",
                "info",
              );
              if (mismatch) {
                newCtx.ui.notify(
                  "Independent re-execution mismatch — default to FAIL unless explained",
                  "warning",
                );
              }
            },
          });

          if (result.cancelled) {
            isolation = "same_session_fallback";
            updateIsolationMode(ctx.cwd, isolation);
            await injectSameSession(pi, ctx, configResult, kickoff.prompt, isolation);
            return;
          }

          // Successfully switched — old session runtime is gone; do not use old pi.
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          isolation = "same_session_fallback";
          updateIsolationMode(ctx.cwd, isolation);
          ctx.ui.notify(
            `Isolated newSession failed (${msg}); falling back to same-session review.`,
            "warning",
          );
          await injectSameSession(pi, ctx, configResult, kickoff.prompt, isolation);
          return;
        }
      }

      // Forced same-session or no newSession API
      await injectSameSession(pi, ctx, configResult, kickoff.prompt, isolation);
    },
  });
}

async function injectSameSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  configResult: LoadConfigResult,
  prompt: string,
  isolation: IsolationMode,
): Promise<void> {
  updateIsolationMode(ctx.cwd, isolation);
  const roleResult = await applyRole(pi, ctx, "reviewer", configResult);
  ctx.ui.notify(
    `Nucleus: ${isolation === "same_session_fallback" ? "same-session fallback" : isolation} review (hybrid isolation — residual history may remain)`,
    "warning",
  );
  ctx.ui.notify(roleResult.message, roleResult.modelApplied ? "info" : "warning");
  pi.sendUserMessage(prompt);
  markKickoffDelivered(ctx.cwd);
}

async function recordVerdict(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  verdict: "pass" | "fail",
  findingsText: string,
): Promise<void> {
  const state = loadState(ctx.cwd);
  if (state.phase !== "Reviewing" && state.phase !== "Attested") {
    ctx.ui.notify(
      `Cannot record review verdict in phase ${state.phase}. Start /review first.`,
      "error",
    );
    return;
  }

  if (state.phase === "Attested") {
    transitionPhase(ctx.cwd, "Reviewing", { role: "reviewer", note: "late review record" });
  }

  const findings = findingsText
    ? findingsText.split(/;\s*/).map((s) => s.trim()).filter(Boolean)
    : verdict === "pass"
      ? ["No blocking findings recorded"]
      : ["Unspecified failure — see review conversation"];

  const result: ReviewResult = {
    verdict,
    findings,
    reviewedAt: new Date().toISOString(),
    reviewerModel: undefined,
  };

  const s = loadState(ctx.cwd);
  s.reviewResult = result;
  saveState(ctx.cwd, s);

  if (verdict === "pass") {
    transitionPhase(ctx.cwd, "Accepted", {
      note: "review pass",
      reviewResult: result,
    });
    ctx.ui.notify("Review PASS → Accepted", "info");
    pi.sendMessage({
      customType: "nucleus-review",
      content: `Review PASS. Phase: Accepted.\nFindings:\n${findings.map((f) => `- ${f}`).join("\n")}\n\nOptional: /retro`,
      display: true,
      details: result,
    });
  } else {
    transitionPhase(ctx.cwd, "Rejected", {
      note: "review fail",
      reviewResult: result,
    });
    ctx.ui.notify("Review FAIL → Rejected", "warning");
    pi.sendMessage({
      customType: "nucleus-review",
      content: `Review FAIL. Phase: Rejected.\nFindings:\n${findings.map((f) => `- ${f}`).join("\n")}\n\nFix via /implement (re-enter Implementing) or revise /spec.`,
      display: true,
      details: result,
    });
  }
}

export { hasVerifiedAttestation };
