# Nucleus

**The Honesty Harness**

> Agents can lie. Nucleus makes lying hard and detection automatic.

Nucleus is a local-first coding agent harness built on [Pi](https://pi.dev). Its primary purpose is to restore trust in generative coding.

Most agent workflows optimize for speed and autonomy. Nucleus optimizes for **verifiability**. It treats the tendency of language models to fabricate results, claim tests passed when they did not, or drift from the original intent as a first-class engineering problem rather than an inconvenience.

---

## The Problem

When agents write code, two failure modes destroy trust:

1. **Fabrication** — The agent claims it ran tests, checked edge cases, or verified behaviour when it did not.
2. **Scope drift** — The agent expands, invents, or “improves” beyond what was actually requested, often without clear signal.

Once trust is lost, developers stop relying on the agent for anything consequential. Productivity gains evaporate.

Nucleus attacks both problems directly.

---

## Core Idea

Nucleus enforces a disciplined loop:

```
Spec → Implement → Attest (real execution capture) → Adversarial Review → Accept / Reject → Retro
```

Key mechanisms:

- **Structured Specs first** — Non-trivial work begins with a clear, testable Nucleus Spec.
- **Forced attestation** — Claims about tests, builds, or commands must be backed by a real harness-captured artifact (stdout, exit code, environment fingerprint). The model cannot simply assert success.
- **Adversarial Review** — A separate role (preferably a different model with restricted context) actively looks for fabrication, missing evidence, and Spec violations.
- **Visible state** — The current phase of any change is explicit. The human always knows where the honesty gate sits.
- **Model nomination** — You decide which model plays Planner, Implementer, and Reviewer. Local models (Ollama etc.) are first-class.

The result is not a more autonomous agent. It is a more *honest* one.

---

## Who It Is For

- Solo developers who want agent assistance without surrendering trust in the codebase
- Engineers who have been burned by fabricated test results or silent scope creep
- Anyone building serious software with coding agents and who values verifiability over raw generation speed

Nucleus is deliberately thin in its first versions. It prioritises the honesty contract over feature completeness.

---

## Design Principles

1. **Honesty over cleverness**
2. **Spec before code**
3. **Attestation must be hard to fake**
4. **Role separation with different incentives**
5. **Local-first** — all state and artifacts live on disk; models can be remote or fully local
6. **Human remains the authority**

---

## Current Status

**Phase 0 + Phase 1 implemented; Phase 1 live-validated 2026-07-27; Phase 1.1 integrity hardening applied.**

- TypeScript extension for hard enforcement (attestation, role switching, phase gates)
- Skills for softer procedural knowledge (`skills/nucleus-spec`, `skills/retro`)
- YAML model nomination via `nucleus.yaml`
- Harness-owned `nucleus_attest` tool writing real artifacts under `.nucleus/attestations/`
- **Attestation integrity (1.1):** HMAC-SHA256 over critical fields with project-local `.nucleus/attest.key` — marker-only forgeries are rejected
- Commands: `/nucleus`, `/spec`, `/implement`, `/review`, `/accept`, `/retro`
- Live honesty test (2026-07-27): happy path held; `/review` blocked without attestation; remaining marker-only leak closed in 1.1
- Develop this package *outside* a running Nucleus/Pi session that loads itself

**Residual trust:** integrity tags stop casual model forgery, not a process that can read the local attest key. See `AGENTS.md`.

See `AGENTS.md` for the working contract. See `ROADMAP.md` for Phase 0/1 specs and later phases.

---

## Install (Pi)

```bash
# From a project that should use Nucleus (project-local install)
pi install -l /absolute/path/to/nucleus

# Or copy example config
cp /path/to/nucleus/nucleus.config.example.yaml ./nucleus.yaml
# Edit models.* to match providers configured in your Pi setup
```

Then start Pi in the project and run `/nucleus` to verify status.

### Honesty loop

```text
/spec            → draft Nucleus Spec (Planner model)
/spec approve    → SpecApproved
/implement       → Implementer model + restricted tools
# Implementer must call tool: nucleus_attest { command: "npm test" }
/review          → Adversarial Reviewer (Spec + Diff + Attestation)
/review pass|fail
/accept          # or /accept override <reason>
/retro           → Socratic improvements to rules
```

---

## High-Level Architecture

```
Human / Planner
      ↓
Nucleus Spec (approved)
      ↓
Implementer (restricted tools + nominated model)
      ↓
Attestation (harness captures real command output)
      ↓
Adversarial Reviewer (clean context: Spec + Diff + Attestation)
      ↓
Accept or Reject
      ↓
Retro (Socratic improvement of the rules themselves)
```

---

## Philosophy

Coding was never the real bottleneck. Trust is.

Nucleus exists to make the cost of dishonesty high and the path of verifiable work the path of least resistance.

---

## License

TBD
