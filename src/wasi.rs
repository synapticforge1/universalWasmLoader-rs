//! Minimal WASI Preview 1 shim (SPEC §10.2).
//!
//! Lets an **I/O-using library** module — e.g. a `wasmtk modc` library that calls
//! `console.log` (which lowers to `fd_write`) — instantiate in this host without
//! pulling in a full `wasmtime-wasi` context (which would force the whole loader
//! onto a `Store<WasiP1Ctx>`). It covers the small, commonly-imported subset from
//! §10.2; anything outside the subset surfaces as a normal missing-import error at
//! instantiation, which documents the gap rather than hiding it. A pure-compute
//! library imports none of this and is unaffected — the funcs registered here are
//! simply never linked.
//!
//! Mirrors the reference `-js` loader's `wasi.js`: `fd_write` routes stdout (fd 1)
//! and stderr (fd 2) to the process streams; the rest are minimal stubs.

use anyhow::{anyhow, Result};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use wasmtime::{Caller, Extern, Linker, Memory};

const ERRNO_SUCCESS: i32 = 0;

fn caller_memory(caller: &mut Caller<'_, ()>) -> Result<Memory> {
    caller
        .get_export("memory")
        .and_then(|e| if let Extern::Memory(m) = e { Some(m) } else { None })
        .ok_or_else(|| anyhow!("wasi shim: module has no `memory` export"))
}

/// Register the minimal `wasi_snapshot_preview1` subset on `linker`. Always safe to
/// call — a module that imports none of these is unaffected.
pub fn link_wasi_shim(linker: &mut Linker<()>) -> Result<()> {
    // fd_write(fd, iovs, iovs_len, nwritten) -> errno. Routes stdout(1)/stderr(2).
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "fd_write",
        |mut caller: Caller<'_, ()>, fd: i32, iovs: i32, iovs_len: i32, nwritten: i32| -> Result<i32> {
            let mem = caller_memory(&mut caller)?;
            let mut bytes: Vec<u8> = Vec::new();
            let mut written: i32 = 0;
            {
                let data = mem.data(&caller);
                for i in 0..iovs_len {
                    let base = (iovs + i * 8) as usize;
                    if base + 8 > data.len() {
                        return Err(anyhow!("fd_write: iovec out of bounds"));
                    }
                    let ptr = i32::from_le_bytes(data[base..base + 4].try_into().unwrap()) as usize;
                    let len = i32::from_le_bytes(data[base + 4..base + 8].try_into().unwrap());
                    if len < 0 || ptr + len as usize > data.len() {
                        return Err(anyhow!("fd_write: buffer out of bounds"));
                    }
                    bytes.extend_from_slice(&data[ptr..ptr + len as usize]);
                    written += len;
                }
            }
            if fd == 2 {
                let mut e = std::io::stderr();
                let _ = e.write_all(&bytes);
                let _ = e.flush();
            } else {
                let mut o = std::io::stdout();
                let _ = o.write_all(&bytes);
                let _ = o.flush();
            }
            let out = mem.data_mut(&mut caller);
            let np = nwritten as usize;
            if np + 4 <= out.len() {
                out[np..np + 4].copy_from_slice(&written.to_le_bytes());
            }
            Ok(ERRNO_SUCCESS)
        },
    )?;

    // proc_exit(code) -> never. A reactor library should not normally call this.
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "proc_exit",
        |_caller: Caller<'_, ()>, code: i32| -> Result<()> { Err(anyhow!("wasm proc_exit({code})")) },
    )?;

    // random_get(buf, len) -> errno. Time-seeded xorshift64 (no external rand dep).
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "random_get",
        |mut caller: Caller<'_, ()>, buf: i32, len: i32| -> Result<i32> {
            let mem = caller_memory(&mut caller)?;
            let out = mem.data_mut(&mut caller);
            let (b, l) = (buf as usize, len as usize);
            if b + l > out.len() {
                return Err(anyhow!("random_get: out of bounds"));
            }
            let mut state = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0x9E37_79B9_7F4A_7C15)
                | 1;
            for byte in out[b..b + l].iter_mut() {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                *byte = (state & 0xff) as u8;
            }
            Ok(ERRNO_SUCCESS)
        },
    )?;

    // clock_time_get(id, precision, time_ptr) -> errno. Writes i64 ns since epoch.
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "clock_time_get",
        |mut caller: Caller<'_, ()>, _id: i32, _precision: i64, time_ptr: i32| -> Result<i32> {
            let ns = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as i64)
                .unwrap_or(0);
            let mem = caller_memory(&mut caller)?;
            let out = mem.data_mut(&mut caller);
            let t = time_ptr as usize;
            if t + 8 <= out.len() {
                out[t..t + 8].copy_from_slice(&ns.to_le_bytes());
            }
            Ok(ERRNO_SUCCESS)
        },
    )?;

    // environ_sizes_get / args_sizes_get: report an empty environment / arg list.
    for name in ["environ_sizes_get", "args_sizes_get"] {
        linker.func_wrap(
            "wasi_snapshot_preview1",
            name,
            |mut caller: Caller<'_, ()>, count_ptr: i32, size_ptr: i32| -> Result<i32> {
                let mem = caller_memory(&mut caller)?;
                let out = mem.data_mut(&mut caller);
                for p in [count_ptr as usize, size_ptr as usize] {
                    if p + 4 <= out.len() {
                        out[p..p + 4].copy_from_slice(&0i32.to_le_bytes());
                    }
                }
                Ok(ERRNO_SUCCESS)
            },
        )?;
    }
    for name in ["environ_get", "args_get"] {
        linker.func_wrap(
            "wasi_snapshot_preview1",
            name,
            |_caller: Caller<'_, ()>, _a: i32, _b: i32| -> i32 { ERRNO_SUCCESS },
        )?;
    }

    // fd stubs.
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "fd_close",
        |_caller: Caller<'_, ()>, _fd: i32| -> i32 { ERRNO_SUCCESS },
    )?;
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "fd_fdstat_get",
        |_caller: Caller<'_, ()>, _fd: i32, _stat: i32| -> i32 { ERRNO_SUCCESS },
    )?;
    linker.func_wrap(
        "wasi_snapshot_preview1",
        "fd_seek",
        |mut caller: Caller<'_, ()>, _fd: i32, _offset: i64, _whence: i32, newoffset: i32| -> Result<i32> {
            let mem = caller_memory(&mut caller)?;
            let out = mem.data_mut(&mut caller);
            let n = newoffset as usize;
            if n + 8 <= out.len() {
                out[n..n + 8].copy_from_slice(&0i64.to_le_bytes());
            }
            Ok(ERRNO_SUCCESS)
        },
    )?;

    Ok(())
}
