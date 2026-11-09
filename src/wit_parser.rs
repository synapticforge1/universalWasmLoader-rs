//! Strict WIT parser for the subset `wasmtk` writes (SPEC 4.0.0 §2 "Parsing").
//!
//! A port of universalWasmLoader-js `wit-parser.js` 2.0.0: the same grammar and the same fault
//! messages. Anything outside the grammar is an error — a `.wit` is never read loosely.

use anyhow::{anyhow, bail, Result};
use std::fmt;

/// Parsed WIT type.
#[derive(Debug, Clone, PartialEq)]
pub enum WitType {
    S32,
    S64,
    F32,
    F64,
    Bool,
    Str,
}

/// The WIT types this loader translates (SPEC §4); any other type is an error.
const WIT_TYPES: &str = "s32, s64, f32, f64, bool, string";

impl WitType {
    fn parse(raw: &str, place: &str) -> Result<Self> {
        Ok(match raw.trim() {
            "s32" => Self::S32,
            "s64" => Self::S64,
            "f32" => Self::F32,
            "f64" => Self::F64,
            "bool" => Self::Bool,
            "string" => Self::Str,
            t => bail!("unsupported WIT type \"{t}\" in {place} (supported: {WIT_TYPES})"),
        })
    }
}

impl fmt::Display for WitType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::S32 => "s32",
            Self::S64 => "s64",
            Self::F32 => "f32",
            Self::F64 => "f64",
            Self::Bool => "bool",
            Self::Str => "string",
        })
    }
}

/// A single parameter in a WIT function signature.
#[derive(Debug, Clone)]
pub struct WitParam {
    /// snake_case name for use in Rust.
    pub name: String,
    pub ty: WitType,
}

/// A parsed WIT function (import or export).
#[derive(Debug, Clone)]
pub struct WitFunc {
    /// Original kebab-case name from WIT.
    pub name: String,
    /// camelCase name — this is the actual name used in the WASM binary for exports.
    pub camel_name: String,
    /// snake_case name for host language (Rust/Python) — used in the public API.
    pub snake_name: String,
    pub params: Vec<WitParam>,
    pub result: Option<WitType>,
}

/// Fully parsed WIT world.
#[derive(Debug, Clone)]
pub struct ParsedWit {
    pub package_name: String,
    pub world_name: String,
    pub imports: Vec<WitFunc>,
    pub exports: Vec<WitFunc>,
}

/// Convert kebab-case to snake_case.
pub fn kebab_to_snake(s: &str) -> String {
    s.replace('-', "_")
}

/// Convert kebab-case to camelCase (matches JS `kebabToCamel`).
pub fn kebab_to_camel(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut capitalize_next = false;
    for ch in s.chars() {
        if ch == '-' {
            capitalize_next = true;
        } else if capitalize_next {
            result.extend(ch.to_uppercase());
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }
    result
}

fn regex(pattern: &str) -> regex_lite::Regex {
    regex_lite::Regex::new(pattern).expect("valid regex")
}

/// A WIT identifier: kebab-case words of letters and digits.
fn is_ident(s: &str) -> bool {
    regex(r"^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$").is_match(s)
}

/// `raw` is the text between the parentheses of `func(...)`; `fn_label` is e.g. `export add`.
fn parse_params(raw: &str, fn_label: &str) -> Result<Vec<WitParam>> {
    // A trailing comma is valid WIT: `func(a: s32,)`.
    let mut parts: Vec<&str> = raw.split(',').map(str::trim).collect();
    if parts.last() == Some(&"") {
        parts.pop();
    }
    let param_re = regex(r"^([^:\s]+)\s*:\s*(\S+)$");
    let mut params = Vec::with_capacity(parts.len());
    let mut seen: Vec<&str> = Vec::new();
    for part in parts {
        let cap = param_re
            .captures(part)
            .filter(|c| is_ident(c.get(1).map_or("", |m| m.as_str())))
            .ok_or_else(|| anyhow!("malformed parameter \"{part}\" in {fn_label} (expected \"name: type\")"))?;
        let raw_name = cap.get(1).map_or("", |m| m.as_str());
        if seen.contains(&raw_name) {
            bail!("duplicate parameter \"{raw_name}\" in {fn_label}");
        }
        seen.push(raw_name);
        let ty = WitType::parse(&cap[2], &format!("{fn_label}, parameter {raw_name}"))?;
        params.push(WitParam { name: kebab_to_snake(raw_name), ty });
    }
    Ok(params)
}

/// Parse a WIT source string in the subset `wasmtk` produces: an optional `package` line and one
/// `world` holding only `import` / `export` function statements, with `//` comments.
///
/// Anything else — a malformed statement or parameter, an unsupported type (`u32` is never read
/// as another type), a duplicate name, text outside the world — is an error naming the fault
/// (SPEC 4.0.0 §2).
pub fn parse_wit(src: &str) -> Result<ParsedWit> {
    let src = src.strip_prefix('\u{feff}').unwrap_or(src);
    let code = regex(r"//[^\n]*").replace_all(src, "");

    let mut rest = code.trim();
    let mut package_name = String::new();
    if let Some(cap) = regex(r"^package\s+([^\s;]+)\s*;").captures(rest) {
        package_name = cap[1].to_string();
        let end = cap.get(0).map_or(0, |m| m.end());
        rest = rest[end..].trim();
    }

    let world = regex(r"^world\s+([^\s{]+)\s*\{([^{}]*)\}$").captures(rest).ok_or_else(|| {
        if rest.is_empty() {
            anyhow!("not a WIT world: it is empty")
        } else {
            let head: String = rest.chars().take(60).collect();
            anyhow!("not a WIT world: expected one \"world <name> {{ ... }}\" block, found: {head}")
        }
    })?;
    let world_name = world[1].to_string();
    if !is_ident(&world_name) {
        bail!("malformed world name \"{world_name}\"");
    }

    let func_re = regex(r"^(import|export)\s+([^\s:]+)\s*:\s*func\s*\(([^()]*)\)\s*(?:->\s*(\S+))?$");
    let mut imports: Vec<WitFunc> = Vec::new();
    let mut exports: Vec<WitFunc> = Vec::new();
    let mut statements: Vec<&str> = world[2].split(';').map(str::trim).collect();
    let last = statements.pop().unwrap_or("");
    if !last.is_empty() {
        bail!("unterminated WIT statement (missing \";\"): {last}");
    }
    let ws = regex(r"\s+");
    for stmt in statements {
        let cap = func_re
            .captures(stmt)
            .ok_or_else(|| anyhow!("unsupported or malformed WIT statement: {}", ws.replace_all(stmt, " ")))?;
        let keyword = &cap[1];
        let name = cap[2].to_string();
        let fn_label = format!("{keyword} {name}");
        if !is_ident(&name) {
            bail!("malformed function name in {fn_label}");
        }
        let list = if keyword == "import" { &mut imports } else { &mut exports };
        if list.iter().any(|f| f.name == name) {
            bail!("duplicate {fn_label}");
        }
        let params = parse_params(&cap[3], &fn_label)?;
        let result = match cap.get(4) {
            Some(m) => Some(WitType::parse(m.as_str(), &format!("{fn_label}, result"))?),
            None => None,
        };
        list.push(WitFunc {
            camel_name: kebab_to_camel(&name),
            snake_name: kebab_to_snake(&name),
            name,
            params,
            result,
        });
    }

    Ok(ParsedWit { package_name, world_name, imports, exports })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fault(src: &str) -> String {
        format!("{:#}", parse_wit(src).expect_err("must not parse"))
    }

    #[test]
    fn accepts_the_wasmtk_subset() {
        let p = parse_wit(
            "\u{feff}// header\npackage local:m;\nworld m-1 {\n  import env-f: func(p0: f64,) -> f64; // c\n  export is-ok: func() -> bool;\n  export run: func(s: string);\n}\n",
        )
        .unwrap();
        assert_eq!(p.package_name, "local:m");
        assert_eq!(p.world_name, "m-1");
        assert_eq!(p.imports[0].camel_name, "envF");
        assert_eq!(p.imports[0].params.len(), 1);
        assert_eq!(p.exports[0].snake_name, "is_ok");
        assert_eq!(p.exports[0].result, Some(WitType::Bool));
        assert_eq!(p.exports[1].result, None);
    }

    #[test]
    fn refuses_everything_else() {
        assert!(fault("").contains("it is empty"));
        assert!(fault("garbage").contains("not a WIT world"));
        assert!(fault("world w { export f: func(a: u32); }").contains("unsupported WIT type \"u32\" in export f, parameter a"));
        assert!(fault("world w { export f: func() -> s99; }").contains("unsupported WIT type \"s99\" in export f, result"));
        assert!(fault("world w { export f: func(a: s32 b: s32); }").contains("malformed parameter \"a: s32 b: s32\""));
        assert!(fault("world w { export f: func(s32); }").contains("malformed parameter"));
        assert!(fault("world w { export f: func(a: s32, a: s32); }").contains("duplicate parameter \"a\""));
        assert!(fault("world w { export f: func(); export f: func(); }").contains("duplicate export f"));
        assert!(fault("world w { export f: func() }").contains("missing \";\""));
        assert!(fault("world w { record r { a: s32 }; }").contains("not a WIT world"));
        assert!(fault("world w { use x; }").contains("unsupported or malformed WIT statement: use x"));
        assert!(fault("world w {} world v {}").contains("not a WIT world"));
        assert!(fault("world w { export f_g: func(); }").contains("malformed function name"));
    }
}
