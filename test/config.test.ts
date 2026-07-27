import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  parseModelRef,
  validateConfig,
  ConfigError,
} from "../src/config.ts";

describe("parseModelRef", () => {
  it("parses provider/model", () => {
    const r = parseModelRef("anthropic/claude-sonnet-4");
    assert.equal(r.provider, "anthropic");
    assert.equal(r.modelId, "claude-sonnet-4");
  });

  it("supports ollama local models", () => {
    const r = parseModelRef("ollama/llama3.2");
    assert.equal(r.provider, "ollama");
    assert.equal(r.modelId, "llama3.2");
  });

  it("rejects missing slash", () => {
    assert.throws(() => parseModelRef("noslash"), ConfigError);
  });
});

describe("validateConfig", () => {
  it("accepts minimal valid config", () => {
    const c = validateConfig({
      models: {
        planner: "a/b",
        implementer: "c/d",
        reviewer: "e/f",
      },
    });
    assert.equal(c.models.planner, "a/b");
    assert.equal(c.attestation.required, true);
    assert.ok(c.roles.implementer.allowed_tools?.includes("nucleus_attest"));
    assert.equal(c.roles.reviewer.adversarial, true);
  });

  it("injects nucleus_attest into implementer tools", () => {
    const c = validateConfig({
      models: {
        planner: "a/b",
        implementer: "c/d",
        reviewer: "e/f",
      },
      roles: {
        implementer: { allowed_tools: ["read", "bash"] },
      },
    });
    assert.ok(c.roles.implementer.allowed_tools?.includes("nucleus_attest"));
    assert.ok(c.roles.implementer.allowed_tools?.includes("read"));
  });

  it("rejects missing models", () => {
    assert.throws(() => validateConfig({}), ConfigError);
  });
});

describe("loadConfig", () => {
  it("loads project nucleus.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "nucleus-cfg-"));
    writeFileSync(
      join(dir, "nucleus.yaml"),
      `
models:
  planner: "p/planner"
  implementer: "i/impl"
  reviewer: "r/rev"
`,
      "utf-8",
    );
    const result = loadConfig(dir, join(dir, "no-home"));
    assert.equal(result.error, null);
    assert.equal(result.config?.models.planner, "p/planner");
    assert.ok(result.sources.some((s) => s.endsWith("nucleus.yaml")));
  });

  it("merges global then project (project wins)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nucleus-cfg-"));
    const home = join(dir, "home");
    mkdirSync(join(home, ".nucleus"), { recursive: true });
    writeFileSync(
      join(home, ".nucleus", "nucleus.yaml"),
      `
models:
  planner: "g/planner"
  implementer: "g/impl"
  reviewer: "g/rev"
attestation:
  required: false
`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "nucleus.yaml"),
      `
models:
  planner: "p/planner"
  implementer: "g/impl"
  reviewer: "g/rev"
`,
      "utf-8",
    );
    const result = loadConfig(dir, home);
    assert.equal(result.error, null);
    assert.equal(result.config?.models.planner, "p/planner");
    // attestation.required from global remains unless overridden
    assert.equal(result.config?.attestation.required, false);
  });

  it("returns error when missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "nucleus-cfg-"));
    const result = loadConfig(dir, join(dir, "no-home"));
    assert.equal(result.config, null);
    assert.ok(result.error);
  });
});
