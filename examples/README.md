# Nucleus examples

**Full docs:** [../docs/index.md](../docs/index.md)

## Install + config

```bash
pi install git:github.com/ndx-video/nucleus
# project-local: pi install -l git:github.com/ndx-video/nucleus

cp ../nucleus.config.example.yaml ./nucleus.yaml   # from a clone
# edit models.* to match your Pi providers

pi
/nucleus
```

## Files

| File | Purpose |
|------|---------|
| `nucleus.yaml` | Minimal config (models + attestation defaults) |
| `../nucleus.config.example.yaml` | Full annotated config |

## Loop

```text
/spec → /spec approve → /implement
  → nucleus_attest { command: "npm test" }
  → /review → /review pass|fail → /accept
```
