/**
 * /retro — Socratic interview that writes improvements into project rules.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { LoadConfigResult } from "../config.ts";
import { applyRole } from "../roles/index.ts";
import { loadState } from "../state.ts";

const RETRO_QUESTIONS = `
## Socratic Retro Questions

1. What almost went wrong (fabrication risk, scope drift, unclear Spec)?
2. Where did attestation help — or fail to catch a lie?
3. Did the Reviewer have enough (Spec + Diff + Attestation)? What was missing?
4. Which project rule or skill would have prevented the failure if it already existed?
5. What single deterministic rule should we write back into AGENTS.md or skills/ now?

When the human answers, propose **concrete** edits (unified-diff style or exact file snippets).
Only write changes the human approves. Prefer AGENTS.md, skills/, or prompts/ — not silent behavior changes.
`.trim();

export function registerRetroCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("retro", {
    description: "Socratic retro → propose deterministic improvements to project rules",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      const state = loadState(ctx.cwd);
      const roleResult = await applyRole(pi, ctx, "planner", configResult);

      // Optional: write a retro log stub
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "log") {
        const logPath = resolve(ctx.cwd, ".nucleus/retro-log.md");
        const entry = [
          "",
          `## Retro ${new Date().toISOString()}`,
          "",
          `- changeId: ${state.changeId ?? "(none)"}`,
          `- phase: ${state.phase}`,
          `- review: ${state.reviewResult?.verdict ?? "(none)"}`,
          "",
        ].join("\n");
        if (existsSync(logPath)) {
          writeFileSync(logPath, readFileSync(logPath, "utf-8") + entry, "utf-8");
        } else {
          writeFileSync(logPath, `# Nucleus Retro Log\n${entry}`, "utf-8");
        }
        ctx.ui.notify(`Appended retro stub to ${logPath}`, "info");
      }

      const agentsPath = resolve(ctx.cwd, "AGENTS.md");
      const hasAgents = existsSync(agentsPath);

      const prompt = [
        "You are facilitating a Nucleus Socratic Retro.",
        "Goal: turn this session's honesty failures (or near-misses) into **deterministic** project rules.",
        "",
        `Current phase: ${state.phase}`,
        `Change: ${state.changeId ?? "(none)"}`,
        `Review: ${state.reviewResult ? `${state.reviewResult.verdict} — ${state.reviewResult.findings.join("; ")}` : "(none)"}`,
        `Override: ${state.overrideReason ?? "(none)"}`,
        `AGENTS.md present: ${hasAgents}`,
        "",
        RETRO_QUESTIONS,
        "",
        "Interview the human one question at a time. Do not invent answers.",
        "After sufficient answers, propose specific file edits. Wait for approval before writing.",
      ].join("\n");

      ctx.ui.notify(
        roleResult.modelApplied ? "Retro · Planner" : roleResult.message,
        roleResult.modelApplied ? "info" : "warning",
      );
      pi.sendUserMessage(prompt);
    },
  });
}
