/**
 * Append-only honesty history log under `.nucleus/history.jsonl`.
 *
 * state.json answers "where is the gate now?"
 * history.jsonl answers "what happened over time?"
 *
 * - Never silently drop events (unlike the old in-state notes cap).
 * - Rotate by file size for manageability; rotated files keep data.
 * - Local-first telemetry — not cryptographic evidence (attestations are).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { ensureNucleusLayout, historyPath, nucleusRoot } from "./paths.ts";
import type { Phase } from "./types.ts";

/** Rotate when the active log exceeds this many bytes (~1 MiB). */
export const HISTORY_ROTATE_BYTES = 1_000_000;

export type HistoryEventType =
  | "transition"
  | "attestation"
  | "change_boundary"
  | "migrated_note"
  | "note";

export interface HistoryEvent {
  ts: string;
  changeId: string | null;
  phase: Phase | string;
  event: HistoryEventType;
  note: string;
  attestationId?: string;
  fromPhase?: string;
  toPhase?: string;
}

function ensureHistoryParent(cwd: string): void {
  ensureNucleusLayout(cwd);
  const root = nucleusRoot(cwd);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
}

/**
 * Rotate history.jsonl → history.jsonl.1 (and .2…) when over size limit.
 * Oldest excess numbered files can be cleaned by the human; we keep a short chain.
 */
export function maybeRotateHistory(cwd: string, maxBytes = HISTORY_ROTATE_BYTES): void {
  const path = historyPath(cwd);
  if (!existsSync(path)) return;
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size < maxBytes) return;

  // Shift .2 → gone, .1 → .2, active → .1
  const p1 = `${path}.1`;
  const p2 = `${path}.2`;
  try {
    if (existsSync(p2)) {
      // Drop oldest of the small rotation chain (data may still exist as .2 until overwrite)
      renameSync(p2, `${path}.old-${Date.now()}`);
    }
    if (existsSync(p1)) {
      renameSync(p1, p2);
    }
    renameSync(path, p1);
  } catch {
    // Best-effort; continue appending if rotation fails
  }
}

export function appendHistory(cwd: string, event: HistoryEvent): void {
  ensureHistoryParent(cwd);
  maybeRotateHistory(cwd);
  const path = historyPath(cwd);
  const line = JSON.stringify(event) + "\n";
  try {
    appendFileSync(path, line, "utf-8");
  } catch {
    // If append fails (permissions), try write new file once
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, line, "utf-8");
    } catch {
      // History is best-effort soft audit; never break the honesty gate
    }
  }
}

/** Parse legacy note strings: `[iso] phase: message` or free text. */
export function parseLegacyNote(line: string): {
  ts: string;
  note: string;
  phaseHint?: string;
} {
  const m = /^\[([^\]]+)\]\s*(?:([^:]+):\s*)?(.*)$/s.exec(line.trim());
  if (m) {
    return {
      ts: m[1]!,
      phaseHint: m[2]?.trim(),
      note: (m[3] ?? "").trim() || line.trim(),
    };
  }
  return { ts: new Date().toISOString(), note: line };
}

/**
 * Migrate in-state notes[] into history.jsonl. Returns number of lines migrated.
 * Caller should clear notes and save state when count > 0.
 */
export function migrateNotesToHistory(
  cwd: string,
  notes: string[],
  context: { changeId: string | null; phase: Phase | string },
): number {
  if (!notes.length) return 0;
  for (const line of notes) {
    if (typeof line !== "string" || !line.trim()) continue;
    const parsed = parseLegacyNote(line);
    appendHistory(cwd, {
      ts: parsed.ts,
      changeId: context.changeId,
      phase: parsed.phaseHint ?? context.phase,
      event: "migrated_note",
      note: parsed.note,
    });
  }
  return notes.length;
}

export function appendTransitionHistory(
  cwd: string,
  opts: {
    changeId: string | null;
    fromPhase: string;
    toPhase: string;
    note: string;
  },
): void {
  appendHistory(cwd, {
    ts: new Date().toISOString(),
    changeId: opts.changeId,
    phase: opts.toPhase,
    event: "transition",
    note: opts.note,
    fromPhase: opts.fromPhase,
    toPhase: opts.toPhase,
  });
}

export function appendAttestationHistory(
  cwd: string,
  opts: {
    changeId: string | null;
    phase: string;
    attestationId: string;
    note?: string;
  },
): void {
  appendHistory(cwd, {
    ts: new Date().toISOString(),
    changeId: opts.changeId,
    phase: opts.phase,
    event: "attestation",
    note: opts.note ?? `recorded ${opts.attestationId}`,
    attestationId: opts.attestationId,
  });
}

export function appendChangeBoundary(
  cwd: string,
  opts: { previousChangeId: string | null; newChangeId: string | null; phase: string },
): void {
  appendHistory(cwd, {
    ts: new Date().toISOString(),
    changeId: opts.newChangeId,
    phase: opts.phase,
    event: "change_boundary",
    note: `new change (previous: ${opts.previousChangeId ?? "none"})`,
  });
}
