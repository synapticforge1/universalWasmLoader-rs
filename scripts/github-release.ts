/**
 * The GitHub half of a release, through GitHub's REST API — not the GitHub CLI (workspace letters
 * H30, H32, H33). `.github/workflows/publish.yml` fetches this one file at `github.sha` and runs:
 *
 *   bun github-release.ts state  # checks: is this push a release?  new | rerun | none
 *   bun github-release.ts tag    # tag job (U6): CI's annotated tag vX.Y.Z on GITHUB_SHA
 *   bun github-release.ts page   # release job (U7): the Release page FROM that tag
 *   … --dry-run                  # every check, nothing written
 *
 * The owner's order (2026-11-10): checks, then the tag, then the page from the tag, then the
 * publish. A tag pushed with the job's GITHUB_TOKEN starts no workflow run, so all four jobs run in
 * the one run started by the push of `main` (`needs:`).
 *
 * Environment (GitHub Actions sets all but the token and VERSION, which the job passes in):
 *   GITHUB_REPOSITORY  owner/repo     GITHUB_SHA  the commit the run is for
 *   VERSION            X.Y.Z, Cargo.toml's version (the tag is vX.Y.Z)
 *   GITHUB_TOKEN       contents: write for `tag` / `page`; reads need none
 *   GITHUB_API_URL     default https://api.github.com
 *   CRATE              the crates.io name, for the link on top of the page's notes
 *   RELEASE_TIMEOUT_MS the limit for EACH request, request to last byte; default 30000
 *   GITHUB_OUTPUT      when set, `state` also writes `state=<answer>` there
 *
 * state: the tag is absent → new (a release); it peels to GITHUB_SHA → rerun (finish what a failed
 *        run left); it peels elsewhere → none (an ordinary push of an already-released version).
 * tag:   absent → POST git/tags (annotated, message "vX.Y.Z") + POST git/refs, then read back: it
 *        must peel to GITHUB_SHA. Already peeling to GITHUB_SHA → done, nothing written. Elsewhere
 *        → refused: a published tag never moves.
 * page:  H32's order: (1) the tag peels to GITHUB_SHA (`POST /releases` would CREATE a missing
 *        tag from the default branch); (2) an existing page = done, nothing written; (3) POST
 *        `generate_release_notes` with the crates.io link on top, read back (the tag, not a
 *        draft), peel again.
 *
 * `node:` builtins and `fetch` only.
 */
import process from "node:process";

const argv = process.argv.slice(2);
const command = argv[0];
const dryRun = argv.slice(1).includes("--dry-run");
if (!["state", "tag", "page"].includes(command ?? "")) {
  fail(`the first argument must be state | tag | page (got "${command ?? ""}")`);
}
for (const arg of argv.slice(1)) {
  if (arg !== "--dry-run") fail(`unknown argument "${arg}" — use --dry-run or nothing`);
}

function fail(msg: string): never {
  console.error(`github-release: ${msg}`);
  process.exit(1);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} is not set`);
  return v;
}

const repo = need("GITHUB_REPOSITORY");
const sha = need("GITHUB_SHA");
const version = need("VERSION");
const tag = `v${version}`;
const token = process.env.GITHUB_TOKEN ?? "";
const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const timeoutMs = Number(process.env.RELEASE_TIMEOUT_MS ?? "30000");

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`GITHUB_REPOSITORY "${repo}" is not owner/repo`);
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION "${version}" is not X.Y.Z`);
if (!/^[0-9a-f]{40}$/.test(sha)) fail(`GITHUB_SHA "${sha}" is not a full commit id`);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail(`RELEASE_TIMEOUT_MS must be a positive number`);

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${repo} release workflow`,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** One request under ONE time limit, from the request to the last byte of the body. */
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let status: number;
  let text: string;
  try {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: body === undefined ? headers() : { ...headers(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    if (signal.aborted) fail(`${method} ${path}: timed out after ${timeoutMs} ms`);
    fail(`${method} ${path}: ${(e as Error).message}`);
  }
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status, json };
}

/** The commit the tag peels to on GitHub (annotated tags followed), or null when it is absent. */
async function peel(): Promise<string | null> {
  const ref = await call("GET", `/repos/${repo}/git/ref/tags/${tag}`);
  if (ref.status === 404) return null;
  if (ref.status !== 200) fail(`GET tag ref ${tag}: HTTP ${ref.status} ${JSON.stringify(ref.json)}`);
  let object = ref.json?.object as { type: string; sha: string } | undefined;
  for (let depth = 0; object?.type === "tag"; depth++) {
    if (depth > 5) fail(`tag ${tag} nests more than 5 tag objects`);
    const t = await call("GET", `/repos/${repo}/git/tags/${object.sha}`);
    if (t.status !== 200) fail(`GET tag object ${object.sha}: HTTP ${t.status}`);
    object = t.json?.object;
  }
  if (object?.type !== "commit") fail(`tag ${tag} does not point to a commit (${JSON.stringify(object)})`);
  return object.sha;
}

if (command === "state") {
  const at = await peel();
  const state = at === null ? "new" : at === sha ? "rerun" : "none";
  console.log(`state=${state}  (tag ${tag} ${at === null ? "absent" : `on ${at}`}; this run is for ${sha})`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(out, `state=${state}\n`);
  }
  process.exit(0);
}

if (command === "tag") {
  const at = await peel();
  if (at === sha) {
    console.log(`tag ${tag} already on ${sha}, nothing written`);
    process.exit(0);
  }
  if (at !== null) fail(`tag ${tag} is on ${at}, not ${sha}; refusing (a published tag never moves)`);
  if (dryRun) {
    console.log(`dry-run: would create the annotated tag ${tag} on ${sha}`);
    process.exit(0);
  }
  if (!token) fail("GITHUB_TOKEN is not set; cannot create the tag");
  const obj = await call("POST", `/repos/${repo}/git/tags`, { tag, message: tag, object: sha, type: "commit" });
  if (obj.status !== 201 || !/^[0-9a-f]{40}$/.test(obj.json?.sha ?? "")) {
    fail(`POST tag object ${tag}: HTTP ${obj.status} ${JSON.stringify(obj.json)}`);
  }
  const ref = await call("POST", `/repos/${repo}/git/refs`, { ref: `refs/tags/${tag}`, sha: obj.json.sha });
  if (ref.status !== 201) fail(`POST ref refs/tags/${tag}: HTTP ${ref.status} ${JSON.stringify(ref.json)}`);
  const back = await peel();
  if (back !== sha) fail(`after creating it, tag ${tag} peels to ${back ?? "nothing"}, not ${sha}`);
  console.log(`tag ${tag} created (annotated, object ${obj.json.sha}) on ${sha}, read back`);
  process.exit(0);
}

// page — H32's order
const crate = need("CRATE");
if (!/^[a-z0-9_-]+$/.test(crate)) fail(`CRATE "${crate}" is not a crate name`);

// 1. The tag exists and peels to the commit this run is for.
const before = await peel();
if (before === null) fail(`tag ${tag} does not exist on GitHub; refusing (a release would create it)`);
if (before !== sha) fail(`tag ${tag} is ${before}, this run is for ${sha}; refusing`);
console.log(`tag ${tag} = ${sha}`);

// 2. Already released? Then nothing is written.
const existing = await call("GET", `/repos/${repo}/releases/tags/${tag}`);
if (existing.status === 200) {
  console.log(`GitHub Release ${tag} already exists, nothing written: ${existing.json?.html_url}`);
  process.exit(0);
}
if (existing.status !== 404) fail(`GET release ${tag}: HTTP ${existing.status} ${JSON.stringify(existing.json)}`);

// 3. Create it, read it back, peel the tag again.
const body = {
  tag_name: tag,
  name: tag,
  body: `crates.io: https://crates.io/crates/${crate}/${version}`,
  generate_release_notes: true,
  draft: false,
  prerelease: false,
};
if (dryRun) {
  console.log(`dry-run: would POST /repos/${repo}/releases ${JSON.stringify(body)}`);
  process.exit(0);
}
if (!token) fail("GITHUB_TOKEN is not set; cannot create the release");
const created = await call("POST", `/repos/${repo}/releases`, body);
if (created.status !== 201) fail(`POST release ${tag}: HTTP ${created.status} ${JSON.stringify(created.json)}`);
const back = await call("GET", `/repos/${repo}/releases/tags/${tag}`);
if (back.status !== 200) fail(`read-back of release ${tag}: HTTP ${back.status}`);
if (back.json?.tag_name !== tag || back.json?.draft !== false) {
  fail(`read-back of release ${tag}: tag_name ${back.json?.tag_name}, draft ${back.json?.draft}`);
}
const after = await peel();
if (after !== sha) fail(`after the POST, tag ${tag} is ${after ?? "missing"}, not ${sha}`);
console.log(`GitHub Release ${tag} created: ${back.json?.html_url}`);
