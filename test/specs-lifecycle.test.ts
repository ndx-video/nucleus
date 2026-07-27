import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPEC_TEMPLATE } from "../src/context.ts";
import { defaultSpecPath, ensureNucleusLayout } from "../src/paths.ts";
import {
  archiveOnAccept,
  archiveSpecFile,
  prepareFreshCurrentSpec,
} from "../src/specs.ts";
import { loadState, saveState, transitionPhase } from "../src/state.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-speclc-"));
}

describe("spec lifecycle / current.md rotation", () => {
  it("archives non-template Spec and writes fresh current.md", () => {
    const cwd = tmp();
    ensureNucleusLayout(cwd);
    const cur = defaultSpecPath(cwd);
    writeFileSync(cur, "# Nucleus Spec — Phase 0\n\n## Goal\n\nDone stuff.\n", "utf-8");

    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    const state = loadState(cwd);
    state.specPath = ".nucleus/specs/current.md";
    saveState(cwd, state);

    const fresh = prepareFreshCurrentSpec(cwd, {
      changeId: state.changeId,
      archiveLabel: "new-change",
    });

    assert.ok(fresh.archived);
    assert.ok(fresh.archived!.includes("archive/"));
    assert.ok(existsSync(join(cwd, fresh.archived!)));
    assert.match(readFileSync(join(cwd, fresh.archived!), "utf-8"), /Phase 0/);
    assert.equal(readFileSync(fresh.absPath, "utf-8").trim(), SPEC_TEMPLATE.trim());
    assert.equal(fresh.specPath, ".nucleus/specs/current.md");
  });

  it("skips archiving pure template", () => {
    const cwd = tmp();
    ensureNucleusLayout(cwd);
    const cur = defaultSpecPath(cwd);
    writeFileSync(cur, SPEC_TEMPLATE, "utf-8");
    const archived = archiveSpecFile(cwd, cur, {
      changeId: "chg-test",
      label: "x",
    });
    assert.equal(archived, null);
  });

  it("archiveOnAccept preserves accepted Spec", () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", { startNewChange: true });
    transitionPhase(cwd, "SpecApproved", { specPath: ".nucleus/specs/current.md" });
    const cur = defaultSpecPath(cwd);
    writeFileSync(cur, "# Accepted Spec\n\n## Goal\n\nShip it.\n", "utf-8");
    const s = loadState(cwd);
    s.specPath = ".nucleus/specs/current.md";
    saveState(cwd, s);

    const path = archiveOnAccept(cwd);
    assert.ok(path);
    assert.match(path!, /accepted/);
    assert.match(readFileSync(join(cwd, path!), "utf-8"), /Ship it/);
    // working file still present
    assert.ok(existsSync(cur));
  });
});
