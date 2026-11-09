# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **Release 1.0.4 measures H32's release job on GitHub** (owner, 2026-11-09: "commit, push
  then release"). A patch: since `v1.0.3`, `.github/`, `scripts/`, README and `cmem/` changed, plus
  `SPEC_VERSION` "4.0.0" → "4.0.1" (a SPEC clarification, no behaviour change; the gate floors
  it at patch). It measures `checks` running
  `bun test scripts/`, and `release` fetching the script alone at `github.sha` (no checkout), with
  the crates.io link, the draft check and the second peel ([overview.md](overview.md) § Release
  flow). Read back: every step green; the page's `author.login` = `github-actions[bot]`, the
  crates.io link on top, the tag unmoved. Then write that into workspace row H32.

- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
