/**
 * /implement — hand approved Spec to Implementer (model + tools + context).
 */

import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { LoadConfigResult } from "../config.ts";
import { safeResolveSpecPath } from "./spec.ts";
import { findAdoptableDefaultSpec } from "../specs.ts";
import { applyRole } from "../roles/index.ts";
import { loadState, saveState, transitionPhase } from "../state.ts";

export function registerImplementCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("implement", {
    description: "Hand approved Spec to Implementer (switch model + inject context)",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      let state = loadState(ctx.cwd);
      const phase = state.phase;

      const allowed: typeof phase[] = ["SpecApproved", "Implementing", "Rejected"];
      if (!allowed.includes(phase)) {
        if (phase === "Attested" || phase === "Reviewing") {
          ctx.ui.notify(
            `Cannot /implement in ${phase}. Use /review (or /review fail then /implement).`,
            "error",
          );
          return;
        }
        if (phase === "Accepted") {
          ctx.ui.notify("Change already Accepted. Start a new change with /spec.", "error");
          return;
        }
        // Common footgun: Spec file exists but never /spec approve
        const orphan = findAdoptableDefaultSpec(ctx.cwd);
        if (phase === "idle" || phase === "SpecDraft") {
          ctx.ui.notify(
            orphan
              ? `Cannot /implement in ${phase}. Spec file exists at ${orphan.relPath} — run /spec approve first.`
              : `Cannot /implement in ${phase}. Next: /spec then /spec approve.`,
            "error",
          );
          return;
        }
        ctx.ui.notify(
          `Cannot /implement in ${phase}. Next: /spec then /spec approve.`,
          "error",
        );
        return;
      }

      let specAbs = safeResolveSpecPath(ctx.cwd, state.specPath);
      if (!state.specPath || !specAbs || !existsSync(specAbs)) {
        const adoptable = findAdoptableDefaultSpec(ctx.cwd);
        if (adoptable && phase === "SpecApproved") {
          state.specPath = adoptable.relPath;
          saveState(ctx.cwd, state);
          specAbs = adoptable.absPath;
          ctx.ui.notify(`Adopted Spec at ${adoptable.relPath}.`, "info");
        } else {
          ctx.ui.notify("No Spec on disk. Run /spec, then /spec approve.", "error");
          return;
        }
      }

      if (phase === "SpecApproved" || phase === "Rejected") {
        transitionPhase(ctx.cwd, "Implementing", {
          role: "implementer",
          note: "implement started",
          clearAttestations: phase === "Rejected",
          reviewResult: phase === "Rejected" ? null : undefined,
        });
      }

      const roleResult = await applyRole(pi, ctx, "implementer", configResult);
      const next = loadState(ctx.cwd);
      const nextAbs = safeResolveSpecPath(ctx.cwd, next.specPath) ?? specAbs;
      const specBody = readFileSync(nextAbs, "utf-8");

      const prompt = [
        "You are the Implementer. Faithfulness to the Spec only.",
        "",
        `Change: ${next.changeId}`,
        `Phase: ${next.phase}`,
        `Spec: ${next.specPath}`,
        "",
        "## Spec",
        "",
        specBody,
        "",
        "## Rules",
        "",
        "1. Implement only what the Spec requires. No scope drift.",
        "2. After making changes, run verification via **nucleus_attest** (not bare bash claims).",
        "   Example: call nucleus_attest with command like `npm test` or the project's check command.",
        "3. Never claim tests passed without a real attestation artifact under `.nucleus/attestations/`.",
        "4. When done and attested, the human (or you) must run **`/review`** (slash command).",
        "5. After review: **`/review pass`** or **`/accept`** — not bare `/accept` while phase is still Attested.",
        "   Chat-only “I reviewed it” does not advance the honesty phase.",
        "",
        "Begin by confirming you understand the Acceptance Criteria, then implement.",
      ].join("\n");

      // Quiet success: one notify + kickoff message
      ctx.ui.notify(
        roleResult.modelApplied
          ? `Implementer · ${next.phase} · ${next.specPath}`
          : roleResult.message,
        roleResult.modelApplied ? "info" : "warning",
      );
      pi.sendUserMessage(prompt);
    },
  });
}
