#!/usr/bin/env bash
#
# Raise the [package] version in Cargo.toml — patch (default), minor, or major.
# Cargo.toml is the single source of version truth.
#
#   scripts/bump.sh            # patch:  0.1.0 -> 0.1.1
#   scripts/bump.sh minor      # minor:  0.1.0 -> 0.2.0
#   scripts/bump.sh major      # major:  0.1.0 -> 1.0.0
#   scripts/bump.sh --dry-run  # print the next patch version, do not write
#   scripts/bump.sh minor --dry-run
#
# Mirrors the UX of the JS reference's `deno task bump`. Uses plain sed on
# Cargo.toml so it needs no extra tooling (no cargo-edit required), but if you
# prefer, `cargo set-version --bump patch` (from cargo-edit) is an equivalent.
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_TOML="$ROOT/Cargo.toml"

kind="patch"
dry_run=0
for arg in "$@"; do
  case "$arg" in
    patch|minor|major) kind="$arg" ;;
    --dry-run|-n)      dry_run=1 ;;
    *)
      echo "bump: unknown argument \"$arg\" — use patch | minor | major [--dry-run]" >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$CARGO_TOML" ]; then
  echo "bump: Cargo.toml not found at $CARGO_TOML" >&2
  exit 1
fi

# Grab the FIRST `version = "X.Y.Z"` (the [package] one, which comes first).
current="$(grep -m1 -E '^version[[:space:]]*=[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$CARGO_TOML" \
  | sed -E 's/^version[[:space:]]*=[[:space:]]*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')"

if [ -z "$current" ]; then
  echo "bump: could not find a 'version = \"X.Y.Z\"' field in Cargo.toml" >&2
  exit 1
fi

IFS='.' read -r major minor patch <<<"$current"
case "$kind" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
esac
next="${major}.${minor}.${patch}"

if [ "$dry_run" -eq 1 ]; then
  echo "bump (dry-run): $current -> $next ($kind) — Cargo.toml NOT modified"
  exit 0
fi

# Targeted in-place replace of ONLY the first version line, leaving the rest of
# Cargo.toml's formatting untouched. Awk so we only touch the first match.
tmp="$(mktemp)"
awk -v nextver="$next" '
  !done && $0 ~ /^version[[:space:]]*=[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"/ {
    sub(/"[0-9]+\.[0-9]+\.[0-9]+"/, "\"" nextver "\"")
    done = 1
  }
  { print }
' "$CARGO_TOML" >"$tmp"
mv "$tmp" "$CARGO_TOML"

echo "Cargo.toml -> $next  ($kind bump from $current)"
echo "Next: review, commit, then run scripts/release.sh to tag v$next and push."
