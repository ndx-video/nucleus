---
name: nucleus-spec
description: Create and refine lightweight Nucleus Specs (Goal, Constraints, Acceptance Criteria, Out-of-Scope, Decision Log).
---

# Nucleus Spec Skill

Use this when creating or refining a Spec for non-trivial work.

## Template

```markdown
# Nucleus Spec

## Goal

<!-- What should be true when this change is done? One clear outcome. -->

## Constraints

<!-- Hard limits: tech, time, compatibility, style, security. -->

## Acceptance Criteria

<!-- Testable checks. Prefer commands that can be attested via nucleus_attest. -->

- [ ] 
- [ ] 

## Out-of-Scope

<!-- Explicit non-goals. Prevents scope drift. -->

## Decision Log / Open Questions

| Decision / Question | Status | Notes |
|---------------------|--------|-------|
|                     | open   |       |
```

## Rules

- Keep ceremony low: one markdown file under `.nucleus/specs/` (default `current.md`).
- Acceptance Criteria should map to commands the Implementer can run with `nucleus_attest`.
- Out-of-Scope is mandatory for honesty — it is the anti-drift surface.
- Prefer open questions over silent assumptions.
- Human approves via `/spec approve` before `/implement`.

## Commands

- `/spec` — create or refine
- `/spec new` — reset template at default path
- `/spec approve` — phase → SpecApproved
- `/spec path/to/file.md` — use a custom path
