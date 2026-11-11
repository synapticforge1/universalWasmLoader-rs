/**
 * The crates.io half of a release (workspace letter H33, slot U8; the owner's decision D2,
 * 2026-11-10: crates.io publishes from CI only, through trusted publishing — no stored token).
 * `.github/workflows/publish.yml`'s `publish` job runs, in order:
 *
 *   bun scripts/crates-io.ts has       # is VERSION already listed?  published=true|false
 *   bun scripts/crates-io.ts token     # GitHub OIDC (audience "crates.io") -> a short-lived crates.io token
 *   cargo publish --locked --no-verify # with that token
 *   bun scripts/crates-io.ts revoke    # end the token (always runs once one was made)
 *   bun scripts/crates-io.ts readback  # FATAL: crates.io serves VERSION, not yanked
 *
 * Trusted publishing, as rust-lang/crates-io-auth-action implements it (read 2026-11-10 from its
 * `dist/main.js` / `dist/post.js`): the OIDC audience is the registry host without its scheme
 * ("crates.io"); `POST <registry>/api/v1/trusted_publishing/tokens` with `{"jwt": …}` answers
 * `{"token": …}`; `DELETE` on the same URL with `Authorization: Bearer <token>` revokes it. The
 * GitHub side is the runner's documented OIDC request (`ACTIONS_ID_TOKEN_REQUEST_URL` +
 * `&audience=…`, `Authorization: bearer ACTIONS_ID_TOKEN_REQUEST_TOKEN` → `{"value": jwt}`), as
 * loader-py measured for PyPI. It needs the job's `id-token: write` and, on crates.io, a trusted
 * publisher for this repository and workflow (an owner setting).
 *
 * Environment:
 *   CRATE, VERSION              the crate and X.Y.Z
 *   CRATES_API_URL              default https://crates.io
 *   ACTIONS_ID_TOKEN_REQUEST_*  set by GitHub when the job has id-token: write (token)
 *   GITHUB_ENV / GITHUB_OUTPUT  where `token` hands the token on / where `has` answers
 *   CARGO_REGISTRY_TOKEN        the token, for `revoke`
 *   CRATES_TIMEOUT_MS           the limit for EACH request, request to last byte; default 30000
 *   READBACK_ATTEMPTS / READBACK_INTERVAL_MS   default 30 × 10000 (5 minutes)
 *
 * The token is never printed: `::add-mask::` comes first, then it goes to GITHUB_ENV only.
 * `node:` builtins and `fetch` only.
 */
import { appendFileSync } from "node:fs";
import process from "node:process";

const command = process.argv[2];
if (!["has", "token", "revoke", "readback"].includes(command ?? "")) {
  fail(`the first argument must be has | token | revoke | readback (got "${command ?? ""}")`);
}
if (process.argv.length > 3) fail(`unexpected arguments: ${process.argv.slice(3).join(" ")}`);

function fail(msg: string): never {
  console.error(`crates-io: ${msg}`);
  process.exit(1);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} is not set`);
  return v;
}

const crate = need("CRATE");
const version = need("VERSION");
if (!/^[a-z0-9_-]+$/.test(crate)) fail(`CRATE "${crate}" is not a crate name`);
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION "${version}" is not X.Y.Z`);
const registry = (process.env.CRATES_API_URL || "https://crates.io").replace(/\/+$/, "");
const timeoutMs = Number(process.env.CRATES_TIMEOUT_MS ?? "30000");
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("CRATES_TIMEOUT_MS must be a positive number");
const UA = "universalWasmLoader-rs release workflow (https://github.com/synapticforge1/universalWasmLoader-rs)";
const TOKENS = `${registry}/api/v1/trusted_publishing/tokens`;

/** One request under ONE time limit, request to last byte. Never logs headers or bodies. */
async function call(method: string, url: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const label = `${method} ${url.replace(/\?.*$/, "")}`;
  try {
    const res = await fetch(url, { method, headers: { "User-Agent": UA, ...init.headers }, body: init.body, signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    if (signal.aborted) fail(`${label}: timed out after ${timeoutMs} ms`);
    fail(`${label}: ${(e as Error).message}`);
  }
}

if (command === "has") {
  const r = await call("GET", `${registry}/api/v1/crates/${crate}/versions`);
  let published: boolean;
  if (r.status === 404) published = false; // the crate itself does not exist yet
  else if (r.status === 200 && Array.isArray(r.json?.versions)) {
    published = r.json.versions.some((v: { num: string }) => v.num === version);
  } else fail(`crates.io's version list for ${crate}: HTTP ${r.status}`);
  console.log(`crates.io ${published ? "already lists" : "does not list"} ${crate} ${version}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
  process.exit(0);
}

if (command === "token") {
  const reqUrl = need("ACTIONS_ID_TOKEN_REQUEST_URL");
  const reqToken = need("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const envFile = need("GITHUB_ENV");
  const audience = registry.replace(/^https?:\/\//, "");
  const oidcUrl = new URL(reqUrl);
  oidcUrl.searchParams.set("audience", audience);
  const oidc = await call("GET", oidcUrl.toString(), { headers: { Authorization: `bearer ${reqToken}` } });
  const jwt = oidc.json?.value;
  if (oidc.status !== 200 || typeof jwt !== "string" || !jwt) fail(`GitHub's OIDC token request: HTTP ${oidc.status}`);
  const ex = await call("POST", TOKENS, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jwt }) });
  const token = ex.json?.token;
  if (ex.status !== 200 || typeof token !== "string" || !token) {
    const detail = Array.isArray(ex.json?.errors) ? ex.json.errors.map((e: { detail?: string }) => e.detail).join("; ") : "";
    fail(`crates.io refused the trusted-publishing exchange: HTTP ${ex.status}${detail ? ` — ${detail}` : ""} (is a trusted publisher configured for this repository and workflow on crates.io?)`);
  }
  console.log(`::add-mask::${token}`);
  appendFileSync(envFile, `CARGO_REGISTRY_TOKEN=${token}\n`);
  console.log(`crates.io issued a trusted-publishing token (audience ${audience}); handed to the next steps, masked`);
  process.exit(0);
}

if (command === "revoke") {
  const token = need("CARGO_REGISTRY_TOKEN");
  const r = await call("DELETE", TOKENS, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status < 200 || r.status > 299) fail(`revoking the trusted-publishing token: HTTP ${r.status}`);
  console.log("the trusted-publishing token is revoked");
  process.exit(0);
}

// readback — FATAL unless crates.io serves VERSION, not yanked
const attempts = Number(process.env.READBACK_ATTEMPTS ?? "30");
const interval = Number(process.env.READBACK_INTERVAL_MS ?? "10000");
let last = "";
for (let i = 1; i <= attempts; i++) {
  const r = await call("GET", `${registry}/api/v1/crates/${crate}/${version}`);
  const v = r.json?.version;
  if (r.status === 200 && v?.num === version) {
    if (v.yanked) fail(`crates.io serves ${crate} ${version} but it is YANKED`);
    console.log(`crates.io serves ${crate} ${version} (not yanked), attempt ${i}`);
    process.exit(0);
  }
  last = `HTTP ${r.status}`;
  console.log(`attempt ${i}/${attempts}: ${last}`);
  if (i < attempts) await new Promise((resolve) => setTimeout(resolve, interval));
}
fail(`crates.io does not serve ${crate} ${version} after ${attempts} attempts (${last})`);
