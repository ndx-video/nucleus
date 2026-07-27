/**
 * Load and validate nucleus.yaml (project → global merge).
 * Model nomination is the human's authority; we never hard-code model names.
 */

import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { globalConfigPath, projectConfigPath } from "./paths.ts";
import type { AttestationConfig, NucleusConfig, ParsedModelRef, RoleConfig } from "./types.ts";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_ATTESTATION: AttestationConfig = {
  required: true,
  store_path: ".nucleus/attestations/",
  require_real_stdout: true,
};

const DEFAULT_IMPLEMENTER_ROLE: RoleConfig = {
  allowed_tools: ["read", "write", "edit", "bash", "grep", "find", "ls", "nucleus_attest"],
};

const DEFAULT_REVIEWER_ROLE: RoleConfig = {
  allowed_tools: ["read", "bash", "grep", "find", "ls", "nucleus_verify"],
  adversarial: true,
};

const DEFAULT_PLANNER_ROLE: RoleConfig = {
  allowed_tools: undefined, // full access
};

export function parseModelRef(raw: string): ParsedModelRef {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ConfigError("Model reference must be a non-empty string (e.g. provider/model-id)");
  }
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new ConfigError(
      `Invalid model reference "${raw}". Expected "provider/model-id" (e.g. anthropic/claude-sonnet-4 or ollama/llama3.2).`,
    );
  }
  return {
    provider: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
    raw: trimmed,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConfigError(`Config field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ConfigError(`Config field "${field}" must be an array of strings`);
  }
  return value.map((v) => v.trim()).filter(Boolean);
}

function parseRoleConfig(raw: unknown, field: string): RoleConfig {
  if (raw === undefined) return {};
  if (!isObject(raw)) {
    throw new ConfigError(`Config field "${field}" must be an object`);
  }
  const allowed = asStringArray(raw.allowed_tools, `${field}.allowed_tools`);
  const adversarial =
    raw.adversarial === undefined ? undefined : Boolean(raw.adversarial);
  return {
    ...(allowed ? { allowed_tools: allowed } : {}),
    ...(adversarial !== undefined ? { adversarial } : {}),
  };
}

function parseAttestation(raw: unknown): AttestationConfig {
  if (raw === undefined) return { ...DEFAULT_ATTESTATION };
  if (!isObject(raw)) {
    throw new ConfigError('Config field "attestation" must be an object');
  }
  return {
    required: raw.required === undefined ? DEFAULT_ATTESTATION.required : Boolean(raw.required),
    store_path:
      raw.store_path === undefined
        ? DEFAULT_ATTESTATION.store_path
        : asString(raw.store_path, "attestation.store_path"),
    require_real_stdout:
      raw.require_real_stdout === undefined
        ? DEFAULT_ATTESTATION.require_real_stdout
        : Boolean(raw.require_real_stdout),
  };
}

/**
 * Validate a raw YAML/JSON object into NucleusConfig.
 * Throws ConfigError on invalid shape.
 */
export function validateConfig(raw: unknown): NucleusConfig {
  if (!isObject(raw)) {
    throw new ConfigError("nucleus.yaml root must be a mapping/object");
  }

  if (!isObject(raw.models)) {
    throw new ConfigError('nucleus.yaml must define "models" with planner, implementer, reviewer');
  }

  const planner = asString(raw.models.planner, "models.planner");
  const implementer = asString(raw.models.implementer, "models.implementer");
  const reviewer = asString(raw.models.reviewer, "models.reviewer");

  // Validate model ref format early
  parseModelRef(planner);
  parseModelRef(implementer);
  parseModelRef(reviewer);

  const rolesRaw = isObject(raw.roles) ? raw.roles : {};

  const implementerRole: RoleConfig = {
    ...DEFAULT_IMPLEMENTER_ROLE,
    ...parseRoleConfig(rolesRaw.implementer, "roles.implementer"),
  };
  // Always ensure nucleus_attest is available to implementer when attestation required
  if (!implementerRole.allowed_tools) {
    implementerRole.allowed_tools = [...(DEFAULT_IMPLEMENTER_ROLE.allowed_tools ?? [])];
  } else if (!implementerRole.allowed_tools.includes("nucleus_attest")) {
    implementerRole.allowed_tools = [...implementerRole.allowed_tools, "nucleus_attest"];
  }

  const reviewerRole: RoleConfig = {
    ...DEFAULT_REVIEWER_ROLE,
    ...parseRoleConfig(rolesRaw.reviewer, "roles.reviewer"),
  };
  if (reviewerRole.adversarial === undefined) {
    reviewerRole.adversarial = true;
  }
  // Always ensure nucleus_verify is available for independent re-execution (Phase 1.2)
  if (!reviewerRole.allowed_tools) {
    reviewerRole.allowed_tools = [...(DEFAULT_REVIEWER_ROLE.allowed_tools ?? [])];
  } else if (!reviewerRole.allowed_tools.includes("nucleus_verify")) {
    reviewerRole.allowed_tools = [...reviewerRole.allowed_tools, "nucleus_verify"];
  }

  const plannerRole: RoleConfig = {
    ...DEFAULT_PLANNER_ROLE,
    ...parseRoleConfig(rolesRaw.planner, "roles.planner"),
  };

  const attestation = parseAttestation(raw.attestation);

  const spec_path =
    raw.spec_path === undefined ? undefined : asString(raw.spec_path, "spec_path");

  return {
    models: { planner, implementer, reviewer },
    roles: {
      implementer: implementerRole,
      reviewer: reviewerRole,
      planner: plannerRole,
    },
    attestation,
    ...(spec_path ? { spec_path } : {}),
  };
}

export interface LoadConfigResult {
  config: NucleusConfig | null;
  error: string | null;
  sources: string[];
}

function readYamlFile(path: string): unknown {
  const text = readFileSync(path, "utf-8");
  return parseYaml(text);
}

/**
 * Load order: project `nucleus.yaml` → global `~/.nucleus/nucleus.yaml`.
 * Project wins on key-level merge for models/roles/attestation.
 */
export function loadConfig(cwd: string, homeDir?: string): LoadConfigResult {
  const sources: string[] = [];
  const projectPath = projectConfigPath(cwd);
  const globalPath = globalConfigPath(homeDir);

  let merged: Record<string, unknown> = {};

  if (existsSync(globalPath)) {
    try {
      const g = readYamlFile(globalPath);
      if (isObject(g)) {
        merged = deepMerge(merged, g);
        sources.push(globalPath);
      }
    } catch (err) {
      return {
        config: null,
        error: `Failed to parse global config ${globalPath}: ${err instanceof Error ? err.message : String(err)}`,
        sources,
      };
    }
  }

  if (existsSync(projectPath)) {
    try {
      const p = readYamlFile(projectPath);
      if (isObject(p)) {
        merged = deepMerge(merged, p);
        sources.push(projectPath);
      }
    } catch (err) {
      return {
        config: null,
        error: `Failed to parse project config ${projectPath}: ${err instanceof Error ? err.message : String(err)}`,
        sources,
      };
    }
  }

  if (sources.length === 0) {
    return {
      config: null,
      error: `No nucleus.yaml found. Create ${CONFIG_HINT} (see nucleus.config.example.yaml).`,
      sources,
    };
  }

  try {
    return { config: validateConfig(merged), error: null, sources };
  } catch (err) {
    return {
      config: null,
      error: err instanceof Error ? err.message : String(err),
      sources,
    };
  }
}

const CONFIG_HINT = "nucleus.yaml";

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (isObject(value) && isObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function defaultConfigTemplate(): string {
  return `# Nucleus — copy to nucleus.yaml (or ~/.nucleus/nucleus.yaml).
# Runtime: .nucleus/ (state, specs, attestations, attest.key — do not commit key)

models:
  planner: "anthropic/claude-opus-4"
  implementer: "anthropic/claude-sonnet-4"
  reviewer: "openai/gpt-4.1"

roles:
  implementer:
    allowed_tools: ["read", "write", "edit", "bash", "grep", "find", "ls", "nucleus_attest"]
  reviewer:
    allowed_tools: ["read", "bash", "grep", "find", "ls", "nucleus_verify"]
    adversarial: true

attestation:
  required: true
  store_path: ".nucleus/attestations/"
  require_real_stdout: true
`;
}
