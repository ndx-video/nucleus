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

Phase 0 (Foundations) and Phase 1 (Minimal Viable Loop) have detailed specifications. The project is being built as a proper Pi package with:

- TypeScript extensions for hard enforcement (attestation, role switching, phase gates)
- Skills for softer procedural knowledge
- YAML-based model nomination
- A clear development rule: the package itself is developed *outside* a running Nucleus session to avoid meta-confusion

See `AGENTS.md` for the full working contract that agents operating in this repository must follow.

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
