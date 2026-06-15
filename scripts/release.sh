#!/usr/bin/env bash
#
# Tag the current Cargo.toml version as vX.Y.Z and push, triggering the
# crates.io publish CI (.github/workflows/publish.yml). Never runs
# `cargo publish` locally — publishing happens in CI from the tag.
# Mirrors the JS reference's `deno task publish`.
#
#   scripts/release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_TOML="$ROOT/Cargo.toml"

version="$(grep -m1 -E '^version[[:space:]]*=[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$CARGO_TOML" \
  | sed -E 's/^version[[:space:]]*=[[:space:]]*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')"

if [ -z "$version" ]; then
  echo "release: could not read version from Cargo.toml" >&2
  exit 1
fi

tag="v$version"
echo "Releasing $tag via GitHub Actions…"

cd "$ROOT"

# Commit any pending version bump (only if something is staged/changed).
if ! git diff --quiet -- Cargo.toml Cargo.lock 2>/dev/null; then
  git add Cargo.toml Cargo.lock 2>/dev/null || git add Cargo.toml
  git commit -m "bump version to $tag"
fi

git tag -f "$tag"
git push
git push -f origin "$tag"

echo
echo "Tag $tag pushed. GitHub Actions (publish.yml) will build, test, and publish to crates.io."
