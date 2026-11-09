/**
 * Tag the current Cargo.toml version as vX.Y.Z and push, triggering the crates.io publish CI
 * (.github/workflows/publish.yml). Never runs `cargo publish` locally — publishing happens in
 * CI from the tag.
 *
 *   bun scripts/release.ts
 *
 * A tag publishes, and a published crate version is immutable (★ 7.11), so a tag is NEVER moved:
 * the script refuses, before committing anything, when `vX.Y.Z` already exists locally or on
 * `origin`, or when `origin` cannot be asked. No `-f` anywhere. To release again, bump first.
 *
 * Port of scripts/release.sh (workspace letter H15); the proof is recorded in the commit that
 * replaced the .sh. The refusal (2026-11-08) is the one behaviour change since. `node:` builtins only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cargoToml = fileURLToPath(new URL("../Cargo.toml", import.meta.url));

const m = readFileSync(cargoToml, "utf8").match(/^version[ \t]*=[ \t]*"(\d+\.\d+\.\d+)"/m);
if (!m) {
  console.error("release: could not read version from Cargo.toml");
  process.exit(1);
}

const tag = `v${m[1]}`;
console.log(`Releasing ${tag} via GitHub Actions…`);

/** Run git in the repo root with inherited stdio; on failure exit with its code. */
function git(...args: string[]): void {
  const r = spawnSync("git", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Refuse to move a tag: it may already have published (crates.io never takes a version again).
const local = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: root, encoding: "utf8" });
if (local.status === 0) {
  console.error(`release: tag ${tag} already exists locally (${local.stdout.trim()}); a tag is never moved — bump first`);
  process.exit(1);
}
// --exit-code: 0 = the ref exists, 2 = it does not; anything else = origin could not be asked.
const remote = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
  cwd: root,
  encoding: "utf8",
});
if (remote.status === 0) {
  console.error(`release: tag ${tag} already exists on origin (${remote.stdout.trim().split(/\s/)[0]}); a tag is never moved — bump first`);
  process.exit(1);
}
if (remote.status !== 2) {
  console.error(`release: could not ask origin whether ${tag} exists (git ls-remote exit ${remote.status}); refusing`);
  if (remote.stderr.trim()) console.error(remote.stderr.trim());
  process.exit(1);
}

// Commit any pending version bump (only if Cargo.toml / Cargo.lock changed).
const pending = spawnSync("git", ["diff", "--quiet", "--", "Cargo.toml", "Cargo.lock"], { cwd: root });
if (pending.status !== 0) {
  const both = spawnSync("git", ["add", "Cargo.toml", "Cargo.lock"], { cwd: root, stdio: "ignore" });
  if (both.status !== 0) git("add", "Cargo.toml");
  // argv, not a shell: the message is never re-parsed.
  git("commit", "-m", `bump version to ${tag}`);
}

git("tag", tag);
git("push");
git("push", "origin", tag);

console.log("");
console.log(`Tag ${tag} pushed. GitHub Actions (publish.yml) will build, test, and publish to crates.io.`);
