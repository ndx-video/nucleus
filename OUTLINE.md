**Roadmap: Local-First Custom Pi Harness for Spec-Driven + Adversarial Agent Workflows**

### Vision
A minimal, highly configurable Pi-based coding harness that lets a solo developer run a disciplined, Lessa-inspired agentic SDLC locally.  

Core loop:  
**Spec → Plan (human + SOTA) → Implement (mid-tier) → Adversarial Review + Attestation → Merge/Accept → Retro**

The harness enforces separation of roles, real verification (not just prompting), and progressive improvement of the workflow itself. Skills remain useful for soft procedures; hard enforcement and multi-role orchestration live in extensions + hooks.

### Guiding Principles
- Local-first (agents run on your machine; models can be local or remote via API)
- Explicit model nomination per role (you decide which model does planning vs implementation vs adversarial review)
- Deterministic quality gates over “hope the model behaves”
- Thin core + progressive enhancement (start usable in days, deepen over time)
- Avoid meta-confusion: develop the harness itself with a different tool (Cursor / Claude Code / etc.), not inside Pi
- Solo-friendly: low ceremony, high leverage, easy to evolve

### Non-Goals (for now)
- Multi-user / team collaboration features
- Full enterprise provenance infrastructure
- Built-in cloud agent runners
- Replacing Pi’s core (we extend it, we don’t fork the entire thing)
- Supporting every possible model provider on day one

---

### Phase 0 — Foundations (1–3 days)
**Outcome:** Clean development environment + clear architecture decisions.

- Decide final package/extension structure for Pi
- Set up a separate development harness (non-Pi) for building this project
- Define the core config surface: `models.yaml` or equivalent where the user nominates models per role
- Establish basic project layout (extensions, skills, prompt templates, config, examples)
- Document the intended control flow at a high level

**Exit criteria:** You can install a skeleton Pi package and load a custom system prompt + config without errors.

---

### Phase 1 — Minimal Viable Loop (MVP) (1–2 weeks)
**Outcome:** A working end-to-end loop that is already better than pure skills.

Key capabilities:
- Explicit role separation (Planner / Implementer / Adversarial Reviewer)
- User-nominated models per role
- Structured spec artifact (lightweight Open Spec style)
- Forced attestation step after implementation (agent must produce real command output / test results that the reviewer can verify)
- Simple adversarial review pass that receives the original spec + diff + attestation
- Basic `/roadmap`, `/spec`, `/implement`, `/review`, `/retro` commands (or skill equivalents)

**Exit criteria:** You can run a small real task through the full loop on a real codebase and the adversarial step actually catches at least some fabrication or drift.

---

### Phase 2 — Enforcement & Determinism (1–2 weeks)
**Outcome:** Quality gates become hard instead of polite suggestions.

- Hooks that intercept tool calls (especially shell / write operations)
- Provenance capture that is difficult to fake
- Configurable policy rules (what the implementer is allowed to touch, required tests, etc.)
- Ability to run the adversarial reviewer as a true separate session/role with restricted context
- Auto-sizer logic: decide whether a task needs a full spec or can take a lighter path

**Exit criteria:** You can deliberately try to make the implementer fabricate test results and the system reliably detects it.

---

### Phase 3 — Workflow Evolution & Usability (ongoing)
**Outcome:** The harness improves itself and becomes pleasant for daily use.

- Strong `/retro` that interviews you (Socratic) and proposes concrete improvements to skills, rules, or extensions
- Better context management (what each role sees)
- Decision log / onboarding helpers for new projects
- Packaging so the whole thing is installable as a Pi package
- Optional local model support (Ollama etc.) for the cheaper roles
- Progressive disclosure of complexity (simple mode vs advanced mode)

---

### Phase 4 — Hardening & Polish (later)
- More sophisticated multi-role orchestration if needed
- Better visualisation of the loop state
- Integration points with your existing knowledgebase / ontology work (if desired)
- Performance and token-cost tuning
- Documentation and example workflows

---

### Key Architectural Decisions (to lock early)
1. Config format for model nomination (YAML recommended)
2. How strictly roles are isolated (separate sessions vs same session with strong role prompting + context filtering)
3. Where attestation lives (custom tool vs post-processing hook)
4. Whether the adversarial reviewer is always a different model or can be the same model with different system prompt + restricted tools
5. Development workflow: build this project outside Pi to avoid confusion

---

### Success Metrics for the MVP (Phase 1)
- You can nominate different models for Planner / Implementer / Reviewer
- Spec → Code → Verified Review works on a real task without you manually babysitting every step
- The system catches at least one class of agent fabrication or scope drift
- The whole thing remains local-first and runs on your machine
- You would rather use this loop than plain Claude Code / Cursor for non-trivial work

---