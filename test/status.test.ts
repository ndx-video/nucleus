import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttestation } from "../src/attestation/index.ts";
import { formatFullStatus } from "../src/commands/status.ts";
import {
  blockedReason,
  suggestNextActions,
} from "../src/next-actions.ts";
import { createInitialState, loadState, transitionPhase } from "../src/state.ts";
import type { NucleusConfig } from "../src/types.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-status-"));
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

describe("suggestNextActions / blockedReason", () => {
  it("points idle to /spec", () => {
    const s = createInitialState();
    const next = suggestNextActions(s, {
      configLoaded: true,
      verifiedAttestations: 0,
      rawAttestationIds: 0,
      hasSpecOnDisk: false,
    });
    assert.ok(next.some((n) => n.includes("/spec")));
  });

  it("blocks Implementing with 0 verified att", () => {
    const s = createInitialState();
    s.phase = "Implementing";
    const reason = blockedReason(s, {
      configLoaded: true,
      verifiedAttestations: 0,
      rawAttestationIds: 0,
      hasSpecOnDisk: true,
    });
    assert.ok(reason);
    assert.match(reason!, /0 verified/);
  });

  it("after attest suggests /review", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved");
    transitionPhase(cwd, "Implementing");
    await createAttestation(cwd, { command: "echo x" }, config);
    const s = loadState(cwd);
    assert.equal(s.phase, "Attested");
    const next = suggestNextActions(s, {
      configLoaded: true,
      verifiedAttestations: 1,
      rawAttestationIds: 1,
      hasSpecOnDisk: true,
    });
    assert.ok(next.some((n) => n.includes("/review")));
  });
});

describe("formatFullStatus", () => {
  it("is scannable and shows next actions", () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, "nucleus.yaml"),
      `
models:
  planner: "p/planner"
  implementer: "i/impl"
  reviewer: "r/rev"
`,
      "utf-8",
    );
    const text = formatFullStatus(cwd, {
      config: {
        models: {
          planner: "p/planner",
          implementer: "i/impl",
          reviewer: "r/rev",
        },
        roles: {
          implementer: {},
          reviewer: { adversarial: true },
        },
        attestation: {
          required: true,
          store_path: ".nucleus/attestations/",
          require_real_stdout: true,
        },
      },
      error: null,
      sources: [join(cwd, "nucleus.yaml")],
    });
    assert.match(text, /^Nucleus/m);
    assert.match(text, /Phase/);
    assert.match(text, /Role/);
    assert.match(text, /Attest/);
    assert.match(text, /Next/);
    assert.match(text, /\/spec/);
  });

  it("shows blocked when implementing without att", async () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved", { specPath: ".nucleus/specs/current.md" });
    transitionPhase(cwd, "Implementing");
    const text = formatFullStatus(cwd, {
      config,
      error: null,
      sources: ["test"],
    });
    assert.match(text, /0 verified/);
    assert.match(text, /Blocked|nucleus_attest/i);
  });
});
