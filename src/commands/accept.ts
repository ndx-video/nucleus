/**
 * /accept — mark change accepted after review pass or explicit human override.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { hasVerifiedAttestation } from "../attestation/index.ts";
import type { LoadConfigResult } from "../config.ts";
import { loadState, transitionPhase } from "../state.ts";

export function registerAcceptCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("accept", {
    description:
      "Mark change accepted (after review pass, or override: /accept override <reason>)",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const trimmed = (args ?? "").trim();
      const state = loadState(ctx.cwd);
      const storePath = getConfig().config?.attestation.store_path;
      const hasVerified = hasVerifiedAttestation(ctx.cwd, storePath);

      // Already accepted
      if (state.phase === "Accepted") {
        ctx.ui.notify("Change already Accepted.", "info");
        return;
      }

      const isOverride = /^override\b/i.test(trimmed);
      const overrideReason = isOverride
        ? trimmed.replace(/^override\s*/i, "").trim() || "unspecified human override"
        : null;

      if (state.phase === "Reviewing") {
        if (state.reviewResult?.verdict === "pass") {
          transitionPhase(ctx.cwd, "Accepted", {
            note: "accept after review pass",
            reviewResult: state.reviewResult,
          });
        } else if (isOverride) {
          transitionPhase(ctx.cwd, "Accepted", {
            note: `human override: ${overrideReason}`,
            overrideReason,
          });
        } else {
          ctx.ui.notify(
            "Review not passed. Use `/review pass`, or `/accept override <reason>` to force.",
            "error",
          );
          return;
        }
      } else if (state.phase === "Attested" || state.phase === "Implementing") {
        if (!isOverride) {
          ctx.ui.notify(
            `Phase is ${state.phase}. Run /review first, or \`/accept override <reason>\`.`,
            "error",
          );
          return;
        }
        // Must go Attested → Reviewing → Accepted for legal transitions,
        // or we allow override path only from Reviewing. Force through Reviewing.
        if (state.phase === "Implementing" && hasVerified) {
          transitionPhase(ctx.cwd, "Attested", { note: "override path" });
        }
        let s = loadState(ctx.cwd);
        if (s.phase === "Implementing") {
          ctx.ui.notify(
            "Cannot accept without attestation. Produce nucleus_attest first, or override from Reviewing.",
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
        }
      } else if (state.phase === "Rejected" && isOverride) {
        // Rejected → Implementing is allowed, not directly Accepted.
        // Human override from Rejected: go Implementing? No — user wants accept.
        // Record note and force via a path: not in transitions. Be honest and refuse.
        ctx.ui.notify(
          "Cannot accept a Rejected change directly. Re-implement (/implement) and re-review, or start a new /spec.",
          "error",
        );
        return;
      } else {
        ctx.ui.notify(
          `Cannot /accept from phase ${state.phase}. Complete the honesty loop or use override from reviewable phases.`,
          "error",
        );
        return;
      }

      const final = loadState(ctx.cwd);
      if (final.phase !== "Accepted") {
        ctx.ui.notify(`Accept failed; phase is still ${final.phase}.`, "error");
        return;
      }

      const msg = final.overrideReason
        ? `Accepted with HUMAN OVERRIDE: ${final.overrideReason}`
        : "Accepted after review.";
      ctx.ui.notify(msg, "info");
      pi.sendMessage({
        customType: "nucleus-accept",
        content: `${msg}\nPhase: Accepted · change ${final.changeId}\nOptional: /retro`,
        display: true,
      });
    },
  });
}
