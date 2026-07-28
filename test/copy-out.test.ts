import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAssistantTexts,
  computeCopyOutGitignoreWarnings,
  formatOutFilename,
  nextOutFileIndex,
  gitignoreHasDirIgnore,
  pickByRecency,
} from "../src/commands/copy-out.ts";

describe("copy-out helpers", () => {
  it("collects assistant texts in order", () => {
    const branch = [
      { type: "message", message: { role: "user", content: "hi" } },
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "first" }] },
      },
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "second" }] },
      },
    ];
    assert.deepEqual(collectAssistantTexts(branch), ["first", "second"]);
  });

  it("pickByRecency: 1 is most recent", () => {
    const texts = ["a", "b", "c"];
    assert.equal(pickByRecency(texts, 1), "c");
    assert.equal(pickByRecency(texts, 2), "b");
    assert.equal(pickByRecency(texts, 3), "a");
    assert.equal(pickByRecency(texts, 4), null);
    assert.equal(pickByRecency(texts, 0), null);
  });

  it("nextOutFileIndex increments from existing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "nucleus-out-"));
    assert.equal(nextOutFileIndex(dir), 1);
    writeFileSync(join(dir, "0001.md"), "x");
    writeFileSync(join(dir, "0003.md"), "y");
    writeFileSync(join(dir, "notes.md"), "ignore");
    assert.equal(nextOutFileIndex(dir), 4);
  });

  it("formatOutFilename pads to 4 digits", () => {
    assert.equal(formatOutFilename(1), "0001.md");
    assert.equal(formatOutFilename(42), "0042.md");
    assert.equal(formatOutFilename(1234), "1234.md");
  });

  it("gitignoreHasDirIgnore detects .out/ ignore entries", () => {
    assert.equal(gitignoreHasDirIgnore(".out/\n", ".out"), true);
    assert.equal(gitignoreHasDirIgnore(".out\n", ".out"), true);
    assert.equal(gitignoreHasDirIgnore(".out/**\n", ".out"), true);
    assert.equal(gitignoreHasDirIgnore("out/\n", ".out"), false);
  });

  it("computeCopyOutGitignoreWarnings warns when .out exists but is not ignored", () => {
    const warnings = computeCopyOutGitignoreWarnings({
      outExists: true,
      gitignoreText: ".nucleus/\n",
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!.message, /STERN WARNING/);
  });

  it("computeCopyOutGitignoreWarnings warns when .nucleus is not ignored", () => {
    const warnings = computeCopyOutGitignoreWarnings({
      outExists: false,
      gitignoreText: "",
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!.message, /WARNING: `\.nucleus/);
  });

  it("computeCopyOutGitignoreWarnings returns both warnings when both are missing", () => {
    const warnings = computeCopyOutGitignoreWarnings({
      outExists: true,
      gitignoreText: "",
    });
    assert.equal(warnings.length, 2);
  });
});
