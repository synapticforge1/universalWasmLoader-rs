//! SPEC 4.0.0 §8 "Refusals" — every row is a test, plus the edges §2 / §4 / §11 name.
//!
//! Rust stand-ins for the JS values: `undefined` / `null` → `WasmVal::Void`; `2 ** 31` and `17n`
//! → `WasmVal::I64`; an `async` callback cannot be written (a [`HostCallback`] returns
//! `Result<WasmVal>`, and no future implements `IntoWasmVal`), so that row is enforced by the
//! type system. The http rows run against a local server that counts requests per path.
//! Scratch `.wit` files go in a temporary directory, never in `tests/` (the fixture stamp).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use universal_wasm_loader::{
    wasm_import, wasm_import_with_options, wasm_load, Callbacks, CancelToken, HostCallback,
    LoadOptions, WasmVal,
};

/// The whole error chain, as the caller sees it with `{:#}`.
fn chain<T>(r: anyhow::Result<T>) -> String {
    match r {
        Ok(_) => panic!("expected an error, got Ok"),
        Err(e) => format!("{e:#}"),
    }
}

fn assert_names(msg: &str, parts: &[&str]) {
    for p in parts {
        assert!(msg.contains(p), "error does not name {p:?}:\n{msg}");
    }
}

// ── scratch directories ───────────────────────────────────────────────────────

static DIRS: AtomicUsize = AtomicUsize::new(0);

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let n = DIRS.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("uwl-rs-refusals-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }
    fn fixture(&self, name: &str, as_name: &str) -> &Self {
        std::fs::copy(Path::new("tests").join(name), self.0.join(as_name)).unwrap();
        self
    }
    fn write(&self, name: &str, text: &str) -> &Self {
        std::fs::write(self.0.join(name), text).unwrap();
        self
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ── §4 host callbacks ─────────────────────────────────────────────────────────

fn cb(v: WasmVal) -> HostCallback {
    Arc::new(move |_: &[WasmVal]| Ok(v.clone()))
}

#[test]
fn imports_without_callbacks_name_both() {
    let msg = chain(wasm_load("tests/imports_50.wasm", None));
    assert_names(&msg, &["no host callback", "envMul (WIT \"env-mul\")", "envAdd (WIT \"env-add\")"]);
}

#[test]
fn imports_with_only_env_mul_name_env_add() {
    let cbs = Callbacks::new().on("envMul", |(a, b): (f64, f64)| a * b);
    let msg = chain(wasm_load("tests/imports_50.wasm", Some(cbs)));
    assert_names(&msg, &["envAdd (WIT \"env-add\")"]);
    assert!(!msg.contains("envMul"), "envMul has a callback:\n{msg}");
}

#[test]
fn missing_callbacks_are_refused_before_the_wasm_is_read() {
    // Only the .wit exists: the error must be about the callbacks, not the missing .wasm.
    let d = Scratch::new();
    d.fixture("imports_50.wit", "imports_50.wit");
    let msg = chain(wasm_load(d.path("imports_50.wasm"), None));
    assert_names(&msg, &["no host callback", "envMul", "envAdd"]);
}

#[test]
fn callback_return_values_are_checked_never_coerced() {
    let wrong = [
        WasmVal::Void,                    // undefined / null
        WasmVal::F64(2.9),                // 2.9
        WasmVal::I64(1 << 31),            // 2 ** 31, 17n
        WasmVal::Bool(true),              // true
        WasmVal::Str("17".into()),        // "17"
    ];
    for v in wrong {
        let shown = format!("{v:?}");
        let cbs = Callbacks::new()
            .on("envMul", |(a, b): (f64, f64)| a * b)
            .on_raw("envAdd", cb(v));
        let m = wasm_load("tests/imports_50.wasm", Some(cbs)).unwrap();
        let msg = chain(m.call::<_, i32>("combine", (10i32, 7i32)));
        assert_names(&msg, &["host callback envAdd", "WIT import \"env-add\" -> s32", &shown, "expected an i32"]);
    }
}

#[test]
fn callback_result_kind_must_match_exactly() {
    // An f32 for an f64 result is a different kind: refused, not widened.
    let cbs = Callbacks::new()
        .on("envMul", |(a, b): (f64, f64)| (a * b) as f32)
        .on("envAdd", |(a, b): (i32, i32)| a + b);
    let m = wasm_load("tests/imports_50.wasm", Some(cbs)).unwrap();
    let msg = chain(m.call::<_, f64>("scale", (3.0f64, 4.0f64)));
    assert_names(&msg, &["host callback envMul", "-> f64", "F32(12.0)"]);
}

#[test]
fn a_callback_error_reaches_the_caller() {
    let failing: HostCallback = Arc::new(|_: &[WasmVal]| Err(anyhow::anyhow!("the host said no")));
    let cbs = Callbacks::new()
        .on("envMul", |(a, b): (f64, f64)| a * b)
        .on_raw("envAdd", failing);
    let m = wasm_load("tests/imports_50.wasm", Some(cbs)).unwrap();
    assert_names(&chain(m.call::<_, i32>("combine", (10i32, 7i32))), &["the host said no"]);
}

#[test]
fn a_string_result_import_is_refused_at_load() {
    let wit = "package local:imports-50;\nworld imports-50 {\n  import env-mul: func(p0: f64, p1: f64) -> string;\n  import env-add: func(p0: s32, p1: s32) -> s32;\n  export scale: func(x: f64, factor: f64) -> f64;\n  export combine: func(a: s32, b: s32) -> s32;\n}\n";
    let cbs = || {
        Callbacks::new()
            .on("envMul", |(a, b): (f64, f64)| a * b)
            .on("envAdd", |(a, b): (i32, i32)| a + b)
    };
    let d = Scratch::new();
    d.fixture("imports_50.wasm", "imports_50.wasm").write("imports_50.wit", wit);
    let msg = chain(wasm_load(d.path("imports_50.wasm"), Some(cbs())));
    assert_names(&msg, &["returning a string is not supported", "envMul (WIT \"env-mul\")"]);

    // Before the .wasm is read: the same refusal with no .wasm present.
    let e = Scratch::new();
    e.write("imports_50.wit", wit);
    assert_names(&chain(wasm_load(e.path("imports_50.wasm"), Some(cbs()))), &["returning a string is not supported"]);
}

// ── §4 typed-call arguments ───────────────────────────────────────────────────

#[test]
fn typed_call_arguments_on_math_50() {
    let m = wasm_load("tests/math_50.wasm", None).unwrap();
    assert_names(&chain(m.call::<_, i32>("add", ("x", 1i32))), &["add(a: s32, b: s32)", "parameter a (s32)", "Str(\"x\")"]);
    assert_names(&chain(m.call::<_, i32>("add", (2.7f64, 1i32))), &["add(a: s32, b: s32)", "parameter a (s32)", "F64(2.7)"]);
    assert_names(&chain(m.call::<_, i32>("add", (1i32, 1i64 << 31))), &["add(a: s32, b: s32)", "parameter b (s32)", "I64(2147483648)"]);
    assert_names(&chain(m.call::<_, i32>("add", (1i32,))), &["add(a: s32, b: s32)", "expects 2 arguments, got 1"]);
    assert_names(&chain(m.call::<_, i32>("add", (1i32, 2i32, 3i32))), &["expects 2 arguments, got 3"]);
    // multiply takes f64: an f32 or an integer is refused, not converted.
    assert_names(&chain(m.call::<_, f64>("multiply", (2.5f32, 4.0f32))), &["parameter a (f64)", "expects an f64"]);
}

#[test]
fn typed_call_arguments_on_strings_and_booleans() {
    let s = wasm_load("tests/strings_50.wasm", None).unwrap();
    assert_names(&chain(s.call::<_, String>("greet", (42i32,))), &["greet(name: string)", "parameter name (string)", "I32(42)"]);
    let b = wasm_load("tests/booleans_50.wasm", None).unwrap();
    assert_names(&chain(b.call::<_, bool>("is_even", ("4",))), &["is_even(n: s32)", "parameter n (s32)"]);
    // A bool parameter takes a bool, never an integer (there is none in the fixtures' params, so
    // the reverse: an integer where a float is expected).
    assert_names(&chain(b.call::<_, bool>("is_positive", (1i32,))), &["is_positive(x: f64)", "parameter x (f64)"]);
}

#[test]
fn a_result_of_the_wrong_kind_is_refused() {
    let m = wasm_load("tests/math_50.wasm", None).unwrap();
    assert_names(&chain(m.call::<_, i32>("multiply", (2.5f64, 4.0f64))), &["result of 'multiply'", "expected i32", "F64(10.0)"]);
    assert_names(&chain(m.call::<_, bool>("add", (3i32, 4i32))), &["result of 'add'", "expected bool"]);
}

// ── §2 the .wit: absent versus failed, strict parsing ─────────────────────────

fn math_beside(wit: &str) -> (Scratch, String) {
    let d = Scratch::new();
    d.fixture("math_50.wasm", "math_50.wasm").write("math_50.wit", wit);
    let msg = chain(wasm_load(d.path("math_50.wasm"), None));
    (d, msg)
}

#[test]
fn a_wit_that_does_not_parse_fails_the_load() {
    let cases = [
        ("world math-50 {\n  export add: func(a: s32 b: s32) -> s32;\n}\n", "malformed parameter \"a: s32 b: s32\" in export add"),
        ("world math-50 {\n  export add: func(a: u32, b: s32) -> s32;\n}\n", "unsupported WIT type \"u32\" in export add, parameter a"),
        ("world math-50 {\n  export add: func(a: s32, b: s32) -> s99;\n}\n", "unsupported WIT type \"s99\""),
        ("", "it is empty"),
        ("this is not wit", "not a WIT world"),
        ("world math-50 {\n  export add: func(a: s32, b: s32) -> s32\n}\n", "missing \";\""),
        ("world math-50 {\n  export add: func(a: s32, b: s32) -> s32;\n  export add: func(a: s32, b: s32) -> s32;\n}\n", "duplicate export add"),
    ];
    for (wit, fault) in cases {
        let (d, msg) = math_beside(wit);
        let label = d.path("math_50.wit").display().to_string();
        assert_names(&msg, &["invalid .wit", &label, fault]);
    }
}

#[test]
fn a_wit_export_the_module_lacks_fails_the_load() {
    let (_d, msg) = math_beside(
        "world math-50 {\n  export add: func(a: s32, b: s32) -> s32;\n  export divide: func(a: s32, b: s32) -> s32;\n}\n",
    );
    assert_names(&msg, &["does not export", "divide (WIT \"divide\")"]);
    assert!(!msg.contains("add ("), "add exists:\n{msg}");
}

#[test]
fn an_unreadable_wit_fails_the_load() {
    // A directory where the .wit should be: present but unreadable — not "absent".
    let d = Scratch::new();
    d.fixture("math_50.wasm", "math_50.wasm");
    std::fs::create_dir(d.path("math_50.wit")).unwrap();
    assert_names(&chain(wasm_load(d.path("math_50.wasm"), None)), &["cannot read .wit", "math_50.wit"]);
}

#[test]
fn a_wit_that_is_not_utf8_fails_the_load() {
    let d = Scratch::new();
    d.fixture("math_50.wasm", "math_50.wasm");
    std::fs::write(d.path("math_50.wit"), [0x77u8, 0x6f, 0xff, 0xfe]).unwrap();
    assert_names(&chain(wasm_load(d.path("math_50.wasm"), None)), &["invalid .wit", "not UTF-8"]);
}

#[test]
fn an_absent_wit_gives_raw_exports() {
    let d = Scratch::new();
    d.fixture("math_50.wasm", "math_50.wasm");
    let m = wasm_load(d.path("math_50.wasm"), None).unwrap();
    assert_eq!(m.call::<_, i32>("add", (3i32, 4i32)).unwrap(), 7);
}

#[test]
fn a_path_not_ending_in_wasm_has_no_companion_wit() {
    // 0.2.0 replaced the extension and read `math.wit` here — garbage, read loosely, gave a typed
    // module with no exports. Now `math.bin` has no companion: raw exports.
    let d = Scratch::new();
    d.fixture("math_50.wasm", "math.bin").write("math.wit", "garbage");
    let m = wasm_load(d.path("math.bin"), None).unwrap();
    assert_eq!(m.call::<_, i32>("add", (3i32, 4i32)).unwrap(), 7);
}

#[tokio::test]
async fn the_async_file_path_follows_the_same_rules() {
    let msg = chain(wasm_import("tests/imports_50.wasm", None).await);
    assert_names(&msg, &["no host callback", "envMul", "envAdd"]);
}

// ── §11 options ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_zero_time_limit_is_an_error() {
    let opts = LoadOptions::new().timeout(Duration::ZERO);
    assert_names(&chain(wasm_import_with_options("tests/math_50.wasm", None, opts).await), &["time limit must be positive"]);
}

// ── http: a local server that counts requests ─────────────────────────────────

#[derive(Clone)]
enum Reply {
    Status(u16, Vec<u8>),
    Stall,
}

struct Server {
    base: String,
    hits: Arc<Mutex<HashMap<String, usize>>>,
}

impl Server {
    /// Routes are exact request targets (path + query); anything else is 404.
    async fn start(routes: &[(&str, Reply)]) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let routes: Arc<HashMap<String, Reply>> =
            Arc::new(routes.iter().map(|(p, r)| (p.to_string(), r.clone())).collect());
        let hits: Arc<Mutex<HashMap<String, usize>>> = Arc::default();
        let h = hits.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let routes = routes.clone();
                let hits = h.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 1024];
                    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        match sock.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => buf.extend_from_slice(&chunk[..n]),
                        }
                    }
                    let head = String::from_utf8_lossy(&buf).to_string();
                    let target = head.split_whitespace().nth(1).unwrap_or("").to_string();
                    *hits.lock().unwrap().entry(target.clone()).or_insert(0) += 1;
                    let reply = routes.get(&target).cloned().unwrap_or(Reply::Status(404, b"not found".to_vec()));
                    match reply {
                        Reply::Stall => {
                            // Hold the connection open and never answer.
                            std::future::pending::<()>().await;
                        }
                        Reply::Status(code, body) => {
                            let head = format!(
                                "HTTP/1.1 {code} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                body.len()
                            );
                            let _ = sock.write_all(head.as_bytes()).await;
                            let _ = sock.write_all(&body).await;
                            let _ = sock.shutdown().await;
                        }
                    }
                });
            }
        });
        Server { base, hits }
    }

    fn url(&self, target: &str) -> String {
        format!("{}{target}", self.base)
    }

    fn hits(&self, target: &str) -> usize {
        self.hits.lock().unwrap().get(target).copied().unwrap_or(0)
    }

    fn total(&self) -> usize {
        self.hits.lock().unwrap().values().sum()
    }
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(Path::new("tests").join(name)).unwrap()
}

fn ok(name: &str) -> Reply {
    Reply::Status(200, fixture(name))
}

#[tokio::test]
async fn http_typed_load_one_request_per_file() {
    let s = Server::start(&[("/m/math_50.wasm", ok("math_50.wasm")), ("/m/math_50.wit", ok("math_50.wit"))]).await;
    let m = wasm_import(s.url("/m/math_50.wasm"), None).await.unwrap();
    assert_eq!(m.call::<_, i32>("add", (3i32, 4i32)).unwrap(), 7);
    // Typed: the argument check proves the .wit was applied.
    assert!(m.call::<_, i32>("add", (3i32,)).is_err());
    assert_eq!((s.hits("/m/math_50.wit"), s.hits("/m/math_50.wasm")), (1, 1));
}

#[tokio::test]
async fn http_wit_404_and_410_give_raw_exports() {
    for code in [404u16, 410] {
        let s = Server::start(&[("/m/math_50.wasm", ok("math_50.wasm")), ("/m/math_50.wit", Reply::Status(code, vec![]))]).await;
        let m = wasm_import(s.url("/m/math_50.wasm"), None).await.unwrap();
        assert_eq!(m.call::<_, i32>("add", (3i32, 4i32)).unwrap(), 7);
        // Raw: no WIT argument check, so a missing argument is the engine's error, not ours.
        let raw = chain(m.call::<_, i32>("add", (3i32,)));
        assert!(!raw.contains("expects 2 arguments"), "{code}: typed, not raw:\n{raw}");
        assert_eq!((s.hits("/m/math_50.wit"), s.hits("/m/math_50.wasm")), (1, 1), "{code}");
    }
}

#[tokio::test]
async fn http_wit_500_fails_before_the_wasm_is_fetched() {
    let s = Server::start(&[("/m/math_50.wasm", ok("math_50.wasm")), ("/m/math_50.wit", Reply::Status(500, vec![]))]).await;
    let msg = chain(wasm_import(s.url("/m/math_50.wasm"), None).await);
    assert_names(&msg, &["HTTP 500", &s.url("/m/math_50.wit")]);
    assert_eq!((s.hits("/m/math_50.wit"), s.hits("/m/math_50.wasm")), (1, 0));
}

#[tokio::test]
async fn http_wasm_404_and_500_name_the_url_and_status() {
    for code in [404u16, 500] {
        let s = Server::start(&[("/m/math_50.wasm", Reply::Status(code, vec![])), ("/m/math_50.wit", ok("math_50.wit"))]).await;
        let msg = chain(wasm_import(s.url("/m/math_50.wasm"), None).await);
        assert_names(&msg, &[&format!("HTTP {code}"), &s.url("/m/math_50.wasm")]);
        assert_eq!((s.hits("/m/math_50.wit"), s.hits("/m/math_50.wasm")), (1, 1), "{code}");
    }
}

#[tokio::test]
async fn http_a_server_that_never_answers_hits_the_time_limit() {
    // The .wit stalls: the load fails naming its URL and the limit; the .wasm is never requested.
    let s = Server::start(&[("/m/math_50.wasm", ok("math_50.wasm")), ("/m/math_50.wit", Reply::Stall)]).await;
    let opts = LoadOptions::new().timeout(Duration::from_millis(300));
    let t = Instant::now();
    let msg = chain(wasm_import_with_options(s.url("/m/math_50.wasm"), None, opts.clone()).await);
    assert!(t.elapsed() < Duration::from_secs(10), "took {:?}", t.elapsed());
    assert_names(&msg, &["timed out after 300 ms", &s.url("/m/math_50.wit")]);
    assert_eq!(s.hits("/m/math_50.wasm"), 0);

    // The .wasm stalls (the .wit is absent).
    let s = Server::start(&[("/m/math_50.wasm", Reply::Stall)]).await;
    let msg = chain(wasm_import_with_options(s.url("/m/math_50.wasm"), None, opts).await);
    assert_names(&msg, &["timed out after 300 ms", &s.url("/m/math_50.wasm")]);
    assert_eq!((s.hits("/m/math_50.wit"), s.hits("/m/math_50.wasm")), (1, 1));
}

#[tokio::test]
async fn http_the_wit_url_drops_query_and_fragment() {
    let s = Server::start(&[("/m/math_50.wasm?v=1", ok("math_50.wasm")), ("/m/math_50.wit", ok("math_50.wit"))]).await;
    let m = wasm_import(s.url("/m/math_50.wasm?v=1#frag"), None).await.unwrap();
    assert_eq!(m.call::<_, i32>("add", (3i32, 4i32)).unwrap(), 7);
    assert_eq!((s.hits("/m/math_50.wit"), s.hits("/m/math_50.wasm?v=1")), (1, 1));
    assert_eq!(s.total(), 2);
}

#[tokio::test]
async fn http_an_already_cancelled_token_fetches_nothing() {
    let s = Server::start(&[("/m/math_50.wasm", ok("math_50.wasm"))]).await;
    let token = CancelToken::new();
    token.cancel();
    let opts = LoadOptions::new().cancel_token(token);
    assert_names(&chain(wasm_import_with_options(s.url("/m/math_50.wasm"), None, opts).await), &["cancelled"]);
    assert_eq!(s.total(), 0);
}

#[tokio::test]
async fn http_cancelling_stops_a_stalled_load() {
    let s = Server::start(&[("/m/math_50.wasm", ok("math_50.wasm")), ("/m/math_50.wit", Reply::Stall)]).await;
    let token = CancelToken::new();
    let t2 = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        t2.cancel();
    });
    let opts = LoadOptions::new().no_timeout().cancel_token(token);
    let t = Instant::now();
    let msg = chain(wasm_import_with_options(s.url("/m/math_50.wasm"), None, opts).await);
    assert!(t.elapsed() < Duration::from_secs(10), "took {:?}", t.elapsed());
    assert_names(&msg, &["cancelled"]);
    assert_eq!(s.hits("/m/math_50.wasm"), 0);
}

#[tokio::test]
async fn http_missing_callbacks_are_refused_before_the_wasm_is_fetched() {
    let s = Server::start(&[("/i/imports_50.wasm", ok("imports_50.wasm")), ("/i/imports_50.wit", ok("imports_50.wit"))]).await;
    assert_names(&chain(wasm_import(s.url("/i/imports_50.wasm"), None).await), &["envMul", "envAdd"]);
    assert_eq!((s.hits("/i/imports_50.wit"), s.hits("/i/imports_50.wasm")), (1, 0));
}

#[tokio::test]
async fn http_a_malformed_wit_names_its_url() {
    let s = Server::start(&[
        ("/m/math_50.wasm", ok("math_50.wasm")),
        ("/m/math_50.wit", Reply::Status(200, b"world m { export add: func(a: u32); }".to_vec())),
    ]).await;
    let msg = chain(wasm_import(s.url("/m/math_50.wasm"), None).await);
    assert_names(&msg, &["invalid .wit", &s.url("/m/math_50.wit"), "\"u32\""]);
    assert_eq!(s.hits("/m/math_50.wasm"), 0);
}
