/**
 * /review — launch Adversarial Reviewer with Spec + Diff + Attestation only.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
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
      "Adversarial review (Spec+Diff+Attestation). Args: pass | fail [findings...] | (none = start review)",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      const trimmed = (args ?? "").trim();
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      // Record verdict: /review pass | /review fail ...
      if (sub === "pass" || sub === "fail") {
        await recordVerdict(pi, ctx, sub, parts.slice(1).join(" "));
        return;
      }

      const state = loadState(ctx.cwd);

      // Gate: need attestation when required
      const attRequired = configResult.config?.attestation.required !== false;
      if (attRequired && state.attestationIds.length === 0) {
        ctx.ui.notify(
          "No attestation recorded. Implementer must call nucleus_attest before /review.",
          "error",
        );
        pi.sendMessage({
          customType: "nucleus-review-blocked",
          content:
            "Review blocked: attestation required. Run verification with nucleus_attest, then /review.",
          display: true,
        });
        return;
      }

      const phase = state.phase;
      const canStartReview =
        phase === "Attested" ||
        phase === "Reviewing" ||
        (phase === "Implementing" && state.attestationIds.length > 0);

      if (!canStartReview) {
        ctx.ui.notify(
          `Cannot /review from phase ${phase}. Need Attested (after nucleus_attest).`,
          "error",
        );
        return;
      }

      // Advance to Reviewing
      if (phase === "Implementing" && state.attestationIds.length > 0) {
        transitionPhase(ctx.cwd, "Attested", { note: "attestation present before review" });
      }
      const s2 = loadState(ctx.cwd);
      if (s2.phase === "Attested") {
        transitionPhase(ctx.cwd, "Reviewing", {
          role: "reviewer",
          note: "adversarial review started",
        });
      }

      const roleResult = await applyRole(pi, ctx, "reviewer", configResult);
      const bundle = buildReviewerContext(ctx.cwd, configResult.config);

      if (!bundle.hasSpec) {
        ctx.ui.notify("Warning: no Spec content found for review.", "warning");
      }
      if (!bundle.hasAttestation) {
        ctx.ui.notify("Warning: no valid attestation artifacts found.", "warning");
      }

      // Inject restricted context as the user message that starts the review turn.
      // Phase 1 hybrid: same session, but we replace the "working set" via a clean
      // review bundle rather than relying on Implementer chat history.
      const prompt = [
        bundle.text,
        "",
        "---",
        "Perform the adversarial review now. Be skeptical.",
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
