import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttestation } from "../src/attestation/index.ts";
import { buildReviewerContext } from "../src/context.ts";
import {
  assertKickoffIsIsolated,
  buildIsolatedReviewPrompt,
  formatIsolationMode,
  loadReviewSessionMeta,
  supportsNewSession,
  writeReviewKickoff,
} from "../src/review-isolation.ts";
import { transitionPhase } from "../src/state.ts";
import type { NucleusConfig } from "../src/types.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-iso-"));
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

describe("Phase 2.0 reviewer isolation helpers", () => {
  it("buildIsolatedReviewPrompt contains only bundle + isolation header", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");
    await createAttestation(cwd, { command: "echo iso-test" }, config);

    const bundle = await buildReviewerContext(cwd, config, { reverify: true });
    const prompt = buildIsolatedReviewPrompt(bundle);

    const check = assertKickoffIsIsolated(prompt);
    assert.equal(check.ok, true, check.reasons.join("; "));
    assert.match(prompt, /BEGIN REVIEW BUNDLE/);
    assert.match(prompt, /iso-test/);
    assert.match(prompt, /Independent re-execution/i);
    // Must not look like a chat transcript dump (header may mention "history" in prose)
    assert.equal(/^#{1,3}\s*Conversation History\b/im.test(prompt), false);
    assert.equal(/##\s*Conversation History\b/i.test(prompt), false);
  });

  it("writeReviewKickoff persists meta + bundle for audit", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");
    await createAttestation(cwd, { command: "echo persist" }, config);
    const bundle = await buildReviewerContext(cwd, config, { reverify: false });

    const kickoff = writeReviewKickoff(cwd, bundle, {
      changeId: "chg-test",
      parentSession: "/tmp/parent-session.jsonl",
      isolation: "new_session",
    });

    assert.equal(kickoff.meta.isolation, "new_session");
    assert.equal(kickoff.meta.parentSession, "/tmp/parent-session.jsonl");
    assert.ok(existsSync(join(cwd, ".nucleus", "review-bundle.md")));
    assert.ok(existsSync(join(cwd, ".nucleus", "review-session.json")));

    const onDisk = readFileSync(join(cwd, ".nucleus", "review-bundle.md"), "utf-8");
    assert.equal(onDisk, kickoff.prompt);

    const meta = loadReviewSessionMeta(cwd);
    assert.ok(meta);
    assert.equal(meta!.isolation, "new_session");
    assert.equal(meta!.kickoffDelivered, false);
    assert.equal(meta!.changeId, "chg-test");
  });

  it("formatIsolationMode distinguishes explicit same-session from fallback", () => {
    assert.equal(formatIsolationMode("new_session"), "new_session");
    assert.equal(formatIsolationMode("same_session_explicit"), "same_session (requested)");
    assert.equal(formatIsolationMode("same_session_fallback"), "same_session (fallback)");
  });

  it("writeReviewKickoff records same_session_explicit when requested", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");
    await createAttestation(cwd, { command: "echo explicit" }, config);
    const bundle = await buildReviewerContext(cwd, config, { reverify: false });

    writeReviewKickoff(cwd, bundle, {
      changeId: "chg-explicit",
      parentSession: null,
      isolation: "same_session_explicit",
    });

    const meta = loadReviewSessionMeta(cwd);
    assert.equal(meta!.isolation, "same_session_explicit");
  });

  it("supportsNewSession detects ExtensionCommandContext capability", () => {
    assert.equal(supportsNewSession({ newSession: async () => ({ cancelled: false }) }), true);
    assert.equal(supportsNewSession({}), false);
    assert.equal(supportsNewSession({ newSession: "nope" }), false);
  });

  it("assertKickoffIsIsolated rejects conversation-history dumps", () => {
    const bad = [
      "# Conversation History",
      "Implementer said: tests passed for sure",
      "chain-of-thought dump follows",
    ].join("\n");
    const check = assertKickoffIsIsolated(bad);
    assert.equal(check.ok, false);
    assert.ok(check.reasons.length >= 1);
  });
});
