/**
 * Shared types for Nucleus — The Honesty Harness.
 * Keep these lean; Phase 1 only.
 */

/** Honesty-loop phases. Transitions are gated; no skipping. */
export type Phase =
  | "idle"
  | "SpecDraft"
  | "SpecApproved"
  | "Implementing"
  | "Attested"
  | "Reviewing"
  | "Accepted"
  | "Rejected";

export type Role = "planner" | "implementer" | "reviewer";

export const PHASES: readonly Phase[] = [
  "idle",
  "SpecDraft",
  "SpecApproved",
  "Implementing",
  "Attested",
  "Reviewing",
  "Accepted",
  "Rejected",
] as const;

export const ROLES: readonly Role[] = ["planner", "implementer", "reviewer"] as const;

/** Allowed transitions: from → to[] */
export const PHASE_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  idle: ["SpecDraft"],
  SpecDraft: ["SpecApproved", "idle"],
  SpecApproved: ["Implementing", "SpecDraft"],
  Implementing: ["Attested", "SpecApproved"],
  Attested: ["Reviewing", "Implementing"],
  Reviewing: ["Accepted", "Rejected", "Implementing"],
  Accepted: ["idle", "SpecDraft"],
  Rejected: ["Implementing", "SpecDraft", "idle"],
};

export interface RoleConfig {
  allowed_tools?: string[];
  adversarial?: boolean;
}

export interface AttestationConfig {
  required: boolean;
  store_path: string;
  require_real_stdout: boolean;
}

export interface NucleusConfig {
  models: {
    planner: string;
    implementer: string;
    reviewer: string;
  };
  roles: {
    implementer: RoleConfig;
    reviewer: RoleConfig;
    planner?: RoleConfig;
  };
  attestation: AttestationConfig;
  /** Optional: path to current/working spec relative to project root */
  spec_path?: string;
}

export interface ParsedModelRef {
  provider: string;
  modelId: string;
  raw: string;
}

export interface ReviewResult {
  verdict: "pass" | "fail";
  findings: string[];
  reviewedAt: string;
  reviewerModel?: string;
}

export interface NucleusState {
  version: 1;
  phase: Phase;
  role: Role;
  /** Stable id for the current change under honesty review */
  changeId: string | null;
  /** Path to the active Nucleus Spec (relative to project root) */
  specPath: string | null;
  /** Attestation artifact ids produced for this change */
  attestationIds: string[];
  /** Latest review outcome, if any */
  reviewResult: ReviewResult | null;
  /** Human override reason when accepting without review pass */
  overrideReason: string | null;
  /**
   * @deprecated Transition diary now lives in `.nucleus/history.jsonl`.
   * Kept empty for backward-compatible parse; migrated on load.
   */
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GitFingerprint {
  head: string | null;
  branch: string | null;
  status: string;
  dirty: boolean;
}

export interface AttestationArtifact {
  /** Unique id (timestamp + short hash) */
  id: string;
  /** ISO timestamp of capture */
  timestamp: string;
  /** Working directory where command ran */
  cwd: string;
  /** Command as executed by the harness */
  command: string;
  /** Optional human label */
  label?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  git: GitFingerprint;
  /** Simple content hashes of listed files (if any) */
  fileHashes: Record<string, string>;
  /** Always set by harness — marks real capture (fast filter only; not sufficient alone) */
  capturedBy: "nucleus_attest";
  /**
   * HMAC-SHA256 integrity tag over critical fields, using project-local
   * `.nucleus/attest.key`. Format: `hmac-sha256:<hex>`.
   * Required for loadAttestation to accept the artifact (Phase 1.1).
   */
  integrity: string;
  /** Schema version (2 = integrity-tagged artifacts) */
  version: 2;
  /** Change id this attestation belongs to */
  changeId: string | null;
}

export interface StatusSnapshot {
  phase: Phase;
  role: Role;
  changeId: string | null;
  specPath: string | null;
  attestationCount: number;
  latestAttestationId: string | null;
  reviewResult: ReviewResult | null;
  overrideReason: string | null;
  models: NucleusConfig["models"] | null;
  configLoaded: boolean;
  configError: string | null;
  allowedNext: Phase[];
}
