/**
 * Path helpers for Nucleus local-first storage under `.nucleus/`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const NUCLEUS_DIR = ".nucleus";
export const STATE_FILE = "state.json";
export const ATTESTATIONS_DIR = "attestations";
export const SPECS_DIR = "specs";
export const DEFAULT_SPEC_FILE = "current.md";
export const CONFIG_FILE = "nucleus.yaml";
export const GLOBAL_CONFIG_DIR = ".nucleus";
/** Phase 2.0: last Reviewer isolation kickoff metadata */
export const REVIEW_SESSION_FILE = "review-session.json";
/** Full Review Bundle text written for isolated session injection + audit */
export const REVIEW_BUNDLE_FILE = "review-bundle.md";
/** Incrementing export of assistant responses via /copy-out */
export const OUT_DIR = "out";

export function nucleusRoot(cwd: string): string {
  return resolve(cwd, NUCLEUS_DIR);
}

export function statePath(cwd: string): string {
  return join(nucleusRoot(cwd), STATE_FILE);
}

export function attestationsDir(cwd: string, storePath?: string): string {
  if (storePath) {
    return resolve(cwd, storePath);
  }
  return join(nucleusRoot(cwd), ATTESTATIONS_DIR);
}

export function specsDir(cwd: string): string {
  return join(nucleusRoot(cwd), SPECS_DIR);
}

export function defaultSpecPath(cwd: string): string {
  return join(specsDir(cwd), DEFAULT_SPEC_FILE);
}

export function reviewSessionPath(cwd: string): string {
  return join(nucleusRoot(cwd), REVIEW_SESSION_FILE);
}

export function reviewBundlePath(cwd: string): string {
  return join(nucleusRoot(cwd), REVIEW_BUNDLE_FILE);
}

export function outDir(cwd: string): string {
  return join(nucleusRoot(cwd), OUT_DIR);
}

export function projectConfigPath(cwd: string): string {
  return resolve(cwd, CONFIG_FILE);
}

export function globalConfigPath(homeDir: string = process.env.HOME ?? ""): string {
  return join(homeDir, GLOBAL_CONFIG_DIR, CONFIG_FILE);
}

/** Ensure `.nucleus/` layout exists (state parent + attestations + specs). */
export function ensureNucleusLayout(cwd: string, storePath?: string): void {
  const root = nucleusRoot(cwd);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  const att = attestationsDir(cwd, storePath);
  if (!existsSync(att)) {
    mkdirSync(att, { recursive: true });
  }
  const specs = specsDir(cwd);
  if (!existsSync(specs)) {
    mkdirSync(specs, { recursive: true });
  }
  const out = outDir(cwd);
  if (!existsSync(out)) {
    mkdirSync(out, { recursive: true });
  }
}

/** Relative path from cwd for display / state storage. */
export function toProjectRelative(cwd: string, absolutePath: string): string {
  const abs = resolve(absolutePath);
  const base = resolve(cwd);
  if (abs === base) return ".";
  if (abs.startsWith(base + "/") || abs.startsWith(base + "\\")) {
    return abs.slice(base.length + 1);
  }
  return abs;
}
