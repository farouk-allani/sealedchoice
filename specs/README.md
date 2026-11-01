# specs/

Executable and machine-readable specification. Code in `contracts/`, `evaluator/` and `packages/` must agree with this folder.

| Path | What |
|---|---|
| `reference/reference.py` | Reference implementation (stdlib only): JCS hashing, Merkle tree, key derivation, full scoring pipeline, compact result. Run it to regenerate vectors; `--check` to verify they are current |
| `reference/make_ecies_vector.py` | One-off generator for `ecies-decrypt.json` (needs `pip install eciespy==0.4.7`; randomized, do not regenerate casually) |
| `test-vectors/scoring-2-bids.json` | A vs B: expected 7800 vs 6400 |
| `test-vectors/scoring-3-bids-injection.json` | A, B, malicious C: 7466 / 5955 / 5700, C flagged 24 |
| `test-vectors/scoring-edge-cases.json` | tie-break, over cap, clamped quote, failed model, copied ciphertext, decrypt failure, no eligible bids |
| `test-vectors/merkle.json` | leaves, roots and every proof for 1, 2, 3, 5 leaves |
| `test-vectors/hashes-and-keys.json` | rubric hash, HKDF → secp256k1 keys (fake secrets), NEP-413 message and nonce |
| `test-vectors/compact-result.json` | the on-chain result JSON for the 3-bid case and worst-case size |
| `test-vectors/ecies-decrypt.json` | ciphertexts of the three example bids under the fake tender key |
| `schemas/*.schema.json` | JSON Schema 2020-12 for rubric, bid plaintext, model output, compact result, evidence bundle, debrief |
| `examples/rubric.example.json` | the demo rubric (security review of a DAO treasury module) |
| `examples/bids/*.json` | the three demo bids (C contains a prompt injection) |
| `scoring-prompt.md` | system and user templates sent to NEAR AI models, retry policy |

How implementations use the vectors: load the JSON file by relative path in the test, feed `rubric`, `bids`, `model_outputs` (or `cases[i]`) to the implementation, deep-compare with `expected`. For Rust, `serde_json::Value` comparison is fine; for TS, `expect(actual).toEqual(expected)`.

Changing a rule: edit `reference.py`, run it, review the vector diff, add a `docs/DECISIONS.md` entry, update the Rust and TS ports, all in one commit.
