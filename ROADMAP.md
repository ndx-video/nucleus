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
| Role isolation | Planner + Implementer: same session OK; **Reviewer (Phase 2.0): `ctx.newSession()` clean session with Review Bundle only** (fallback: same-session hybrid) | Reviewer must not inherit Implementer history or helpfulness bias |
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

**Phase 1 live validation (2026-07-27) — PASS**  
Run against sibling repo `nucleus-test`:

| Artifact | Path |
|----------|------|
| Summary | [`../nucleus-test/agent-responses/01.md`](../nucleus-test/agent-responses/01.md) |
| Full report | [`../nucleus-test/.results/HONESTY_TEST_REPORT.md`](../nucleus-test/.results/HONESTY_TEST_REPORT.md) |

Held: happy path Spec → Implement → real `nucleus_attest` → Review → Accept; `/review` blocked without attestation; model nomination / role tools.  
Residual found (later closed by 1.1): hand-written JSON with only `"capturedBy": "nucleus_attest"` was accepted by the loader.

---

## Three-layer honesty stack — live-validated (2026-07-27)

The core honesty contract after Phase 1 is a **three-layer stack**. All three layers were live-validated the same day against `nucleus-test` (local Pi install of this package).

| Layer | Phase | Live status | Summary | Verdict |
|-------|-------|-------------|---------|---------|
| **1. Attestation integrity** | 1.1 | **PASS — 2026-07-27** | [agent-responses/02.md](../nucleus-test/agent-responses/02.md) | [.results/phase11/VERDICT.md](../nucleus-test/.results/phase11/VERDICT.md) |
| **2. Independent re-execution** | 1.2 | **PASS — 2026-07-27** | [agent-responses/03.md](../nucleus-test/agent-responses/03.md) | [.results/phase12/VERDICT.md](../nucleus-test/.results/phase12/VERDICT.md) |
| **3. Reviewer isolation** | 2.0 | **PASS — 2026-07-27** | [agent-responses/04.md](../nucleus-test/agent-responses/04.md) | [.results/phase20/VERDICT.md](../nucleus-test/.results/phase20/VERDICT.md) |

Base loop (pre-stack fabrication gates): [01.md](../nucleus-test/agent-responses/01.md) · [HONESTY_TEST_REPORT.md](../nucleus-test/.results/HONESTY_TEST_REPORT.md).

---

### Phase 1.1 — Attestation Integrity Hardening

**Status:** Implemented · **Live-validated 2026-07-27 — PASS**  
Evidence: [`../nucleus-test/agent-responses/02.md`](../nucleus-test/agent-responses/02.md) · [`../nucleus-test/.results/phase11/VERDICT.md`](../nucleus-test/.results/phase11/VERDICT.md)

**Goal**  
Close the marker-only forgery leak without expanding into Phase 2 crypto/signing infrastructure.

**Mechanism**
1. Keep `capturedBy: "nucleus_attest"` as a fast first filter.
2. Project-local secret at `.nucleus/attest.key` (created by harness on first write, mode `0600`).
3. Artifact field `integrity: "hmac-sha256:<hex>"` over critical fields (command, exitCode, stdout/stderr, timestamp, cwd, git fingerprint, fileHashes, changeId, …).
4. `loadAttestation` verifies the MAC; reject missing/invalid integrity or tampered content.
5. Unit tests cover real load + marker-only rejection + tamper rejection.

**Live checks that held:** marker-only forgery rejected; fake MAC rejected; stdout tamper with reused MAC rejected; fresh harness att accepted.

**Residual trust model**  
Stops casual model forgery. Not cryptographic unforgeability against a malicious process with full filesystem access to `.nucleus/attest.key`. Local-first by design.

**Out of scope for 1.1**  
External keys, forked Reviewer sessions, free-text claim scanning, broader Phase 2.

---

### Phase 1.2 — Independent Verification + Residual Polish

**Status:** Implemented · **Live-validated 2026-07-27 — PASS**  
Evidence: [`../nucleus-test/agent-responses/03.md`](../nucleus-test/agent-responses/03.md) · [`../nucleus-test/.results/phase12/VERDICT.md`](../nucleus-test/.results/phase12/VERDICT.md)

**Goal**  
Status and review gates must only trust integrity-verified attestations; Reviewer must independently re-execute attested commands.

**A. Residual polish**
1. Status / footer attestation counts use verified loads only (not raw `state.attestationIds`).
2. `/review` entry requires ≥1 successfully loaded + integrity-verified attestation; forged/invalid IDs alone block review with a clear message.

**B. Independent verification**
1. Review Bundle includes original attested commands.
2. By default `/review` re-executes each verified command and embeds comparison (exit code + stdout/stderr).
3. Tool `nucleus_verify` available to Reviewer for a second pass.
4. Reviewer prompt treats `exit_mismatch` as strong FAIL evidence; `output_mismatch` as suspicious.

**Live checks that held:** forged-only IDs → status `0 verified` and `/review` blocked; deterministic re-exec MATCH; exit-mismatch path treated as FAIL signal. Residual: TAP `duration_ms` can cause OUTPUT MISMATCH without fabrication (surfaced, not hidden).

**Residual trust**  
HMAC integrity + re-execution together. Still not remote attestation; flaky non-determinism can produce output_mismatch without fabrication (surfaced, not hidden).

**Out of scope for 1.2**  
Forked Reviewer sessions, free-text claim NLP, Phase 2 heavy hooks.

---

### Phase 2.0 — True Reviewer Isolation

**Status:** Implemented · **Live-validated 2026-07-27 — PASS**  
Evidence: [`../nucleus-test/agent-responses/04.md`](../nucleus-test/agent-responses/04.md) · [`../nucleus-test/.results/phase20/VERDICT.md`](../nucleus-test/.results/phase20/VERDICT.md)

**Goal**  
Run the Adversarial Reviewer in a clean context containing only Spec + Diff + verified Attestation(s) + independent re-execution results — no Implementer chain-of-thought or prior chat.

**Mechanism**
1. `/review` builds the Review Bundle (including harness re-exec) on disk under `.nucleus/review-bundle.md`.
2. Preferred: `ctx.newSession({ withSession })` starts a blank session; `withSession` injects only the kickoff prompt (bundle + isolation header).
3. New extension instance `session_start` applies Reviewer model + tools from disk phase/role before kickoff.
4. Fallback: `/review same` or automatic same-session injection when `newSession` is missing/cancelled; isolation mode recorded in `.nucleus/review-session.json`.

**Preserved layers**  
HMAC integrity (1.1), verified-only gates + re-exec (1.2), phase machine, tool restrictions (no write/edit).

**Live checks that held:** distinct child session file (`isolation: new_session`); planted Implementer leak token present in parent, **absent** in child; child first message is isolation kickoff + Review Bundle only; forged gate and re-exec layers still work under isolation.

**Residual limitations**
- Ambient project system prompt resources (AGENTS.md, skills) may still load — not Implementer chat.
- Same-session fallback retains residual history risk (explicitly labeled).
- Not multi-reviewer batteries or free-text claim scanning.

**Live-test criterion**  
Reviewer session branch starts empty aside from the injected Review Bundle; no Implementer messages appear in session history.

---

### Phase 2.1 — Daily-Use Polish (pre-release)

**Status:** Implemented (no honesty-layer changes)

**Goal**  
Make the validated stack pleasant for daily work: scannable `/nucleus`, clear command errors, readable Review Bundle, install-ready package metadata and examples.

**In scope**
- Status: phase, role, verified att count + latest id, isolation mode, blocked reason, next actions
- Command feedback: short, actionable, consistent with gates
- Review Bundle / kickoff layout for scanability (MATCH/MISMATCH summary table)
- Annotated `nucleus.config.example.yaml` + `examples/`
- `package.json` `files` list for clean `pi install` / npm publish

**Out of scope**  
Multi-reviewer, auto-sizer, free-text claim scanning.

---