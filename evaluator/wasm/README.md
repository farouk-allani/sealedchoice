# Evaluator WASM

The binary OutLayer runs (`wasm32-wasip2`). Design: [`docs/04-evaluator.md`](../../docs/04-evaluator.md). Decisions: DECISIONS D-024 (part 1), D-020 (model output parsing), D-019 (injection fold). Scoring is [`evaluator/core`](../core); this crate does input, keys, envelopes, prompts and services.

Status: **part 1 (deterministic path)**. Every stage the vectors pin is built and tested. Model calls, signatures, attestation, the WASM's own hash, the request id and the HTTP bundle store sit behind traits (`src/services.rs`) with no real implementation until gates G1–G3.

Build: `cargo build -p evaluator-wasm --target wasm32-wasip2 --release`. That is the default build: real services are `Unavailable`, so `evaluate` refuses with `E_SERVICE`. `--features offline` is for the harness only: fixture services and a local bundle store. Never deploy it.

Tests:
- `cargo test -p evaluator-wasm`: native, every scoring vector through the pipeline.
- `cargo test -p evaluator-harness --features run`: the built WASM under wasmtime.

## Actions (stdin JSON, built by the tender contract)

| `action` | Output on stdout (JCS) |
|---|---|
| `derive_pubkey` `{contract_id, tender_id}` | `{"pk":"02…","tid":"<id>","v":1}`: the tender's public key |
| `evaluate` (docs/04 §6) | the compact result (≤ 900 bytes); the bundle goes to the bundle store first |
| `quote`, `payout_status` | `E_NOT_IMPLEMENTED` (T13) |

On refusal: `{"error":"E_…","v":1}` and exit code 1. stderr carries fixed codes and counts only, never a secret, a key, bid text or a model answer.

## Environment (`src/env_names.rs`)

| Name | Use |
|---|---|
| `NEAR_PREDECESSOR_ID` | must equal the input's `contract_id`: the account that called `request_execution`, i.e. the tender contract (G1, request 6845) |
| `NEAR_SENDER_ID` | the transaction signer (the buyer). Never compared with `contract_id` — doing so refuses every honest run |
| `MASTER_SECRET` | tender-key master secret, 64 hex characters (⚠️ G1 fixes the name) |
| `NEAR_BLOCK_HEIGHT` | written into the bundle when present |
| `EVALUATOR_FIXTURES`, `BUNDLE_STORE_DIR` | offline build only |

## Error codes

| Code | Meaning |
|---|---|
| `E_INPUT` | stdin is not the JSON of a known action, has unknown fields, bad base64, or bid indices are not 0..n−1 |
| `E_SENDER` | `NEAR_PREDECESSOR_ID` missing or not the input's `contract_id` |
| `E_ENV` | master secret missing or not 64 hex characters |
| `E_RUBRIC` | `rubric_json` not canonical JCS, not a rubric in either shape (scoring core, prompt), weights not 10000, `budget_cap_minor` not a positive integer string, a criterion id not matching `^[a-z][a-z0-9_]{1,31}$`, a qualitative criterion reads a non-text field, or `min_valid_outputs` not 2 or 3 (or above the model count). `pipeline::check_rubric`, before any service; the contract refuses the same rubrics (I14) |
| `E_ROOT_MISMATCH` | the bids do not hash to `bids_root` |
| `E_ATTEMPT` | `attempt` outside 1..=3 |
| `E_PROMPT` | the user template could not be rendered (missing question or anchor); `check_rubric` renders it once before any service |
| `E_SCORING` | the scoring core refused (weights, JCS of the bundle, result over 900 bytes, …) |
| `E_SERVICE` | an external service failed or is unavailable in this build; or the bundle store refused twice |
| `E_MODEL_AUTH` | the key check (one call that depends on no bid) or, on attempts 1–2, a bid's call got 401 or 403: the run stops there, nothing is stored, the contract's retry applies (D-024) |
| `E_MODEL_OUTAGE` | an eligible bid got fewer answered model calls than `aggregation.min_valid_outputs` (unanswered: no response, 5xx or 429 after the one retry; another 4xx counts as answered but invalid), or no call in the run got a 2xx response, or the key check failed without 401/403. On the last attempt (3) a bid's failed calls count as invalid answers instead, and only "no answer across two or more eligible bids" or a failed key check refuses. Nothing is stored, the contract's retry applies (D-024) |
| `E_NOT_IMPLEMENTED` | `quote`, `payout_status` |

Recorded, not refused: a reader key (bid `debrief_pubkey` or committee `pubkey`) that is not a point on secp256k1 gets an envelope with `ecies_b64: ""` and `"error": "E_READER_KEY"`; the run goes on. A failed model call or signature fetch is recorded in `model_calls` with `error` (and `http_status`) and counts as an invalid output.
