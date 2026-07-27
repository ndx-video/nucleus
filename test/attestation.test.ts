import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAttestation,
  loadAttestation,
  hashFiles,
} from "../src/attestation/index.ts";
import { loadState, transitionPhase } from "../src/state.ts";
import type { NucleusConfig } from "../src/types.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-att-"));
}

const minimalConfig: NucleusConfig = {
  models: {
    planner: "a/b",
    implementer: "c/d",
    reviewer: "e/f",
  },
  roles: {
    implementer: { allowed_tools: ["bash", "nucleus_attest"] },
    reviewer: { allowed_tools: ["read", "bash"], adversarial: true },
  },
  attestation: {
    required: true,
    store_path: ".nucleus/attestations/",
    require_real_stdout: true,
  },
};

describe("createAttestation", () => {
  it("captures real command output and writes artifacts", async () => {
    const cwd = tmp();
    // Attestation auto-advances phase only from Implementing
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing", { role: "implementer" });

    const result = await createAttestation(
      cwd,
      { command: "echo hello-nucleus && echo err-msg >&2", label: "smoke" },
      minimalConfig,
    );

    assert.equal(result.artifact.capturedBy, "nucleus_attest");
    assert.equal(result.artifact.exitCode, 0);
    assert.match(result.artifact.stdout, /hello-nucleus/);
    assert.match(result.artifact.stderr, /err-msg/);
    assert.ok(result.artifact.timestamp);
    assert.equal(result.artifact.cwd, cwd);
    assert.ok(existsSync(result.jsonPath));
    assert.ok(existsSync(result.mdPath));

    const onDisk = JSON.parse(readFileSync(result.jsonPath, "utf-8"));
    assert.equal(onDisk.id, result.artifact.id);
    assert.equal(onDisk.capturedBy, "nucleus_attest");

    const state = loadState(cwd);
    assert.ok(state.attestationIds.includes(result.artifact.id));
    assert.equal(state.phase, "Attested");
  });

  it("records non-zero exit codes honestly", async () => {
    const cwd = tmp();
    const result = await createAttestation(
      cwd,
      { command: "exit 7" },
      minimalConfig,
    );
    assert.equal(result.artifact.exitCode, 7);
  });

  it("hashes requested files", async () => {
    const cwd = tmp();
    writeFileSync(join(cwd, "tracked.txt"), "payload", "utf-8");
    const hashes = hashFiles(cwd, ["tracked.txt", "missing.txt"]);
    assert.equal(hashes["tracked.txt"]?.length, 64);
    assert.equal(hashes["missing.txt"], "(missing)");
  });

  it("rejects load of forged artifacts without capturedBy", async () => {
    const cwd = tmp();
    const result = await createAttestation(
      cwd,
      { command: "true" },
      minimalConfig,
    );
    // Overwrite with forgery
    writeFileSync(
      result.jsonPath,
      JSON.stringify({ id: result.artifact.id, exitCode: 0, stdout: "FAKE" }),
      "utf-8",
    );
    const loaded = loadAttestation(cwd, result.artifact.id);
    assert.equal(loaded, null);
  });
});
