/**
 * The release-mode compatibility gate (workspace letters H6, H33 slot U5), one implementation for
 * every caller: `scripts/bump.ts` (the floor before a bump), `scripts/release.ts` (the cold gate
 * before `main` is pushed) and CI's `checks` job (on the pushed commit, before any tag exists).
 *
 *   bun scripts/compat.ts --release
 *
 * Against the PREVIOUS release (the highest `v*` tag below Cargo.toml's version; a tag for this
 * version is allowed only on HEAD — a re-run):
 *   1. API floor: `cargo semver-checks check-release --baseline-rev <prev>` — it infers the
 *      required bump from the two versions, so a too-small bump fails here.
 *   2. SPEC: `SPEC_VERSION` must equal the reference `SPEC.md` (universalWasmLoader-js `main`),
 *      and a SPEC change since <prev> needs at least its own level in the version bump.
 *   3. Behaviour: <prev>'s `tests/` (with its own fixtures) against this `src/`, in a throwaway
 *      `.compat/` crate; red refuses a patch or minor, a major may proceed.
 *   4. Packaging: `cargo package --locked` (the publish dry run; it builds the packaged crate).
 *
 * `node:` builtins and `fetch` only. Every network request has a 30 s limit.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const KINDS = ["patch", "minor", "major"] as const;
export type Kind = (typeof KINDS)[number];

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SPEC_URL =
  process.env.SPEC_REFERENCE_URL ??
  "https://raw.githubusercontent.com/synapticforge1/universalWasmLoader-js/main/SPEC.md";
const SPEC_CONST = /pub const SPEC_VERSION: &str = "(\d+\.\d+\.\d+)";/;
const VERSION_LINE = /^version[ \t]*=[ \t]*"(\d+\.\d+\.\d+)"/m;

export function run(cmd: string, args: string[], cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

export function parse(v: string): [number, number, number] {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`not a version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compare(a: string, b: string): number {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The level of the change from `a` to `b` (b > a); null when equal. */
export function bumpKind(a: string, b: string): Kind | null {
  const [x, y] = [parse(a), parse(b)];
  if (x[0] !== y[0]) return "major";
  if (x[1] !== y[1]) return "minor";
  if (x[2] !== y[2]) return "patch";
  return null;
}

export function atLeast(k: Kind, floor: Kind): boolean {
  return KINDS.indexOf(k) >= KINDS.indexOf(floor);
}

export function cargoVersion(root = ROOT): string {
  const m = readFileSync(join(root, "Cargo.toml"), "utf8").match(VERSION_LINE);
  if (!m) throw new Error("no version line in Cargo.toml");
  return m[1];
}

export function specVersionAt(rev: string | null, root = ROOT): string | null {
  const text = rev === null
    ? readFileSync(join(root, "src", "lib.rs"), "utf8")
    : run("git", ["show", `${rev}:src/lib.rs`], root).stdout;
  return text.match(SPEC_CONST)?.[1] ?? null;
}

/** The reference SPEC.md's `Version:` line, fetched with a 30 s limit. */
export async function referenceSpec(): Promise<string> {
  let text: string;
  try {
    const res = await fetch(SPEC_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    throw new Error(`could not read the reference SPEC.md (${SPEC_URL}): ${(e as Error).message}`);
  }
  const m = text.match(/^Version:\s*(\d+\.\d+\.\d+)/m);
  if (!m) throw new Error(`the reference SPEC.md has no "Version:" line (${SPEC_URL})`);
  return m[1];
}

/** The highest `v*` tag strictly below `version`, or null. */
export function previousTag(version: string, root = ROOT): string | null {
  const tags = run("git", ["tag", "-l", "v*"], root).stdout.split(/\r?\n/).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const below = tags.filter((t) => compare(t, version) < 0).sort(compare);
  return below.at(-1) ?? null;
}

/** <tag>'s `tests/` against this `src/` in a throwaway `.compat/` crate. */
export function prevTagTests(tag: string, root = ROOT): { green: boolean; summary: string; failures: string } {
  const compat = join(root, ".compat");
  rmSync(compat, { recursive: true, force: true });
  try {
    mkdirSync(compat);
    for (const f of ["Cargo.toml", "Cargo.lock", "README.md"]) cpSync(join(root, f), join(compat, f));
    cpSync(join(root, "src"), join(compat, "src"), { recursive: true });
    const tar = join(compat, "tests.tar");
    const archived = run("git", ["archive", "--format=tar", "-o", tar, tag, "tests"], root);
    const untarred = archived.status === 0 && run("tar", ["-xf", "tests.tar"], compat).status === 0;
    if (!untarred) throw new Error(`could not extract ${tag}:tests`);
    rmSync(tar);
    const r = run("cargo", ["test", "--locked", "--tests"], compat);
    const out = `${r.stdout}\n${r.stderr}`;
    let passed = 0;
    let failed = 0;
    for (const m of out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) {
      passed += Number(m[1]);
      failed += Number(m[2]);
    }
    const green = r.status === 0 && passed > 0 && failed === 0;
    const failures = green ? "" : out.split("\n").filter((l) => /FAILED|panicked|error(\[|:)/.test(l)).join("\n");
    return { green, summary: `${passed} passed, ${failed} failed (exit ${r.status})`, failures };
  } finally {
    rmSync(compat, { recursive: true, force: true });
  }
}

/** The whole release-mode gate. Returns the lines to print; throws with the reason on a refusal. */
export async function releaseGate(root = ROOT): Promise<string[]> {
  const out: string[] = [];
  const version = cargoVersion(root);
  const here = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
  const own = run("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}^{commit}`], root);
  if (own.status === 0 && own.stdout.trim() !== here) {
    throw new Error(`tag v${version} exists on ${own.stdout.trim()}, not on HEAD ${here}: this version is already released`);
  }
  const prev = previousTag(version, root);
  if (prev === null) throw new Error(`no v* tag below ${version}: nothing to compare with`);
  const kind = bumpKind(prev, version);
  if (kind === null) throw new Error(`Cargo.toml ${version} equals ${prev}`);
  out.push(`release ${version} over ${prev}: a ${kind} bump`);

  // 1. API floor
  const sc = run("cargo", ["semver-checks", "check-release", "--baseline-rev", prev], root);
  if (sc.error || /no such command|not installed/i.test(sc.stderr)) {
    throw new Error("cargo-semver-checks is required — cargo install cargo-semver-checks --locked");
  }
  if (sc.status !== 0) {
    const lints = [...`${sc.stdout}${sc.stderr}`.matchAll(/--- failure ([\w-]+):/g)].map((m) => m[1]);
    throw new Error(`cargo semver-checks refuses a ${kind} bump over ${prev}: ${lints.join(", ") || sc.stderr.trim()}`);
  }
  out.push(`API floor: cargo semver-checks accepts the ${kind} bump over ${prev}`);

  // 2. SPEC
  const ours = specVersionAt(null, root);
  if (ours === null) throw new Error("no `pub const SPEC_VERSION` in src/lib.rs");
  const reference = await referenceSpec();
  if (ours !== reference) throw new Error(`SPEC_VERSION is ${ours} but the reference SPEC.md is ${reference}`);
  const atPrev = specVersionAt(prev, root);
  if (atPrev !== null && atPrev !== ours) {
    const specKind = bumpKind(atPrev, ours);
    if (specKind && !atLeast(kind, specKind)) {
      throw new Error(`SPEC ${atPrev} -> ${ours} is a ${specKind} change; a ${kind} release is too small`);
    }
    out.push(`SPEC ${atPrev} -> ${ours} (${specKind}) = reference; covered by the ${kind} bump`);
  } else {
    out.push(`SPEC_VERSION ${ours} = reference SPEC.md ${reference}${atPrev === null ? ` (none at ${prev})` : ""}`);
  }

  // 3. Behaviour
  const t = prevTagTests(prev, root);
  out.push(`${prev} tests/ against this src/: ${t.green ? "green" : "RED"} — ${t.summary}`);
  if (!t.green && kind !== "major") {
    throw new Error(`${prev}'s tests are red against this src/; a ${kind} release is refused (classify each failure)\n${t.failures}`);
  }

  // 4. Packaging (the publish dry run)
  const pkg = run("cargo", ["package", "--locked", "--quiet"], root);
  if (pkg.status !== 0) throw new Error(`cargo package --locked failed:\n${pkg.stderr.trim()}`);
  out.push("cargo package --locked: the packaged crate builds");
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--release") {
    console.error("compat: usage — bun scripts/compat.ts --release");
    process.exit(2);
  }
  if (!existsSync(join(ROOT, "Cargo.toml"))) {
    console.error(`compat: no Cargo.toml at ${ROOT}`);
    process.exit(1);
  }
  try {
    for (const line of await releaseGate()) console.log(line);
    console.log("compat --release: green");
  } catch (e) {
    console.error(`compat: ${(e as Error).message}`);
    process.exit(1);
  }
}
