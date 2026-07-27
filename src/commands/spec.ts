/**
 * /spec — create or refine a Nucleus Spec (Planner role).
 *
 * Args:
 *   (none)     — open/create default .nucleus/specs/current.md
 *   approve    — SpecDraft → SpecApproved
 *   new        — reset default template
 *   <path.md>  — only a short path-like token is treated as a file path
 *   <free text>— treated as planner context / goal hint (NOT a path)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

/** Linux NAME_MAX is typically 255; keep path args well under that. */
const MAX_SPEC_PATH_CHARS = 200;
/** Full resolved path safety bound (PATH_MAX is 4096; stay conservative). */
const MAX_RESOLVED_PATH_CHARS = 1024;

/**
 * True only when `arg` looks like an intentional relative/absolute file path,
 * not a free-text goal description.
 */
export function isSpecPathArg(arg: string): boolean {
  const t = arg.trim();
  if (!t || t.length > MAX_SPEC_PATH_CHARS) return false;
  if (/[\n\r\0]/.test(t)) return false;
  // multi-sentence / prose heuristics
  if (/\s{2,}/.test(t)) return false;
  if ((t.match(/\s/g) ?? []).length > 3) return false; // more than 4 path segments with spaces → prose
  if (/[.!?]\s+[A-Z]/.test(t)) return false;
  // must look path-like: slash, or ends with .md/.markdown, or single simple token
  if (t.includes("/") || t.includes("\\")) return true;
  if (/\.(md|markdown|txt)$/i.test(t)) return true;
  // single bare token without spaces → allow (e.g. SPECS.md)
  if (!/\s/.test(t) && t.length <= 64) return true;
  return false;
}

export function safeResolveSpecPath(
  cwd: string,
  candidate: string | null | undefined,
): string | null {
  if (!candidate || !candidate.trim()) return null;
  if (candidate.length > MAX_SPEC_PATH_CHARS) return null;
  if (/[\n\r\0]/.test(candidate)) return null;
  try {
    const abs = resolve(cwd, candidate);
    if (abs.length > MAX_RESOLVED_PATH_CHARS) return null;
    // reject if any path segment is absurdly long (NAME_MAX)
    const parts = abs.split(/[/\\]/);
    if (parts.some((p) => p.length > 240)) return null;
    return abs;
  } catch {
    return null;
  }
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeTemplate(filePath: string): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, SPEC_TEMPLATE, "utf-8");
}

export function registerSpecCommand(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  pi.registerCommand("spec", {
    description:
      "Create or refine a Nucleus Spec (Planner). Args: approve | new | <path.md> | <goal text>",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const configResult = getConfig();
      ensureNucleusLayout(ctx.cwd, configResult.config?.attestation.store_path);

      const trimmed = (args ?? "").trim();
      const sub = trimmed.split(/\s+/).filter(Boolean)[0]?.toLowerCase();

      if (sub === "approve") {
        await handleApprove(pi, ctx);
        return;
      }

      const roleResult = await applyRole(pi, ctx, "planner", configResult);

      let state = loadState(ctx.cwd);
      if (state.phase === "Accepted" || state.phase === "Rejected") {
        try {
          transitionPhase(ctx.cwd, "idle", { note: "new change after terminal phase" });
        } catch {
          /* ignore */
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
          `Phase is ${state.phase}. Continuing in Planner; approve/reject path may be needed later.`,
          "warning",
        );
      }

      state = ensureChangeId(ctx.cwd);

      // Free-text goal vs path: never treat long prose as a filesystem path (ENAMETOOLONG).
      let goalHint: string | null = null;
      let pathArg: string | null = null;
      if (sub === "new") {
        pathArg = null;
      } else if (trimmed && isSpecPathArg(trimmed)) {
        pathArg = trimmed;
      } else if (trimmed) {
        goalHint = trimmed;
      }

      let specAbs =
        safeResolveSpecPath(ctx.cwd, state.specPath) ?? defaultSpecPath(ctx.cwd);

      try {
        if (sub === "new") {
          ensureNucleusLayout(ctx.cwd);
          specAbs = defaultSpecPath(ctx.cwd);
          writeTemplate(specAbs);
        } else if (pathArg) {
          const resolved = safeResolveSpecPath(ctx.cwd, pathArg);
          if (!resolved) {
            ctx.ui.notify(
              "Spec path too long or invalid. Use a short path like .nucleus/specs/foo.md, or omit the path.",
              "error",
            );
            return;
          }
          specAbs = resolved;
          if (!existsSync(specAbs)) {
            writeTemplate(specAbs);
          }
        } else if (!existsSync(specAbs)) {
          ensureNucleusLayout(ctx.cwd);
          // If prior state.specPath was invalid/oversized, fall back to default
          if (!safeResolveSpecPath(ctx.cwd, state.specPath)) {
            specAbs = defaultSpecPath(ctx.cwd);
          }
          writeTemplate(specAbs);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(
          `Could not open/create Spec file (${msg}). Using default path.`,
          "error",
        );
        specAbs = defaultSpecPath(ctx.cwd);
        try {
          ensureNucleusLayout(ctx.cwd);
          if (!existsSync(specAbs)) writeTemplate(specAbs);
        } catch (err2) {
          ctx.ui.notify(
            `Spec write failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
            "error",
          );
          return;
        }
      }

      const rel = toProjectRelative(ctx.cwd, specAbs);
      // Guard against storing unusable paths in state
      if (rel.length > MAX_SPEC_PATH_CHARS) {
        ctx.ui.notify("Resolved Spec path is too long; refusing to store it.", "error");
        return;
      }

      state = loadState(ctx.cwd);
      state.specPath = rel;
      state.role = "planner";
      saveState(ctx.cwd, state);

      let specContent = SPEC_TEMPLATE;
      try {
        if (existsSync(specAbs)) {
          specContent = readFileSync(specAbs, "utf-8");
        }
      } catch {
        specContent = SPEC_TEMPLATE;
      }

      const prompt = [
        "You are the Planner. Create or refine the Nucleus Spec.",
        "",
        `Spec path: ${rel}`,
        `Change: ${state.changeId}`,
        `Phase: ${state.phase}`,
        goalHint ? `\n## User request / goal hint\n\n${goalHint}\n` : "",
        "Required sections: Goal, Constraints, Acceptance Criteria (testable), Out-of-Scope, Decision Log / Open Questions.",
        "Keep it lean. When the human is satisfied, run `/spec approve`.",
        "",
        "Current spec content:",
        "```markdown",
        specContent,
        "```",
        "",
        "Edit the file on disk as needed. Ask clarifying questions before filling assumptions.",
      ]
        .filter(Boolean)
        .join("\n");

      ctx.ui.notify(
        roleResult.modelApplied
          ? `Planner · Spec ${rel}${goalHint ? " · with goal hint" : ""}`
          : roleResult.message,
        roleResult.modelApplied ? "info" : "warning",
      );
      pi.sendUserMessage(prompt);
    },
  });
}

async function handleApprove(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const state = loadState(ctx.cwd);
  const abs = safeResolveSpecPath(ctx.cwd, state.specPath);
  if (!state.specPath || !abs || !existsSync(abs)) {
    ctx.ui.notify("No Spec on disk. Run /spec first.", "error");
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
    const s = loadState(ctx.cwd);
    s.specPath = state.specPath;
    saveState(ctx.cwd, s);
  }

  const s2 = loadState(ctx.cwd);
  if (s2.phase !== "SpecDraft" && s2.phase !== "SpecApproved") {
    ctx.ui.notify(
      `Cannot approve in ${s2.phase}. Allowed from SpecDraft.`,
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
