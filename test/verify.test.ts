import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countVerifiedAttestations,
  createAttestation,
  hasVerifiedAttestation,
  listAttestations,
  loadAttestation,
} from "../src/attestation/index.ts";
import {
  compareAttestationToReexec,
  reexecuteAttestation,
} from "../src/attestation/verify.ts";
import { buildStatusSnapshot } from "../src/commands/status.ts";
import { buildReviewerContext } from "../src/context.ts";
import { loadState, recordAttestation, saveState, transitionPhase } from "../src/state.ts";
import type { NucleusConfig } from "../src/types.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-verify-"));
}

const config: NucleusConfig = {
  models: { planner: "a/b", implementer: "c/d", reviewer: "e/f" },
  roles: {
    implementer: { allowed_tools: ["bash", "nucleus_attest"] },
    reviewer: { allowed_tools: ["read", "bash", "nucleus_verify"], adversarial: true },
  },
  attestation: {
    required: true,
    store_path: ".nucleus/attestations/",
    require_real_stdout: true,
  },
};

describe("verified-only counts and gates", () => {
  it("counts only integrity-verified attestations", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");

    const real = await createAttestation(cwd, { command: "echo ok" }, config);
    assert.equal(countVerifiedAttestations(cwd), 1);
    assert.equal(hasVerifiedAttestation(cwd), true);
    assert.deepEqual(listAttestations(cwd), [real.artifact.id]);

    // Inject a forged raw id into state without a valid file
    const state = loadState(cwd);
    state.attestationIds.push("att-forged-only-in-state");
    saveState(cwd, state);

    assert.equal(state.attestationIds.length, 2);
    assert.equal(countVerifiedAttestations(cwd), 1);
    assert.equal(loadAttestation(cwd, "att-forged-only-in-state"), null);
  });

  it("status snapshot uses verified count, not raw ids", async () => {
    const cwd = tmp();
    await createAttestation(cwd, { command: "echo status" }, config);
    const state = loadState(cwd);
    state.attestationIds.push("att-ghost");
    saveState(cwd, state);

    const snap = buildStatusSnapshot(cwd, {
      config,
      error: null,
      sources: ["test"],
    });
    assert.equal(snap.attestationCount, 1);
    assert.notEqual(snap.latestAttestationId, "att-ghost");
  });

  it("review bundle hasAttestation false when only forged ids exist", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    // Simulate forged path: raw id recorded, no valid artifact
    recordAttestation(cwd, "att-forged-marker");
    // Force phase as if someone faked advancement — still no verified file
    const st = loadState(cwd);
    st.phase = "Attested";
    st.attestationIds = ["att-forged-marker"];
    saveState(cwd, st);

    writeFileSync(
      join(cwd, ".nucleus", "attestations", "att-forged-marker.json"),
      JSON.stringify({
        id: "att-forged-marker",
        capturedBy: "nucleus_attest",
        exitCode: 0,
        stdout: "fake",
        command: "true",
      }),
      "utf-8",
    );

    assert.equal(hasVerifiedAttestation(cwd), false);
    const bundle = await buildReviewerContext(cwd, config, { reverify: false });
    assert.equal(bundle.hasAttestation, false);
    assert.equal(bundle.attestationIds.length, 0);
  });
});

describe("independent re-execution", () => {
  it("matches a fresh harness attestation", async () => {
    const cwd = tmp();
    const result = await createAttestation(
      cwd,
      { command: "echo independent-ok" },
      config,
    );
    const v = await reexecuteAttestation(cwd, result.artifact.id);
    assert.ok(v);
    assert.equal(v!.verdict, "match");
    assert.equal(v!.exitCodeMatch, true);
    assert.equal(v!.stdoutMatch, true);
  });

  it("detects exit code mismatch", async () => {
    const cwd = tmp();
    const result = await createAttestation(cwd, { command: "exit 0" }, config);
    const artifact = loadAttestation(cwd, result.artifact.id)!;
    // Simulate re-exec failure comparison without rewriting signed artifact
    const comparison = compareAttestationToReexec(artifact, {
      exitCode: 1,
      stdout: "",
      stderr: "boom",
      durationMs: 5,
    });
    assert.equal(comparison.verdict, "exit_mismatch");
    assert.equal(comparison.exitCodeMatch, false);
  });

  it("detects output mismatch when exit matches", async () => {
    const cwd = tmp();
    const result = await createAttestation(cwd, { command: "echo a" }, config);
    const artifact = loadAttestation(cwd, result.artifact.id)!;
    const comparison = compareAttestationToReexec(artifact, {
      exitCode: artifact.exitCode,
      stdout: "different\n",
      stderr: artifact.stderr,
      durationMs: 3,
    });
    assert.equal(comparison.verdict, "output_mismatch");
    assert.equal(comparison.exitCodeMatch, true);
    assert.equal(comparison.stdoutMatch, false);
  });

  it("embeds re-execution results in review bundle by default", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");
    await createAttestation(cwd, { command: "echo bundle-reexec" }, config);

    const bundle = await buildReviewerContext(cwd, config, { reverify: true });
    assert.equal(bundle.hasAttestation, true);
    assert.equal(bundle.verifications.length, 1);
    assert.equal(bundle.verifications[0]!.verdict, "match");
    assert.match(bundle.text, /Independent re-execution/i);
    assert.match(bundle.text, /bundle-reexec/);
    assert.equal(bundle.hasVerificationMismatch, false);
  });
});
