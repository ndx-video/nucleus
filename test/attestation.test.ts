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
import { attestKeyPath } from "../src/attestation/integrity.ts";
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
  it("captures real command output and writes integrity-tagged artifacts", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing", { role: "implementer" });

    const result = await createAttestation(
      cwd,
      { command: "echo hello-nucleus && echo err-msg >&2", label: "smoke" },
      minimalConfig,
    );

    assert.equal(result.artifact.capturedBy, "nucleus_attest");
    assert.equal(result.artifact.version, 2);
    assert.match(result.artifact.integrity, /^hmac-sha256:[0-9a-f]{64}$/);
    assert.equal(result.artifact.exitCode, 0);
    assert.match(result.artifact.stdout, /hello-nucleus/);
    assert.match(result.artifact.stderr, /err-msg/);
    assert.ok(result.artifact.timestamp);
    assert.equal(result.artifact.cwd, cwd);
    assert.ok(existsSync(result.jsonPath));
    assert.ok(existsSync(result.mdPath));
    assert.ok(existsSync(attestKeyPath(cwd)), "project-local attest.key must exist");

    const onDisk = JSON.parse(readFileSync(result.jsonPath, "utf-8"));
    assert.equal(onDisk.id, result.artifact.id);
    assert.equal(onDisk.capturedBy, "nucleus_attest");
    assert.equal(onDisk.integrity, result.artifact.integrity);

    // Real harness-produced artifact still loads
    const loaded = loadAttestation(cwd, result.artifact.id);
    assert.ok(loaded);
    assert.equal(loaded!.id, result.artifact.id);
    assert.equal(loaded!.integrity, result.artifact.integrity);

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
    assert.ok(loadAttestation(cwd, result.artifact.id));
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
    writeFileSync(
      result.jsonPath,
      JSON.stringify({ id: result.artifact.id, exitCode: 0, stdout: "FAKE" }),
      "utf-8",
    );
    const loaded = loadAttestation(cwd, result.artifact.id);
    assert.equal(loaded, null);
  });

  it("rejects hand-written file that only has the capturedBy marker", async () => {
    const cwd = tmp();
    // Establish a real secret so we are not rejecting merely for missing key
    const real = await createAttestation(cwd, { command: "echo real" }, minimalConfig);
    assert.ok(loadAttestation(cwd, real.artifact.id));

    const fakeId = "att-forged-marker-only";
    const fakePath = join(cwd, ".nucleus", "attestations", `${fakeId}.json`);
    writeFileSync(
      fakePath,
      JSON.stringify(
        {
          id: fakeId,
          timestamp: new Date().toISOString(),
          cwd,
          command: "npm test",
          exitCode: 0,
          stdout: "all tests passed (forged)",
          stderr: "",
          durationMs: 1,
          git: { head: "deadbeef", branch: "main", status: "(clean)", dirty: false },
          fileHashes: {},
          capturedBy: "nucleus_attest",
          version: 2,
          changeId: null,
          // deliberately no integrity / wrong integrity
        },
        null,
        2,
      ),
      "utf-8",
    );
    assert.equal(loadAttestation(cwd, fakeId), null);
  });

  it("rejects marker + fake integrity string", async () => {
    const cwd = tmp();
    await createAttestation(cwd, { command: "echo seed" }, minimalConfig);

    const fakeId = "att-forged-fake-mac";
    const fakePath = join(cwd, ".nucleus", "attestations", `${fakeId}.json`);
    writeFileSync(
      fakePath,
      JSON.stringify(
        {
          id: fakeId,
          timestamp: new Date().toISOString(),
          cwd,
          command: "npm test",
          exitCode: 0,
          stdout: "PASS",
          stderr: "",
          durationMs: 1,
          git: { head: null, branch: null, status: "(clean)", dirty: false },
          fileHashes: {},
          capturedBy: "nucleus_attest",
          integrity: "hmac-sha256:" + "ab".repeat(32),
          version: 2,
          changeId: null,
        },
        null,
        2,
      ),
      "utf-8",
    );
    assert.equal(loadAttestation(cwd, fakeId), null);
  });

  it("rejects tampered stdout that reuses a real integrity tag", async () => {
    const cwd = tmp();
    const result = await createAttestation(
      cwd,
      { command: "echo original-output" },
      minimalConfig,
    );
    assert.ok(loadAttestation(cwd, result.artifact.id));

    const onDisk = JSON.parse(readFileSync(result.jsonPath, "utf-8"));
    onDisk.stdout = "TAMPERED — all tests passed";
    // keep original integrity tag
    writeFileSync(result.jsonPath, JSON.stringify(onDisk, null, 2) + "\n", "utf-8");

    assert.equal(loadAttestation(cwd, result.artifact.id), null);
  });
});
