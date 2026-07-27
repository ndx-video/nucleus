/**
 * File-backed phase state machine under `.nucleus/state.json`.
 * Visible honesty gate — human always knows where the change sits.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
    reviewResult: (o.reviewResult as ReviewResult | null) ?? null,
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
    return parseState(JSON.parse(text));
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
  }
  if (to === "idle") {
    state.changeId = null;
    state.specPath = null;
    state.attestationIds = [];
    state.reviewResult = null;
    state.overrideReason = null;
    state.role = "planner";
  }
  if (options?.note) {
    state.notes.push(`[${nowIso()}] ${state.phase}: ${options.note}`);
    // Cap notes to keep state lean
    if (state.notes.length > 50) {
      state.notes = state.notes.slice(-50);
    }
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
    state.notes.push(`[${nowIso()}] Attested: recorded ${attestationId}`);
  }
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

export function formatStatus(state: NucleusState): string {
  const lines = [
    `Phase:        ${state.phase}`,
    `Role:         ${state.role}`,
    `Change:       ${state.changeId ?? "(none)"}`,
    `Spec:         ${state.specPath ?? "(none)"}`,
    `Attestations: ${state.attestationIds.length}${state.attestationIds.length ? ` [${state.attestationIds[state.attestationIds.length - 1]}]` : ""}`,
    `Review:       ${state.reviewResult ? `${state.reviewResult.verdict} (${state.reviewResult.findings.length} findings)` : "(none)"}`,
    `Override:     ${state.overrideReason ?? "(none)"}`,
    `Updated:      ${state.updatedAt}`,
    `Next:         ${allowedNextPhases(state.phase).join(", ") || "—"}`,
  ];
  return lines.join("\n");
}
