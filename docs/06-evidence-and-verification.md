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
| Committee report: everything, including all proposals | envelope in bundle, encrypted per member | committee |
| Award, amount, rationale, deviation flag, approvals; payout tx | contract `get_award`, events, explorer | everyone |

## Public verification checklist (`pnpm verify --tender <id>` and the `/tenders/<id>/verify` page run the same code from `packages/verify`)

Each check prints PASS/FAIL with the data it used.

1. **Rubric**: `sha256(rubric_json) == rubric_hash`, and `rubric_json` is canonical (`JCS(parse(rubric_json)) == rubric_json`).
2. **Rubric fixed before bidding**: the `tender_created` event's block is earlier than the first `bid_submitted` block, and the contract source has no rubric setter (link to the code).
3. **Bid set**: recompute every leaf from on-chain ciphertexts and the Merkle root; equal to `frozen.root` and to `result.root`. Count equals the number of active bids at close.
4. **Evaluator identity**: the tender's pinned `wasm_sha256` equals the reproducible build of `source_tag` (instructions in README; the verifier links the GitHub tag and the hash). The OutLayer execution for this tender used that hash (link to the OutLayer record).
5. **One result**: exactly one attempt `Accepted`; failures listed with reasons.
6. **Bundle integrity**: `sha256(JCS(bundle)) == result.bundle`; `bundle.result` equals the compact result minus `bundle`; `bundle.bids_root == root`; `bundle.rubric_hash == rubric_hash`.
7. **Model calls complete**: for every eligible bid, exactly one call per model in `rubric.models` (or a recorded error), with the model id as pinned.
8. **Signatures**: each `signature` verifies (ECDSA, EIP-191 personal-sign over `text`, recovered address == `signing_address`); `text` contains the model id (for provider-TEE signatures) and the recorded `request_sha256:response_sha256`. Exact text format: verify at G3 and update this line.
9. **Attestation**: the signing addresses appear in the attestation reports in the bundle; the report nonce equals `sha256(bids_root || attempt)[0..32]`. Deep verification of the TDX/GPU quotes follows NEAR AI's documented verifier; link it, run it if practical.
10. **Ranking consistency**: eligible entries sorted by total desc; ineligible flagged entries last; status consistent with flags.

## Bidder checks (`/tenders/<id>/debrief`, in the browser)

1. Re-derive the debrief key with the wallet (05-crypto-and-keys.md), decrypt the envelope, check `sha256(plaintext) == plaintext_sha256`.
2. My leaf is in the frozen set (Merkle proof against `root`).
3. For each of my raw model calls: `sha256(request bytes)` and `sha256(response bytes)` equal the signed hashes in the public bundle. My proposal text appears in the request.
4. Recompute my criterion scores from the raw responses with the scoring core (quote check, lower median) and my total. Equal to the published total.
5. Show my rank of N, my flags with plain-language explanations, and the "missing" notes.

## Committee checks (`/tenders/<id>/committee`)

Decrypt the report (key derived like the debrief one, purpose `committee`), then run the bidder checks for every bid and show all proposals, scores, quotes, flags and the recommended winner. The award form is on the same page.

## Bundle store

`apps/web` API route.

- `PUT /api/bundles/<sha256>` with header `Authorization: Bearer <BUNDLE_STORE_TOKEN>`; body = JCS bytes. Server recomputes sha256, rejects mismatch, rejects overwrite of an existing different object (cannot happen with content addressing, check anyway), stores immutably.
- `GET /api/bundles/<sha256>` public, `Cache-Control: immutable`.
- Storage backend: decide at T06 (Vercel Blob, Cloudflare R2 or S3). Optional: also pin to IPFS and record the CID in the bundle store index (not in the hash).
- The store can withhold but cannot alter. Mention this limit in the README.

## What a judge does in 2 minutes (goes into README)

1. Open the demo tender page → see status, rubric hash, 3 bids (ciphertext only), ranking.
2. Click "Verify" → see 10 checks pass with links to transactions and the OutLayer execution.
3. Open the attack page → see each manipulation attempt fail with its transaction hash.
4. Optional: submit a bid on the open "try it" tender with a testnet wallet, wait for the scheduled close, decrypt the debrief.
