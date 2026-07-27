# Nucleus by NDX Pty Ltd

**The Honesty Harness**

**Official site:** [https://nucleuspi.dev](https://nucleuspi.dev)

> Agents can lie. Nucleus makes lying hard and detection automatic.

Nucleus by NDX Pty Ltd is a local-first coding agent harness built on [Pi](https://pi.dev). Its primary purpose is to restore trust in generative coding.

This repository is the open-source project source. Product information,
documentation, and project news live on the official site.

## Source & community

| | |
|--|--|
| **Website** | [nucleuspi.dev](https://nucleuspi.dev) |
| **Source** | [github.com/ndx-video/nucleus](https://github.com/ndx-video/nucleus) |
| **Contributing** | [CONTRIBUTING.md](./CONTRIBUTING.md) |

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

**Phase 0 through Phase 2.0 are implemented. The three-layer honesty stack is live-validated (2026-07-27).**

### Three-layer honesty stack (live-validated)

| Layer | What it does | Live-validated | Results |
|-------|----------------|----------------|---------|
| **1. Attestation integrity (Phase 1.1)** | HMAC-SHA256 on harness-captured artifacts; marker-only / tampered forgeries rejected | **2026-07-27 — PASS** | [summary](../nucleus-test/agent-responses/02.md) · [verdict](../nucleus-test/.results/phase11/VERDICT.md) |
| **2. Independent re-execution (Phase 1.2)** | Verified-only status/`/review` gates; harness re-runs attested commands (MATCH / MISMATCH) | **2026-07-27 — PASS** | [summary](../nucleus-test/agent-responses/03.md) · [verdict](../nucleus-test/.results/phase12/VERDICT.md) |
| **3. Reviewer isolation (Phase 2.0)** | Clean `newSession` with only Spec + Diff + verified Attestation + re-exec (no Implementer history) | **2026-07-27 — PASS** | [summary](../nucleus-test/agent-responses/04.md) · [verdict](../nucleus-test/.results/phase20/VERDICT.md) |

**Base Phase 1 loop** (Spec → Implement → Attest → Review → Accept, plus fabrication gates) was live-validated the same day: [summary](../nucleus-test/agent-responses/01.md) · [full report](../nucleus-test/.results/HONESTY_TEST_REPORT.md).

Also in place:

- TypeScript extension for hard enforcement (attestation, role switching, phase gates)
- Skills for softer procedural knowledge (`skills/nucleus-spec`, `skills/retro`)
- YAML model nomination via `nucleus.yaml`
- Commands: `/nucleus`, `/spec`, `/implement`, `/review`, `/accept`, `/retro`
- Develop this package *outside* a running Nucleus/Pi session that loads itself

**Residual trust (honest limits):** local-first only — not remote attestation. A process that can read `.nucleus/attest.key` can forge MACs; TAP non-determinism can surface as OUTPUT MISMATCH without fabrication; ambient AGENTS.md/skills may still load into an isolated Reviewer session; `/review same` is hybrid fallback. Details in `AGENTS.md` and `ROADMAP.md`.

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
/review          → Isolated Reviewer session (Spec+Diff+Attestation+re-exec only)
/review same     → Force same-session hybrid (fallback / debug)
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

**Nucleus by NDX Pty Ltd** is licensed under the **Apache License, Version 2.0**.
See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Copyright 2026 NDX Pty Ltd and contributors.

You are free to use, modify, and redistribute Nucleus — including in commercial
and internal products — under those terms. Contributions are welcome under the
same license; see [CONTRIBUTING.md](./CONTRIBUTING.md).
