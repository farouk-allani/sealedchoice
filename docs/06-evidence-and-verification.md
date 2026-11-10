# 06 — Evidence and verification

Goal: anyone can check the process, a bidder can check their own score end to end, and the committee can check everything, without trusting SealedChoice.

## What exists after a tender is evaluated

| Evidence | Where | Who can read |
|---|---|---|
| Rubric JSON + hash, evaluator ref (URL, WASM sha256, source tag), committee, deadline, bond | contract `get_tender` | everyone |
| Every bid's ciphertext, sha256, leaf, submit time | contract `get_bids`, `get_bid_ciphertext`, `get_frozen` | everyone |
| Every evaluation attempt and its outcome | contract `get_attempts`, events | everyone |
| Compact result (ranking, totals, flags, root, rubric hash, bundle hash) | contract `get_result` | everyone |
| OutLayer execution record + TEE attestation for each run | OutLayer explorer / API (verify how at G1) | everyone |
| Evidence bundle: per-bid public info, model call hashes, NEAR AI signatures, attestation reports, encrypted envelopes | bundle store `GET /api/bundles/<sha256>` | everyone |
| Debrief: own criterion scores, quotes, raw model request/response bytes | envelope in bundle, encrypted to the bidder | that bidder |
| Committee report: everything, including all proposals | one AES-256-GCM body in the bundle, its key ECIES-encrypted per member (D-024) | committee |
| Award, amount, rationale, deviation flag, approvals; payout tx | contract `get_award`, events, explorer | everyone |

## Public verification checklist (`pnpm verify --tender <id>` and the `/tenders/<id>/verify` page run the same code from `packages/verify`)

Each check prints PASS, FAIL or SKIP with the data it used. The three mean different things and must not be
collapsed: PASS is the evidence agreeing, FAIL is the evidence contradicting itself, and SKIP is this evidence
being unable to settle the question, which is not an accusation. A check that cannot reach a verdict reports
SKIP, never PASS and never FAIL (D-035). `pnpm verify` exits non-zero only on a FAIL; the page raises its alert
only on a FAIL.

1. **Rubric**: `sha256(rubric_json) == rubric_hash`, and `rubric_json` is canonical (`JCS(parse(rubric_json)) == rubric_json`).
2. **Rubric fixed before bidding**: the contract records `created_at_ns` (D-035), so this is a direct comparison
   against the first `submitted_at_ns`. A creation time after the first bid is a real contradiction and
   **FAILS**: a bid cannot predate the tender it was sealed against. The rubric is immutable after creation (I1)
   and the contract exposes no setter.

   **Fallback, for a tender made by a contract deployed before that field existed** (tenders 1 to 4 on
   `tenders.sealedchoice.testnet`): no indexer either, so this is derived
   from the rule `create_tender` enforces. A deadline may not be closer than `min_deadline_delay_ns`, so creation
   happened at or before `deadline - min_delay`; if the first `submitted_at_ns` is later than that bound, creation
   provably came first, and the rubric is immutable after it (I1, and the contract exposes no setter).
   **The bound only settles it when the first bid lands inside the last `min_delay` of the window.** A bid earlier
   than that leaves the bound short, and the check then reports **SKIP**, naming the shortfall and pointing at the
   creating transaction in an explorer. It is not a FAIL: the chain cannot show a rubric moved, and a red row that
   means "could not tell" teaches a reader to skim past the rows that mean something (D-035; tender 4 is the live
   example on the old contract, a 900 s window bid into after 55 s). Any tender made by the current contract takes
   the direct path above instead.
3. **Bid set**: recompute every leaf from on-chain ciphertexts and the Merkle root; equal to `frozen.root` and to `result.root`. Count equals the number of active bids at close.
4. **Evaluator artifact identity**: download the artifact at the tender's pinned `wasm_url` and compare its raw SHA-256 with the on-chain `wasm_sha256`. This implemented public check does not rebuild `source_tag` or independently verify the OutLayer hardware quote. Inspect the execution record separately. The bundle's own evaluator fields are informational input echoes, not an independent source. Frozen source tags remain local pending source publication; the artifact and release-build evidence are listed in the README.
5. **One result**: exactly one attempt `Accepted`; failures listed with reasons.
6. **Bundle integrity**: `sha256(JCS(bundle)) == result.bundle`; `bundle.result` equals the compact result minus `bundle`; `bundle.bids_root == root`; `bundle.rubric_hash == rubric_hash`.
7. **Model calls complete**: for every eligible bid, exactly one call per model in `rubric.models` (or a recorded error), with the model id as pinned.
8. **Signatures**: each `signature` verifies (ECDSA, EIP-191 personal-sign over `text`, recovered address == `signing_address`); the exact provider-TEE text is `<model>:<request_sha256>:<response_sha256>`, checked against the recorded fields.
9. **Attestation**: the signing addresses appear in the attestation reports in the bundle; the report nonce equals `sha256(bids_root || u32le(attempt))`, hex (`specs/test-vectors/evaluation-run.json`, D-024). Deep verification of the TDX/GPU quotes follows NEAR AI's documented verifier; link it, run it if practical.
10. **Ranking consistency**: eligible entries sorted by total descending; ineligible flagged entries last; unique indices and the frozen-set entry count. This public check does not recompute private totals, validate price/index tie-breaks or establish status/flags consistency.

## Bidder checks (`/tenders/<id>/debrief`, in the browser)

Before either the bidder or committee reader parses or decrypts a bundle,
it validates the accepted compact result and compares SHA-256 of the exact
fetched bytes to that result's `bundle` field. A missing/malformed result or
different digest refuses the open. An ETag or matching internal plaintext
hash cannot replace this check: anyone can encrypt a new envelope to a
registered public reader key. Encryption alone does not identify its author.
Both openers share this boundary (`packages/verify/src/bundle-commitment.ts`);
`report-open.test.ts` covers authentic opens and correctly encrypted replacements.

1. Re-derive the debrief key with the wallet (05-crypto-and-keys.md), decrypt the envelope, check `sha256(plaintext) == plaintext_sha256`.
2. My leaf is in the frozen set (Merkle proof against `root`).
3. For each of my raw model calls: `sha256(request bytes)` and `sha256(response bytes)` equal the signed hashes in the public bundle. My proposal text appears in the request.
4. Recompute my criterion scores from the raw responses with the scoring core (quote check, lower median) and my total. Equal to the published total.
5. Show my rank of N, my flags with plain-language explanations, and the "missing" notes.

## Committee checks (`/tenders/<id>/committee`)

Decrypt the report (key derived like the debrief one, purpose `committee`), then run the bidder checks for every bid and show all proposals, scores, quotes, flags and the recommended winner. The award form is on the same page.

## Bundle store

`apps/web` API route (`apps/web/src/app/api/bundles/[sha256]/route.ts`; rules in `apps/web/src/lib/bundles/handler.ts`).

- `PUT /api/bundles/<sha256>` with header `Authorization: Bearer <BUNDLE_STORE_TOKEN>`; body = JCS bytes, at most `MAX_BUNDLE_BYTES` (4 MiB, our limit; D-024 keeps bundles far below it; ⚠️ check against real bundles at T07). Server recomputes sha256, rejects mismatch, rejects overwrite of an existing different object (cannot happen with content addressing, check anyway), stores immutably. Answers: 201 stored; 200 the same bytes were already there (idempotent); 400 `E_BAD_HASH` (path not 64 lowercase hex), `E_EMPTY_BODY` or `E_HASH_MISMATCH`; 401 missing or wrong token (checked first, constant-time); 409 `E_CONFLICT` (different bytes under that hash); 413 `E_TOO_LARGE`; 503 when no backend or no token is configured (fails closed).
- `GET /api/bundles/<sha256>` public, `Content-Type: application/json`, `Cache-Control: public, max-age=31536000, immutable`, `ETag` = the hash. **A verifier must strip an optional `W/` prefix and the quotes before comparing** — the route sets a strong `"<hash>"`, but a CDN that compresses the body has to weaken it: measured on the Vercel deployment 2026-11-05, `W/"<hash>"` with `content-encoding: br`, and exactly `"<hash>"` with `accept-encoding: identity`. The route hashes the stored bytes again before serving them (500 `E_STORE_CORRUPT` otherwise); unknown hash → 404, not cached.
- Storage backend: Vercel Blob (D-021), behind a two-method interface (`get`, `putIfAbsent`); a filesystem driver serves tests and local development. Server-side env only: `BUNDLE_STORE_TOKEN`, `BUNDLE_STORE_BACKEND` (`local` | `vercel-blob`), `BUNDLE_STORE_DIR`, `BUNDLE_BLOB_ACCESS`, `BLOB_READ_WRITE_TOKEN`. Optional: also pin to IPFS and record the CID in the bundle store index (not in the hash).
- The store can withhold but cannot alter. Mention this limit in the README.
- **409 `E_CONFLICT` cannot be produced over HTTP**: `handleput` compares `sha256(body)` with the path before it calls the backend, so different bytes are always `400 E_HASH_MISMATCH` first. The 409 branch is defence in depth for a backend that returns different bytes under a hash, and is unit-tested rather than reachable from outside (verified against the deployment 2026-11-05).

## What a judge does in 2 minutes (goes into README)

1. Open the demo tender page → see status, rubric hash, 3 bids (ciphertext only), ranking.
2. Click "Verify" → see 10 checks pass with links to transactions and the OutLayer execution.
3. Open the attack page → see each manipulation attempt fail with its transaction hash.
4. Optional: submit a bid on the open "try it" tender with a testnet wallet, wait for the scheduled close, decrypt the debrief.
