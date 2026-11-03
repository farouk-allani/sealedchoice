# 07 — Threat model

Format: attacker → what they try → what stops it → what is left (honest residual risk). The "Demo" column marks attacks the demo shows failing on testnet with a transaction hash (T12).

## Before the deadline (confidentiality)

| Attacker | Attempt | Defence | Residual | Demo |
|---|---|---|---|---|
| Buyer / operator | Read bids early by calling OutLayer with our WASM | Secrets released only when the caller is the tender contract (access condition) and only to the pinned WASM hash; the WASM has no "decrypt and return" action | Trust in OutLayer's TEE and secret-release logic | ✅ direct `request_execution` from a non-contract account: secret not available |
| Operator | Deploy a different evaluator that leaks | Tender pins `wasm_sha256` at creation; secrets are bound to the hash, a different build gets nothing | Pinned build must be the published source: reproducible build check | ✅ evaluator with a different hash cannot derive the tender key |
| Operator | Redeploy the tender contract with a function that triggers evaluation early, or sign a `request_execution` to OutLayer as the contract account (the secrets' caller rule then passes) with a chosen input, such as its own committee key | **Real risk while the contract account has a full-access key.** Mitigation for the demo: deploy the final contract on a fresh account and delete its full-access keys (locked contract), with the tx in the README | If not locked, this is the biggest trust assumption; say so | — |
| Anyone | Call `close_and_evaluate` before the deadline | Contract time check | — | ✅ |
| Bidder | Copy a competitor's ciphertext and submit it | Contract rejects a ciphertext hash already seen in the tender; second layer: plaintext contains `bidder`, mismatch → ACCOUNT_MISMATCH, ineligible, bond forfeited | Copier learns nothing (cannot decrypt) | ✅ |
| Network observer | Infer bids from size or timing | Ciphertext lengths vary with text; bidder accounts and times are public | Who bid and when is public. Padding to a fixed size is a cheap improvement (stretch) | — |

## At close and evaluation (integrity)

| Attacker | Attempt | Defence | Residual | Demo |
|---|---|---|---|---|
| Buyer | Change rubric or weights after seeing who bid | No setter; rubric hash checked by evaluator and verifier | — | ✅ `update_rubric` does not exist |
| Buyer / operator | Add, drop or swap a bid | Contract freezes the set and root; evaluator recomputes root; result must echo the root | — | ✅ crafted result with a different root rejected |
| Operator | Rerun until the ranking is favourable | Only the contract can start a run; one accepted result; max 2 retries after failures, all recorded | An operator who controls the bundle store could force failures (e.g. reject uploads) to get a retry. Retries are visible and capped; model outputs at temperature 0 are mostly stable | ✅ second result rejected |
| Operator | Forge a result | Callback is `#[private]` and only accepts the attempt the contract started; result comes from OutLayer's promise | Trust in OutLayer delivering the WASM's real output | ✅ direct `on_evaluate` call fails |
| Bidder | Prompt injection in the proposal | Delimited data with a per-bid boundary; instructions in the system prompt; JSON-only output; quote check; lower median of 3 model families; injection flag for the committee | Correlated failures across all three models; subtle persuasion that is not an "instruction" | ✅ bid C (test vector) |
| Bidder | Exaggerated or false claims | Scored as claims; "missing" notes; committee reviews | Not solved by technology | — |
| Model / NEAR AI | Wrong model served, response altered | `x-no-aliasing`, signed request/response hashes, attestation report with nonce | Trust in NEAR AI's TEE attestation chain | — |

## After evaluation (award and money)

| Attacker | Attempt | Defence | Residual | Demo |
|---|---|---|---|---|
| Committee | Award a favourite against the ranking | Allowed, by design (humans decide); deviation flag and written rationale on-chain; approvals threshold | Humans can still choose badly; it is visible | ✅ deviation without rationale rejected |
| Committee | Award an ineligible bid | Contract checks flags in the stored result | — | ✅ |
| Anyone | Redirect the payout | Only the awarded bidder can set the payout target; contract pays only that target; 1Click quote must echo recipient and amount | Trust in the 1Click service for cross-chain delivery | ✅ `accept_award` from another account rejected |
| Buyer | Withdraw escrow after bidding | Escrow can only go to the winner or back to the buyer through cancel (before deadline), no-award decision (committee) or remainder after payout | — | — |
| Bidder | Spam bids | Bond + storage per bid, `MAX_BIDS` | A rich spammer can fill slots; raise bond per tender | — |
| Bidder | Hold the 5 slots and withdraw just before the deadline, so others cannot bid | Each held slot costs its storage (not refunded on withdrawal) and the bond is locked until withdrawal | `withdraw_bid` refunds the whole bond, so five accounts can block a tender for the cost of storage. Partial forfeit on withdrawal or more slots after G1/G3 are possible fixes; not done | — |

## Things outside the system

Collusion between bidders, bribes paid off-chain, a biased rubric, a committee that is captured. SealedChoice makes the process visible; it cannot make people honest. Say this plainly in the README.

## Privacy of the outcome

Public after evaluation: who bid, when, ranks, totals, flags, the award amount and the payout transaction. Not public: proposal texts, prices of losing bids, per-criterion scores. Note: a bidder's debrief includes their own price score, from which they can compute the lowest eligible price. That is similar to publishing the lowest price in a public award notice; document it, do not hide it.

The bundle publishes `request_sha256` for every model call, and a request is built only from public parts (the templates, the rubric, a boundary derived from the public root) plus the proposal. So anyone who guesses a proposal's exact text can confirm the guess against that hash. Proposals are long free text, so this only matters for a near-exact guess.

A bad reader key (a `debrief_pubkey` or committee key that is not a point on secp256k1) does not stop an evaluation. That envelope is published empty with `E_READER_KEY`, and the run goes on (D-024). Otherwise a bidder, or the buyer through a committee key, could make every attempt fail and end the tender as `Failed`.
