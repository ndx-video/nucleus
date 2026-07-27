/**
 * Actionable "what next?" hints for /nucleus status and command errors.
 * Honesty gates stay authoritative; this only explains them.
 */

import type { NucleusState, Phase } from "./types.ts";

export interface NextActionContext {
  configLoaded: boolean;
  verifiedAttestations: number;
  rawAttestationIds: number;
  hasSpecOnDisk: boolean;
}

/**
 * Human-facing next steps for the current honesty phase.
 * Prefer concrete slash commands over internal phase names alone.
 */
export function suggestNextActions(
  state: NucleusState,
  ctx: NextActionContext,
): string[] {
  if (!ctx.configLoaded) {
    return [
      "Copy nucleus.config.example.yaml → nucleus.yaml",
      "Set models.planner / implementer / reviewer, then /nucleus",
    ];
  }

  switch (state.phase) {
    case "idle":
      return ["/spec — draft a Nucleus Spec for this change"];
    case "SpecDraft":
      return [
        "Edit the Spec (Goal, Constraints, Acceptance Criteria, Out-of-Scope)",
        "/spec approve — when the human is satisfied",
      ];
    case "SpecApproved":
      return ["/implement — hand Spec to Implementer"];
    case "Implementing":
      if (ctx.verifiedAttestations === 0) {
        return [
          "Implement to Spec, then call tool nucleus_attest { command: \"…\" }",
          "0 verified attestations — /review is blocked until attest succeeds",
        ];
      }
      return ["/review — isolated adversarial review (Spec+Diff+Attest+re-exec)"];
    case "Attested":
      if (ctx.verifiedAttestations === 0) {
        return [
          "No integrity-valid artifacts — re-run nucleus_attest",
          "Then /review",
        ];
      }
      return ["/review — isolated adversarial review"];
    case "Reviewing":
      return [
        "Complete adversarial review (bundle already injected)",
        "/review pass  or  /review fail <summary>",
      ];
    case "Accepted":
      return ["/retro — optional rule improvements", "/spec — start a new change"];
    case "Rejected":
      return [
        "/implement — fix, re-attest, then /review",
        "or revise via /spec then /spec approve",
      ];
    default: {
      const _exhaustive: never = state.phase;
      return [`Unknown phase: ${String(_exhaustive)}`];
    }
  }
}

/**
 * Short blocked reason when the loop cannot advance cleanly, or null if unblocked.
 */
export function blockedReason(
  state: NucleusState,
  ctx: NextActionContext,
): string | null {
  if (!ctx.configLoaded) {
    return "Blocked: no nucleus.yaml — copy example and set models.*";
  }
  if (
    (state.phase === "Implementing" || state.phase === "Attested") &&
    ctx.verifiedAttestations === 0
  ) {
    if (ctx.rawAttestationIds > 0) {
      return `Blocked: ${ctx.rawAttestationIds} raw attestation id(s) failed integrity — run nucleus_attest for a real capture`;
    }
    return "Blocked: 0 verified attestations — run nucleus_attest first";
  }
  if (
    (state.phase === "SpecApproved" || state.phase === "Implementing") &&
    !ctx.hasSpecOnDisk
  ) {
    return "Blocked: Spec path missing on disk — run /spec";
  }
  if (state.phase === "idle") {
    return null; // idle is ready for /spec, not "blocked"
  }
  return null;
}

/** Map internal phase → short label for status. */
export function phaseLabel(phase: Phase): string {
  const labels: Record<Phase, string> = {
    idle: "idle (ready for /spec)",
    SpecDraft: "Spec draft",
    SpecApproved: "Spec approved",
    Implementing: "implementing",
    Attested: "attested",
    Reviewing: "reviewing",
    Accepted: "accepted",
    Rejected: "rejected",
  };
  return labels[phase] ?? phase;
}
