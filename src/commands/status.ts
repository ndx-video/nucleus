/**
 * /nucleus and /n — show honesty state / phase.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  countVerifiedAttestations,
  latestVerifiedAttestationId,
} from "../attestation/index.ts";
import type { LoadConfigResult } from "../config.ts";
import { allowedNextPhases, formatStatus, loadState } from "../state.ts";
import type { StatusSnapshot } from "../types.ts";

export function buildStatusSnapshot(
  cwd: string,
  configResult: LoadConfigResult,
): StatusSnapshot {
  const state = loadState(cwd);
  const storePath = configResult.config?.attestation.store_path;
  const verifiedCount = countVerifiedAttestations(cwd, storePath);
  const latestVerifiedId = latestVerifiedAttestationId(cwd, storePath);

  return {
    phase: state.phase,
    role: state.role,
    changeId: state.changeId,
    specPath: state.specPath,
    // Phase 1.2: only integrity-verified attestations
    attestationCount: verifiedCount,
    latestAttestationId: latestVerifiedId,
    reviewResult: state.reviewResult,
    overrideReason: state.overrideReason,
    models: configResult.config?.models ?? null,
    configLoaded: !!configResult.config,
    configError: configResult.error,
    allowedNext: allowedNextPhases(state.phase),
  };
}

export function formatFullStatus(
  cwd: string,
  configResult: LoadConfigResult,
): string {
  const state = loadState(cwd);
  const snap = buildStatusSnapshot(cwd, configResult);
  const lines = [
    "═══ Nucleus — The Honesty Harness ═══",
    "",
    formatStatus(state, {
      verifiedCount: snap.attestationCount,
      latestVerifiedId: snap.latestAttestationId,
      rawCount: state.attestationIds.length,
    }),
    "",
    "── Config ──",
    snap.configLoaded
      ? [
          `  planner:     ${snap.models?.planner}`,
          `  implementer: ${snap.models?.implementer}`,
          `  reviewer:    ${snap.models?.reviewer}`,
          `  sources:     ${configResult.sources.join(", ") || "(none)"}`,
        ].join("\n")
      : `  ERROR: ${snap.configError}`,
    "",
    "── Loop ──",
    "  Spec → Implement → Attest → Review (+ independent re-exec) → Accept/Reject → Retro",
    "",
    "── Commands ──",
    "  /spec  /implement  /review  /accept  /retro  /nucleus",
  ];
  return lines.join("\n");
}

export function registerStatusCommands(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  const handler = async (_args: string, ctx: ExtensionCommandContext) => {
    const text = formatFullStatus(ctx.cwd, getConfig());
    ctx.ui.notify("Nucleus status", "info");
    pi.sendMessage({
      customType: "nucleus-status",
      content: text,
      display: true,
      details: buildStatusSnapshot(ctx.cwd, getConfig()),
    });
  };

  pi.registerCommand("nucleus", {
    description: "Show Nucleus honesty state / current phase",
    handler,
  });

  pi.registerCommand("n", {
    description: "Alias for /nucleus — honesty state / phase",
    handler,
  });
}
