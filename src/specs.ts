/**
 * Spec file lifecycle helpers.
 *
 * Problem: a single `.nucleus/specs/current.md` becomes stale/misleading when
 * a change is Accepted and the next change begins — Git and status still say
 * "current" while content belongs to a prior change.
 *
 * Fix:
 * - Archive the active Spec on Accept (and when starting a new change / /spec new).
 * - Always point the *working* Spec at a fresh current.md for the new change.
 * - Archives live under `.nucleus/specs/archive/` with changeId + label.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { SPEC_TEMPLATE } from "./context.ts";
import {
  defaultSpecPath,
  ensureNucleusLayout,
  specsDir,
  toProjectRelative,
} from "./paths.ts";
import { loadState, saveState } from "./state.ts";

export const SPECS_ARCHIVE_DIR = "archive";

export function specsArchiveDir(cwd: string): string {
  return join(specsDir(cwd), SPECS_ARCHIVE_DIR);
}

function safeSlug(input: string, max = 48): string {
  const s = input
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return s || "spec";
}

/**
 * Copy an existing Spec file into `.nucleus/specs/archive/`.
 * Returns project-relative archive path, or null if nothing to archive.
 */
export function archiveSpecFile(
  cwd: string,
  specAbs: string,
  options: {
    changeId?: string | null;
    label?: string;
  } = {},
): string | null {
  if (!existsSync(specAbs)) return null;

  let body = "";
  try {
    body = readFileSync(specAbs, "utf-8");
  } catch {
    return null;
  }
  // Skip empty / pure-template archives to reduce noise
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed === SPEC_TEMPLATE.trim()) return null;

  ensureNucleusLayout(cwd);
  const archiveRoot = specsArchiveDir(cwd);
  if (!existsSync(archiveRoot)) {
    mkdirSync(archiveRoot, { recursive: true });
  }

  const changePart = options.changeId ? safeSlug(options.changeId, 64) : "no-change";
  const labelPart = safeSlug(options.label ?? "archived", 32);
  const base = basename(specAbs).replace(/\.md$/i, "") || "spec";
  // Avoid collisions
  let name = `${changePart}__${labelPart}__${base}.md`;
  let dest = join(archiveRoot, name);
  let n = 2;
  while (existsSync(dest)) {
    name = `${changePart}__${labelPart}__${base}-${n}.md`;
    dest = join(archiveRoot, name);
    n += 1;
  }

  copyFileSync(specAbs, dest);

  // Optional pointer file for humans browsing the archive
  const notePath = dest.replace(/\.md$/, ".meta.json");
  writeFileSync(
    notePath,
    JSON.stringify(
      {
        archivedAt: new Date().toISOString(),
        source: toProjectRelative(cwd, specAbs),
        changeId: options.changeId ?? null,
        label: options.label ?? "archived",
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  return toProjectRelative(cwd, dest);
}

/**
 * Archive whatever Spec state currently points at (if any).
 */
export function archiveActiveSpec(
  cwd: string,
  label = "archived",
): string | null {
  const state = loadState(cwd);
  if (!state.specPath) {
    const fallback = defaultSpecPath(cwd);
    if (existsSync(fallback)) {
      return archiveSpecFile(cwd, fallback, {
        changeId: state.changeId,
        label,
      });
    }
    return null;
  }
  const resolved = resolve(cwd, state.specPath);
  return archiveSpecFile(cwd, resolved, {
    changeId: state.changeId,
    label,
  });
}

/**
 * Prepare a fresh working Spec at `.nucleus/specs/current.md` for a new change.
 * Archives any existing current.md (or previous state.specPath) first.
 */
export function prepareFreshCurrentSpec(
  cwd: string,
  options: {
    changeId?: string | null;
    archiveLabel?: string;
    /** If true (default), write SPEC_TEMPLATE after archive */
    writeTemplate?: boolean;
  } = {},
): {
  specPath: string;
  absPath: string;
  archived: string | null;
} {
  ensureNucleusLayout(cwd);
  const abs = defaultSpecPath(cwd);
  const state = loadState(cwd);
  const changeId = options.changeId !== undefined ? options.changeId : state.changeId;
  const label = options.archiveLabel ?? "superseded";

  let archived: string | null = null;
  // Prefer archiving the file state points at; also archive current.md if different
  if (state.specPath) {
    const prev = resolve(cwd, state.specPath);
    archived = archiveSpecFile(cwd, prev, { changeId, label });
  }
  if (existsSync(abs)) {
    // Only re-archive if path differs from what we already archived
    const prevAbs = state.specPath ? resolve(cwd, state.specPath) : null;
    if (!prevAbs || prevAbs !== abs) {
      const again = archiveSpecFile(cwd, abs, {
        changeId,
        label: archived ? `${label}-current` : label,
      });
      if (!archived) archived = again;
    } else if (!archived) {
      // Same path as state.specPath — already archived above if non-template
      archived = archiveSpecFile(cwd, abs, { changeId, label });
    }
  }

  if (options.writeTemplate !== false) {
    writeFileSync(abs, SPEC_TEMPLATE, "utf-8");
  }

  const rel = toProjectRelative(cwd, abs);
  return { specPath: rel, absPath: abs, archived };
}

/**
 * After Accept: archive the accepted Spec so current.md is not the only copy.
 * Does not rewrite current.md (caller may start a new change later).
 */
export function archiveOnAccept(cwd: string): string | null {
  const state = loadState(cwd);
  if (!state.specPath) return null;
  const abs = resolve(cwd, state.specPath);
  return archiveSpecFile(cwd, abs, {
    changeId: state.changeId,
    label: "accepted",
  });
}

/**
 * Point state at a Spec path and optionally clear prior-change leftovers.
 */
export function setActiveSpecPath(
  cwd: string,
  relPath: string,
  options?: { clearReviewResidue?: boolean },
): void {
  const state = loadState(cwd);
  state.specPath = relPath;
  if (options?.clearReviewResidue) {
    state.reviewResult = null;
    state.overrideReason = null;
  }
  saveState(cwd, state);
}

/** True if file exists and is more than an empty/template stub. */
export function isSubstantialSpecFile(absPath: string): boolean {
  if (!existsSync(absPath)) return false;
  try {
    const body = readFileSync(absPath, "utf-8").trim();
    if (!body) return false;
    if (body === SPEC_TEMPLATE.trim()) return false;
    // Template with only whitespace edits still "empty" of intent — require a Goal-ish body
    return body.length > SPEC_TEMPLATE.trim().length * 0.5 || /##\s*Goal/i.test(body);
  } catch {
    return false;
  }
}

/**
 * If state has no specPath but default current.md has real content, return it
 * for adoption (agents often write the file before the harness registers the path).
 */
export function findAdoptableDefaultSpec(cwd: string): {
  absPath: string;
  relPath: string;
} | null {
  const abs = defaultSpecPath(cwd);
  if (!isSubstantialSpecFile(abs)) return null;
  return { absPath: abs, relPath: toProjectRelative(cwd, abs) };
}
