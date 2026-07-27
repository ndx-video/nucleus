# Nucleus by NDX Pty Ltd

**The Honesty Harness**

> Agents can lie. Nucleus makes lying hard and detection automatic.

Local-first coding agent package for [Pi](https://pi.dev). Restores trust in generative coding through Specs, harness-owned attestation, independent re-execution, and isolated adversarial review.

**Docs (start here):** [docs/index.md](./docs/index.md) · **Site:** [nucleuspi.dev](https://nucleuspi.dev) · **Source:** [github.com/ndx-video/nucleus](https://github.com/ndx-video/nucleus)

---

## Install (one-liner)

**Prerequisite:** Pi on your PATH.

```bash
pi install git:github.com/ndx-video/nucleus
```

Project-local (writes `.pi/settings.json`):

```bash
pi install -l git:github.com/ndx-video/nucleus
```

Then in your project:

```bash
# copy example config (from clone, or from the installed package tree)
cp nucleus.config.example.yaml ./nucleus.yaml   # if you have a clone
# edit models.planner / implementer / reviewer  (provider/model-id)

pi
/nucleus
```

| Form | Works? | Notes |
|------|--------|--------|
| `pi install git:github.com/ndx-video/nucleus` | **Yes — preferred** | Git install; runs `npm install` for `yaml` |
| `pi install https://github.com/ndx-video/nucleus` | Yes | Same source |
| `pi install -l /path/to/clone` | Yes | Local development |
| `pi install nucleus` | **No** | npm name `nucleus` is an unrelated package |
| `pi install npm:@ndx-video/nucleus` | Not yet | Publish scoped package for a registry one-liner |

Full walkthrough: **[docs/index.md](./docs/index.md)**.

---

## Honesty loop

```text
/spec → /spec approve → /implement
  → tool: nucleus_attest { command: "npm test" }
  → /review → /review pass|fail → /accept
  → /retro (optional)
```

`/nucleus` (or `/n`) — phase, verified attestations, blocked reason, **next action**.

---

## Three-layer honesty stack (live-validated 2026-07-27)

| Layer | Guarantee |
|-------|-----------|
| **1. HMAC integrity** | Harness-signed attestations; marker-only forgeries rejected |
| **2. Independent re-exec** | `/review` re-runs commands; MATCH / MISMATCH in the bundle |
| **3. Reviewer isolation** | Clean session: Spec + Diff + Attest + re-exec only |

Residual limits (local-first, ambient AGENTS.md/skills, human records final pass): see [docs](./docs/index.md#5-three-honesty-layers-and-residual-limits).

Evidence: sibling `nucleus-test` results linked from [ROADMAP.md](./ROADMAP.md).

---

## Design principles

1. Honesty over cleverness  
2. Spec before code  
3. Attestation must be hard to fake  
4. Role separation with different incentives  
5. Local-first  
6. Human remains the authority  

---

## Package layout

```text
src/          # Pi extension (hard enforcement)
skills/       # Spec + retro soft procedures
prompts/      # Role prompts
docs/         # Primary user/agent docs
examples/     # Minimal nucleus.yaml
nucleus.config.example.yaml
```

Develop this package **outside** a running Nucleus/Pi session that loads itself (see [AGENTS.md](./AGENTS.md)).

---

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
