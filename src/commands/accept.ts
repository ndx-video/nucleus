/**
 * /accept — mark change accepted after review, or with human override.
 *
 * Design (post-feedback):
 * - From **Reviewing**: bare `/accept` records a review PASS and accepts
 *   (same outcome as `/review pass`). Agents naturally say “safe to accept.”
 * - From **Attested**: review harness was never started (phase never left Attested).
 *   Point them at `/review` then `/review pass`, or allow `/review pass` as a
 *   late record, or `/accept override <reason>` to skip review.
 * - `/review pass` still works from Attested (late record) for convenience.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { hasVerifiedAttestation } from "../attestation/index.ts";
import type { LoadConfigResult } from "../config.ts";
import { archiveOnAccept } from "../specs.ts";
import { loadState, saveState, transitionPhase } from "../state.ts";
import type { ReviewResult } from "../types.ts";

function buildPassResult(findings: string[]): ReviewResult {
  return {
    verdict: "pass",
    findings,
    reviewedAt: new Date().toISOString(),
  };
}

function finishAccepted(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  opts: { overrideReason?: string | null; via: string },
): void {
  const final = loadState(ctx.cwd);
  if (final.phase !== "Accepted") {
    ctx.ui.notify(`Accept failed; phase is still ${final.phase}.`, "error");
    return;
  }

  let archived: string | null = null;
  try {
    archived = archiveOnAccept(ctx.cwd);
  } catch {
    archived = null;
  }

  const msg = final.overrideReason
    ? `Accepted with HUMAN OVERRIDE: ${final.overrideReason}`
    : `Accepted (${opts.via}).`;
  const archiveNote = archived
    ? `\nSpec archived → \`${archived}\`\nNext change: /spec (writes a fresh current.md)`
    : `\nNext change: /spec (starts a new Spec draft)`;
  ctx.ui.notify(archived ? `Accepted · Spec archived` : msg, "info");
  pi.sendMessage({
    customType: "nucleus-accept",
    content: `${msg}\nPhase: Accepted · change ${final.changeId}${archiveNote}\nOptional: /retro`,
    display: true,
    details: {
      archivedSpec: archived,
      changeId: final.changeId,
      via: opts.via,
    },
  });
}

export function registerAcceptCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("accept", {
    description:
      "Accept change after review (/accept), or skip review: /accept override <reason>",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const trimmed = (args ?? "").trim();
      const state = loadState(ctx.cwd);
      const storePath = getConfig().config?.attestation.store_path;
      const hasVerified = hasVerifiedAttestation(ctx.cwd, storePath);
      const attRequired = getConfig().config?.attestation.required !== false;

      if (state.phase === "Accepted") {
        ctx.ui.notify("Already Accepted. /spec to start a new change.", "info");
        return;
      }

      const isOverride = /^override\b/i.test(trimmed);
      const overrideReason = isOverride
        ? trimmed.replace(/^override\s*/i, "").trim() || "unspecified human override"
        : null;

      // ── Reviewing: bare /accept == review pass (agent-natural) ─────────
      if (state.phase === "Reviewing") {
        if (state.reviewResult?.verdict === "fail") {
          ctx.ui.notify(
            "Last recorded review was FAIL. Use /implement to fix, or /accept override <reason>.",
            "error",
          );
          return;
        }
        if (state.reviewResult?.verdict === "pass") {
          transitionPhase(ctx.cwd, "Accepted", {
            note: "accept after recorded review pass",
            reviewResult: state.reviewResult,
          });
          finishAccepted(pi, ctx, { via: "review pass already recorded" });
          return;
        }
        if (isOverride) {
          transitionPhase(ctx.cwd, "Accepted", {
            note: `human override: ${overrideReason}`,
            overrideReason,
          });
          finishAccepted(pi, ctx, { overrideReason, via: "override while Reviewing" });
          return;
        }
        if (attRequired && !hasVerified) {
          ctx.ui.notify(
            "Cannot accept: no verified attestation. Run nucleus_attest, then /review.",
            "error",
          );
          return;
        }
        // Implicit pass — same as /review pass after a review session
        const result = buildPassResult([
          "Accepted via /accept after Reviewing (equivalent to /review pass)",
        ]);
        const s = loadState(ctx.cwd);
        s.reviewResult = result;
        saveState(ctx.cwd, s);
        transitionPhase(ctx.cwd, "Accepted", {
          note: "accept after review session",
          reviewResult: result,
        });
        finishAccepted(pi, ctx, { via: "/accept while Reviewing" });
        return;
      }

      // ── Attested / Implementing: review not started (or not finished) ──
      if (state.phase === "Attested" || state.phase === "Implementing") {
        if (isOverride) {
          if (state.phase === "Implementing" && hasVerified) {
            transitionPhase(ctx.cwd, "Attested", { note: "override path" });
          }
          let s = loadState(ctx.cwd);
          if (s.phase === "Implementing") {
            ctx.ui.notify(
              "Cannot accept without attestation. nucleus_attest first, or stay on override only after Attested.",
              "error",
            );
            return;
          }
          if (s.phase === "Attested") {
            transitionPhase(ctx.cwd, "Reviewing", {
              note: "override skip review",
              role: "planner",
            });
          }
          s = loadState(ctx.cwd);
          if (s.phase === "Reviewing") {
            transitionPhase(ctx.cwd, "Accepted", {
              note: `human override: ${overrideReason}`,
              overrideReason,
            });
            finishAccepted(pi, ctx, { overrideReason, via: "override from Attested" });
          }
          return;
        }

        // Not override — explain the real gate (this was the confusing error)
        const detail =
          state.phase === "Attested"
            ? [
                "Cannot /accept yet — phase is still **Attested** (harness never entered Reviewing).",
                "That usually means `/review` was not run as a slash command (conversational “review” does not advance the phase).",
                "",
                "Next:",
                "  1. `/review` — start isolated Reviewer (required for honesty loop)",
                "  2. Finish review, then `/review pass` or `/accept`",
                "",
                "If you already reviewed in chat and only need to record pass: `/review pass`",
                "To skip review entirely: `/accept override <reason>`",
              ].join("\n")
            : [
                "Cannot /accept in Implementing.",
                "Run nucleus_attest (→ Attested), then /review, then /review pass or /accept.",
                "Or `/accept override <reason>` only after you have attestation and still skip review.",
              ].join("\n");

        ctx.ui.notify(
          state.phase === "Attested"
            ? "Cannot /accept in Attested — run /review first (then /review pass or /accept)."
            : "Cannot /accept in Implementing — attest, then /review.",
          "error",
        );
        pi.sendMessage({
          customType: "nucleus-accept-blocked",
          content: detail,
          display: true,
        });
        return;
      }

      if (state.phase === "Rejected" && isOverride) {
        ctx.ui.notify(
          "Cannot accept a Rejected change directly. /implement and re-review, or /spec.",
          "error",
        );
        return;
      }

      ctx.ui.notify(
        `Cannot /accept from ${state.phase}. Complete Spec → Implement → Attest → /review → /accept (or /review pass).`,
        "error",
      );
    },
  });
}
