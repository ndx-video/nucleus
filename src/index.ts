/**
 * Nucleus — The Honesty Harness
 * Pi extension entry point.
 *
 * Agents can lie. Nucleus makes lying hard and detection automatic.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  countVerifiedAttestations,
  createAttestation,
  formatAttestationSummary,
  latestVerifiedAttestationId,
} from "./attestation/index.ts";
import {
  formatVerificationSummary,
  reexecuteAttestation,
} from "./attestation/verify.ts";
import { registerAcceptCommand } from "./commands/accept.ts";
import { registerImplementCommand } from "./commands/implement.ts";
import { registerReviewCommand } from "./commands/review.ts";
import { registerRetroCommand } from "./commands/retro.ts";
import { registerSpecCommand } from "./commands/spec.ts";
import { registerStatusCommands } from "./commands/status.ts";
import { loadConfig, type LoadConfigResult } from "./config.ts";
import { ensureNucleusLayout } from "./paths.ts";
import { roleSystemPromptSuffix } from "./roles/index.ts";
import { loadState } from "./state.ts";
import type { Role } from "./types.ts";

export default function nucleusExtension(pi: ExtensionAPI): void {
  let configResult: LoadConfigResult = {
    config: null,
    error: "Config not loaded yet",
    sources: [],
  };
  let activeRole: Role = "planner";

  const getConfig = (): LoadConfigResult => configResult;

  function refreshConfig(cwd: string): void {
    configResult = loadConfig(cwd);
    if (configResult.config) {
      ensureNucleusLayout(cwd, configResult.config.attestation.store_path);
    } else {
      ensureNucleusLayout(cwd);
    }
  }

  // ─── Session start: load config + status widget ─────────────────────
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    refreshConfig(ctx.cwd);
    try {
      const state = loadState(ctx.cwd);
      activeRole = state.role;
      updateStatusUi(ctx);
      if (configResult.error) {
        ctx.ui.notify(`Nucleus: ${configResult.error}`, "warning");
      } else {
        ctx.ui.notify(
          `Nucleus loaded · phase ${state.phase} · role ${state.role}`,
          "info",
        );
      }
    } catch (err) {
      ctx.ui.notify(
        `Nucleus state error: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  });

  // ─── Inject role system prompt ──────────────────────────────────────
  pi.on("before_agent_start", async (_event, ctx: ExtensionContext) => {
    try {
      const state = loadState(ctx.cwd);
      activeRole = state.role;
      updateStatusUi(ctx);
      const suffix = roleSystemPromptSuffix(activeRole);
      // Chain: append role contract to existing system prompt
      return {
        systemPrompt: `${_event.systemPrompt}\n\n${suffix}`,
      };
    } catch {
      return;
    }
  });

  // ─── Light tool policy for reviewer (no write/edit) ─────────────────
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    try {
      const state = loadState(ctx.cwd);
      if (state.role !== "reviewer") return;

      const blocked = new Set(["write", "edit"]);
      if (blocked.has(event.toolName)) {
        return {
          block: true,
          reason:
            "Nucleus: Adversarial Reviewer cannot write/edit project files (honesty isolation).",
        };
      }

      // Always allow nucleus_verify for independent re-execution
      if (event.toolName === "nucleus_verify") return;

      // Also honor configured allow-list if present
      const allowed = configResult.config?.roles.reviewer.allowed_tools;
      if (allowed && allowed.length > 0 && !allowed.includes(event.toolName)) {
        return {
          block: true,
          reason: `Nucleus: tool "${event.toolName}" not in reviewer allowed_tools`,
        };
      }
    } catch {
      // fail open on state errors during tool_call to avoid wedging the session
    }
    return;
  });

  // Keep footer status in sync when tools finish (phase may advance via attest)
  pi.on("tool_execution_end", async (event, ctx: ExtensionContext) => {
    if (event.toolName === "nucleus_attest" || event.toolName === "nucleus_verify") {
      updateStatusUi(ctx);
    }
  });

  // ─── nucleus_attest custom tool ─────────────────────────────────────
  pi.registerTool({
    name: "nucleus_attest",
    label: "Nucleus Attest",
    description:
      "Run a verification command and capture a real attestation artifact (stdout/stderr/exit code/git fingerprint). " +
      "REQUIRED before claiming tests/builds passed. Harness-owned — results are written to .nucleus/attestations/.",
    parameters: Type.Object({
      command: Type.String({
        description: "Shell command to execute and attest (e.g. npm test, cargo test)",
      }),
      label: Type.Optional(
        Type.String({ description: "Optional human label for this attestation" }),
      ),
      hash_files: Type.Optional(
        Type.Array(Type.String(), {
          description: "Optional file paths (relative to cwd) to include content hashes for",
        }),
      ),
      cwd: Type.Optional(
        Type.String({
          description: "Optional working directory relative to project root",
        }),
      ),
      timeout_ms: Type.Optional(
        Type.Number({ description: "Timeout in milliseconds (default 120000)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      refreshConfig(ctx.cwd);
      onUpdate?.({
        content: [{ type: "text", text: `Attesting: ${params.command}` }],
        details: { phase: "running" },
      });

      try {
        const result = await createAttestation(
          ctx.cwd,
          {
            command: params.command,
            label: params.label,
            hash_files: params.hash_files,
            cwd: params.cwd,
            timeout_ms: params.timeout_ms,
          },
          configResult.config,
        );

        const summary = formatAttestationSummary(result.artifact);
        const text = [
          summary,
          "",
          `json: ${result.jsonPath}`,
          `md:   ${result.mdPath}`,
          "",
          result.artifact.exitCode === 0
            ? "Command succeeded (exit 0). Artifact is real harness capture."
            : `Command failed (exit ${result.artifact.exitCode}). Artifact still recorded for Reviewer scrutiny.`,
        ].join("\n");

        updateStatusUi(ctx);

        return {
          content: [{ type: "text", text }],
          details: {
            id: result.artifact.id,
            exitCode: result.artifact.exitCode,
            jsonPath: result.jsonPath,
            mdPath: result.mdPath,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `nucleus_attest failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  });

  // ─── nucleus_verify — independent re-execution (Phase 1.2) ───────────
  pi.registerTool({
    name: "nucleus_verify",
    label: "Nucleus Verify",
    description:
      "Independently re-execute the command recorded in a verified attestation and compare exit code/stdout/stderr. " +
      "Used by the Adversarial Reviewer. exit_mismatch is strong FAIL evidence. " +
      "If attestation_id is omitted, uses the latest integrity-verified attestation.",
    parameters: Type.Object({
      attestation_id: Type.Optional(
        Type.String({
          description: "Attestation id to re-execute (default: latest verified)",
        }),
      ),
      timeout_ms: Type.Optional(
        Type.Number({ description: "Timeout in milliseconds (default 120000)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      refreshConfig(ctx.cwd);
      const storePath = configResult.config?.attestation.store_path;
      const id =
        params.attestation_id?.trim() ||
        latestVerifiedAttestationId(ctx.cwd, storePath);

      if (!id) {
        return {
          content: [
            {
              type: "text",
              text: "nucleus_verify failed: no verified attestation available. Run nucleus_attest first.",
            },
          ],
          details: { error: "no_verified_attestation" },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Re-executing attestation ${id}…` }],
        details: { phase: "running", attestationId: id },
      });

      try {
        const result = await reexecuteAttestation(ctx.cwd, id, {
          storePath,
          timeout_ms: params.timeout_ms,
        });
        if (!result) {
          return {
            content: [
              {
                type: "text",
                text: `nucleus_verify failed: attestation ${id} missing or failed integrity verification.`,
              },
            ],
            details: { error: "invalid_attestation", attestationId: id },
          };
        }

        const text = [
          formatVerificationSummary(result),
          "",
          result.verdict === "exit_mismatch"
            ? "STRONG FAIL SIGNAL: exit codes do not match. Prefer Reviewer FAIL."
            : result.verdict === "output_mismatch"
              ? "SUSPICIOUS: exit matched but output differs. Investigate before PASS."
              : "Re-execution matched attested results. Still check Spec compliance.",
        ].join("\n");

        updateStatusUi(ctx);

        return {
          content: [{ type: "text", text }],
          details: {
            attestationId: result.attestationId,
            verdict: result.verdict,
            exitCodeMatch: result.exitCodeMatch,
            stdoutMatch: result.stdoutMatch,
            stderrMatch: result.stderrMatch,
            originalExitCode: result.original.exitCode,
            reexecExitCode: result.reexec.exitCode,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `nucleus_verify failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  });

  // ─── Commands ───────────────────────────────────────────────────────
  registerStatusCommands(pi, getConfig);
  registerSpecCommand(pi, getConfig);
  registerImplementCommand(pi, getConfig);
  registerReviewCommand(pi, getConfig);
  registerAcceptCommand(pi, getConfig);
  registerRetroCommand(pi, getConfig);

  function updateStatusUi(ctx: ExtensionContext): void {
    try {
      const state = loadState(ctx.cwd);
      activeRole = state.role;
      const storePath = configResult.config?.attestation.store_path;
      const verified = countVerifiedAttestations(ctx.cwd, storePath);
      const att = verified > 0 ? ` · att:${verified}` : "";
      const label = `Nuc:${state.phase}/${state.role}${att}`;
      ctx.ui.setStatus("nucleus", label);
    } catch {
      ctx.ui.setStatus("nucleus", "Nuc:error");
    }
  }
}
