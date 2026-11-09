# universal-wasm-loader

A universal WebAssembly loader for Rust with automatic WIT-based ABI translation.
Rust port of the [UniversalWasmLoader Spec v4.0.1](https://github.com/synapticforge1/universalWasmLoader-js/blob/main/SPEC.md).

Backed by [wasmtime](https://crates.io/crates/wasmtime). Works with any `.wasm` + `.wit` pair produced by [`wasmtk`](https://github.com/synapticforge1/wasmtk). ABI (wasic vs Canonical) is auto-detected — no profile configuration needed.

---

## Quick Start

```toml
[dependencies]
universal-wasm-loader = "1.0"
```

```rust
use universal_wasm_loader::wasm_load;

fn main() -> anyhow::Result<()> {
    let m = wasm_load("my_module.wasm", None)?;
    let result: i32 = m.call("add", (3i32, 4i32))?;
    println!("{result}"); // 7
    Ok(())
}
```

`wasm_load` auto-detects the companion `.wit` file by replacing the `.wasm` suffix with `.wit` (a URL's query and fragment are dropped), and reads it **before** the `.wasm`. WIT export names are converted from kebab-case to snake_case for the Rust API (e.g. `is-positive` → `"is_positive"`).

Raw WASM exports, with no ABI translation, are returned **only when the `.wit` is absent**: no such file, an HTTP 404 / 410, or a path that does not end in `.wasm`. Any other `.wit` failure is an error, raised before the `.wasm` is fetched: an unreadable file, another HTTP status, a network error, the time limit, or a `.wit` that does not parse. A module never silently loses its typed interface. See [Errors](#errors).

---

## Typed Interface

Use `wasm_interface!` to declare a named struct with typed methods — the closest Rust equivalent to a TypeScript interface. The `load` function is synchronous; no `await` anywhere in user code.

```rust
use universal_wasm_loader::wasm_interface;

wasm_interface! {
    pub struct Math {
        fn add(a: i32, b: i32) -> i32;
        fn multiply(a: f64, b: f64) -> f64;
        fn square(x: i32) -> i32;
    }
}

fn main() -> anyhow::Result<()> {
    let math = Math::load("math.wasm", None)?;
    assert_eq!(math.add(3, 4)?,      7);
    assert_eq!(math.multiply(2.5, 4.0)?, 10.0);
    assert_eq!(math.square(5)?,      25);
    Ok(())
}
```

---

## Bind Individual Exports

Extract a single export as a standalone callable — useful when you only need one or two functions.

```rust
use universal_wasm_loader::wasm_load;

fn main() -> anyhow::Result<()> {
    let m      = wasm_load("math.wasm", None)?;
    let add    = m.bind::<(i32, i32), i32>("add");
    let square = m.bind::<(i32,), i32>("square");

    assert_eq!(add((3, 4))?,  7);
    assert_eq!(square((5,))?, 25);
    Ok(())
}
```

---

## Host Import Callbacks

Provide callbacks for WIT `import` declarations using `Callbacks::on` — pass and receive native Rust types, no manual encoding. Callback keys are **camelCase** WIT import names (e.g. `"envMul"` for `env-mul`):

```rust
use universal_wasm_loader::{wasm_load, Callbacks};

fn main() -> anyhow::Result<()> {
    let cbs = Callbacks::new()
        .on("envMul", |(a, b): (f64, f64)| a * b)
        .on("envAdd", |(a, b): (i32, i32)| a + b);

    let m = wasm_load("imports.wasm", Some(cbs))?;
    let r: f64 = m.call("scale",   (3.0f64, 4.0f64))?;
    let n: i32 = m.call("combine", (10i32,  7i32))?;
    assert_eq!(r, 12.0);
    assert_eq!(n, 17);
    Ok(())
}
```

**Every WIT `import` needs a callback.** A load with a missing one fails before the `.wasm` is read, naming every missing callback (`no host callback for WIT imports: envMul (WIT "env-mul"), envAdd (WIT "env-add")`). Callbacks for names the `.wit` does not import are ignored.

**A callback's return value must be the import's WIT result kind**, never converted: return an `f64` for `-> f64` (an `f32` or `i32` is refused) and a `bool` for `-> bool`. A mismatch is an error naming the callback, its import, the result type and the value, raised when WASM calls the import and returned by the export call that triggered it. A callback for an import with no result may return anything; the value is ignored. A callback's own `Err` reaches the caller unchanged. An import whose WIT result is `string` is not supported and fails the load.

---

## URL Loading (Async)

`wasm_import` supports `http://` and `https://` sources. It also works with local file paths when you are already in an async context.

```toml
[dependencies]
universal-wasm-loader = "1.0"
tokio = { version = "1", features = ["full"] }
```

```rust
use universal_wasm_loader::wasm_import;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let m = wasm_import("https://example.com/math.wasm", None).await?;
    let r: i32 = m.call("add", (3i32, 4i32))?;
    println!("{r}");
    Ok(())
}
```

Each file is fetched once, `.wit` first, and never retried.

### Time Limit and Cancellation

Each http(s) fetch must finish, from the request to the last byte of the body, within a time limit: **30 s by default**. Use `wasm_import_with_options` to change it, remove it, or cancel the load with a `CancelToken`:

```rust
use std::time::Duration;
use universal_wasm_loader::{wasm_import_with_options, CancelToken, LoadOptions};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cancel = CancelToken::new();
    let opts = LoadOptions::new()
        .timeout(Duration::from_secs(5)) // or .no_timeout()
        .cancel_token(cancel.clone());   // cancel.cancel() from anywhere stops the load

    let m = wasm_import_with_options("https://example.com/math.wasm", None, opts).await?;
    let r: i32 = m.call("add", (3i32, 4i32))?;
    println!("{r}");
    Ok(())
}
```

When the limit passes, the load fails naming the URL and the limit. A zero limit is an error. A token that is already cancelled fails the load before any request is made. Local files are read without a limit. `wasm_load`, `create_singleton` and `InstancePool` read local files only, so they take no options.

### Version Pinning

Append `@N` to the path to assert the module's `version` i32 global equals N:

```rust
let m = wasm_import("my_module.wasm@2", None).await?;
// errors if module.version != 2
```

---

## Instance Lifecycle

### Singleton

Loads once on the first call; all subsequent calls return a clone of the same `Arc`-backed instance.

```rust
use universal_wasm_loader::create_singleton;

fn main() -> anyhow::Result<()> {
    let get_mod = create_singleton("math.wasm", None);
    let a = get_mod()?;
    let b = get_mod()?;
    assert!(a.ptr_eq(&b)); // same underlying instance
    let r: i32 = a.call("add", (1i32, 2i32))?;
    assert_eq!(r, 3);
    Ok(())
}
```

### InstancePool

Pre-instantiates N independent WASM instances — each with its own linear memory. `run()` atomically acquires, calls, and releases, even if the closure returns an error.

```rust
use universal_wasm_loader::InstancePool;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let pool = InstancePool::new("math.wasm", None, 4).await?;

    let r: i32 = pool.run(|m| m.call("square", (5i32,))).await?;
    assert_eq!(r, 25);

    // concurrent — each run() gets its own instance
    let (a, b) = tokio::join!(
        pool.run(|m| -> anyhow::Result<i32> { m.call("add", (10i32, 5i32)) }),
        pool.run(|m| -> anyhow::Result<i32> { m.call("add", (3i32,  4i32)) }),
    );
    assert_eq!(a?, 15);
    assert_eq!(b?, 7);
    Ok(())
}
```

---

## Type Mapping

`call` accepts any tuple of these types as arguments and returns any of them:

| Rust type | WIT type |
| --- | --- |
| `i32` | `s32` |
| `i64` | `s64` |
| `f32` | `f32` |
| `f64` | `f64` |
| `bool` | `bool` |
| `String` / `&str` (arg) → `String` (return) | `string` |
| `()` | (no return value) |

The same types work in `Callbacks::on` closures — destructure the arg tuple and return any of the above directly.

**Nothing is converted.** With a `.wit`, a call checks its argument count and each argument's kind against the WIT signature before calling WASM: `s32` takes an `i32` (an `i64`, even in range, is refused), `f64` takes an `f64` (an `f32` or an integer is refused), `bool` takes a `bool`, and `string` takes a `&str` / `String`. The return type `R` of `call::<_, R>` must be the export's result kind, or `()` to discard it. Raw exports (no `.wit`) are the engine's own functions; wasmtime checks their argument types.

---

## Errors

Every failure is an `anyhow::Error`. Read the whole chain with `{:#}`: a host callback's error arrives wrapped in wasmtime's backtrace context.

| Situation | When | The message names |
| --- | --- | --- |
| `.wit` unreadable (not "not found"), not UTF-8, or HTTP status other than 404 / 410 | load, before the `.wasm` | the `.wit` path or URL; the status |
| `.wit` does not parse: a type outside `s32 s64 f32 f64 bool string` (e.g. `u32`), a parameter without `name: type`, a duplicate, text outside the one `world` | load, before the `.wasm` | the `.wit` and the fault |
| a WIT `export` the module does not export | load | each missing export |
| a WIT `import` with no callback; an import returning `string` | load, before the `.wasm` | each such import |
| the `.wasm` answers an HTTP error | load | the status and the URL |
| a fetch exceeds the time limit; the `CancelToken` is cancelled | load | the URL and the limit; "cancelled" |
| wrong argument count or kind in a typed call | call | the export, the parameter and its WIT type |
| a result read as the wrong kind | call | the export |
| a callback returns the wrong kind | call | the callback, its import, the result type and the value |

---

## Running Tests

```sh
cargo test
```

The suite covers numeric, bool, string, host-import, singleton, pool, bind, and `wasm_interface!` patterns, plus the SPEC §10 `_initialize` and WASI-shim cases. `tests/refusals.rs` covers SPEC §8 "Refusals" row by row; its http rows run against a local server on 127.0.0.1 that counts requests per path. The fixtures in `tests/` are the reference set from [`universalWasmLoader-js`](https://github.com/synapticforge1/universalWasmLoader-js), copied unmodified (SPEC §7); `tests/fixtures_stamp.rs` checks their bytes against `tests/fixtures.json`.

---

## Breaking Changes

Versions follow [Semantic Versioning 2.0.0](https://semver.org/): a breaking change takes a new
major version and is listed here with its migration.

| Version | Breaking change | Migration |
| --- | --- | --- |
| 1.0.0 | SPEC 4.0.0, loud failures. (1) Only an absent `.wit` (no file, HTTP 404 / 410, a path not ending in `.wasm`) gives raw exports; any other `.wit` failure is an error. (2) The `.wit` is parsed strictly: unknown types such as `u32` are no longer read as `s32`, and `wit_parser::parse_wit` now returns `Result<ParsedWit>`. (3) Every WIT import needs a callback; a missing one is no longer a silent `0`. (4) A callback's return kind is checked. (5) Typed-call arguments are checked: no extra arguments dropped, no `bool` default for a non-bool. (6) Each http(s) fetch has a 30 s limit. | Pass a callback for every WIT import. Use the exact Rust type for each WIT type (`i32` for `s32`, `f64` for `f64`), in calls and in callback results. Fix or remove a `.wit` that does not parse. For a slow server, use `wasm_import_with_options` with a longer `LoadOptions::timeout` or `no_timeout()`. |
| 0.1.0 → 0.2.0 | none (0.1.1 and 0.2.0 are compatible; 0.2.0 adds `SPEC_VERSION`) | — |

---

## Releasing (crates.io)

The crate version lives in **`Cargo.toml`** (`[package].version`) — the single source of truth.

The release scripts are TypeScript run by [Bun](https://bun.sh):

```sh
bun scripts/bump.ts            # patch:  0.1.0 -> 0.1.1   (default)
bun scripts/bump.ts minor      # minor:  0.1.0 -> 0.2.0
bun scripts/bump.ts major      # major:  0.1.0 -> 1.0.0
bun scripts/bump.ts --dry-run  # print the next version without writing
```

The bump is gated: it refuses a version below what `cargo semver-checks` requires (install with
`cargo install cargo-semver-checks --locked`), and a patch or minor while the previous release's
tests fail against the new source. It needs the reference clone at `upstream/universalWasmLoader-js`
to check `SPEC_VERSION`.

After bumping, commit the change, then tag and push to trigger publishing:

```sh
bun scripts/release.ts         # tags vX.Y.Z from Cargo.toml and pushes -> CI
```

`release.ts` never moves a tag: it refuses when `vX.Y.Z` already exists locally or on `origin`
(a published crate version can never be replaced), so a second release needs a new bump.

`scripts/release.ts` never runs `cargo publish` locally. The tag push triggers
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which runs three jobs on
GitHub runners, each with only the permission it needs:

| Job | Permission | Does |
| --- | --- | --- |
| `checks` | read | clones without credentials, builds, runs `cargo test`, `cargo semver-checks` and the release-page script's tests — all third-party code runs here, with no secret |
| `publish` | read | refuses unless the tag is still the commit `checks` passed, then runs `cargo publish --no-verify` with the crates.io token in that one step; skips the upload if crates.io already has the version |
| `release` | write | waits until crates.io serves the version (even if `publish` failed after uploading), then, with no checkout, fetches `scripts/github-release.ts` at the tagged commit and creates the GitHub Release page through the REST API (the tag must still be that commit; an existing page is left alone) |

> The publish workflow is written entirely with plain `run:` steps (checkout via
> `git clone`, Rust pinned to an exact version through the runner's `rustup`), so it runs
> under a GitHub Actions policy that permits only owner-owned actions. Under such a policy
> any third-party `uses:` step causes a `startup_failure` (nothing runs, nothing reaches
> crates.io). Do not add `uses:`.

### Required one-time owner setup (before the first publish)

1. **`CARGO_REGISTRY_TOKEN` repo secret** — create a crates.io API token at
   <https://crates.io/settings/tokens> (scope: publish-new + publish-update), then add it
   under repo **Settings → Secrets and variables → Actions → New repository secret**, named
   exactly `CARGO_REGISTRY_TOKEN`.
2. **Crate name** — `universal-wasm-loader` must be available (first publish) or already
   owned by your crates.io account. Verify at <https://crates.io/crates/universal-wasm-loader>.

---

## Ecosystem

This crate is part of the [polyglot WASM ecosystem](https://github.com/synapticforge1/wasmtk):

- [`wasmtk`](https://github.com/synapticforge1/wasmtk) — TypeScript-to-WASM compiler and polyglot build CLI
- [`universalWasmLoader-js`](https://github.com/synapticforge1/universalWasmLoader-js) — JS/TS reference implementation and spec
- **`universalWasmLoader-rs`** — this crate
- `universalWasmLoader-py` — Python port (Stage 2, in progress)

---

## License

MIT — see [LICENSE](LICENSE).
