---
name: nucleus-retro
description: Socratic retro after a Nucleus honesty loop; write deterministic improvements into project rules.
---

# Nucleus Retro Skill

Run after Accept/Reject (or anytime the human wants to improve the harness rules).

## Goal

Turn near-misses and failures into **deterministic** project rules — not vague advice.

## Socratic questions (one at a time)

1. What almost went wrong (fabrication risk, scope drift, unclear Spec)?
2. Where did attestation help — or fail to catch a lie?
3. Did the Reviewer have enough (Spec + Diff + Attestation)? What was missing?
4. Which project rule or skill would have prevented the failure if it already existed?
5. What single deterministic rule should we write back into `AGENTS.md` or `skills/` now?

## Output

- Propose concrete file edits (exact snippets or unified diffs).
- Prefer `AGENTS.md`, `skills/`, `prompts/` — not hidden extension hacks unless necessary.
- Wait for human approval before writing.

## Commands

- `/retro` — start interview
- `/retro log` — append a stub entry to `.nucleus/retro-log.md`
