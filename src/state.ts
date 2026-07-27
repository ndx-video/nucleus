/**
 * File-backed phase state machine under `.nucleus/state.json`.
 * Visible honesty gate — human always knows where the change sits.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  appendAttestationHistory,
  appendChangeBoundary,
  appendTransitionHistory,
  migrateNotesToHistory,
} from "./history.ts";
import { ensureNucleusLayout, statePath } from "./paths.ts";
import {
  PHASE_TRANSITIONS,
  type NucleusState,
  type Phase,
  type ReviewResult,
  type Role,
} from "./types.ts";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function newChangeId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = randomBytes(3).toString("hex");
  return `chg-${ts}-${rand}`;
}

export function createInitialState(): NucleusState {
  const t = nowIso();
  return {
    version: 1,
    phase: "idle",
    role: "planner",
    changeId: null,
    specPath: null,
    attestationIds: [],
    reviewResult: null,
    overrideReason: null,
    notes: [],
    createdAt: t,
    updatedAt: t,
  };
}

function isPhase(value: unknown): value is Phase {
  return (
    typeof value === "string" &&
    value in PHASE_TRANSITIONS
  );
}

function isRole(value: unknown): value is Role {
  return value === "planner" || value === "implementer" || value === "reviewer";
}

/**
 * Normalize reviewResult from disk. Hand-edited or legacy state may store
 * a bare string ("pass") instead of { verdict, findings }.
 */
export function normalizeReviewResult(raw: unknown): ReviewResult | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const v = raw.toLowerCase();
    if (v === "pass" || v === "fail") {
      return {
        verdict: v,
        findings: ["(legacy/hand-edited reviewResult string)"],
        reviewedAt: nowIso(),
      };
    }
    return null;
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const verdict =
    o.verdict === "pass" || o.verdict === "fail"
      ? o.verdict
      : typeof o.verdict === "string" && o.verdict.toLowerCase() === "pass"
        ? "pass"
        : typeof o.verdict === "string" && o.verdict.toLowerCase() === "fail"
          ? "fail"
          : null;
  if (!verdict) return null;
  const findings = Array.isArray(o.findings)
    ? o.findings.filter((x): x is string => typeof x === "string")
    : [];
  return {
    verdict,
    findings,
    reviewedAt: typeof o.reviewedAt === "string" ? o.reviewedAt : nowIso(),
    reviewerModel: typeof o.reviewerModel === "string" ? o.reviewerModel : undefined,
  };
}

export function parseState(raw: unknown): NucleusState {
  if (typeof raw !== "object" || raw === null) {
    throw new StateError("state.json must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) {
    throw new StateError(`Unsupported state version: ${String(o.version)}`);
  }
  if (!isPhase(o.phase)) {
    throw new StateError(`Invalid phase: ${String(o.phase)}`);
  }
  if (!isRole(o.role)) {
    throw new StateError(`Invalid role: ${String(o.role)}`);
  }
  return {
    version: 1,
    phase: o.phase,
    role: o.role,
    changeId: typeof o.changeId === "string" || o.changeId === null ? (o.changeId as string | null) : null,
    specPath: typeof o.specPath === "string" || o.specPath === null ? (o.specPath as string | null) : null,
    attestationIds: Array.isArray(o.attestationIds)
      ? o.attestationIds.filter((x): x is string => typeof x === "string")
      : [],
    reviewResult: normalizeReviewResult(o.reviewResult),
    overrideReason: typeof o.overrideReason === "string" || o.overrideReason === null
      ? (o.overrideReason as string | null)
      : null,
    notes: Array.isArray(o.notes) ? o.notes.filter((x): x is string => typeof x === "string") : [],
    createdAt: typeof o.createdAt === "string" ? o.createdAt : nowIso(),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : nowIso(),
  };
}

export function loadState(cwd: string): NucleusState {
  ensureNucleusLayout(cwd);
  const path = statePath(cwd);
  if (!existsSync(path)) {
    const initial = createInitialState();
    saveState(cwd, initial);
    return initial;
  }
  try {
    const text = readFileSync(path, "utf-8");
    const state = parseState(JSON.parse(text));
    // One-time migration: ballooning notes[] → append-only history.jsonl
    if (state.notes.length > 0) {
      migrateNotesToHistory(cwd, state.notes, {
        changeId: state.changeId,
        phase: state.phase,
      });
      state.notes = [];
      saveState(cwd, state);
    }
    return state;
  } catch (err) {
    throw new StateError(
      `Failed to load ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function saveState(cwd: string, state: NucleusState): void {
  ensureNucleusLayout(cwd);
  const path = statePath(cwd);
  const next: NucleusState = {
    ...state,
    updatedAt: nowIso(),
  };
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf-8");
}

export function canTransition(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function allowedNextPhases(phase: Phase): Phase[] {
  return [...PHASE_TRANSITIONS[phase]];
}

/**
 * Transition phase with validation. Mutates and persists state.
 * Throws StateError if transition is illegal.
 */
export function transitionPhase(
  cwd: string,
  to: Phase,
  options?: {
    note?: string;
    role?: Role;
    specPath?: string | null;
    clearAttestations?: boolean;
    reviewResult?: ReviewResult | null;
    overrideReason?: string | null;
    startNewChange?: boolean;
  },
): NucleusState {
  const state = loadState(cwd);
  if (!canTransition(state.phase, to)) {
    throw new StateError(
      `Illegal phase transition: ${state.phase} → ${to}. Allowed: ${allowedNextPhases(state.phase).join(", ") || "(none)"}`,
    );
  }

  const fromPhase = state.phase;
  const previousChangeId = state.changeId;

  state.phase = to;
  if (options?.role) state.role = options.role;
  if (options?.specPath !== undefined) state.specPath = options.specPath;
  if (options?.clearAttestations) state.attestationIds = [];
  if (options?.reviewResult !== undefined) state.reviewResult = options.reviewResult;
  if (options?.overrideReason !== undefined) state.overrideReason = options.overrideReason;
  if (options?.startNewChange) {
    state.changeId = newChangeId();
    state.attestationIds = [];
    state.reviewResult = null;
    state.overrideReason = null;
    // Do not reuse prior change's Spec path — caller should set a fresh current.md
    state.specPath = null;
    state.notes = [];
    appendChangeBoundary(cwd, {
      previousChangeId,
      newChangeId: state.changeId,
      phase: to,
    });
  }
  if (to === "idle") {
    state.changeId = null;
    state.specPath = null;
    state.attestationIds = [];
    state.reviewResult = null;
    state.overrideReason = null;
    state.role = "planner";
    state.notes = [];
  }
  // History goes to history.jsonl — never balloon state.json
  state.notes = [];
  if (options?.note) {
    appendTransitionHistory(cwd, {
      changeId: state.changeId,
      fromPhase,
      toPhase: to,
      note: options.note,
    });
  }

  saveState(cwd, state);
  return state;
}

export function setRole(cwd: string, role: Role): NucleusState {
  const state = loadState(cwd);
  state.role = role;
  saveState(cwd, state);
  return state;
}

export function recordAttestation(cwd: string, attestationId: string): NucleusState {
  const state = loadState(cwd);
  if (!state.attestationIds.includes(attestationId)) {
    state.attestationIds.push(attestationId);
  }
  // Auto-advance Implementing → Attested when first real attestation lands
  if (state.phase === "Implementing") {
    state.phase = "Attested";
  }
  state.notes = [];
  appendAttestationHistory(cwd, {
    changeId: state.changeId,
    phase: state.phase,
    attestationId,
    note: `recorded ${attestationId}`,
  });
  saveState(cwd, state);
  return state;
}

export function ensureChangeId(cwd: string): NucleusState {
  const state = loadState(cwd);
  if (!state.changeId) {
    state.changeId = newChangeId();
    saveState(cwd, state);
  }
  return state;
}

export interface FormatStatusOptions {
  /** Integrity-verified attestation count (Phase 1.2 — preferred for display) */
  verifiedCount?: number;
  /** Latest integrity-verified id */
  latestVerifiedId?: string | null;
  /** Raw ids in state (may include invalid/forged); for honesty gap display */
  rawCount?: number;
}

export function formatStatus(state: NucleusState, opts?: FormatStatusOptions): string {
  const verified =
    opts?.verifiedCount !== undefined ? opts.verifiedCount : null;
  const latest =
    opts?.latestVerifiedId !== undefined
      ? opts.latestVerifiedId
      : state.attestationIds.length
        ? state.attestationIds[state.attestationIds.length - 1]
        : null;
  const raw = opts?.rawCount ?? state.attestationIds.length;

  let attLine: string;
  if (verified === null) {
    // Fallback when caller has not resolved verified set (tests / early boot)
    attLine = `Attestations: ${raw}${latest ? ` [${latest}]` : ""} (raw ids — verify on load)`;
  } else if (verified === 0) {
    attLine =
      raw > 0
        ? `Attestations: 0 verified (${raw} raw id(s) failed integrity)`
        : `Attestations: 0 verified`;
  } else {
    const gap = raw > verified ? ` (${raw} raw)` : "";
    attLine = `Attestations: ${verified} verified${latest ? ` [${latest}]` : ""}${gap}`;
  }

  const lines = [
    `Phase:        ${state.phase}`,
    `Role:         ${state.role}`,
    `Change:       ${state.changeId ?? "(none)"}`,
    `Spec:         ${state.specPath ?? "(none)"}`,
    attLine,
    `Review:       ${state.reviewResult ? `${state.reviewResult.verdict} (${state.reviewResult.findings.length} findings)` : "(none)"}`,
    `Override:     ${state.overrideReason ?? "(none)"}`,
    `Updated:      ${state.updatedAt}`,
    `Next:         ${allowedNextPhases(state.phase).join(", ") || "—"}`,
  ];
  return lines.join("\n");
}
