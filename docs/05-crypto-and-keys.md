# 05 — Crypto and keys

Every rule here has a test vector in `specs/test-vectors/` produced by `specs/reference/reference.py` (and `make_ecies_vector.py` for ECIES). Rust and TS implementations must match them byte for byte.

## Canonical JSON (anything that is hashed)

RFC 8785 (JCS) restricted to: objects with ASCII keys, arrays, strings, integers, booleans, null. **No floats.** Amounts are decimal strings in minor units, scores are integers.

- TS: `canonicalize` npm package (RFC 8785 implementation) — verify version at T01.
- Rust: `serde_jcs` crate — verify at T02. If either misbehaves on our subset, write the 30-line serializer (sorted keys, `,`/`:` separators, serde_json string escaping) and test against the vectors.
- Check: `rubric_jcs_sha256` in `hashes-and-keys.json` = `16bd1b78…968b`.

## Bid-set Merkle tree

```
leaf   = sha256(0x00 || u32le(len(bidder_utf8)) || bidder_utf8 || u64le(submitted_at_ns) || sha256(ciphertext))
parent = sha256(0x01 || left || right)
```

Leaves in frozen order (submission time, then slot). An odd last node is promoted unchanged. Proof steps list the sibling and its side. The 0x00/0x01 prefixes separate leaves from inner nodes. Vectors: `merkle.json` (1, 2, 3 and 5 leaves, every proof).

The contract computes leaves and root with `env::sha256` at close. The evaluator recomputes them from the ciphertexts it receives and refuses to run if the root differs. The verifier recomputes them from chain state.

## Tender key (bid encryption)

- `MASTER_SECRET`: an OutLayer **PROTECTED_** secret, generated inside the TEE (type hex32), bound to the evaluator WASM hash, access condition = caller is the tender contract. Nobody, including us, ever sees it. Verify the exact setup at gate G1 and write the steps in `docs/references.md`.
- Per tender: `tender_sk = derive_secp256k1(ikm = MASTER_SECRET bytes, salt = "sealedchoice/tender-key/v1", info = "<contract_id>:<tender_id>")`, `tender_pk = compressed(tender_sk·G)`.
- `derive_secp256k1`: `k = HKDF-SHA256(ikm, salt, info || u8(ctr), 32)` for ctr = 0, 1, … until `1 ≤ k < n`.
- The WASM takes the calling contract from the OutLayer environment (**`NEAR_PREDECESSOR_ID`**) and asserts it equals the input's `contract_id`. Not `NEAR_SENDER_ID`: G1 measured that as the transaction **signer** (the buyer who calls `close_and_evaluate`), so a check against it would refuse every honest run and admit only a transaction signed by the contract account itself — the full-access-key case in `docs/07-threat-model.md`.
- The `derive_pubkey` action returns only the public key. No action ever returns a private key or plaintext.

Consequence of WASM-hash binding: a new evaluator build cannot read tenders created with an older build. During development that is fine (create new tenders). For the demo, freeze the build (tag `evaluator-v1.0.0`) before creating the demo tender. Record in DECISIONS.md D-006.

## ECIES (bids, debriefs, committee report)

eciesjs (TS) and the Rust `ecies` crate, default config, which must be identical on both sides:

- secp256k1, ephemeral public key **uncompressed** (65 bytes), HKDF-SHA256 key, AES-256-GCM with **16-byte nonce**.
- Wire: `ephemeral_pk(65) || nonce(16) || tag(16) || ciphertext`. Overhead 97 bytes.
- Vector: `ecies-decrypt.json` (ciphertexts made with eciespy 0.4.7; decrypt in Rust and TS, compare plaintext hash).
- Check `ecies` crate features for `wasm32-wasip2` (pure-Rust backend, no OpenSSL). Gate G2 proves TS-encrypt → WASM-decrypt inside OutLayer.

Plaintext of a bid = JCS bytes of the bid object (`specs/schemas/bid-plaintext.schema.json`). Salt: 16 random bytes hex, generated in the browser with `crypto.getRandomValues`.

## Reader keys (debrief and committee report)

Bidders and committee members need a secp256k1 key pair to receive encrypted results, without managing another secret. Default: derive it from a NEP-413 wallet signature.

1. Message (exact text, see `key_derivation_message` in reference.py):
   ```
   SealedChoice key derivation v1
   Contract: <contract_id>
   Tender: <tender_id>
   Purpose: debrief|committee
   This signature does not authorize any transaction.
   ```
2. `signMessage({ message, recipient: contract_id, nonce: sha256(message) })` (NEP-413). Use the raw 64-byte ed25519 signature.
3. `sk = derive_secp256k1(ikm = signature, salt = "sealedchoice/debrief-key/v1" or "sealedchoice/committee-key/v1", info = "<contract_id>:<tender_id>:<account_id>")`.
4. Register `compressed(sk·G)` with the bid (`debrief_pubkey`) or at tender creation (committee).

Ed25519 signatures are deterministic, so the same wallet re-derives the same key later. **Some wallets may not sign deterministically** (MPC or passkey wallets). At T09, test with the wallets we support: sign twice, compare. If a wallet is not deterministic, fall back to a random key the browser offers as a download (`sealedchoice-key-<tender>-<account>.json`) and warn the user to keep it.

Never send the reader private key anywhere. Decrypt in the browser.

## Libraries (verify current versions at T00/T01; do not trust these names blindly)

| Purpose | TS | Rust |
|---|---|---|
| secp256k1 | `@noble/secp256k1` or `@noble/curves` | `k256` |
| HKDF / SHA-256 | `@noble/hashes` | `hkdf`, `sha2` |
| ECIES | `eciesjs` | `ecies` (pure feature) |
| JCS | `canonicalize` | `serde_jcs` |
| ECDSA recover for NEAR AI signatures | `viem` or `ethers` (`verifyMessage`/`recoverMessageAddress`) | `k256` + keccak (only if verified in WASM; default is to verify off-chain) |
