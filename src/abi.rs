use std::collections::HashMap;
use std::sync::Arc;
use wasmtime::{Caller, Extern, FuncType, Linker, Store, ValType};
use anyhow::{anyhow, Result};
use crate::wit_parser::{WitFunc, WitType};

// ── Public value type ─────────────────────────────────────────────────────────

/// A dynamically-typed WASM value with ABI translation applied.
#[derive(Debug, Clone, PartialEq)]
pub enum WasmVal {
    I32(i32),
    I64(i64),
    F32(f32),
    F64(f64),
    Bool(bool),
    Str(String),
    Void,
}

impl WasmVal {
    pub fn as_i32(&self) -> Option<i32>  { if let Self::I32(v)  = self { Some(*v) } else { None } }
    pub fn as_i64(&self) -> Option<i64>  { if let Self::I64(v)  = self { Some(*v) } else { None } }
    pub fn as_f32(&self) -> Option<f32>  { if let Self::F32(v)  = self { Some(*v) } else { None } }
    pub fn as_f64(&self) -> Option<f64>  { if let Self::F64(v)  = self { Some(*v) } else { None } }
    pub fn as_bool(&self) -> Option<bool> { if let Self::Bool(v) = self { Some(*v) } else { None } }
    pub fn as_str(&self)  -> Option<&str> { if let Self::Str(v)  = self { Some(v)  } else { None } }
}

/// A host callback — receives and returns decoded `WasmVal`s.
pub type HostCallback = Arc<dyn Fn(&[WasmVal]) -> Result<WasmVal> + Send + Sync>;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn read_str(data: &[u8], ptr: u32, len: u32) -> Result<String> {
    let s = ptr as usize;
    let e = s + len as usize;
    if e > data.len() {
        return Err(anyhow!("string read OOB ptr={ptr} len={len}"));
    }
    Ok(String::from_utf8(data[s..e].to_vec())?)
}

/// Copy `bytes` into linear memory at `ptr` — an allocator returning an out-of-bounds pointer
/// is an error, not a panic.
fn write_bytes(data: &mut [u8], ptr: i32, bytes: &[u8]) -> Result<()> {
    let s = ptr as u32 as usize;
    let dst = data
        .get_mut(s..s + bytes.len())
        .ok_or_else(|| anyhow!("string write OOB ptr={ptr} len={}", bytes.len()))?;
    dst.copy_from_slice(bytes);
    Ok(())
}

/// Encode a checked, non-string argument (the kind already matches the WIT type).
fn encode_scalar(v: &WasmVal) -> wasmtime::Val {
    match v {
        WasmVal::I32(x)  => wasmtime::Val::I32(*x),
        WasmVal::I64(x)  => wasmtime::Val::I64(*x),
        WasmVal::F32(x)  => wasmtime::Val::F32(x.to_bits()),
        WasmVal::F64(x)  => wasmtime::Val::F64(x.to_bits()),
        WasmVal::Bool(b) => wasmtime::Val::I32(i32::from(*b)),
        WasmVal::Str(_) | WasmVal::Void => unreachable!("check_args admits only WIT kinds; strings are encoded by the caller"),
    }
}

fn wit_to_wasm_params(params: &[crate::wit_parser::WitParam]) -> Vec<ValType> {
    params.iter().flat_map(|p| match &p.ty {
        WitType::Str  => vec![ValType::I32, ValType::I32],
        WitType::S64  => vec![ValType::I64],
        WitType::F32  => vec![ValType::F32],
        WitType::F64  => vec![ValType::F64],
        _             => vec![ValType::I32],
    }).collect()
}

fn wit_to_wasm_results(result: &Option<WitType>) -> Vec<ValType> {
    match result {
        None                  => vec![],
        Some(WitType::S64)    => vec![ValType::I64],
        Some(WitType::F32)    => vec![ValType::F32],
        Some(WitType::F64)    => vec![ValType::F64],
        // SPEC 3.0.0: a string return is a single i32 pointer to a
        // callee-allocated [ptr, len] pair (callee-allocated convention).
        Some(WitType::Str)    => vec![ValType::I32],
        _                     => vec![ValType::I32],
    }
}

// ── Argument and result checks (SPEC 4.0.0 §4) ────────────────────────────────

/// What a value of WIT type `ty` must be, for an error message.
fn expected_kind(ty: &WitType) -> &'static str {
    match ty {
        WitType::S32  => "an i32",
        WitType::S64  => "an i64",
        WitType::F32  => "an f32",
        WitType::F64  => "an f64",
        WitType::Bool => "a bool",
        WitType::Str  => "a string",
    }
}

/// Whether `v` is in the domain of WIT type `ty` — exact kind, never coerced.
fn fits(ty: &WitType, v: &WasmVal) -> bool {
    matches!(
        (ty, v),
        (WitType::S32, WasmVal::I32(_))
            | (WitType::S64, WasmVal::I64(_))
            | (WitType::F32, WasmVal::F32(_))
            | (WitType::F64, WasmVal::F64(_))
            | (WitType::Bool, WasmVal::Bool(_))
            | (WitType::Str, WasmVal::Str(_))
    )
}

/// `add(a: s32, b: s32)`, the Rust API name with the WIT parameter types.
fn signature(func: &WitFunc) -> String {
    let params: Vec<String> = func.params.iter().map(|p| format!("{}: {}", p.name, p.ty)).collect();
    format!("{}({})", func.snake_name, params.join(", "))
}

/// A typed call checks its argument count and each argument's kind against the WIT signature
/// before calling WASM, and coerces nothing (SPEC 4.0.0 §4 "Typed-call arguments").
pub(crate) fn check_args(func: &WitFunc, args: &[WasmVal]) -> Result<()> {
    if args.len() != func.params.len() {
        let n = func.params.len();
        return Err(anyhow!(
            "wasm_import: {} expects {n} argument{}, got {}",
            signature(func), if n == 1 { "" } else { "s" }, args.len()
        ));
    }
    for (p, v) in func.params.iter().zip(args) {
        if !fits(&p.ty, v) {
            return Err(anyhow!(
                "wasm_import: {}: parameter {} ({}) expects {}, got {v:?}",
                signature(func), p.name, p.ty, expected_kind(&p.ty)
            ));
        }
    }
    Ok(())
}

/// `envMul (WIT "env-mul"), envAdd (WIT "env-add")`.
fn name_list(funcs: &[&WitFunc]) -> String {
    let names: Vec<String> = funcs.iter().map(|f| format!("{} (WIT \"{}\")", f.camel_name, f.name)).collect();
    names.join(", ")
}

/// Every WIT import needs a host callback, and none may return a `string` (SPEC 4.0.0 §4).
/// Runs before the `.wasm` is read; names every missing callback.
pub(crate) fn check_imports(
    import_funcs: &[WitFunc],
    user_callbacks: &HashMap<String, HostCallback>,
) -> Result<()> {
    let missing: Vec<&WitFunc> =
        import_funcs.iter().filter(|f| !user_callbacks.contains_key(&f.camel_name)).collect();
    if !missing.is_empty() {
        return Err(anyhow!(
            "wasm_import: no host callback for WIT import{}: {}",
            if missing.len() > 1 { "s" } else { "" }, name_list(&missing)
        ));
    }
    let string_result: Vec<&WitFunc> =
        import_funcs.iter().filter(|f| f.result == Some(WitType::Str)).collect();
    if !string_result.is_empty() {
        return Err(anyhow!(
            "wasm_import: a WIT import returning a string is not supported: {}",
            name_list(&string_result)
        ));
    }
    Ok(())
}

/// Every WIT export must exist in the instance (SPEC 4.0.0 §2), checked at load.
pub(crate) fn check_exports(
    store: &mut Store<()>,
    instance: &wasmtime::Instance,
    export_funcs: &[WitFunc],
) -> Result<()> {
    let absent: Vec<&WitFunc> = export_funcs
        .iter()
        .filter(|f| instance.get_func(&mut *store, &f.camel_name).is_none())
        .collect();
    if !absent.is_empty() {
        return Err(anyhow!(
            "wasm_import: the .wit declares export{} the module does not export: {}",
            if absent.len() > 1 { "s" } else { "" }, name_list(&absent)
        ));
    }
    Ok(())
}

/// Check a host callback's return value against its WIT import's result and encode it for WASM:
/// the argument domains in reverse, never coerced. A void import ignores the value.
fn encode_callback_result(func: &WitFunc, ret: &WasmVal) -> Result<Option<wasmtime::Val>> {
    let Some(ty) = &func.result else { return Ok(None) };
    Ok(Some(match (ty, ret) {
        (WitType::S32,  WasmVal::I32(v))  => wasmtime::Val::I32(*v),
        (WitType::S64,  WasmVal::I64(v))  => wasmtime::Val::I64(*v),
        (WitType::F32,  WasmVal::F32(v))  => wasmtime::Val::F32(v.to_bits()),
        (WitType::F64,  WasmVal::F64(v))  => wasmtime::Val::F64(v.to_bits()),
        (WitType::Bool, WasmVal::Bool(b)) => wasmtime::Val::I32(i32::from(*b)),
        _ => {
            return Err(anyhow!(
                "wasm_import: host callback {} (WIT import \"{}\" -> {ty}) returned {ret:?}; expected {}",
                func.camel_name, func.name, expected_kind(ty)
            ))
        }
    }))
}

// ── Import environment ────────────────────────────────────────────────────────

/// Register host import callbacks into a `Linker<()>` under the `"env"` namespace.
///
/// `user_callbacks` keys are **camelCase** WIT import names (e.g. `"envMul"`). Every import
/// needs one (SPEC 4.0.0 §4): a missing callback, or an import with a `string` result, is an
/// error naming them all. A callback's return value is checked against the import's WIT result
/// when WASM calls it; a mismatch reaches the caller of the export as an error.
/// Must be called before instantiation; memory is resolved from the caller at call time.
pub fn link_import_env(
    linker: &mut Linker<()>,
    import_funcs: &[WitFunc],
    user_callbacks: &HashMap<String, HostCallback>,
) -> Result<()> {
    check_imports(import_funcs, user_callbacks)?;
    for func in import_funcs {
        // WASM binary import name is snake_case (kebab → underscore).
        let wasm_key = func.name.replace('-', "_");
        let params   = func.params.clone();
        let result   = func.result.clone();
        let wit_func = func.clone();
        // User-facing key is camelCase (e.g. "envMul"); check_imports proved it is present.
        let cb = user_callbacks
            .get(&func.camel_name)
            .cloned()
            .ok_or_else(|| anyhow!("wasm_import: no host callback for {}", func.camel_name))?;

        let param_types  = wit_to_wasm_params(&params);
        let result_types = wit_to_wasm_results(&result);
        let func_type = FuncType::new(linker.engine(), param_types, result_types);

        linker.func_new("env", &wasm_key, func_type, move |mut caller: Caller<'_, ()>, raw: &[wasmtime::Val], results: &mut [wasmtime::Val]| {
            let mut wasm_vals: Vec<WasmVal> = Vec::new();
            let mut i = 0usize;
            for p in &params {
                match &p.ty {
                    WitType::Str => {
                        let ptr = raw[i].unwrap_i32() as u32;
                        let len = raw[i + 1].unwrap_i32() as u32;
                        i += 2;
                        let mem = caller.get_export("memory")
                            .and_then(|e| if let Extern::Memory(m) = e { Some(m) } else { None })
                            .ok_or_else(|| anyhow!("no memory export"))?;
                        let data = mem.data(&caller);
                        let s = read_str(data, ptr, len)?;
                        wasm_vals.push(WasmVal::Str(s));
                    }
                    WitType::Bool => {
                        wasm_vals.push(WasmVal::Bool(raw[i].unwrap_i32() != 0));
                        i += 1;
                    }
                    WitType::S32 => { wasm_vals.push(WasmVal::I32(raw[i].unwrap_i32())); i += 1; }
                    WitType::S64 => { wasm_vals.push(WasmVal::I64(raw[i].unwrap_i64())); i += 1; }
                    WitType::F32 => { wasm_vals.push(WasmVal::F32(raw[i].unwrap_f32())); i += 1; }
                    WitType::F64 => { wasm_vals.push(WasmVal::F64(raw[i].unwrap_f64())); i += 1; }
                }
            }

            // The callback's own error reaches the export's caller as it is.
            let ret = cb(&wasm_vals)?;
            if let Some(v) = encode_callback_result(&wit_func, &ret)? {
                results[0] = v;
            }
            Ok(())
        })?;
    }
    Ok(())
}

// ── wasic export call ─────────────────────────────────────────────────────────

pub fn call_wasic_export(
    store: &mut Store<()>,
    instance: &wasmtime::Instance,
    func: &WitFunc,
    args: &[WasmVal],
) -> Result<WasmVal> {
    let mem = instance.get_memory(&mut *store, "memory")
        .ok_or_else(|| anyhow!("no memory export"))?;

    let wasm_fn = instance.get_func(&mut *store, &func.camel_name)
        .ok_or_else(|| anyhow!("export '{}' not found", func.camel_name))?;

    check_args(func, args)?;
    let mut wasm_args: Vec<wasmtime::Val> = Vec::new();

    for arg in args {
        match arg {
            WasmVal::Str(s) => {
                let bytes = s.as_bytes();
                let malloc = instance.get_typed_func::<i32, i32>(&mut *store, "__malloc")
                    .map_err(|_| anyhow!("__malloc not exported"))?;
                let ptr = malloc.call(&mut *store, bytes.len() as i32)?;
                write_bytes(mem.data_mut(&mut *store), ptr, bytes)?;
                wasm_args.push(wasmtime::Val::I32(ptr));
                wasm_args.push(wasmtime::Val::I32(bytes.len() as i32));
            }
            other => wasm_args.push(encode_scalar(other)),
        }
    }

    if func.result == Some(WitType::Str) {
        wasm_fn.call(&mut *store, &wasm_args, &mut [])?;
        let ptr = instance.get_global(&mut *store, "__str_ret_ptr")
            .ok_or_else(|| anyhow!("__str_ret_ptr not found"))?
            .get(&mut *store).unwrap_i32() as u32;
        let len = instance.get_global(&mut *store, "__str_ret_len")
            .ok_or_else(|| anyhow!("__str_ret_len not found"))?
            .get(&mut *store).unwrap_i32() as u32;
        let data = mem.data(&*store);
        return Ok(WasmVal::Str(read_str(data, ptr, len)?));
    }

    let n = if func.result.is_some() { 1 } else { 0 };
    let mut results = vec![wasmtime::Val::I32(0); n];
    wasm_fn.call(&mut *store, &wasm_args, &mut results)?;
    decode_result(&func.result, &results)
}

// ── component export call (Canonical ABI) ─────────────────────────────────────

pub fn call_component_export(
    store: &mut Store<()>,
    instance: &wasmtime::Instance,
    func: &WitFunc,
    args: &[WasmVal],
) -> Result<WasmVal> {
    let mem = instance.get_memory(&mut *store, "memory")
        .ok_or_else(|| anyhow!("no memory export"))?;

    let cabi = instance
        .get_typed_func::<(i32, i32, i32, i32), i32>(&mut *store, "cabi_realloc")
        .map_err(|_| anyhow!("cabi_realloc not exported"))?;

    let wasm_fn = instance.get_func(&mut *store, &func.camel_name)
        .ok_or_else(|| anyhow!("export '{}' not found", func.camel_name))?;

    check_args(func, args)?;
    let mut wasm_args: Vec<wasmtime::Val> = Vec::new();

    for arg in args {
        match arg {
            WasmVal::Str(s) => {
                let bytes = s.as_bytes();
                let ptr = cabi.call(&mut *store, (0, 0, 1, bytes.len() as i32))?;
                write_bytes(mem.data_mut(&mut *store), ptr, bytes)?;
                wasm_args.push(wasmtime::Val::I32(ptr));
                wasm_args.push(wasmtime::Val::I32(bytes.len() as i32));
            }
            other => wasm_args.push(encode_scalar(other)),
        }
    }

    if func.result == Some(WitType::Str) {
        // SPEC 3.0.0 — callee-allocated string returns.
        // The export returns an i32 pointer to a callee-allocated 8-byte
        // [ptr, len] pair. Call with ONLY the encoded params (no trailing
        // return area), capture the returned i32, read+decode the pair, then
        // release the returned memory via the paired `cabi_post_<name>` export.
        let mut results = [wasmtime::Val::I32(0)];
        wasm_fn.call(&mut *store, &wasm_args, &mut results)?;
        let ret_area = results[0].unwrap_i32();

        let decoded = {
            let data = mem.data(&*store);
            let b = ret_area as usize;
            if b + 8 > data.len() {
                return Err(anyhow!("string return area OOB ret_area={ret_area}"));
            }
            let ret_ptr = i32::from_le_bytes(data[b..b + 4].try_into()?) as u32;
            let ret_len = i32::from_le_bytes(data[b + 4..b + 8].try_into()?) as u32;
            // Decode copies the bytes into an owned String, so it remains valid
            // after `cabi_post_<name>` releases the callee allocation below.
            read_str(data, ret_ptr, ret_len)?
        };

        // Release the returned memory: call `cabi_post_<camel_name>(ret_area)`
        // if the module exports it; tolerate its absence.
        let post_name = format!("cabi_post_{}", func.camel_name);
        if let Ok(post) = instance.get_typed_func::<i32, ()>(&mut *store, &post_name) {
            post.call(&mut *store, ret_area)?;
        }

        return Ok(WasmVal::Str(decoded));
    }

    let n = if func.result.is_some() { 1 } else { 0 };
    let mut results = vec![wasmtime::Val::I32(0); n];
    wasm_fn.call(&mut *store, &wasm_args, &mut results)?;
    decode_result(&func.result, &results)
}

// ── raw export call (no WIT / no ABI translation) ─────────────────────────────

/// Call a WASM export directly by name with no ABI translation.
/// Used when no companion `.wit` file is found.
pub fn call_raw_export(
    store: &mut Store<()>,
    instance: &wasmtime::Instance,
    name: &str,
    args: &[WasmVal],
) -> Result<WasmVal> {
    let wasm_fn = instance.get_func(&mut *store, name)
        .ok_or_else(|| anyhow!("raw export '{name}' not found"))?;

    let mut wasm_args: Vec<wasmtime::Val> = Vec::new();
    for v in args {
        wasm_args.push(match v {
            WasmVal::I32(x)  => wasmtime::Val::I32(*x),
            WasmVal::I64(x)  => wasmtime::Val::I64(*x),
            WasmVal::F32(x)  => wasmtime::Val::F32(x.to_bits()),
            WasmVal::F64(x)  => wasmtime::Val::F64(x.to_bits()),
            WasmVal::Bool(b) => wasmtime::Val::I32(if *b { 1 } else { 0 }),
            _ => return Err(anyhow!("strings require a companion .wit file")),
        });
    }

    let n = wasm_fn.ty(&*store).results().len();
    let mut results = vec![wasmtime::Val::I32(0); n];
    wasm_fn.call(&mut *store, &wasm_args, &mut results)?;

    if n == 0 { return Ok(WasmVal::Void); }
    Ok(match results[0] {
        wasmtime::Val::I32(v)    => WasmVal::I32(v),
        wasmtime::Val::I64(v)    => WasmVal::I64(v),
        wasmtime::Val::F32(bits) => WasmVal::F32(f32::from_bits(bits)),
        wasmtime::Val::F64(bits) => WasmVal::F64(f64::from_bits(bits)),
        _                        => WasmVal::Void,
    })
}

fn decode_result(result: &Option<WitType>, results: &[wasmtime::Val]) -> Result<WasmVal> {
    Ok(match result {
        None                 => WasmVal::Void,
        Some(WitType::S32)   => WasmVal::I32(results[0].unwrap_i32()),
        Some(WitType::S64)   => WasmVal::I64(results[0].unwrap_i64()),
        Some(WitType::F32)   => WasmVal::F32(results[0].unwrap_f32()),
        Some(WitType::F64)   => WasmVal::F64(results[0].unwrap_f64()),
        Some(WitType::Bool)  => WasmVal::Bool(results[0].unwrap_i32() != 0),
        Some(WitType::Str)   => unreachable!("string returns handled above"),
    })
}
