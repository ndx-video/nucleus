import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSpecPathArg, safeResolveSpecPath } from "../src/commands/spec.ts";

describe("isSpecPathArg", () => {
  it("accepts short path-like tokens", () => {
    assert.equal(isSpecPathArg(".nucleus/specs/current.md"), true);
    assert.equal(isSpecPathArg("docs/feature.md"), true);
    assert.equal(isSpecPathArg("SPEC.md"), true);
    assert.equal(isSpecPathArg("new"), true); // single token (caller filters subcommands)
  });

  it("rejects free-text goals (ENAMETOOLONG root cause)", () => {
    assert.equal(
      isSpecPathArg(
        "Build an inventory module for warehouse receiving with barcode scan and ERP integration",
      ),
      false,
    );
    assert.equal(
      isSpecPathArg("Add feature X. Then wire Y. Also handle Z edge cases."),
      false,
    );
  });

  it("rejects oversized strings", () => {
    assert.equal(isSpecPathArg("a".repeat(300) + ".md"), false);
    assert.equal(isSpecPathArg("x".repeat(500)), false);
  });

  it("rejects newlines", () => {
    assert.equal(isSpecPathArg("foo.md\nbar"), false);
  });
});

describe("safeResolveSpecPath", () => {
  it("resolves short relative paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nucleus-specpath-"));
    const abs = safeResolveSpecPath(cwd, ".nucleus/specs/current.md");
    assert.ok(abs);
    assert.ok(abs!.startsWith(cwd));
    assert.ok(abs!.endsWith("current.md"));
  });

  it("rejects huge path components", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nucleus-specpath-"));
    const huge = "a".repeat(300) + ".md";
    assert.equal(safeResolveSpecPath(cwd, huge), null);
  });

  it("rejects null/empty", () => {
    const cwd = "/tmp";
    assert.equal(safeResolveSpecPath(cwd, null), null);
    assert.equal(safeResolveSpecPath(cwd, ""), null);
  });
});
