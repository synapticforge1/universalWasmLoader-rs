# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🗓️ **OWNER, after the first release in the new order publishes: retire the old token** (D2).
  Delete the GitHub secret `CARGO_REGISTRY_TOKEN` and revoke that crates.io API token; nothing
  references it any more. The crates.io trusted publisher itself (repository
  `synapticforge1/universalWasmLoader-rs`, workflow `publish.yml`) was set up by the owner
  2026-11-10 ("done") — not readable from here (crates.io lists a crate's trusted-publishing
  configs only to an authenticated owner), so the first release's `publish` job is its measurement.
  If that exchange is refused, the fix is the setting, then "Re-run failed jobs".
  [release.md](release.md) § How a release runs.
- ⬜ **The first release in the owner's order measures U5–U8 on GitHub** (2026-11-10): `checks`
  on a push of `main` (the non-release path is measured at the next push), CI's REST tag, the page
  before the publish, crates.io's acceptance of an OIDC token from a run started by a push of
  `main`, the revoke, the fatal read-back. Read back as in [release.md](release.md) and write the
  result into workspace rows H33 / H34.
