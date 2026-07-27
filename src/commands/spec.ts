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
  findAdoptableDefaultSpec,
  prepareFreshCurrentSpec,
} from "../specs.ts";
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
      /** True when this /spec call starts a brand-new change. */
      let startedNewChange = false;
      /** True when we rotated off an Accepted/Rejected change (must not reuse that Spec). */
      let rotatedFromTerminal = false;

      if (state.phase === "Accepted" || state.phase === "Rejected") {
        try {
          if (state.phase === "Accepted") {
            try {
              prepareFreshCurrentSpec(ctx.cwd, {
                changeId: state.changeId,
                archiveLabel: "accepted-pre-new",
                writeTemplate: false,
              });
            } catch {
              /* archive best-effort */
            }
          }
          transitionPhase(ctx.cwd, "idle", { note: "new change after terminal phase" });
          rotatedFromTerminal = true;
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
        startedNewChange = true;
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
      let archivedNote: string | null = null;
      let adoptedExisting = false;

      try {
        if (sub === "new" || (startedNewChange && rotatedFromTerminal)) {
          // Explicit reset, or new change after Accept/Reject: archive + fresh template
          const fresh = prepareFreshCurrentSpec(ctx.cwd, {
            changeId: state.changeId,
            archiveLabel: sub === "new" ? "spec-new" : "new-change",
            writeTemplate: true,
          });
          specAbs = fresh.absPath;
          archivedNote = fresh.archived;
          state = loadState(ctx.cwd);
          state.specPath = fresh.specPath;
          state.reviewResult = null;
          state.overrideReason = null;
          state.role = "planner";
          saveState(ctx.cwd, state);
        } else if (startedNewChange) {
          // idle → SpecDraft but not after Accept: adopt pre-written current.md if substantial
          const adoptable = findAdoptableDefaultSpec(ctx.cwd);
          if (adoptable) {
            specAbs = adoptable.absPath;
            adoptedExisting = true;
            state = loadState(ctx.cwd);
            state.specPath = adoptable.relPath;
            state.role = "planner";
            saveState(ctx.cwd, state);
          } else {
            const fresh = prepareFreshCurrentSpec(ctx.cwd, {
              changeId: state.changeId,
              archiveLabel: "new-change",
              writeTemplate: true,
            });
            specAbs = fresh.absPath;
            archivedNote = fresh.archived;
            state = loadState(ctx.cwd);
            state.specPath = fresh.specPath;
            state.role = "planner";
            saveState(ctx.cwd, state);
          }
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
        archivedNote
          ? `Prior Spec archived at: ${archivedNote} (do not treat it as the active Spec).`
          : "",
        startedNewChange && rotatedFromTerminal || sub === "new"
          ? "This is a **fresh working Spec** for the current change. Do not reintroduce prior-change acceptance notes unless the human asks."
          : "",
        adoptedExisting
          ? "Adopted existing `.nucleus/specs/current.md` (already on disk). Refine it; do not discard unless the human asks."
          : "",
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
          ? `Planner · Spec ${rel}${adoptedExisting ? " · adopted existing" : ""}${archivedNote ? " · prior archived" : ""}${goalHint ? " · goal hint" : ""}`
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
  let state = loadState(ctx.cwd);
  let abs = safeResolveSpecPath(ctx.cwd, state.specPath);

  // Adopt orphan current.md: file written without harness registering specPath
  if (!state.specPath || !abs || !existsSync(abs)) {
    const adoptable = findAdoptableDefaultSpec(ctx.cwd);
    if (adoptable) {
      abs = adoptable.absPath;
      state.specPath = adoptable.relPath;
      state.role = "planner";
      saveState(ctx.cwd, state);
      ctx.ui.notify(
        `Adopted existing Spec at ${adoptable.relPath} (was not registered in state).`,
        "info",
      );
    } else {
      const defaultAbs = defaultSpecPath(ctx.cwd);
      const hint = existsSync(defaultAbs)
        ? " Found a template/empty current.md — run /spec and fill it first."
        : " Run /spec to create .nucleus/specs/current.md first.";
      ctx.ui.notify(`No Spec on disk.${hint}`, "error");
      return;
    }
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
      // startNewChange clears specPath — re-apply after
      specPath: undefined,
    });
    const s = loadState(ctx.cwd);
    // Re-bind adopted/default path after startNewChange nulls specPath
    s.specPath = state.specPath;
    saveState(ctx.cwd, s);
    state = s;
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
