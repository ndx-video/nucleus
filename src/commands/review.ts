/**
 * /review — launch Adversarial Reviewer with Spec + Diff + verified Attestation
 * + independent re-execution (Phase 1.2).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  countVerifiedAttestations,
  hasVerifiedAttestation,
} from "../attestation/index.ts";
import type { LoadConfigResult } from "../config.ts";
import { buildReviewerContext } from "../context.ts";
import { applyRole } from "../roles/index.ts";
import { loadState, saveState, transitionPhase } from "../state.ts";
import type { ReviewResult } from "../types.ts";

export function registerReviewCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("review", {
    description:
      "Adversarial review (Spec+Diff+verified Attestation+re-exec). Args: pass | fail [findings...] | (none = start review)",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      const trimmed = (args ?? "").trim();
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      if (sub === "pass" || sub === "fail") {
        await recordVerdict(pi, ctx, sub, parts.slice(1).join(" "));
        return;
      }

      const state = loadState(ctx.cwd);
      const storePath = configResult.config?.attestation.store_path;
      const verifiedCount = countVerifiedAttestations(ctx.cwd, storePath);
      const hasVerified = verifiedCount > 0;
      const rawCount = state.attestationIds.length;

      // Gate: need at least one integrity-verified attestation when required
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

      // Advance to Reviewing only when a verified attestation exists
      if (phase === "Implementing" && hasVerified) {
        transitionPhase(ctx.cwd, "Attested", {
          note: "verified attestation present before review",
        });
      }
      const s2 = loadState(ctx.cwd);
      if (s2.phase === "Attested") {
        transitionPhase(ctx.cwd, "Reviewing", {
          role: "reviewer",
          note: "adversarial review started (with independent re-exec)",
        });
      }

      const roleResult = await applyRole(pi, ctx, "reviewer", configResult);

      // Default: harness re-executes attested commands into the bundle
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

      const prompt = [
        bundle.text,
        "",
        "---",
        "Perform the adversarial review now. Be skeptical.",
        "Independent re-execution results are already in the bundle (section 4).",
        "You may call `nucleus_verify` for a second pass if needed.",
        "When finished, the human can record the outcome with `/review pass` or `/review fail <summary>`.",
      ].join("\n");

      ctx.ui.notify(roleResult.message, roleResult.modelApplied ? "info" : "warning");
      pi.sendUserMessage(prompt);
    },
  });
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

// re-export for tests
export { hasVerifiedAttestation };
