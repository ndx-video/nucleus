import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canTransition,
  loadState,
  normalizeReviewResult,
  parseState,
  recordAttestation,
  StateError,
  transitionPhase,
} from "../src/state.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-state-"));
}

describe("normalizeReviewResult", () => {
  it("accepts proper objects", () => {
    const r = normalizeReviewResult({
      verdict: "pass",
      findings: ["ok"],
      reviewedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(r?.verdict, "pass");
    assert.deepEqual(r?.findings, ["ok"]);
  });

  it("normalizes bare string pass/fail (hand-edited state)", () => {
    assert.equal(normalizeReviewResult("pass")?.verdict, "pass");
    assert.equal(normalizeReviewResult("fail")?.verdict, "fail");
    assert.equal(normalizeReviewResult("nope"), null);
  });

  it("parseState tolerates bare reviewResult string", () => {
    const s = parseState({
      version: 1,
      phase: "SpecDraft",
      role: "planner",
      changeId: null,
      specPath: null,
      attestationIds: [],
      reviewResult: "pass",
      overrideReason: null,
      notes: [],
      createdAt: "t",
      updatedAt: "t",
    });
    assert.equal(s.reviewResult?.verdict, "pass");
  });
});

describe("phase transitions", () => {
  it("allows honesty loop path", () => {
    assert.equal(canTransition("idle", "SpecDraft"), true);
    assert.equal(canTransition("SpecDraft", "SpecApproved"), true);
    assert.equal(canTransition("SpecApproved", "Implementing"), true);
    assert.equal(canTransition("Implementing", "Attested"), true);
    assert.equal(canTransition("Attested", "Reviewing"), true);
    assert.equal(canTransition("Reviewing", "Accepted"), true);
    assert.equal(canTransition("Reviewing", "Rejected"), true);
  });

  it("blocks skipping phases", () => {
    assert.equal(canTransition("idle", "Accepted"), false);
    assert.equal(canTransition("SpecDraft", "Implementing"), false);
    assert.equal(canTransition("SpecApproved", "Attested"), false);
  });
});

describe("loadState / transitionPhase", () => {
  it("creates initial idle state", () => {
    const cwd = tmp();
    const s = loadState(cwd);
    assert.equal(s.phase, "idle");
    assert.equal(s.role, "planner");
    assert.equal(s.version, 1);
  });

  it("walks full happy path", () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    let s = loadState(cwd);
    assert.equal(s.phase, "SpecDraft");
    assert.ok(s.changeId);

    s = transitionPhase(cwd, "SpecApproved", { specPath: ".nucleus/specs/current.md" });
    assert.equal(s.phase, "SpecApproved");
    assert.equal(s.specPath, ".nucleus/specs/current.md");

    s = transitionPhase(cwd, "Implementing", { role: "implementer" });
    assert.equal(s.role, "implementer");

    s = recordAttestation(cwd, "att-test-1");
    assert.equal(s.phase, "Attested");
    assert.deepEqual(s.attestationIds, ["att-test-1"]);

    s = transitionPhase(cwd, "Reviewing", { role: "reviewer" });
    s = transitionPhase(cwd, "Accepted", {
      reviewResult: {
        verdict: "pass",
        findings: ["ok"],
        reviewedAt: new Date().toISOString(),
      },
    });
    assert.equal(s.phase, "Accepted");
    assert.equal(s.reviewResult?.verdict, "pass");
  });

  it("throws on illegal transition", () => {
    const cwd = tmp();
    assert.throws(() => transitionPhase(cwd, "Accepted"), StateError);
  });

  it("rejects to implementing re-entry", () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");
    recordAttestation(cwd, "att-1");
    transitionPhase(cwd, "Reviewing");
    transitionPhase(cwd, "Rejected", {
      reviewResult: {
        verdict: "fail",
        findings: ["drift"],
        reviewedAt: new Date().toISOString(),
      },
    });
    const s = transitionPhase(cwd, "Implementing", {
      clearAttestations: true,
      role: "implementer",
    });
    assert.equal(s.phase, "Implementing");
    assert.deepEqual(s.attestationIds, []);
  });
});
