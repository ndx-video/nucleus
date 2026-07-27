/**
 * /spec — create or refine a Nucleus Spec (Planner role).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { LoadConfigResult } from "../config.ts";
import { SPEC_TEMPLATE } from "../context.ts";
import {
  defaultSpecPath,
  ensureNucleusLayout,
  toProjectRelative,
} from "../paths.ts";
import { applyRole } from "../roles/index.ts";
import {
  ensureChangeId,
  loadState,
  saveState,
  transitionPhase,
} from "../state.ts";

export function registerSpecCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("spec", {
    description: "Create or refine a Nucleus Spec (Planner). Args: approve | new | <path>",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      ensureNucleusLayout(ctx.cwd, configResult.config?.attestation.store_path);

      const trimmed = (args ?? "").trim();
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      // /spec approve — mark SpecApproved
      if (sub === "approve") {
        await handleApprove(pi, ctx);
        return;
      }

      // Switch to planner
      const roleResult = await applyRole(pi, ctx, "planner", configResult);

      // Start or continue a draft
      let state = loadState(ctx.cwd);
      if (state.phase === "Accepted" || state.phase === "Rejected") {
        try {
          transitionPhase(ctx.cwd, "idle", { note: "new change after terminal phase" });
        } catch {
          /* ignore if not allowed */
        }
        state = loadState(ctx.cwd);
      }
      if (state.phase === "idle") {
        transitionPhase(ctx.cwd, "SpecDraft", {
          startNewChange: true,
          role: "planner",
          note: "spec draft started",
        });
      } else if (state.phase !== "SpecDraft" && state.phase !== "SpecApproved") {
        ctx.ui.notify(
          `Current phase is ${state.phase}. Refining spec may require reject/restart. Continuing in Planner role.`,
          "warning",
        );
      }

      state = ensureChangeId(ctx.cwd);

      // Resolve spec path
      let specAbs = state.specPath
        ? resolve(ctx.cwd, state.specPath)
        : defaultSpecPath(ctx.cwd);

      if (sub === "new") {
        ensureNucleusLayout(ctx.cwd);
        specAbs = defaultSpecPath(ctx.cwd);
        writeFileSync(specAbs, SPEC_TEMPLATE, "utf-8");
      } else if (sub && sub !== "approve") {
        specAbs = resolve(ctx.cwd, trimmed);
        if (!existsSync(specAbs)) {
          writeFileSync(specAbs, SPEC_TEMPLATE, "utf-8");
        }
      } else if (!existsSync(specAbs)) {
        ensureNucleusLayout(ctx.cwd);
        writeFileSync(specAbs, SPEC_TEMPLATE, "utf-8");
      }

      const rel = toProjectRelative(ctx.cwd, specAbs);
      state = loadState(ctx.cwd);
      state.specPath = rel;
      state.role = "planner";
      saveState(ctx.cwd, state);

      const specContent = existsSync(specAbs)
        ? readFileSync(specAbs, "utf-8")
        : SPEC_TEMPLATE;

      const prompt = [
        "You are the Planner. Create or refine the Nucleus Spec.",
        "",
        `Spec path: ${rel}`,
        `Change: ${state.changeId}`,
        `Phase: ${state.phase}`,
        "",
        "Required sections: Goal, Constraints, Acceptance Criteria (testable), Out-of-Scope, Decision Log / Open Questions.",
        "Keep it lean. When the human is satisfied, run `/spec approve`.",
        "",
        "Current spec content:",
        "```markdown",
        specContent,
        "```",
        "",
        "Edit the file on disk as needed. Ask clarifying questions before filling assumptions.",
      ].join("\n");

      ctx.ui.notify(roleResult.message, roleResult.modelApplied ? "info" : "warning");
      pi.sendUserMessage(prompt);
    },
  });
}

async function handleApprove(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const state = loadState(ctx.cwd);
  if (!state.specPath || !existsSync(resolve(ctx.cwd, state.specPath))) {
    ctx.ui.notify("No spec file on disk. Run /spec first to create one.", "error");
    return;
  }

  if (state.phase === "SpecApproved") {
    ctx.ui.notify(`Spec already approved · ${state.specPath}`, "info");
    return;
  }

  if (state.phase === "idle") {
    transitionPhase(ctx.cwd, "SpecDraft", {
      startNewChange: !state.changeId,
      role: "planner",
      note: "draft opened for approve",
      specPath: state.specPath,
    });
    // re-apply spec path after startNewChange may clear it
    const s = loadState(ctx.cwd);
    s.specPath = state.specPath;
    saveState(ctx.cwd, s);
  }

  const s2 = loadState(ctx.cwd);
  if (s2.phase !== "SpecDraft" && s2.phase !== "SpecApproved") {
    ctx.ui.notify(
      `Cannot approve spec in phase ${s2.phase}. Allowed from SpecDraft.`,
      "error",
    );
    return;
  }

  if (s2.phase === "SpecDraft") {
    transitionPhase(ctx.cwd, "SpecApproved", {
      role: "planner",
      note: "human approved spec",
    });
  }

  const final = loadState(ctx.cwd);
  ctx.ui.notify(`Spec approved · next: /implement`, "info");
  pi.sendMessage({
    customType: "nucleus-spec",
    content: `Spec approved (${final.specPath}). Phase: SpecApproved. Next: /implement`,
    display: true,
  });
}
