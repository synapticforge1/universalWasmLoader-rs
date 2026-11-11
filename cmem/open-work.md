# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🗓️ **OWNER: retire the old crates.io token** (D2). 1.0.5 published through trusted publishing
  (run 42937116031, [release.md](release.md) § 1.0.5), so nothing uses the stored token any
  more: delete the GitHub secret `CARGO_REGISTRY_TOKEN` and revoke that crates.io API token.
- 🟡 **A stronger U8 read-back is available:** crates.io's version record carries
  `trustpub_data` (`provider`, `repository`, `run_id`, `sha`; measured on 1.0.5).
  `crates-io.ts readback` checks only "served, not yanked". It could also require `repository` =
  this repo, `run_id` = `GITHUB_RUN_ID` and `sha` = `GITHUB_SHA` on a fresh upload, which is
  provenance in the PyPI sense. A changed release job: rehearse it (7.22) and land it before a
  release, never during one.
