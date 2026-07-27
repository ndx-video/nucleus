/**
 * /copy-out <n> — copy the Nth most recent assistant response to .nucleus/out/NNNN.md
 *
 * Recency index: 1 = most recent assistant reply, 2 = previous, etc.
 * Filenames increment independently: 0001.md, 0002.md, …
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ensureNucleusLayout, outDir, toProjectRelative } from "../paths.ts";

interface TextPart {
  type: string;
  text?: string;
}

interface AssistantLike {
  role?: string;
  content?: string | TextPart[];
}

/**
 * Collect assistant message texts from a session branch (oldest → newest).
 */
export function collectAssistantTexts(branch: Array<{ type?: string; message?: AssistantLike }>): string[] {
  const texts: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || !entry.message) continue;
    if (entry.message.role !== "assistant") continue;
    const text = extractTextContent(entry.message);
    if (text.trim()) texts.push(text);
  }
  return texts;
}

export function extractTextContent(message: AssistantLike): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is TextPart & { text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

/**
 * Recency index 1 = last assistant message.
 * Returns null if index is out of range.
 */
export function pickByRecency(textsOldestFirst: string[], recencyIndex: number): string | null {
  if (!Number.isInteger(recencyIndex) || recencyIndex < 1) return null;
  const i = textsOldestFirst.length - recencyIndex;
  if (i < 0 || i >= textsOldestFirst.length) return null;
  return textsOldestFirst[i]!;
}

/** Next 0001-style index from existing NNNN.md files in dir. */
export function nextOutFileIndex(dir: string): number {
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const name of readdirSync(dir)) {
    const m = /^(\d{4})\.md$/.exec(name);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (n > max) max = n;
  }
  return max + 1;
}

export function formatOutFilename(index: number): string {
  return `${String(index).padStart(4, "0")}.md`;
}

export function registerCopyOutCommand(pi: ExtensionAPI): void {
  pi.registerCommand("copy-out", {
    description:
      "Copy Nth most recent assistant reply to .nucleus/out/NNNN.md (1 = most recent)",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const raw = (args ?? "").trim();
      // Default to most recent when no args
      if (raw !== "" && !/^\d+$/.test(raw)) {
        ctx.ui.notify("Usage: /copy-out [n]  (1 = most recent assistant reply)", "error");
        return;
      }
      const n = raw === "" ? 1 : Number.parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 1) {
        ctx.ui.notify("Usage: /copy-out [n]  (1 = most recent assistant reply)", "error");
        return;
      }

      ensureNucleusLayout(ctx.cwd);
      const dir = outDir(ctx.cwd);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      let branch: Array<{ type?: string; message?: AssistantLike }> = [];
      try {
        branch = ctx.sessionManager.getBranch() as typeof branch;
      } catch (err) {
        ctx.ui.notify(
          `Cannot read session: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }

      const texts = collectAssistantTexts(branch);
      if (texts.length === 0) {
        ctx.ui.notify("No assistant replies in this session branch.", "error");
        return;
      }

      const body = pickByRecency(texts, n);
      if (body === null) {
        ctx.ui.notify(
          `Only ${texts.length} assistant reply(ies). /copy-out ${n} is out of range (use 1–${texts.length}).`,
          "error",
        );
        return;
      }

      const index = nextOutFileIndex(dir);
      const filename = formatOutFilename(index);
      const abs = join(dir, filename);
      const header = [
        `<!-- nucleus /copy-out recency=${n} of ${texts.length} · ${new Date().toISOString()} -->`,
        "",
      ].join("\n");

      writeFileSync(abs, header + body + (body.endsWith("\n") ? "" : "\n"), "utf-8");

      const rel = toProjectRelative(ctx.cwd, abs);
      ctx.ui.notify(`Wrote assistant #${n} → ${rel}`, "info");
      pi.sendMessage({
        customType: "nucleus-copy-out",
        content: `Copied assistant reply (recency ${n}/${texts.length}) to \`${rel}\` (${body.length} chars).`,
        display: true,
        details: { path: rel, recency: n, total: texts.length, chars: body.length },
      });
    },
  });
}
