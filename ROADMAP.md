# Nucleus — The Honesty Harness  

*Agents can lie. Nucleus makes lying hard and detection automatic.*

---

### Phase 0 — Foundations (Detailed Spec)

**Goal**  
Establish a clean, local-first foundation so that Phase 1 can deliver a working honesty loop without architectural rework. Everything in Phase 0 exists to support the honesty contract.

**Non-Goals for Phase 0**
- No multi-agent runtime beyond simple role switching
- No full OpenSpec compatibility
- No CI integration or remote runners
- No cryptographic signing (simple hashes are enough)
- Do not build or debug the package *inside* a running Nucleus session

**Architecture Decisions (locked for Phase 0/1)**

| Decision | Choice | Rationale (Honesty) |
|----------|--------|---------------------|
| Development environment | Build the package with Cursor / Claude Code / another harness | Avoids meta-confusion and circular debugging |
| Package type | Proper Pi package (installable via `pi install`) | Clean extension surface, shareable later |
| Config format | YAML (`nucleus.yaml`) | Human-readable model nomination + comments |
| Role isolation (MVP) | Hybrid: same session for Planner + Implementer (strong prompts + filtering); new/forked session preferred for Adversarial Reviewer | Reviewer must not inherit Implementer “helpfulness” bias or full history |
| Attestation | Harness-owned custom tool that captures *real* tool output | Prompt-only claims are leaky; real capture is the core honesty mechanism |
| Spec format | Lightweight custom **Nucleus Spec** (markdown) | Low ceremony for solo use; can evolve later |
| State | Visible, file-backed phase tracking under `.nucleus/` | Human always knows where the honesty gate currently is |
| Local-first | All artifacts on disk; models can be remote or local (Ollama etc.) | No required cloud services |

**Recommended Package Structure**

```text
nucleus/
├── package.json                 # Pi package manifest
├── README.md
├── nucleus.config.example.yaml
├── src/
│   ├── index.ts                 # Extension entry
│   ├── config.ts
│   ├── state.ts
│   ├── roles/
│   ├── attestation/
│   ├── commands/
│   └── types.ts
├── skills/                      # Soft procedural knowledge
│   ├── nucleus-spec/
│   └── retro/
├── prompts/                     # Role system prompts
└── examples/
```

**Config Surface (`nucleus.yaml`)**

```yaml
models:
  planner: "anthropic/claude-opus-4"        # or ollama/...
  implementer: "anthropic/claude-sonnet-4"
  reviewer: "openai/gpt-4.1"               # deliberately different model recommended

roles:
  implementer:
    allowed_tools: ["read", "write", "edit", "bash"]
  reviewer:
    allowed_tools: ["read", "bash"]        # no write by default
    adversarial: true

attestation:
  required: true
  store_path: ".nucleus/attestations/"
  require_real_stdout: true
```

Load order: project `nucleus.yaml` → global. Validate on session start.

**Control Flow (high level)**

```
Human / Planner  →  Nucleus Spec (approved)
        ↓
Implementer (restricted tools + model)  →  code changes + forced Attestation
        ↓
Adversarial Reviewer (clean context: Spec + Diff + Attestation)
        ↓
Pass → Accept   |   Fail → Reject / revise
        ↓
/retro  →  deterministic improvements written back into project rules
```

**Phase 0 Deliverables**
1. Repo skeleton + package.json that Pi can load
2. Config loader + schema validation
3. Basic extension that registers and exposes `/nucleus status`
4. Documented control-flow + decision log (this document)
5. Clear development rule: build outside Pi

**Exit Criteria for Phase 0**  
You can install the skeleton package into Pi, load a `nucleus.yaml`, and query status without errors.

---

### Phase 1 — Minimal Viable Loop (Detailed Spec)

**Goal**  
Deliver a usable, honesty-first loop that is already better than pure skills or vanilla Pi/Claude Code. The adversarial step must be capable of catching fabrication or scope drift on a real small task.

**Primary User Stories**
1. As a solo developer I can nominate different models for Planner, Implementer, and Reviewer.
2. I can create a lightweight structured Spec before any code is written.
3. The Implementer is forced to produce a real attestation of verification commands.
4. The Adversarial Reviewer receives only Spec + Diff + Attestation and produces a clear pass/fail + findings.
5. I can see the current phase of the change at any time.
6. After a session I can run a Socratic `/retro` that improves the project rules.

**Role Definitions & Incentives**

| Role | Incentive | Default Model Preference | Tool Restrictions |
|------|-----------|---------------------------|-------------------|
| Planner | Completeness, clarity, correct intent | SOTA | Full (human-led) |
| Implementer | Faithfulness to Spec only; produce real attestation | Mid-tier | Restricted as configured |
| Adversarial Reviewer | Actively seek fabrication, missing evidence, drift, Spec violations | Different model | Read + bash only (no write) |

**Nucleus Spec Format (lightweight)**  
Single markdown file (or small set) with clear sections:

- Goal
- Constraints
- Acceptance Criteria (testable)
- Out-of-Scope
- Decision Log / Open Questions

(Exact template lives in `skills/nucleus-spec/`. Keep ceremony low.)

**Attestation (Honesty Core)**

- Custom tool `nucleus_attest` (or equivalent) owned by the harness.
- When called it:
  - Executes the verification command(s)
  - Captures real stdout, stderr, exit code, timestamp, cwd, git HEAD / status, and a simple hash of relevant files
  - Writes a structured artifact to `.nucleus/attestations/<id>.json` (+ optional human-readable .md)
- Implementer is required (via prompt + light enforcement) to produce a valid attestation before `/review` is allowed.
- Reviewer must receive and inspect the artifact. It may re-run commands if suspicious.
- This is deliberately hard for the model to forge because the harness itself performs the capture.

**Commands (Phase 1 surface)**

| Command | Purpose |
|---------|---------|
| `/nucleus` or `/n` | Status of current change / honesty state |
| `/spec` | Create or refine Nucleus Spec (Planner) |
| `/implement` | Hand approved Spec to Implementer (switch model + inject context) |
| `/review` | Launch Adversarial Reviewer with Spec + Diff + Attestation only |
| `/accept` | Mark change accepted (only after review pass or explicit human override) |
| `/retro` | Socratic interview → write deterministic improvements into project rules |

**State Tracking**  
Simple file-backed state under `.nucleus/` (e.g. `state.json` or markdown). Phases: `SpecDraft → SpecApproved → Implementing → Attested → Reviewing → Accepted | Rejected`.

Visible via `/nucleus status`. This is a trust feature — the human always knows where the gate is.

**Skills vs Extensions Split**

- **Extensions / Hooks (hard)**  
  Config loading, model switching per role, phase state, `nucleus_attest` tool, context filtering for Reviewer, command handlers, basic policy interception.

- **Skills / Prompt templates (soft)**  
  Nucleus Spec template, Socratic `/retro` questions, role behavioural instructions, soft “how to be adversarial” guidance.

**What stays out of Phase 1**
- Full multi-reviewer batteries
- Auto-sizer
- Heavy hooks on every tool call
- OpenSpec CLI dependency
- Cryptographic signatures
- Multi-user features

**Exit / Acceptance Criteria for Phase 1**
1. Model nomination via `nucleus.yaml` works for the three roles.
2. Full loop (Spec → Implement → Attest → Review) can be run on a real small task.
3. Attestation contains real command output that the Reviewer can inspect.
4. Adversarial Reviewer, given only the three artifacts, can catch at least one class of fabrication or Spec drift.
5. Everything remains local-first and works with both remote and local (Ollama) models.
6. The developer would rather use this loop than plain skills/vanilla agent for non-trivial work.

**Phase 1 live validation (2026-07-27)**  
Run against `nucleus-test` (see `nucleus-test/agent-responses/01.md` and `.results/HONESTY_TEST_REPORT.md`):

- Happy path Spec → Implement → real `nucleus_attest` → Review → Accept held.
- `/review` blocked when no attestation existed.
- Model nomination / role tool restrictions observed.
- Residual leak found: hand-written JSON with only `"capturedBy": "nucleus_attest"` was accepted by the loader.

---

### Phase 1.1 — Attestation Integrity Hardening

**Goal**  
Close the marker-only forgery leak without expanding into Phase 2 crypto/signing infrastructure.

**Mechanism**
1. Keep `capturedBy: "nucleus_attest"` as a fast first filter.
2. Project-local secret at `.nucleus/attest.key` (created by harness on first write, mode `0600`).
3. Artifact field `integrity: "hmac-sha256:<hex>"` over critical fields (command, exitCode, stdout/stderr, timestamp, cwd, git fingerprint, fileHashes, changeId, …).
4. `loadAttestation` verifies the MAC; reject missing/invalid integrity or tampered content.
5. Unit tests cover real load + marker-only rejection + tamper rejection.

**Residual trust model**  
Stops casual model forgery. Not cryptographic unforgeability against a malicious process with full filesystem access to `.nucleus/attest.key`. Local-first by design.

**Out of scope for 1.1**  
External keys, forked Reviewer sessions, free-text claim scanning, broader Phase 2.

---