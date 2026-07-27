/**
 * /nucleus and /n — crisp honesty status for daily use (Phase 2.1).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  countVerifiedAttestations,
  latestVerifiedAttestationId,
} from "../attestation/index.ts";
import type { LoadConfigResult } from "../config.ts";
import {
  blockedReason,
  phaseLabel,
  suggestNextActions,
  type NextActionContext,
} from "../next-actions.ts";
import { formatIsolationMode, loadReviewSessionMeta } from "../review-isolation.ts";
import { allowedNextPhases, loadState } from "../state.ts";
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

function nextActionContext(
  cwd: string,
  configResult: LoadConfigResult,
  verified: number,
  raw: number,
  specPath: string | null,
): NextActionContext {
  const hasSpecOnDisk = !!(specPath && existsSync(resolve(cwd, specPath)));
  return {
    configLoaded: !!configResult.config,
    verifiedAttestations: verified,
    rawAttestationIds: raw,
    hasSpecOnDisk,
  };
}

/**
 * Scannable status for humans and models.
 * Phase · role · verified att · isolation · blocked · next actions.
 */
export function formatFullStatus(
  cwd: string,
  configResult: LoadConfigResult,
): string {
  const state = loadState(cwd);
  const storePath = configResult.config?.attestation.store_path;
  const verified = countVerifiedAttestations(cwd, storePath);
  const latest = latestVerifiedAttestationId(cwd, storePath);
  const raw = state.attestationIds.length;
  const actCtx = nextActionContext(cwd, configResult, verified, raw, state.specPath);
  const blocked = blockedReason(state, actCtx);
  const next = suggestNextActions(state, actCtx);
  const isolation = formatIsolationBrief(cwd);

  const attLine =
    verified === 0
      ? raw > 0
        ? `0 verified (${raw} raw failed integrity)`
        : "0 verified"
      : latest
        ? `${verified} verified · latest ${latest}`
        : `${verified} verified`;

  const reviewLine = formatReviewLine(state.reviewResult);

  const lines = [
    "Nucleus",
    "───────",
    `Phase   ${phaseLabel(state.phase)}`,
    `Role    ${state.role}`,
    `Change  ${state.changeId ?? "—"}`,
    `Spec    ${state.specPath ?? "—"}`,
    `Attest  ${attLine}`,
    `Review  ${reviewLine}`,
    `Isol.   ${isolation}`,
  ];

  if (state.overrideReason) {
    lines.push(`Override ${state.overrideReason}`);
  }

  if (blocked) {
    lines.push("", `⚠ ${blocked}`);
  }

  lines.push("", "Next");
  for (const step of next) {
    lines.push(`  · ${step}`);
  }

  if (!configResult.config) {
    lines.push("", `Config  ERROR: ${configResult.error}`);
  } else {
    lines.push(
      "",
      "Models",
      `  planner     ${configResult.config.models.planner}`,
      `  implementer ${configResult.config.models.implementer}`,
      `  reviewer    ${configResult.config.models.reviewer}`,
    );
  }

  lines.push(
    "",
    "Loop  /spec → /spec approve → /implement → nucleus_attest → /review → /accept",
  );

  return lines.join("\n");
}

function formatReviewLine(
  reviewResult: StatusSnapshot["reviewResult"] | unknown,
): string {
  if (reviewResult === null || reviewResult === undefined) return "—";
  // Legacy/hand-edited: bare "pass" | "fail" string
  if (typeof reviewResult === "string") {
    return reviewResult.toUpperCase();
  }
  if (typeof reviewResult !== "object") return "—";
  const r = reviewResult as { verdict?: unknown; findings?: unknown };
  const verdict =
    typeof r.verdict === "string" && r.verdict.length > 0
      ? r.verdict.toUpperCase()
      : null;
  if (!verdict) return "—";
  const n = Array.isArray(r.findings) ? r.findings.length : 0;
  return `${verdict} · ${n} finding(s)`;
}

function formatIsolationBrief(cwd: string): string {
  const meta = loadReviewSessionMeta(cwd);
  if (!meta) return "— (default /review = new_session)";
  const reexec = meta.verificationMismatch ? "re-exec MISMATCH" : "re-exec ok";
  const kick = meta.kickoffDelivered ? "delivered" : "pending";
  let modeLabel: string;
  try {
    modeLabel = formatIsolationMode(meta.isolation);
  } catch {
    modeLabel = String(meta.isolation ?? "unknown");
  }
  return `${modeLabel} · kickoff ${kick} · ${reexec}`;
}

export function registerStatusCommands(
  pi: ExtensionAPI,
  getConfig: () => LoadConfigResult,
): void {
  const handler = async (_args: string, ctx: ExtensionCommandContext) => {
    const configResult = getConfig();
    const text = formatFullStatus(ctx.cwd, configResult);
    // Single surface: custom message (no redundant toast spam)
    pi.sendMessage({
      customType: "nucleus-status",
      content: text,
      display: true,
      details: buildStatusSnapshot(ctx.cwd, configResult),
    });
  };

  pi.registerCommand("nucleus", {
    description: "Show honesty status: phase, role, attestations, next action",
    handler,
  });

  pi.registerCommand("n", {
    description: "Alias for /nucleus",
    handler,
  });
}
