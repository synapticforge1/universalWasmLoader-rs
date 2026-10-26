//! Every place this crate claims a SPEC version agrees with `SPEC_VERSION` (workspace letter H6:
//! the SPEC version assertion). `scripts/bump.ts` checks `SPEC_VERSION` against the reference
//! universalWasmLoader-js `SPEC.md` before a release.

use regex_lite::Regex;
use std::fs;
use universal_wasm_loader::SPEC_VERSION;

fn claims(path: &str) -> Vec<String> {
    let text = fs::read_to_string(path).unwrap();
    let re = Regex::new(r"(?i)Spec v(\d+\.\d+\.\d+)").unwrap();
    re.captures_iter(&text).map(|c| c[1].to_string()).collect()
}

#[test]
fn spec_version_claims_agree() {
    for path in ["README.md", "src/lib.rs"] {
        let found = claims(path);
        assert!(!found.is_empty(), "{path}: no \"Spec vX.Y.Z\" claim found");
        for v in found {
            assert_eq!(v, SPEC_VERSION, "{path} claims Spec v{v}, SPEC_VERSION is {SPEC_VERSION}");
        }
    }
}
