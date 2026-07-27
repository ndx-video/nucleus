import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAssistantTexts,
  formatOutFilename,
  nextOutFileIndex,
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
});
