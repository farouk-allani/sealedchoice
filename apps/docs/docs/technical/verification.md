---
title: Verify the public record
description: What the ten public checks establish, what requires a private reader and how to interpret skipped checks.
---

The browser verifier and command-line verifier use the same `packages/verify` implementation. Anyone can run the public checks without a wallet or secret.

## Open the verifier

Use [Verify tender 1](https://sealedchoice.com/tenders/1/verify), or run from the source checkout:

```bash
pnpm verify --tender 1 --network testnet --contract tenders-v1.sealedchoice.testnet
```

The recorded final demos each passed **10/10**, with zero failures and zero skips. Internet access is required to fetch chain state, the bundle and the pinned evaluator artifact.

## The ten checks

| Check | What is compared |
| --- | --- |
| 1. Rubric | Canonical rubric bytes against the published hash |
| 2. Publication time | Tender creation timestamp against bid submission time |
| 3. Frozen set | Ciphertext hashes, leaves and Merkle root against the frozen set and result |
| 4. Evaluator artifact | Downloaded WASM bytes against the tender's pinned SHA-256 |
| 5. Accepted result | Exactly one accepted evaluation attempt |
| 6. Bundle integrity | Exact bundle bytes against the accepted on-chain hash, plus internal result bindings |
| 7. Model coverage | Each eligible bid's configured model calls or recorded errors |
| 8. Model signatures | EIP-191 signature recovery and binding to model request/response hashes |
| 9. Attestation fields | Recorded signing addresses and nonce against the run's commitments |
| 10. Ranking | Non-increasing public totals, eligible entries before ineligible entries, unique indices and frozen-set entry count |

## PASS, FAIL and Not checked

**PASS** means the evidence examined agrees. **FAIL** means it contradicts the checked constraint. **Not checked** or **SKIP** means the available evidence cannot establish a verdict.

The CLI exits non-zero for failures or a loading error. A skipped check alone does not make its exit code non-zero. For a strict review, inspect the totals and require `passed: 10`, `failed: 0`, `skipped: 0`; `--json` provides these fields. `--no-artifact` deliberately skips the artifact download, so it is not a full verification.

## What these checks do not prove

- They do not establish that a newly rebuilt source tree produces the pinned WASM. That needs a separate reproducible-build comparison.
- Attestation-field consistency and signature recovery do not implement complete Intel TDX or GPU certificate-chain verification.
- Public hashes do not let an unrelated visitor read a model conversation or recalculate every private criterion score.
- The public ranking check does not recompute private totals, enforce the price/index tie-breaks or establish that the result status matches its flags. Deeper score and tie-break checks require the private report.
- A valid ranking does not establish that the rubric is appropriate, that supplier claims are true or that a model's judgment is good.
- These checks do not remove the secret owner's remaining power described in [security](../security.md).

## Private reader verification

A bidder can open its debrief; a committee member can open the full report. The browser first verifies the accepted result and raw bundle hash. It then decrypts the appropriate envelope and checks the plaintext hash, signed request/response hashes and recomputed criterion scores and total.

Only those readers have the raw text and model conversations required for that deeper check. The signed hashes publicly commit the bytes without exposing them.

## Troubleshooting

An RPC outage or unavailable bundle can prevent verification. Retry later and read the specific row's explanation. An unavailable bundle is a real availability limit. Do not substitute an example fixture for a failed live check.

For a historical tender, specify the contract it belongs to. The same tender number on another contract is a different record.
