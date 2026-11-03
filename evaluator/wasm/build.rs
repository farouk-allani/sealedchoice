//! Generates the prompt templates from specs/scoring-prompt.md (the text between the fences under
//! "## System template" and "## User template"), so the WASM carries exactly the published prompt.
//! `src/prompt.rs` tests that the constants hash like the file content.

use std::path::Path;

fn fenced_after(md: &str, heading: &str) -> String {
    let start = md
        .find(heading)
        .unwrap_or_else(|| panic!("scoring-prompt.md: heading {heading:?} not found"));
    let rest = &md[start + heading.len()..];
    let open = rest
        .find("\n```\n")
        .unwrap_or_else(|| panic!("scoring-prompt.md: no fence after {heading:?}"))
        + "\n```\n".len();
    let body = &rest[open..];
    let close = body
        .find("\n```")
        .unwrap_or_else(|| panic!("scoring-prompt.md: unclosed fence after {heading:?}"));
    body[..close].to_string()
}

fn main() {
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/scoring-prompt.md");
    println!("cargo:rerun-if-changed={}", spec.display());
    let md =
        std::fs::read_to_string(&spec).unwrap_or_else(|e| panic!("read {}: {e}", spec.display()));
    let system = fenced_after(&md, "\n## System template\n");
    let user = fenced_after(&md, "\n## User template\n");
    let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|e| panic!("OUT_DIR: {e}"));
    let out = Path::new(&out_dir).join("prompt_templates.rs");
    std::fs::write(
        &out,
        format!(
            "/// System template, verbatim from specs/scoring-prompt.md.\npub const SYSTEM_TEMPLATE: &str = {system:?};\n/// User template, verbatim from specs/scoring-prompt.md.\npub const USER_TEMPLATE: &str = {user:?};\n"
        ),
    )
    .unwrap_or_else(|e| panic!("write {}: {e}", out.display()));
}
