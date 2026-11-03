//! OutLayer entry point: stdin → `evaluator_wasm::run` → stdout. Exit code 1 on refusal.

use evaluator_wasm::services::{Environment, ProcessEnv};
use std::io::{Read, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut stdin = Vec::new();
    if std::io::stdin().read_to_end(&mut stdin).is_err() {
        eprintln!("E_INPUT: stdin unreadable");
        return ExitCode::FAILURE;
    }
    let env = ProcessEnv;
    let result = run(&stdin, &env);
    let (out, code) = match result {
        Ok(out) => (out, ExitCode::SUCCESS),
        Err(e) => {
            eprintln!("{e}");
            (evaluator_wasm::error_object(&e), ExitCode::FAILURE)
        }
    };
    let mut stdout = std::io::stdout().lock();
    if stdout
        .write_all(&out)
        .and_then(|()| stdout.flush())
        .is_err()
    {
        return ExitCode::FAILURE;
    }
    code
}

#[cfg(not(feature = "offline"))]
fn run(stdin: &[u8], env: &dyn Environment) -> Result<Vec<u8>, evaluator_wasm::error::RunError> {
    evaluator_wasm::run(
        stdin,
        env,
        &evaluator_wasm::services::Unavailable::services(),
    )
}

/// Offline build (harness only): fixture services and the local bundle store.
#[cfg(feature = "offline")]
fn run(stdin: &[u8], env: &dyn Environment) -> Result<Vec<u8>, evaluator_wasm::error::RunError> {
    use evaluator_wasm::error::RunError;
    use evaluator_wasm::offline::{Fixtures, LocalStore};
    use evaluator_wasm::services::Services;
    let fixtures = Fixtures::load(env).map_err(|e| RunError::Service(e.0))?;
    let store = LocalStore::from_env(env).map_err(|e| RunError::Service(e.0))?;
    let svc = Services {
        models: &fixtures,
        signatures: &fixtures,
        attestation: &fixtures,
        store: &store,
        execution: &fixtures,
    };
    evaluator_wasm::run(stdin, env, &svc)
}
