---
title: Run the source locally
description: Install the workspace, inspect the testnet demo and run the verifier without secrets.
---

Use the source checkout supplied with the project. The working repository is private; public source publication is a separate release step. Public read-only verification requires no wallet, private key or configured secret.

## Prerequisites

- Node.js **22.12 or newer**; this documentation was checked on Node **24.19.0**.
- pnpm **12.16.1**, pinned by the root `packageManager` field.
- Python 3 for the executable reference and optional browser checks.
- Internet access for the package registry, NEAR RPC, bundle store and evaluator download.
- For Rust checks: Rust **1.97.0**, the targets in `rust-toolchain.toml`, and cargo-near **0.22.0** for the contract build.

## Install and test

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm -r lint
pnpm -r typecheck
```

The tests run offline against test vectors and fixtures after installation. Lint and typecheck include the app and documentation configuration.

## Verify a live tender

```bash
pnpm verify --tender 1 --network testnet --contract tenders-v1.sealedchoice.testnet
```

Expected recorded-demo result: **10/10 checks passed**, with no failed or skipped checks. The explicit contract argument avoids an old local environment configuration selecting the earlier deployment. The verifier script loads its own environment if present; you do not need to create an environment file for a fresh read-only checkout.

For machine-readable results:

```bash
pnpm verify --tender 1 --network testnet --contract tenders-v1.sealedchoice.testnet --json
```

Require `passed: 10`, `failed: 0` and `skipped: 0` for complete evidence. A zero exit code alone does not rule out skips.

## Start the application

```bash
pnpm --filter web dev
```

Open [localhost:3000/tenders](http://localhost:3000/tenders). The default configuration reads the public final testnet contract. Browse without a wallet. Transaction actions need the appropriate testnet account, gas and token balances. Private report access needs a registered reader account's message signature.

## Start the documentation

In another terminal:

```bash
pnpm --filter docs dev
```

Open [localhost:3001](http://localhost:3001). The Docusaurus workspace serves curated content from `apps/docs/docs`; it does not publish the repository's internal planning directory.

Build and serve its static output:

```bash
pnpm --filter docs build
pnpm --filter docs serve
```

The build throws on broken internal links. Search is generated locally from the documentation; it does not need a hosted search key.

## Reference and Rust checks

```bash
python specs/reference/reference.py --check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p evaluator-harness --features run
```

The reference checks that committed vectors still match the executable specification. Rust and TypeScript tests consume those same vectors. Run Rust commands in Linux or WSL with the pinned toolchain. The local WSL sandbox is unavailable because its glibc 2.35 is older than the sandbox binary's required 2.39; that check is not claimed as passed.

## Builds and frozen artifacts

Ordinary development builds:

```bash
cd contracts/tender
cargo near build non-reproducible-wasm
cd ../..
cargo build -p evaluator-wasm --target wasm32-wasip2 --release
```

An ordinary host build is not reproducible-release evidence. Frozen release metadata and hashes are listed in [demo evidence](./evidence.md#frozen-artifacts). The contract's reproducible-build settings are in `contracts/tender/Cargo.toml`; the evaluator uses the OutLayer builder. Rebuilding the frozen release requires its exact source export, build context and pinned image. Frozen source tags are not public yet, so a public cold-source reproduction is pending that publication.

Never deploy a build with offline/testkit fixture features. Do not replace the earlier `tenders.sealedchoice.testnet` deployment with the current storage layout; its old state is incompatible.

## Source map

| Path | Responsibility |
| --- | --- |
| `contracts/tender` | Lifecycle, callback guards, awards, bonds and escrow |
| `evaluator/core` | Pure eligibility, quote checks, aggregation, ranking and flags |
| `evaluator/wasm` | OutLayer I/O, model calls, key derivation and evidence creation |
| `packages/crypto` | Canonical JSON, hashing, Merkle commitments, encryption and reader keys |
| `packages/verify` | Public checks and private report verification |
| `apps/web` | Application, wallet flows and bundle API |
| `apps/docs` | This Docusaurus site |
| `specs` | Schemas, scoring prompt, executable reference and vectors |
