//! Universal WASM Loader — Rust port of the UniversalWasmLoader Spec v4.0.0.
//!
//! Load a `.wasm` file (or URL) with automatic WIT-based ABI translation:
//!
//! ```no_run
//! use universal_wasm_loader::wasm_import;
//!
//! # async fn example() -> anyhow::Result<()> {
//! // From a relative file path (resolved against the current working directory):
//! let m = wasm_import("tests/math_50.wasm", None).await?;
//!
//! // From a URL:
//! let m = wasm_import("https://example.com/math.wasm", None).await?;
//!
//! let result: i32 = m.call("add", (3i32, 4i32))?;
//! assert_eq!(result, 7);
//! # Ok(())
//! # }
//! ```
//!
//! Failures are loud (SPEC 4.0.0): only an ABSENT `.wit` gives raw exports; a `.wit` that cannot
//! be read or does not parse, a WIT import with no host callback, a typed call with the wrong
//! arguments, and a host callback returning the wrong kind are all errors. Every http(s) fetch has
//! a time limit, 30 s by default ([`LoadOptions`]).

pub mod abi;
pub mod types;
mod wasi;
pub mod wit_parser;

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use anyhow::{anyhow, Result};
use once_cell::sync::OnceCell;
use tokio::sync::{Notify, Semaphore};
use wasmtime::{Engine, Linker, Module, Store};

pub use abi::{HostCallback, WasmVal};
pub use types::{IntoWasmVal, FromWasmVal, WasmArgs, FromWasmArgs, host_fn};
pub use wit_parser::ParsedWit;

/// The version of the cross-language UniversalWasmLoader `SPEC.md` this crate implements.
pub const SPEC_VERSION: &str = "4.0.0";

// ── Internal ABI kind (not part of public API) ────────────────────────────────

#[derive(Debug, Clone)]
enum AbiKind {
    Component,
    Wasic,
}

// ── Callbacks ─────────────────────────────────────────────────────────────────

/// Host callbacks for WASM imports.
///
/// Keys are the **camelCase** WIT import name (e.g. `"envMul"` for `env-mul`). Every WIT
/// `import` needs one: a load with a missing callback fails, naming each missing one.
/// Pass a typed closure to [`on`] — argument and return types are decoded automatically:
///
/// ```no_run
/// use universal_wasm_loader::{Callbacks, wasm_import};
///
/// # async fn example() -> anyhow::Result<()> {
/// let cbs = Callbacks::new()
///     .on("envMul", |(a, b): (f64, f64)| a * b)
///     .on("envAdd", |(a, b): (i32, i32)| a + b);
///
/// let m = wasm_import("tests/imports_50.wasm", Some(cbs)).await?;
/// # Ok(())
/// # }
/// ```
///
/// [`on`]: Callbacks::on
#[derive(Default, Clone)]
pub struct Callbacks {
    pub(crate) map: HashMap<String, HostCallback>,
}

impl Callbacks {
    pub fn new() -> Self { Self::default() }

    /// Register a host callback by its camelCase WIT import name.
    ///
    /// The closure receives decoded Rust values (as a destructured tuple) and returns
    /// a native value. Argument and return types are inferred from the closure signature.
    /// The return value's kind must be the import's WIT result (`f64` for `-> f64`, never an
    /// `i32`); a mismatch is an error when WASM calls the import.
    pub fn on<F, Args, R>(mut self, name: impl Into<String>, f: F) -> Self
    where
        Args: FromWasmArgs + 'static,
        R: IntoWasmVal + 'static,
        F: Fn(Args) -> R + Send + Sync + 'static,
    {
        self.map.insert(name.into(), Arc::new(move |raw: &[WasmVal]| {
            let args = Args::from_wasm_vals(raw)?;
            Ok(f(args).into_wasm_val())
        }));
        self
    }

    /// Register a pre-built [`HostCallback`] (e.g. one returned by [`host_fn`]).
    ///
    /// Use this when you need to store or share a callback value before registering it.
    /// For inline closures, prefer [`on`].
    ///
    /// [`on`]: Callbacks::on
    pub fn on_raw(mut self, name: impl Into<String>, cb: HostCallback) -> Self {
        self.map.insert(name.into(), cb); self
    }
}

// ── Load options: time limit and cancellation (SPEC §11) ──────────────────────

/// A cancellation token for a load (SPEC 4.0.0 §11.2). Clone it, hand one clone to
/// [`LoadOptions::cancel_token`], and call [`cancel`](CancelToken::cancel) on another to stop
/// the load: it fails with a "cancelled" error. A token already cancelled fails the load before
/// any fetch.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<CancelInner>);

#[derive(Default)]
struct CancelInner {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    pub fn new() -> Self { Self::default() }

    /// Cancel every load that holds this token (or a clone of it).
    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::SeqCst);
        self.0.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::SeqCst)
    }

    /// Resolves once the token is cancelled.
    async fn cancelled(&self) {
        loop {
            let notified = self.0.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

impl fmt::Debug for CancelToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CancelToken").field("cancelled", &self.is_cancelled()).finish()
    }
}

/// Options for [`wasm_import_with_options`] (SPEC 4.0.0 §1, §11).
///
/// Each http(s) fetch — the `.wit`, then the `.wasm` — must finish, from the request to the last
/// byte of the body, within the time limit: [`DEFAULT_TIMEOUT`](LoadOptions::DEFAULT_TIMEOUT)
/// (30 s) unless set. A zero limit is an error; [`no_timeout`](LoadOptions::no_timeout) removes
/// it. Local files are read without a limit.
///
/// ```no_run
/// use std::time::Duration;
/// use universal_wasm_loader::{wasm_import_with_options, CancelToken, LoadOptions};
///
/// # async fn example() -> anyhow::Result<()> {
/// let cancel = CancelToken::new();
/// let opts = LoadOptions::new().timeout(Duration::from_secs(5)).cancel_token(cancel.clone());
/// let m = wasm_import_with_options("https://example.com/math.wasm", None, opts).await?;
/// # Ok(())
/// # }
/// ```
#[derive(Clone, Debug)]
pub struct LoadOptions {
    timeout: Option<Duration>,
    cancel: Option<CancelToken>,
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self { timeout: Some(Self::DEFAULT_TIMEOUT), cancel: None }
    }
}

impl LoadOptions {
    /// The per-fetch time limit when none is set: 30 s.
    pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

    /// The defaults: a 30 s limit per fetch, no cancellation token.
    pub fn new() -> Self { Self::default() }

    /// The time limit for each http(s) fetch. Must be positive.
    pub fn timeout(mut self, limit: Duration) -> Self {
        self.timeout = Some(limit);
        self
    }

    /// No time limit on http(s) fetches.
    pub fn no_timeout(mut self) -> Self {
        self.timeout = None;
        self
    }

    /// Cancel the load through `token`.
    pub fn cancel_token(mut self, token: CancelToken) -> Self {
        self.cancel = Some(token);
        self
    }

    fn validate(&self) -> Result<()> {
        if self.timeout == Some(Duration::ZERO) {
            return Err(anyhow!("wasm_import: the time limit must be positive (use LoadOptions::no_timeout for none), got 0 ms"));
        }
        self.check_cancelled()
    }

    fn check_cancelled(&self) -> Result<()> {
        match &self.cancel {
            Some(t) if t.is_cancelled() => Err(cancelled()),
            _ => Ok(()),
        }
    }
}

fn cancelled() -> anyhow::Error {
    anyhow!("wasm_import: the load was cancelled")
}

// ── ModuleExports ─────────────────────────────────────────────────────────────

/// A loaded, ABI-translated WASM module.
///
/// Use [`call`] to invoke exported functions by their snake_case name.
///
/// [`call`]: ModuleExports::call
#[derive(Clone)]
pub struct ModuleExports {
    inner: Arc<Mutex<ExportsInner>>,
}

struct ExportsInner {
    store:    Store<()>,
    instance: wasmtime::Instance,
    parsed:   Option<ParsedWit>,
    abi:      AbiKind,
}

impl ModuleExports {
    /// Call a WIT export with native Rust argument and return types.
    ///
    /// With a `.wit`, the argument count and each argument's kind are checked against the WIT
    /// signature, never coerced (`i32` for `s32`, `i64` for `s64`, `f32` / `f64`, `bool`, a
    /// string); `R` must be the export's result kind (or `()` to discard it).
    ///
    /// ```no_run
    /// # use universal_wasm_loader::wasm_import;
    /// # async fn ex() -> anyhow::Result<()> {
    /// # let m = wasm_import("x.wasm", None).await?;
    /// let n: i32    = m.call("add",         (3i32, 4i32))?;
    /// let s: String = m.call("greet",       ("World",))?;
    /// let b: bool   = m.call("is_positive", (1.0f64,))?;
    /// # Ok(()) }
    /// ```
    pub fn call<Args: WasmArgs, R: FromWasmVal>(&self, name: &str, args: Args) -> Result<R> {
        let vals = args.into_wasm_vals();
        let raw = self.call_dyn(name, &vals)?;
        R::from_wasm_val(raw).map_err(|e| anyhow!("wasm_import: result of '{name}': {e}"))
    }

    /// Raw dynamic dispatch — accepts and returns [`WasmVal`] directly.
    pub fn call_dyn(&self, name: &str, args: &[WasmVal]) -> Result<WasmVal> {
        let mut g = self.inner.lock().unwrap();
        let ExportsInner { store, instance, parsed, abi } = &mut *g;

        match parsed {
            Some(p) => {
                let func = p.exports.iter()
                    .find(|f| f.snake_name == name)
                    .ok_or_else(|| anyhow!("no export '{name}' in WIT"))?
                    .clone();
                match abi {
                    AbiKind::Component => abi::call_component_export(store, instance, &func, args),
                    AbiKind::Wasic     => abi::call_wasic_export(store, instance, &func, args),
                }
            }
            None => abi::call_raw_export(store, instance, name, args),
        }
    }

    /// Bind a named export as a standalone callable — no `await` needed at call time.
    ///
    /// The returned closure owns a clone of this handle and captures the export name,
    /// so it can be stored and called repeatedly without re-loading the module.
    ///
    /// ```no_run
    /// # use universal_wasm_loader::wasm_load;
    /// let m = wasm_load("tests/math_50.wasm", None)?;
    /// let add = m.bind::<(i32, i32), i32>("add");
    /// assert_eq!(add((3, 4))?, 7);
    /// # anyhow::Ok(())
    /// ```
    pub fn bind<Args, R>(&self, name: &str) -> impl Fn(Args) -> Result<R>
    where
        Args: WasmArgs,
        R: FromWasmVal,
    {
        let me = self.clone();
        let name = name.to_string();
        move |args: Args| me.call(&name, args)
    }

    /// Check pointer equality — two values from the same [`create_singleton`] call
    /// share the same underlying instance.
    pub fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }
}

// ── Source loading ────────────────────────────────────────────────────────────

fn is_url(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

/// The `.wasm` suffix of `s`, compared without case (as -js's `/\.wasm$/i`).
fn wasm_suffix_start(s: &str) -> Option<usize> {
    let start = s.len().checked_sub(5)?;
    s.get(start..).filter(|t| t.eq_ignore_ascii_case(".wasm")).map(|_| start)
}

/// The companion `.wit` of a file path: the `.wasm` suffix replaced. `None` when the path does
/// not end in `.wasm` — there is no companion to look for, and the module loads as raw exports.
fn wit_path_for(path: &str) -> Option<PathBuf> {
    wasm_suffix_start(path).map(|i| PathBuf::from(format!("{}.wit", &path[..i])))
}

/// The companion `.wit` URL: the path's `.wasm` suffix replaced, query and fragment dropped
/// (SPEC §2). `None` when the URL path does not end in `.wasm`.
fn wit_url_for(url: &reqwest::Url) -> Option<reqwest::Url> {
    let i = wasm_suffix_start(url.path())?;
    let mut wit = url.clone();
    let path = format!("{}.wit", &url.path()[..i]);
    wit.set_path(&path);
    wit.set_query(None);
    wit.set_fragment(None);
    Some(wit)
}

/// Decode and parse a `.wit` that was read; any fault names the `.wit` (SPEC 4.0.0 §2).
fn parse_wit_source(bytes: Vec<u8>, label: &str) -> Result<ParsedWit> {
    let src = String::from_utf8(bytes)
        .map_err(|e| anyhow!("wasm_import: invalid .wit '{label}': not UTF-8 ({e})"))?;
    wit_parser::parse_wit(&src).map_err(|e| anyhow!("wasm_import: invalid .wit '{label}': {e:#}"))
}

/// Read the companion `.wit` of a file path. `None` ONLY when it is absent (no such file, or the
/// path does not end in `.wasm`); any other read failure is an error naming it.
fn read_wit_file(wasm_path: &str) -> Result<Option<ParsedWit>> {
    let Some(wit) = wit_path_for(wasm_path) else { return Ok(None) };
    match std::fs::read(&wit) {
        Ok(bytes) => parse_wit_source(bytes, &wit.display().to_string()).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(anyhow!("wasm_import: cannot read .wit '{}': {e}", wit.display())),
    }
}

/// Fetch `url` once, under ONE time limit (request to the last byte) and the cancellation token.
/// `Ok(None)` only when `absent_ok` and the server answers 404 / 410.
async fn fetch_once(
    client: &reqwest::Client,
    url: &reqwest::Url,
    opts: &LoadOptions,
    absent_ok: bool,
) -> Result<Option<Vec<u8>>> {
    let work = async {
        let res = client.get(url.clone()).send().await
            .map_err(|e| anyhow!("wasm_import: could not fetch {url}: {e}"))?;
        let status = res.status();
        if absent_ok && (status.as_u16() == 404 || status.as_u16() == 410) {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(anyhow!("wasm_import: HTTP {status} for {url}"));
        }
        let body = res.bytes().await
            .map_err(|e| anyhow!("wasm_import: could not read the body of {url}: {e}"))?;
        Ok(Some(body.to_vec()))
    };
    let limited = async {
        match opts.timeout {
            Some(limit) => tokio::time::timeout(limit, work).await.unwrap_or_else(|_| {
                Err(anyhow!("wasm_import: timed out after {} ms fetching {url}", limit.as_millis()))
            }),
            None => work.await,
        }
    };
    match &opts.cancel {
        Some(token) => tokio::select! {
            r = limited => r,
            _ = token.cancelled() => Err(cancelled()),
        },
        None => limited.await,
    }
}

// ── Core instantiation ────────────────────────────────────────────────────────

/// Split an `@N` version suffix (N = ASCII digits only, SPEC §3) off a path.
fn parse_version_suffix(s: &str) -> (&str, Option<i32>) {
    if let Some(at) = s.rfind('@') {
        let digits = &s[at + 1..];
        if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(n) = digits.parse::<i32>() {
                return (&s[..at], Some(n));
            }
        }
    }
    (s, None)
}

/// The checks that run BEFORE the `.wasm` is read: every WIT import has a callback, and none
/// returns a string (SPEC 4.0.0 §4).
fn check_before_wasm(parsed: &Option<ParsedWit>, callbacks: &Callbacks) -> Result<()> {
    match parsed {
        Some(p) => abi::check_imports(&p.imports, &callbacks.map),
        None => Ok(()),
    }
}

/// Compile and instantiate from pre-loaded bytes. CPU-intensive; run in spawn_blocking.
fn instantiate_from_bytes(
    wasm_bytes: Vec<u8>,
    parsed: Option<ParsedWit>,
    callbacks: &Callbacks,
    required_version: Option<i32>,
) -> Result<ModuleExports> {
    let engine = Engine::default();
    let module = Module::new(&engine, &wasm_bytes)?;
    let abi_kind = detect_abi(&module);

    let mut linker: Linker<()> = Linker::new(&engine);
    // Minimal WASI Preview 1 shim (SPEC §10.2) so I/O-using library modules
    // (e.g. a modc lib that calls console.log → fd_write) instantiate here. Safe
    // for pure-compute modules — the funcs are simply never linked.
    wasi::link_wasi_shim(&mut linker)?;
    if let Some(ref p) = parsed {
        if !p.imports.is_empty() {
            abi::link_import_env(&mut linker, &p.imports, &callbacks.map)?;
        }
    }

    let mut store = Store::new(&engine, ());
    let instance = linker.instantiate(&mut store, &module)?;

    // Call the reactor initializer once, before any other export (SPEC §10.1).
    // No-op for modules that don't export `_initialize`.
    if let Ok(init) = instance.get_typed_func::<(), ()>(&mut store, "_initialize") {
        init.call(&mut store, ())?;
    }

    if let Some(required) = required_version {
        let ver_global = instance.get_global(&mut store, "version")
            .ok_or_else(|| anyhow!("@{required} pinned but module has no 'version' global"))?;
        let actual = ver_global.get(&mut store).i32()
            .ok_or_else(|| anyhow!("@{required} pinned but the module's 'version' global is not an i32"))?;
        if actual != required {
            return Err(anyhow!("version mismatch: module is v{actual}, requested @{required}"));
        }
    }

    // A WIT export the module does not export fails the load (SPEC 4.0.0 §2).
    if let Some(ref p) = parsed {
        abi::check_exports(&mut store, &instance, &p.exports)?;
    }

    Ok(ModuleExports {
        inner: Arc::new(Mutex::new(ExportsInner { store, instance, parsed, abi: abi_kind })),
    })
}

/// Load from a file path, synchronously: the `.wit` first, then the callback checks, then the
/// `.wasm` (SPEC 4.0.0 §2, §4).
fn instantiate_sync(path: &Path, callbacks: &Callbacks) -> Result<ModuleExports> {
    let path_str = path.to_string_lossy();
    let (actual, required_version) = parse_version_suffix(&path_str);

    let parsed = read_wit_file(actual)?;
    check_before_wasm(&parsed, callbacks)?;

    let wasm_bytes = std::fs::read(actual)
        .map_err(|e| anyhow!("failed to read '{actual}': {e}"))?;

    instantiate_from_bytes(wasm_bytes, parsed, callbacks, required_version)
}

/// Load from an http(s) URL: the `.wit` (404 / 410 = absent), the callback checks, then the
/// `.wasm` — one request each, each under the time limit and the cancellation token.
async fn load_url(
    url: &str,
    callbacks: Callbacks,
    required_version: Option<i32>,
    opts: &LoadOptions,
) -> Result<ModuleExports> {
    let wasm_url = reqwest::Url::parse(url)
        .map_err(|e| anyhow!("wasm_import: invalid URL '{url}': {e}"))?;
    let client = reqwest::Client::new();

    let parsed = match wit_url_for(&wasm_url) {
        None => None,
        Some(wit_url) => match fetch_once(&client, &wit_url, opts, true).await? {
            None => None,
            Some(bytes) => Some(parse_wit_source(bytes, wit_url.as_str())?),
        },
    };
    check_before_wasm(&parsed, &callbacks)?;

    let wasm_bytes = fetch_once(&client, &wasm_url, opts, false).await?
        .ok_or_else(|| anyhow!("wasm_import: no body for {wasm_url}"))?;

    tokio::task::spawn_blocking(move || {
        instantiate_from_bytes(wasm_bytes, parsed, &callbacks, required_version)
    }).await?
}

fn detect_abi(module: &Module) -> AbiKind {
    for export in module.exports() {
        if export.name() == "cabi_realloc" {
            return AbiKind::Component;
        }
    }
    AbiKind::Wasic
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Load a `.wasm` module and return a [`ModuleExports`] handle, with the default
/// [`LoadOptions`] (a 30 s limit on each http(s) fetch).
///
/// `source` may be:
/// - A **relative file path** — resolved against the current working directory
///   (`cargo test` sets this to the package root, so `"tests/math_50.wasm"` just works)
/// - An **absolute file path**
/// - An **`http://` or `https://` URL** — the companion `.wit` and the WASM are both fetched
///
/// Version pinning: append `@N` to assert the module's `version` i32 global equals N.
///
/// The companion `.wit` file is auto-detected (`.wasm` → `.wit`, a URL's query and fragment
/// dropped) and read FIRST. Only when it is absent — no such file, HTTP 404 / 410, or a path not
/// ending in `.wasm` — are raw WASM exports returned. Any other failure (another HTTP status, a
/// network error, the time limit, an unreadable file, a `.wit` that does not parse) is an error,
/// before the `.wasm` is fetched.
pub async fn wasm_import(
    source: impl AsRef<Path>,
    callbacks: Option<Callbacks>,
) -> Result<ModuleExports> {
    wasm_import_with_options(source, callbacks, LoadOptions::default()).await
}

/// [`wasm_import`] with explicit [`LoadOptions`]: the per-fetch time limit and a
/// [`CancelToken`] (SPEC 4.0.0 §11).
pub async fn wasm_import_with_options(
    source: impl AsRef<Path>,
    callbacks: Option<Callbacks>,
    options: LoadOptions,
) -> Result<ModuleExports> {
    options.validate()?;
    let raw = source.as_ref().to_string_lossy().into_owned();
    let cbs = callbacks.unwrap_or_default();

    let (actual, required_version) = {
        let (s, v) = parse_version_suffix(&raw);
        (s.to_string(), v)
    };

    if is_url(&actual) {
        load_url(&actual, cbs, required_version, &options).await
    } else {
        let path = PathBuf::from(raw);
        tokio::task::spawn_blocking(move || instantiate_sync(&path, &cbs)).await?
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/// Returns a closure that loads the WASM instance on the first call and caches
/// the result. All subsequent calls return a clone of the same `Arc`-backed value.
pub fn create_singleton(
    wasm_path: impl AsRef<Path> + Send + Sync + 'static,
    callbacks: Option<Callbacks>,
) -> impl Fn() -> Result<ModuleExports> {
    let path = wasm_path.as_ref().to_path_buf();
    let cbs = callbacks.unwrap_or_default();
    let cell: Arc<OnceCell<Arc<Mutex<ExportsInner>>>> = Arc::new(OnceCell::new());

    move || {
        let inner = cell.get_or_try_init(|| -> Result<Arc<Mutex<ExportsInner>>> {
            let exports = instantiate_sync(&path, &cbs)?;
            Ok(exports.inner)
        })?;
        Ok(ModuleExports { inner: inner.clone() })
    }
}

// ── InstancePool ──────────────────────────────────────────────────────────────

/// A pool of pre-instantiated WASM modules.
///
/// Each instance has its own independent linear memory. Use [`run`] for an
/// atomic acquire → call → release pattern.
///
/// [`run`]: InstancePool::run
pub struct InstancePool {
    available: Arc<Mutex<Vec<ModuleExports>>>,
    semaphore: Arc<Semaphore>,
    size: usize,
}

impl InstancePool {
    /// Pre-instantiate `size` independent WASM instances.
    pub async fn new(
        wasm_path: impl AsRef<Path>,
        callbacks: Option<Callbacks>,
        size: usize,
    ) -> Result<Self> {
        let path = wasm_path.as_ref().to_path_buf();
        let cbs = callbacks.unwrap_or_default();

        let mut instances = Vec::with_capacity(size);
        for _ in 0..size {
            let p2 = path.clone();
            let o2 = cbs.clone();
            let inst = tokio::task::spawn_blocking(move || instantiate_sync(&p2, &o2)).await??;
            instances.push(inst);
        }

        Ok(Self {
            available: Arc::new(Mutex::new(instances)),
            semaphore: Arc::new(Semaphore::new(size)),
            size,
        })
    }

    /// Total pool capacity.
    pub fn size(&self) -> usize { self.size }

    /// Number of currently idle instances.
    pub fn available(&self) -> usize {
        self.available.lock().unwrap().len()
    }

    /// Check out an instance. Waits if all are in use.
    pub async fn acquire(&self) -> Result<ModuleExports> {
        let _permit = self.semaphore.acquire().await
            .map_err(|_| anyhow!("pool semaphore closed"))?;
        std::mem::forget(_permit);
        let inst = self.available.lock().unwrap().pop()
            .ok_or_else(|| anyhow!("pool empty after semaphore acquire"))?;
        Ok(inst)
    }

    /// Return an instance to the pool.
    pub fn release(&self, inst: ModuleExports) {
        self.available.lock().unwrap().push(inst);
        self.semaphore.add_permits(1);
    }

    /// Acquire an instance, call `f`, release — even if `f` returns `Err`.
    pub async fn run<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&ModuleExports) -> Result<R>,
    {
        let inst = self.acquire().await?;
        let result = f(&inst);
        self.release(inst);
        result
    }
}

// ── wasm_load — sync entry point ──────────────────────────────────────────────

/// Load a `.wasm` module synchronously — no `await` needed.
///
/// Reads from a **file path** only (URLs require the async [`wasm_import`]).
/// Version pinning (`@N`) is supported the same way, and so are the SPEC 4.0.0 load checks.
///
/// Use this when you want to call `wasm_load` from a non-async context, or
/// together with [`bind`] / [`wasm_interface!`] for a fully synchronous API.
///
/// ```no_run
/// use universal_wasm_loader::wasm_load;
///
/// let m = wasm_load("tests/math_50.wasm", None)?;
/// let r: i32 = m.call("add", (3i32, 4i32))?;
/// assert_eq!(r, 7);
/// # anyhow::Ok(())
/// ```
///
/// [`bind`]: ModuleExports::bind
pub fn wasm_load(source: impl AsRef<Path>, callbacks: Option<Callbacks>) -> Result<ModuleExports> {
    instantiate_sync(source.as_ref(), &callbacks.unwrap_or_default())
}

// ── wasm_interface! macro ─────────────────────────────────────────────────────

/// Generate a typed handle struct for a WASM module.
///
/// Declares a struct whose methods map 1-to-1 to WASM exports. The generated
/// `load` associated function is **synchronous** — no `await` required.
///
/// # Example
///
/// ```no_run
/// use universal_wasm_loader::wasm_interface;
///
/// wasm_interface! {
///     pub struct Math {
///         fn add(a: i32, b: i32) -> i32;
///         fn square(x: i32) -> i32;
///     }
/// }
///
/// let math = Math::load("tests/math_50.wasm", None)?;
/// assert_eq!(math.add(3, 4)?, 7);
/// assert_eq!(math.square(5)?, 25);
/// # anyhow::Ok(())
/// ```
#[macro_export]
macro_rules! wasm_interface {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident {
            $(fn $fn_name:ident($($param:ident: $param_ty:ty),*) -> $ret_ty:ty;)*
        }
    ) => {
        $(#[$meta])*
        $vis struct $name($crate::ModuleExports);

        impl $name {
            /// Load the WASM module synchronously and return a typed handle.
            pub fn load(
                source: impl ::std::convert::AsRef<::std::path::Path>,
                callbacks: ::std::option::Option<$crate::Callbacks>,
            ) -> ::anyhow::Result<Self> {
                $crate::wasm_load(source, callbacks).map(Self)
            }

            $(
                pub fn $fn_name(&self, $($param: $param_ty),*) -> ::anyhow::Result<$ret_ty> {
                    self.0.call(stringify!($fn_name), ($($param,)*))
                }
            )*
        }
    };
}
