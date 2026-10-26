/**
 * Tag the current Cargo.toml version as vX.Y.Z and push, triggering the crates.io publish CI
 * (.github/workflows/publish.yml). Never runs `cargo publish` locally — publishing happens in
 * CI from the tag.
 *
 *   bun scripts/release.ts
 *
 * Port of scripts/release.sh (workspace letter H15), same steps and output; the proof is
 * recorded in the commit that replaced the .sh. `node:` builtins only.
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

// Commit any pending version bump (only if Cargo.toml / Cargo.lock changed).
const pending = spawnSync("git", ["diff", "--quiet", "--", "Cargo.toml", "Cargo.lock"], { cwd: root });
if (pending.status !== 0) {
  const both = spawnSync("git", ["add", "Cargo.toml", "Cargo.lock"], { cwd: root, stdio: "ignore" });
  if (both.status !== 0) git("add", "Cargo.toml");
  // argv, not a shell: the message is never re-parsed.
  git("commit", "-m", `bump version to ${tag}`);
}

git("tag", "-f", tag);
git("push");
git("push", "-f", "origin", tag);

console.log("");
console.log(`Tag ${tag} pushed. GitHub Actions (publish.yml) will build, test, and publish to crates.io.`);
