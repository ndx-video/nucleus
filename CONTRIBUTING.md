# Contributing to Nucleus by NDX Pty Ltd

Thanks for your interest in **Nucleus by NDX Pty Ltd** — the Honesty
Harness. Nucleus is a local-first coding agent harness built on
[Pi](https://pi.dev). It optimizes for **verifiability**: making agent
fabrication hard and detection automatic.

**Official site:** [https://nucleuspi.dev](https://nucleuspi.dev) — product
information, documentation, and project news. This repository is the
open-source source tree; use the site as the public face of the project,
and GitHub for code, issues, and pull requests.

Adoption and reuse are welcome: install it in your Pi projects, harden the
honesty loop, or send improvements back.

## License

Nucleus by NDX Pty Ltd is licensed under the **Apache License, Version 2.0**.
See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Copyright 2026 NDX Pty Ltd and contributors.

**By contributing, you agree that your contributions are licensed under the
Apache License 2.0** (the same terms as the rest of the project). You retain
copyright in your contributions; the license grants others the rights they
need to use, modify, and redistribute the combined work — including the
explicit patent grant that makes Apache 2.0 a good fit for commercial and
internal product adoption.

We do **not** require a separate CLA. A pull request is enough.

### Developer Certificate of Origin (DCO)

To keep provenance clear without paperwork, we use the [Developer
Certificate of Origin](https://developercertificate.org/). Sign off each
commit:

```bash
git commit -s -m "Your clear change description"
```

That appends a `Signed-off-by: Your Name <you@example.com>` line. It
certifies that you wrote the change (or have the right to submit it) under
the project license. Use the same name and email as in your git config.

If you forgot `-s` on recent commits:

```bash
git rebase HEAD~N --signoff   # adjust N; only rewrite unpushed history
```

## Ways to participate

You do not have to land a large feature to help:

| Kind | Examples |
|------|----------|
| **Use it** | Run the honesty loop on real work; file where trust still fails |
| **Docs** | Clarify install, Specs, attestation, adoption stories |
| **Bugs** | Minimal repros for phase gates, forgeable attestations, role bugs |
| **Code** | Enforcement, isolation, tests, tooling, Pi integration |
| **Integrations** | Model providers, CI recipes, example projects |

If you build something with Nucleus and want it linked or described in the
repo, open an issue or PR — adoption stories help the next person.

## Before you start coding

1. Read [README.md](./README.md) for intent, install, and the honesty loop.
2. Read [AGENTS.md](./AGENTS.md) for the working contract and residual trust
   boundaries.
3. Skim [ROADMAP.md](./ROADMAP.md) if you are changing phase scope.
4. Prefer a focused change over a kitchen-sink PR.
5. For non-trivial design shifts (especially attestation or review isolation),
   open an issue first so we can align.
6. Develop this package *outside* a running Nucleus/Pi session that loads
   itself.

## Development checklist

```bash
npm install
npm test
npm run typecheck
```

- Keep the honesty contract intact: Spec → Implement → Attest → Review →
  Accept / Reject → Retro.
- Prefer harness-owned evidence over model claims.
- Match existing TypeScript style; avoid drive-by reformatting.
- When you add dependencies, ensure license compatibility with Apache-2.0
  redistribution and update [NOTICE](./NOTICE) if third-party notices must
  be retained at the product level.

## Pull requests

1. Fork (if needed) and branch from `main`.
2. Make the change; keep commits reviewable when practical.
3. Sign off commits (`git commit -s`).
4. Run `npm test` and `npm run typecheck` for the area you touched.
5. Open a PR that states **what** changed and **why**.
6. Link related issues.

We aim for timely, respectful review. Small, well-described PRs land faster.

## Issues and security

- **Bugs and ideas:** GitHub Issues on this repository.
- **Security-sensitive reports** (especially anything that weakens
  attestation integrity or review isolation): prefer a private channel to
  the maintainers (see the repository owner / contact on the GitHub org)
  rather than a public issue, when disclosure could put users at risk.

## Code of conduct expectations

Be respectful and constructive. Assume good intent. Harassment, personal
attacks, or deliberate disruption are not acceptable. Maintainers may close
or refuse contributions that violate that bar.

## Questions?

- **Product / project info:** [nucleuspi.dev](https://nucleuspi.dev)
- **Code and contribution questions:** open a GitHub issue with the
  `question` label (or a short discussion-style issue).

Curious experimenters and production adopters are both welcome.

Thanks for helping Nucleus become easier to run, fork, and build on.
