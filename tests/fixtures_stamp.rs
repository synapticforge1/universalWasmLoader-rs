//! The fixtures in `tests/` are exactly the reference set stamped in `tests/fixtures.json`
//! (copied unmodified from universalWasmLoader-js, SPEC §7; workspace letter H7).
//! Fails when a stamped file is missing or its bytes differ, or when `tests/` holds a
//! `.wasm` / `.wit` / `.wat` the stamp does not list. Same rule as -js `scripts/check-fixtures.ts`.

use regex_lite::Regex;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;

fn stamped_files() -> BTreeMap<String, String> {
    let json = fs::read_to_string("tests/fixtures.json").expect("tests/fixtures.json");
    // Only the "files" object maps a fixture name to a 64-hex sha256.
    let files = &json[json.find("\"files\"").expect("\"files\" key")..];
    let entry = Regex::new(r#""([^"]+\.(?:wasm|wit|wat))"\s*:\s*"([0-9a-f]{64})""#).unwrap();
    entry
        .captures_iter(files)
        .map(|c| (c[1].to_string(), c[2].to_string()))
        .collect()
}

#[test]
fn fixtures_match_stamp() {
    let stamp = stamped_files();
    assert!(!stamp.is_empty(), "no entries parsed from tests/fixtures.json");

    let mut problems = Vec::new();
    for (file, hash) in &stamp {
        match fs::read(format!("tests/{file}")) {
            Err(_) => problems.push(format!("{file}: missing")),
            Ok(bytes) => {
                let got: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
                if &got != hash {
                    problems.push(format!("{file}: bytes differ from the stamp"));
                }
            }
        }
    }
    for e in fs::read_dir("tests").unwrap() {
        let name = e.unwrap().file_name().into_string().unwrap();
        let fixture = [".wasm", ".wit", ".wat"].iter().any(|x| name.ends_with(x));
        if fixture && !stamp.contains_key(&name) {
            problems.push(format!("{name}: not in the stamp"));
        }
    }
    assert!(
        problems.is_empty(),
        "fixtures do not match tests/fixtures.json (re-copy from universalWasmLoader-js; never edit by hand):\n  {}",
        problems.join("\n  ")
    );
}
