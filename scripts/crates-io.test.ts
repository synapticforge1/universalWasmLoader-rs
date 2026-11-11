/**
 * Tests for scripts/crates-io.ts (workspace letter H33, slot U8): `has`, `token`, `revoke` and
 * `readback` run as a child process against ONE mock server that plays both GitHub's OIDC token
 * endpoint and crates.io's API, recording every request. Run with `bun test scripts/`.
 */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./crates-io.ts", import.meta.url));
const CRATE = "universal-wasm-loader";
const VERSION = "9.8.7";
const JWT = "header.payload.signature";
const CRATES_TOKEN = "cio-secret-token-123";

type Hit = { method: string; path: string; search: string; auth: string | null; body: string };
let state: {
  listed: string[]; listStatus: number; oidcStatus: number; exchangeStatus: number;
  revokeStatus: number; servedAfter: number; yanked: boolean; stall: boolean;
};
let hits: Hit[];
let versionGets = 0;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
    hits.push({ method: req.method, path: url.pathname, search: url.search, auth: req.headers.get("authorization"), body });
    if (state.stall) return new Promise<Response>(() => {});
    if (url.pathname === "/oidc") {
      if (state.oidcStatus !== 200) return new Response("no", { status: state.oidcStatus });
      return Response.json({ value: JWT });
    }
    if (url.pathname === `/api/v1/crates/${CRATE}/versions`) {
      if (state.listStatus !== 200) return Response.json({ errors: [] }, { status: state.listStatus });
      return Response.json({ versions: state.listed.map((num) => ({ num })) });
    }
    if (url.pathname === "/api/v1/trusted_publishing/tokens" && req.method === "POST") {
      if (state.exchangeStatus !== 200) {
        return Response.json({ errors: [{ detail: "No matching Trusted Publishing config found" }] }, { status: state.exchangeStatus });
      }
      return Response.json({ token: CRATES_TOKEN });
    }
    if (url.pathname === "/api/v1/trusted_publishing/tokens" && req.method === "DELETE") {
      return new Response(null, { status: state.revokeStatus });
    }
    if (url.pathname === `/api/v1/crates/${CRATE}/${VERSION}`) {
      versionGets++;
      if (versionGets <= state.servedAfter) return Response.json({ errors: [] }, { status: 404 });
      return Response.json({ version: { num: VERSION, yanked: state.yanked } });
    }
    return Response.json({ errors: [] }, { status: 404 });
  },
});

let dir: string;
afterAll(() => server.stop(true));
beforeEach(() => {
  state = { listed: ["1.0.0"], listStatus: 200, oidcStatus: 200, exchangeStatus: 200, revokeStatus: 204, servedAfter: 0, yanked: false, stall: false };
  hits = [];
  versionGets = 0;
  dir = mkdtempSync(join(tmpdir(), "cio-test-"));
});

async function run(cmd: string, extra: Record<string, string | null> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["GITHUB_ENV", "GITHUB_OUTPUT", "CARGO_REGISTRY_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) delete env[k];
  Object.assign(env, {
    CRATE, VERSION, CRATES_API_URL: `http://127.0.0.1:${server.port}`,
    READBACK_ATTEMPTS: "4", READBACK_INTERVAL_MS: "50",
  });
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  const p = Bun.spawn(["bun", SCRIPT, cmd], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err, all: out + err };
}

function tokenEnv() {
  const envFile = join(dir, "env");
  writeFileSync(envFile, "");
  return {
    envFile,
    vars: {
      ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${server.port}/oidc?api-version=2.0`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-req-token",
      GITHUB_ENV: envFile,
    },
  };
}

test("has: not listed → published=false", async () => {
  const out = join(dir, "out");
  const r = await run("has", { GITHUB_OUTPUT: out });
  expect(r.code).toBe(0);
  expect(readFileSync(out, "utf8")).toBe("published=false\n");
  expect(hits.every((h) => h.path.endsWith("/versions"))).toBe(true); // never the version's own URL
  rmSync(dir, { recursive: true });
});

test("has: listed → published=true", async () => {
  state.listed = ["1.0.0", VERSION];
  const out = join(dir, "out");
  expect((await run("has", { GITHUB_OUTPUT: out })).code).toBe(0);
  expect(readFileSync(out, "utf8")).toBe("published=true\n");
});

test("has: the crate does not exist yet (404) → published=false; a 500 → exit 1", async () => {
  state.listStatus = 404;
  expect((await run("has")).all).toContain("does not list");
  state.listStatus = 500;
  expect((await run("has")).code).toBe(1);
});

test("token: OIDC with audience crates.io → exchange → masked, handed on, never printed", async () => {
  const { envFile, vars } = tokenEnv();
  const r = await run("token", vars);
  expect(r.code).toBe(0);
  const oidc = hits.find((h) => h.path === "/oidc")!;
  expect(new URLSearchParams(oidc.search).get("audience")).toBe(`127.0.0.1:${server.port}`);
  expect(new URLSearchParams(oidc.search).get("api-version")).toBe("2.0");
  expect(oidc.auth).toBe("bearer runner-req-token");
  const ex = hits.find((h) => h.path === "/api/v1/trusted_publishing/tokens")!;
  expect(ex.method).toBe("POST");
  expect(JSON.parse(ex.body)).toEqual({ jwt: JWT });
  expect(readFileSync(envFile, "utf8")).toBe(`CARGO_REGISTRY_TOKEN=${CRATES_TOKEN}\n`);
  const lines = r.out.split("\n");
  expect(lines[0]).toBe(`::add-mask::${CRATES_TOKEN}`);
  expect(lines.slice(1).join("\n")).not.toContain(CRATES_TOKEN);
  expect(r.err).not.toContain(CRATES_TOKEN);
});

test("token: the audience is the registry host without its scheme (crates.io in CI)", async () => {
  // the code under test strips the scheme; with the real default it is exactly "crates.io"
  const src = readFileSync(SCRIPT, "utf8");
  expect(src).toContain(`registry.replace(/^https?:\\/\\//, "")`);
  expect(src).toContain(`"https://crates.io"`);
});

test("token: crates.io refuses the exchange → exit 1, names the config, writes nothing", async () => {
  state.exchangeStatus = 400;
  const { envFile, vars } = tokenEnv();
  const r = await run("token", vars);
  expect(r.code).toBe(1);
  expect(r.all).toContain("No matching Trusted Publishing config found");
  expect(readFileSync(envFile, "utf8")).toBe("");
});

test("token: GitHub's OIDC request fails → exit 1, no exchange", async () => {
  state.oidcStatus = 403;
  const { vars } = tokenEnv();
  const r = await run("token", vars);
  expect(r.code).toBe(1);
  expect(hits.some((h) => h.path === "/api/v1/trusted_publishing/tokens")).toBe(false);
});

test("token: no id-token permission (no request URL) → exit 1 before any request", async () => {
  const { vars } = tokenEnv();
  const r = await run("token", { ...vars, ACTIONS_ID_TOKEN_REQUEST_URL: null });
  expect(r.code).toBe(1);
  expect(hits.length).toBe(0);
});

test("revoke: DELETE with Bearer token", async () => {
  const r = await run("revoke", { CARGO_REGISTRY_TOKEN: CRATES_TOKEN });
  expect(r.code).toBe(0);
  const d = hits.find((h) => h.method === "DELETE")!;
  expect(d.path).toBe("/api/v1/trusted_publishing/tokens");
  expect(d.auth).toBe(`Bearer ${CRATES_TOKEN}`);
  state.revokeStatus = 401;
  expect((await run("revoke", { CARGO_REGISTRY_TOKEN: CRATES_TOKEN })).code).toBe(1);
});

test("readback: polls until served", async () => {
  state.servedAfter = 2;
  const r = await run("readback");
  expect(r.code).toBe(0);
  expect(r.all).toContain("attempt 3");
});

test("readback: never served → FATAL", async () => {
  state.servedAfter = 99;
  const r = await run("readback");
  expect(r.code).toBe(1);
  expect(r.all).toContain("after 4 attempts");
});

test("readback: served but yanked → FATAL", async () => {
  state.yanked = true;
  const r = await run("readback");
  expect(r.code).toBe(1);
  expect(r.all).toContain("YANKED");
});

test("stalled registry: fails at the time limit instead of hanging", async () => {
  state.stall = true;
  const t = Date.now();
  const r = await run("has", { CRATES_TIMEOUT_MS: "300" });
  expect(r.code).toBe(1);
  expect(r.all).toContain("timed out after 300 ms");
  expect(Date.now() - t).toBeLessThan(8000);
}, 10000);

test("unknown command or bad version → refused before any request", async () => {
  expect((await run("publish")).code).toBe(1);
  expect((await run("has", { VERSION: "1.0" })).code).toBe(1);
  expect(hits.length).toBe(0);
});
