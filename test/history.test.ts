import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistory,
  maybeRotateHistory,
  migrateNotesToHistory,
  parseLegacyNote,
} from "../src/history.ts";
import { ensureNucleusLayout, historyPath } from "../src/paths.ts";
import { loadState, saveState, transitionPhase } from "../src/state.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nucleus-hist-"));
}

describe("history log", () => {
  it("parses legacy note lines", () => {
    const p = parseLegacyNote("[2026-07-27T12:00:00.000Z] SpecApproved: human approved spec");
    assert.equal(p.ts, "2026-07-27T12:00:00.000Z");
    assert.equal(p.phaseHint, "SpecApproved");
    assert.equal(p.note, "human approved spec");
  });

  it("appends JSONL events", () => {
    const cwd = tmp();
    appendHistory(cwd, {
      ts: "2026-07-27T12:00:00.000Z",
      changeId: "chg-1",
      phase: "SpecDraft",
      event: "transition",
      note: "hello",
    });
    const text = readFileSync(historyPath(cwd), "utf-8");
    const row = JSON.parse(text.trim());
    assert.equal(row.note, "hello");
    assert.equal(row.event, "transition");
  });

  it("migrates notes out of state on load", () => {
    const cwd = tmp();
    // Seed state with ballooning notes without going through transitionPhase
    const s = loadState(cwd);
    s.notes = [
      "[2026-07-27T11:00:00.000Z] SpecDraft: first",
      "[2026-07-27T12:00:00.000Z] SpecApproved: second",
    ];
    s.phase = "SpecApproved";
    s.changeId = "chg-legacy";
    saveState(cwd, s);

    const loaded = loadState(cwd);
    assert.deepEqual(loaded.notes, []);
    assert.ok(existsSync(historyPath(cwd)));
    const lines = readFileSync(historyPath(cwd), "utf-8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /migrated_note/);
  });

  it("transitionPhase writes history not notes", () => {
    const cwd = tmp();
    transitionPhase(cwd, "SpecDraft", {
      startNewChange: true,
      note: "spec draft started",
    });
    const s = loadState(cwd);
    assert.deepEqual(s.notes, []);
    const hist = readFileSync(historyPath(cwd), "utf-8");
    assert.match(hist, /change_boundary|spec draft started|transition/);
  });

  it("migrateNotesToHistory returns count", () => {
    const cwd = tmp();
    const n = migrateNotesToHistory(cwd, ["a", "b"], {
      changeId: null,
      phase: "idle",
    });
    assert.equal(n, 2);
  });

  it("rotates when over size threshold", () => {
    const cwd = tmp();
    ensureNucleusLayout(cwd);
    const path = historyPath(cwd);
    // Force a large file then rotate with tiny threshold
    writeFileSync(path, "x".repeat(100), "utf-8");
    maybeRotateHistory(cwd, 50);
    assert.ok(existsSync(`${path}.1`));
    // After rotation active file may be gone until next append
    appendHistory(cwd, {
      ts: new Date().toISOString(),
      changeId: null,
      phase: "idle",
      event: "note",
      note: "after rotate",
    });
    assert.ok(existsSync(path));
    assert.match(readFileSync(path, "utf-8"), /after rotate/);
  });
});
