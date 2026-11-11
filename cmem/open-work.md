# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🗓️ **OWNER, before the next release: the crates.io trusted publisher** (D2, 2026-11-10). On
  crates.io: `universal-wasm-loader` → Settings → Trusted Publishing → add GitHub, repository
  `synapticforge1/universalWasmLoader-rs`, workflow `publish.yml`, no environment. Without it the
  `publish` job's token exchange is refused; the fix then is the setting and "Re-run failed jobs".
  After the first release publishes through it: delete the GitHub secret `CARGO_REGISTRY_TOKEN`
  and revoke that crates.io API token. [release.md](release.md) § How a release runs.
- ⬜ **The first release in the owner's order measures U5–U8 on GitHub** (2026-11-10): `checks`
  on a push of `main` (the non-release path is measured at the next push), CI's REST tag, the page
  before the publish, crates.io's acceptance of an OIDC token from a run started by a push of
  `main`, the revoke, the fatal read-back. Read back as in [release.md](release.md) and write the
  result into workspace rows H33 / H34.
