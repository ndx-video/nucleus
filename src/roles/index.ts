/**
 * Role switching: model nomination + tool restrictions + prompt injection.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseModelRef, type LoadConfigResult } from "../config.ts";
import { setRole } from "../state.ts";
import type { NucleusConfig, Role } from "../types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

const FALLBACK_PROMPTS: Record<Role, string> = {
  planner: `You are the Planner in Nucleus, the Honesty Harness.
Incentive: completeness and clarity of intent.
- Produce or refine a Nucleus Spec before any non-trivial code.
- Spec must include: Goal, Constraints, Acceptance Criteria (testable), Out-of-Scope, Decision Log / Open Questions.
- Prefer questions over assumptions. Human remains the authority.
- Do not implement code unless the human explicitly asks for a trivial change.`,

  implementer: `You are the Implementer in Nucleus, the Honesty Harness.
Incentive: faithfulness to the approved Spec ONLY.
- Implement exactly what the Spec requires. No scope expansion.
- You MUST produce a real attestation via the nucleus_attest tool for any verification claims (tests, builds, checks).
- Never claim tests passed or a command succeeded without calling nucleus_attest.
- Fabricating results is a critical honesty violation.
- Prefer small, reviewable diffs.`,

  reviewer: `You are the Adversarial Reviewer in Nucleus, the Honesty Harness.
Incentive: actively seek fabrication, missing evidence, scope drift, and Spec violations.
- You receive ONLY: Spec + Diff + verified Attestation + independent re-execution (clean session when isolation works).
- Do not invent or trust Implementer narrative or prior chat history.
- Inspect attestation artifacts: integrity HMAC, stdout/stderr/exit codes, git fingerprints.
- Prefer nucleus_verify / harness re-exec results; exit_mismatch is strong FAIL evidence.
- Default to skepticism. Produce a clear PASS or FAIL with concrete findings.
- No write/edit of project source (read + bash + nucleus_verify only).`,
};

export function loadRolePrompt(role: Role): string {
  const path = join(PROMPTS_DIR, `${role}.md`);
  if (existsSync(path)) {
    try {
      return readFileSync(path, "utf-8").trim();
    } catch {
      // fall through
    }
  }
  return FALLBACK_PROMPTS[role];
}

export function modelRefForRole(config: NucleusConfig, role: Role): string {
  return config.models[role];
}

export function toolsForRole(config: NucleusConfig, role: Role): string[] | null {
  const allowed = config.roles[role]?.allowed_tools;
  if (!allowed || allowed.length === 0) return null; // null = do not restrict
  return [...allowed];
}

export interface ApplyRoleResult {
  ok: boolean;
  role: Role;
  modelRaw: string | null;
  modelApplied: boolean;
  modelError: string | null;
  toolsApplied: string[] | null;
  message: string;
}

/**
 * Switch active role: persist role, set model from config, restrict tools.
 */
export async function applyRole(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  role: Role,
  configResult: LoadConfigResult,
): Promise<ApplyRoleResult> {
  setRole(ctx.cwd, role);

  if (!configResult.config) {
    return {
      ok: false,
      role,
      modelRaw: null,
      modelApplied: false,
      modelError: configResult.error,
      toolsApplied: null,
      message: `Role set to ${role}, but config not loaded: ${configResult.error}`,
    };
  }

  const config = configResult.config;
  const modelRaw = modelRefForRole(config, role);
  let modelApplied = false;
  let modelError: string | null = null;

  try {
    const { provider, modelId } = parseModelRef(modelRaw);
    const model = ctx.modelRegistry.find(provider, modelId);
    if (!model) {
      modelError = `Model not found: ${provider}/${modelId}. Is the provider configured in Pi?`;
    } else {
      const success = await pi.setModel(model);
      if (!success) {
        modelError = `No API key for ${provider}/${modelId}`;
      } else {
        modelApplied = true;
      }
    }
  } catch (err) {
    modelError = err instanceof Error ? err.message : String(err);
  }

  const tools = toolsForRole(config, role);
  let toolsApplied: string[] | null = null;
  if (tools) {
    const all = new Set(pi.getAllTools().map((t) => t.name));
    // Always keep nucleus_attest available for implementer
    const desired = tools.filter((t) => all.has(t) || t === "nucleus_attest");
    // Include custom tools that exist
    const valid = desired.filter((t) => all.has(t));
    if (valid.length > 0) {
      pi.setActiveTools(valid);
      toolsApplied = valid;
    }
  }

  const parts = [`Role → ${role}`];
  if (modelApplied) parts.push(`model ${modelRaw}`);
  else if (modelError) parts.push(`model WARN: ${modelError}`);
  if (toolsApplied) parts.push(`tools: ${toolsApplied.join(", ")}`);

  return {
    ok: modelApplied || !modelError,
    role,
    modelRaw,
    modelApplied,
    modelError,
    toolsApplied,
    message: parts.join(" · "),
  };
}

/** Build system-prompt suffix for current role (injected via before_agent_start). */
export function roleSystemPromptSuffix(role: Role, extra?: string): string {
  const base = loadRolePrompt(role);
  const honesty = `
---
NUCLEUS HONESTY CONTRACT
- Agents can lie. Prefer verifiable claims.
- Never claim tests/builds/commands succeeded without a harness attestation under .nucleus/attestations/.
- Stay in the current role (${role}). Do not mix incentives.
`;
  return [base, honesty, extra].filter(Boolean).join("\n\n");
}
