# Nucleus — Docs

**Agents can lie. Nucleus makes lying hard and detection automatic.**

This page is enough to install Nucleus and run the honesty loop on a real tiny change. Read it once; then use `/nucleus` when stuck.

**Critical (Pi + Nucleus):** slash commands must be sent **alone**. Do not paste a Spec draft or review brief in the same message as `/spec` or `/review`. See [§4a How to type slash commands](#4a-how-to-type-slash-commands-pi).

---

## 1. What it is

Nucleus is a local-first [Pi](https://pi.dev) package that restores trust in generative coding. It does not make agents more autonomous; it makes claims **verifiable**.

Non-trivial work goes through: **Spec → Implement → Attest (real capture) → Adversarial Review → Accept/Reject → Retro**. Models cannot simply assert “tests passed.” The harness captures real command output, tags it with integrity, re-executes it for the Reviewer, and prefers a clean Reviewer session so Implementer chat history does not leak into the review.

---

## 2. Install

**Prerequisite:** [Pi](https://pi.dev) installed and working (`pi` on your PATH).

### One-liner (recommended)

```bash
pi install git:github.com/ndx-video/nucleus
```

That installs globally for your user (`~/.pi/agent/…`). For **project-local** install (team-shareable `.pi/settings.json`):

```bash
pi install -l git:github.com/ndx-video/nucleus
```

Equivalents that also work:

```bash
pi install https://github.com/ndx-video/nucleus
pi install git:github.com/ndx-video/nucleus@main
```

### Not yet: `pi install nucleus`

`nucleus` on npm is an **unrelated** package. A clean registry one-liner would require publishing under a free name (e.g. `npm:@ndx-video/nucleus`), then:

```bash
# future (after npm publish under a scoped name)
pi install npm:@ndx-video/nucleus
```

Until then, use the **git** one-liner above.

### From a local clone (contributors)

```bash
pi install -l /absolute/path/to/nucleus
```

---

## 3. Minimal config

In the **project** you want to work on (not the Nucleus package itself):

```bash
# From a clone, or download the example from the repo
cp /path/to/nucleus/nucleus.config.example.yaml ./nucleus.yaml
# or after git install, copy from the cloned package under ~/.pi/agent/git/...
```

Minimal `nucleus.yaml`:

```yaml
models:
  planner: "provider/your-planner-model"
  implementer: "provider/your-implementer-model"
  reviewer: "provider/your-reviewer-model"   # different model recommended

attestation:
  required: true
  store_path: ".nucleus/attestations/"
  require_real_stdout: true
```

- Model refs are `provider/model-id` as configured in Pi (Anthropic, OpenAI, Ollama, xAI, …).
- Defaults for role tools are fine; omit `roles:` unless you need to customize.
- Runtime state lives under **`.nucleus/`** (state, specs, attestations, HMAC key). Prefer gitignoring `.nucleus/` (especially `attest.key`).

Optional global config: `~/.nucleus/nucleus.yaml` (project file wins on merge).

Start Pi in the project and run:

```text
/nucleus
```

You should see phase, role, models, and a **Next** action.

---

## 4. The honesty loop

| Step | Command / tool | What happens |
|------|----------------|--------------|
| Draft Spec | `/spec` | Planner role; working Spec at `.nucleus/specs/current.md` |
| Approve Spec | `/spec approve` | Phase → SpecApproved |
| (after Accept) | `/spec` again | Prior Spec archived under `.nucleus/specs/archive/`; fresh `current.md` |
| Implement | `/implement` | Implementer model + tools; Spec injected |
| Attest | tool **`nucleus_attest`** | Harness runs your command, writes HMAC-tagged artifact |
| Review | `/review` | Clean Reviewer session + Spec + Diff + Attest + re-exec; phase → **Reviewing** |
| Record verdict | `/review pass` or `/accept` | From **Reviewing** → Accepted (either works) |
| Reject | `/review fail …` | Phase → Rejected |
| Override | `/accept override <reason>` | Skip review (recorded); not the default path |
| Retro | `/retro` | Optional Socratic improvements to project rules |

**Important:** Conversational “review looks good” does **not** change phase. You must run the **`/review` slash command** (phase stays **Attested** until the harness runs). Bare `/accept` while Attested will fail with a clear next-step message.

**Attestation is a tool, not a slash command.** After implementation, the Implementer (or you) must call:

```text
nucleus_attest
  command: "npm test"    # or cargo test, pytest, make check, …
```

Optional: `label`, `hash_files`, `cwd`, `timeout_ms`.

**Review isolation:** `/review` prefers a **new Pi session** with only the Review Bundle. Debug/hybrid: `/review same`.

---

## 4a. How to type slash commands (Pi)

Nucleus is a Pi **extension**. Its loop steps are **slash commands** (`/spec`, `/review`, …). Pi only invokes those commands when the message is a clean command (optional short args).  

If you paste a **multi-line block that begins with** `/spec` or `/review` (command + Spec draft, or command + review brief), Pi often treats the **whole block as a normal user message**. The model may freestyle a “review,” but:

- the Nucleus handler **does not run**
- phase **does not** advance (e.g. stays **Attested**)
- no Review Bundle / isolation kickoff appears
- later `/accept` fails with “Cannot /accept in Attested…”

### Rule

| Do | Don’t |
|----|--------|
| Send **one** slash command per message | Put a Spec or long brief under the same message as `/spec` or `/review` |
| Send long content as the **next** message | Assume “I typed /review at the top” means the harness ran |
| Use only short args on the command line | Use multi-paragraph text as command “args” |

### Correct: draft a Spec with a long brief

**Message 1** (command only):

```text
/spec
```

Wait until Planner kicks off (notify / Spec path / `/nucleus` shows SpecDraft).

**Message 2** (no leading slash — full brief):

```text
Draft the next Spec: Phase 2 — gRPC Bootstrap + Parties service.

## Goal
…

## Locked decisions
…

## Acceptance criteria
…
```

Optional short form for message 1 only:

```text
/spec Phase 2 — gRPC Bootstrap + Parties service
```

(That entire message must be **only** that line — then paste the full brief as message 2.)

### Correct: start adversarial review

**Message 1:**

```text
/review
```

You should see harness text starting with **`NUCLEUS — ISOLATED ADVERSARIAL REVIEW`** and phase **Reviewing**.  
If you only see free-form “I’ll review against the Spec…” with no isolation header, the command did **not** run.

**Then** (after the review finishes), **message 2:**

```text
/review pass
```

or (only once phase is **Reviewing**):

```text
/accept
```

### Safe command forms (entire message)

```text
/nucleus
/n
/spec
/spec approve
/spec new
/spec path/to/file.md
/spec Short goal hint only
/implement
/review
/review same
/review pass
/review fail missing attestation for X
/accept
/accept override human approved despite residual risk
/retro
/copy-out 1
```

### How to tell the harness ran

| Command | You should see |
|---------|----------------|
| `/nucleus` | Status panel (Phase / Role / Attest / Next) |
| `/spec` | Planner kickoff; `specPath` set; often `.nucleus/specs/current.md` |
| `/review` | **`NUCLEUS — ISOLATED ADVERSARIAL REVIEW`**, Review Bundle §§1–4, phase **Reviewing** |
| `/review pass` or `/accept` (from Reviewing) | Phase **Accepted** |

If `/review` only produces ad-hoc `read`/`find` with no isolation header, send bare `/review` again (alone).

---

## 5. Three honesty layers (and residual limits)

| Layer | Guarantee |
|-------|-----------|
| **1. HMAC integrity** | Artifacts under `.nucleus/attestations/` must carry a harness MAC (`integrity: hmac-sha256:…`) keyed by project-local `.nucleus/attest.key`. Marker-only or tampered JSON is rejected. |
| **2. Independent re-execution** | `/review` re-runs attested commands and embeds MATCH / EXIT MISMATCH / OUTPUT MISMATCH. Status and `/review` count only **verified** artifacts. |
| **3. Structural isolation** | Reviewer runs in a clean session (preferred): Spec + Diff + verified Attestation + re-exec only — not Implementer chain-of-thought. |

**Residual (honest):**

- **Local-first, not remote attestation.** A process that can read `.nucleus/attest.key` can forge MACs.
- **Ambient project context** (AGENTS.md, skills) may still load into the Reviewer session — that is not Implementer chat, but not a vacuum.
- **Human records the final gate** (`/review pass|fail`, `/accept`). The harness does not NLP-scan free-text “tests passed” claims.
- **Non-deterministic tests** (e.g. TAP durations) can show OUTPUT MISMATCH without fabrication — surfaced, not hidden.
- **`/review same`** keeps residual history risk by design (fallback/debug).

Live validation (2026-07-27): see repo `ROADMAP.md` / sibling `nucleus-test` results.

---

## 6. 60-second first change

Tiny project with a real test:

```bash
mkdir -p demo && cd demo
echo '{}' > package.json
mkdir -p src test
printf '%s\n' 'export function add(a, b) { return a + b; }' > src/math.js
printf '%s\n' \
  "import test from 'node:test';" \
  "import assert from 'node:assert/strict';" \
  "import { add } from '../src/math.js';" \
  "test('add', () => assert.equal(add(2, 3), 5));" \
  > test/math.test.js
```

Config + install (if not already global):

```bash
# models.* = your Pi providers
cat > nucleus.yaml <<'EOF'
models:
  planner: "anthropic/claude-sonnet-4"
  implementer: "anthropic/claude-sonnet-4"
  reviewer: "openai/gpt-4.1"
attestation:
  required: true
  store_path: ".nucleus/attestations/"
  require_real_stdout: true
EOF

pi install -l git:github.com/ndx-video/nucleus
pi
```

In Pi (**one slash command per message**; long text in a follow-up — see [§4a](#4a-how-to-type-slash-commands-pi)):

```text
/nucleus
```

```text
/spec
```

```text
Goal: add(2,3)===5; Acceptance: node --test passes. Keep the Spec lean.
```

```text
/spec approve
```

```text
/implement
```

```text
# Agent implements, then calls tool (not a slash command):
#   nucleus_attest  command: "node --test"
```

```text
/review
```

```text
/review pass
```

If `/review` is blocked: `/nucleus` will say **0 verified attestations** — call `nucleus_attest` first.

---

## 7. Status & troubleshooting

### Reading `/nucleus` (or `/n`)

Typical fields:

| Line | Meaning |
|------|---------|
| **Phase** | Honesty gate position (idle → SpecDraft → SpecApproved → Implementing → Attested → Reviewing → Accepted/Rejected) |
| **Role** | planner / implementer / reviewer |
| **Attest** | Count of **integrity-verified** artifacts (+ latest id) |
| **Isol.** | Last `/review` isolation mode (`new_session` vs `same_session_fallback`) |
| **⚠ Blocked** | Why you cannot advance |
| **Next** | Concrete slash commands / tools to run |

### Common blocked states

| Symptom | Fix |
|---------|-----|
| Config error / no models | Create `nucleus.yaml` with `models.planner|implementer|reviewer` |
| Cannot `/implement` | `/spec` then `/spec approve` first |
| `/review` blocked — 0 verified | Call tool `nucleus_attest` with a real check command |
| `/review` blocked — raw ids failed integrity | Forged/corrupt files; re-run `nucleus_attest` (do not hand-write JSON) |
| “I ran `/review`” but phase still **Attested** | Command likely **did not fire** (multi-line message). Send bare `/review` alone. Expect isolation header. |
| Free-form review, no **ISOLATED ADVERSARIAL REVIEW** header | Same — not harness review. Resend `/review` alone. |
| Cannot `/accept` in **Attested** | Harness never entered **Reviewing**. Bare `/review`, then `/review pass` or `/accept`. Or `/accept override <reason>` |
| Cannot `/accept` in **Reviewing** with FAIL recorded | Fix via `/implement`, or override |
| Model not found | Model string must match a provider Pi knows (`provider/id`) |
| Reviewer lacks tools | Defaults inject `nucleus_verify`; check `roles.reviewer.allowed_tools` if customized |
| Same-session review | Isolation fell back; check `.nucleus/review-session.json`; prefer bare `/review` |

### Where artifacts live

```text
.nucleus/
  state.json              # hot honesty gate only (phase, role, changeId, specPath, att ids)
  history.jsonl           # append-only phase/attestation log (rotated by size → .1 / .2)
  specs/current.md        # working Spec for the *active* change only
  specs/archive/          # accepted/superseded Specs (changeId + label)
  attestations/*.json     # harness captures + integrity
  attest.key              # project HMAC secret (do not commit)
  review-bundle.md        # last Review Bundle
  review-session.json     # isolation metadata
  out/NNNN.md             # /copy-out exports
```

**Spec rotation:** `/accept` archives the active Spec. The next `/spec` (new change) archives any leftover and writes a **fresh** `current.md` template so prior-phase Specs do not pretend to be “current.”

**History:** transition notes are **not** stored in `state.json` (that array balloons and silently dropped at 50). They append to `history.jsonl`. Legacy `notes[]` migrates automatically on load.

---

## Commands cheat sheet

Each line below = **one entire Pi message** (see [§4a](#4a-how-to-type-slash-commands-pi)).

```text
/nucleus
/n
/spec
/spec approve
/spec new
/spec path/to.md
/implement
/review
/review same
/review pass
/review fail <summary>
/accept
/accept override <reason>
/retro
/copy-out 1
```

Tool (not a slash command): `nucleus_attest` with `command: "…"`.

---

## More

| Resource | Purpose |
|----------|---------|
| [README.md](../README.md) | Product positioning + status |
| [AGENTS.md](../AGENTS.md) | Working contract for agents in this repo |
| [ROADMAP.md](../ROADMAP.md) | Phases + live-validation evidence |
| [nucleus.config.example.yaml](../nucleus.config.example.yaml) | Full annotated config |
| [examples/](../examples/) | Minimal `nucleus.yaml` |

**Site:** [nucleuspi.dev](https://nucleuspi.dev) · **Source:** [github.com/ndx-video/nucleus](https://github.com/ndx-video/nucleus)
