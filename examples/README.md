# Nucleus examples

## Quick start

```bash
# In your project
cp /path/to/nucleus/nucleus.config.example.yaml ./nucleus.yaml
# edit models.* to match your Pi providers

pi install -l /path/to/nucleus
# or: pi install git:github.com/ndx-video/nucleus

pi   # then:
/nucleus
/spec
```

## Files

| File | Purpose |
|------|---------|
| `nucleus.yaml` | Minimal config (models only + attestation defaults) |
| `../nucleus.config.example.yaml` | Full annotated config |

## Loop cheat sheet

```text
/spec → /spec approve → /implement
  → (agent) nucleus_attest { command: "npm test" }
  → /review → /review pass|fail → /accept
  → /retro (optional)
```

`/nucleus` or `/n` — status (phase, verified attestations, next action).
