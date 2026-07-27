# Nucleus — The Honesty Harness

**Agents can lie. Nucleus makes lying hard and detection automatic.**

This repository implements **Nucleus**, a local-first Pi coding agent harness focused on restoring trust in generative coding through structured specs, forced attestation of real execution, and adversarial review.

## Core Principles

1. **Honesty over cleverness** — Prefer verifiable claims over confident statements. If something was not actually run, do not claim it was.
2. **Spec first** — No non-trivial implementation without an approved Nucleus Spec.
3. **Attestation is mandatory** — Any claim involving tests, builds, or commands must be backed by a real harness-captured attestation artifact.
4. **Role separation** — Planner, Implementer, and Adversarial Reviewer have different incentives and (where possible) different context.
5. **Human remains the authority** — The developer nominates models per role and can always override.

## Project Structure (key paths)

```
nucleus/
├── nucleus.yaml                 # Model nomination + role config (source of truth)
├── .nucleus/                    # Runtime state, attestations, current phase
│   ├── state.json               # Current change phase
│   └── attestations/            # Real execution artifacts
├── src/                         # TypeScript extensions (hard enforcement)
├── skills/                      # Soft procedural knowledge (templates, retro)
├── prompts/                     # Role system prompts
└── examples/
```

Do **not** invent new top-level directories without updating this file and the relevant specs.

## Roles & Incentives

| Role | Primary Incentive | Notes |
|------|-------------------|-------|
| **Planner** | Completeness and clarity of intent | Prefer SOTA models. Human-led. |
| **Implementer** | Faithfulness to the Spec only | Must produce real attestation. Restricted tools. |
| **Adversarial Reviewer** | Actively seek fabrication, missing evidence, scope drift, Spec violations | Different model recommended. Clean context preferred (Spec + Diff + Attestation only). No write access by default. |

When acting in a role, stay in character. Do not mix incentives.

## The Honesty Loop (Phase 1)

```
Spec (approved) → Implement → Attest (real capture) → Adversarial Review → Accept / Reject → Retro
```

### Commands (when available)

- `/nucleus` or `/n` — Show current honesty state / phase
- `/spec` — Create or refine a Nucleus Spec
- `/implement` — Hand approved Spec to Implementer
- `/review` — Launch Adversarial Reviewer with restricted context
- `/accept` — Mark change accepted (only after review or explicit human override)
- `/retro` — Socratic interview that writes deterministic improvements back into project rules

### Phase State

The harness tracks phase under `.nucleus/`. Do not skip phases. If the current phase does not allow an action, say so clearly.

## Nucleus Spec Rules

A valid Spec for non-trivial work must contain at minimum:

- **Goal**
- **Constraints**
- **Acceptance Criteria** (testable)
- **Out-of-Scope**
- **Decision Log / Open Questions**

Keep Specs lean. Prefer one clear markdown artifact over many files in Phase 1.

## Attestation Rules (Critical)

- Never claim that tests passed, a build succeeded, or a command produced a particular result unless a real attestation artifact exists.
- The attestation tool is owned by the harness. It captures real stdout/stderr, exit code, timestamp, cwd, and git/status information.
- Attestation artifacts live in `.nucleus/attestations/`.
- The Adversarial Reviewer **must** receive and inspect the attestation. It may re-run commands if suspicious.
- Fabricating or hand-writing an attestation is a critical honesty violation.

## Model Nomination

Models are nominated by the human in `nucleus.yaml` (or the example config). Do not hard-code model names in prompts or code. Respect the configured model for the current role.

Local models (Ollama etc.) are first-class citizens.

## Development Rules for This Repository

- This package is developed **outside** a running Nucleus/Pi session that loads itself. Use Cursor, Claude Code, or another harness to edit the code. This avoids meta-confusion.
- Prefer small, reviewable changes.
- When adding enforcement logic, put it in extensions/hooks rather than relying only on prompts.
- Skills are for soft procedural knowledge. Hard constraints (attestation, role tool restrictions, phase gates) belong in the TypeScript extension layer.
- Keep Phase 1 ruthlessly thin. Do not implement multi-reviewer batteries, full OpenSpec compatibility, or heavy auto-sizers yet.

## What “Done” Means for a Change

A change is considered honestly complete only when:

1. There is an approved Spec (or an explicit human decision that the change is trivial).
2. Implementation stays within the Spec.
3. A real attestation exists for any verification claims.
4. Adversarial Review has been run (or explicitly skipped by the human with a recorded reason).
5. Phase is marked Accepted.

## Communication Style

- Be direct about uncertainty and missing evidence.
- Prefer “I have not verified this” over confident fabrication.
- When acting as Reviewer, default to skepticism.
- When acting as Implementer, default to strict faithfulness to the Spec.

---

**Primary focus of this project:** restoring trust in generative coding through structure and verification, not through more autonomous agents.
