//! OutLayer entry point. Built at T05; until then it prints nothing on stdout.

fn main() {
    eprintln!(
        "evaluator-wasm {} (bp scale {}): not implemented",
        env!("CARGO_PKG_VERSION"),
        evaluator_core::BP
    );
}
