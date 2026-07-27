/**
 * /implement — hand approved Spec to Implementer (model + tools + context).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { LoadConfigResult } from "../config.ts";
import { applyRole } from "../roles/index.ts";
import { loadState, transitionPhase } from "../state.ts";

export function registerImplementCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("implement", {
    description: "Hand approved Spec to Implementer (switch model + inject context)",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      const state = loadState(ctx.cwd);
      const phase = state.phase;

      const allowed: typeof phase[] = ["SpecApproved", "Implementing", "Rejected"];
      if (!allowed.includes(phase)) {
        if (phase === "Attested" || phase === "Reviewing") {
          ctx.ui.notify(
            `Phase is ${phase}. Use /review or reject first. To re-implement after reject, phase must be Rejected or SpecApproved.`,
            "error",
          );
          return;
        }
        ctx.ui.notify(
          `Cannot /implement from phase ${phase}. Approve a spec first (/spec approve).`,
          "error",
        );
        return;
      }

      if (!state.specPath || !existsSync(resolve(ctx.cwd, state.specPath))) {
        ctx.ui.notify("No approved spec on disk. Run /spec and /spec approve first.", "error");
        return;
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
      const specBody = readFileSync(resolve(ctx.cwd, next.specPath!), "utf-8");

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
        "4. When done and attested, tell the human to run `/review`.",
        "",
        "Begin by confirming you understand the Acceptance Criteria, then implement.",
      ].join("\n");

      ctx.ui.notify(roleResult.message, roleResult.modelApplied ? "info" : "warning");
      pi.sendUserMessage(prompt);
    },
  });
}
