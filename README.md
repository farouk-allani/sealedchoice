# SealedChoice

> Skeleton. Filled with real links, numbers and transaction hashes at task T15. Every `TODO(T15)` must be gone before the repository is made public.

**Sealed tenders on NEAR.** Suppliers' bids are encrypted to a key that exists only inside a TEE, so nobody (buyer, operator, other bidders) can read them before the deadline. After the deadline the tender contract has a pinned, published evaluator decrypt and score them once against a rubric fixed on-chain before bidding: code handles eligibility, price and ranking; three models on NEAR AI Cloud score the text criteria with verbatim quotes that code checks. A human committee awards on-chain, with a written rationale if it departs from the ranking, and the escrowed budget pays the winner.

Built for NEAR HACKATHON (Nov 2026). Tracks: TODO(T16, decided by the team).

## The problem

Whoever holds the bids in a tender can leak them, rules get adjusted after bids arrive, scoring is a black box for losing bidders, and payment is a separate slow process. DAOs and ecosystem teams run RFPs on forms and trust.

## Try it in 2 minutes (no install)

TODO(T15): numbered "do X → see Y" steps with real links:

1. Open the evaluated demo tender: TODO link → see the rubric (hash `…`), three sealed bids (ciphertext only), the ranking A 74.66 / B 59.55 / C 57.00 and C's flags.
2. Click **Verify** → see 10 checks pass, each linking to the transaction or record it used.
3. Open **Attacks** → see each manipulation attempt rejected, with its transaction hash.
4. Optional: bid on the open "try it" tender with a testnet wallet; after the next close, open **Debrief** to decrypt and check your own score.

## Run it locally

TODO(T15): prerequisites with versions; commands with expected output (`pnpm verify --tender <id>` → `10/10 PASS`).

## How it works

1. **Create**: the buyer publishes the rubric (criteria, weights, what each score means, models, award policy). The contract stores its hash; there is no method to change it. The TEE derives a per-tender public key. The budget is escrowed.
2. **Bid**: the bid is encrypted in the browser to the tender key. Only ciphertext goes on-chain, with a refundable bond.
3. **Evaluate**: after the deadline anyone can close. The contract freezes the bid set (Merkle root) and asks OutLayer to run the pinned evaluator once. Details: [docs/04-evaluator.md](docs/04-evaluator.md).
4. **Award and pay**: bidders decrypt their own debriefs, the committee decrypts the full report and awards on-chain, the winner accepts and is paid from escrow.

| Step | Decided by | Deterministic |
|---|---|---|
| Eligibility, price score, aggregation, ranking | code | yes |
| Text criteria (methodology, track record) | 3 models, scores 0–5 with quotes; code checks quotes and takes the median | recorded and signed, accepted once |
| Award | human committee, on-chain | rationale required to deviate |

## NEAR technologies used

TODO(T15): each with the file where it is used — OutLayer (TEE execution, secrets bound to the WASM hash), NEAR AI Cloud (private inference, signed responses, attestation), Rust smart contract (state machine, escrow), function-call keys, named sub-accounts, NEAR Intents 1Click (payout), NEP-141 / NEP-145 / NEP-297 / NEP-413.

## What it guarantees and what it does not

TODO(T15): from docs/07-threat-model.md. It shows the process was followed; it does not make a rubric fair, a supplier honest, a model wise or a committee right.

## Evidence from the demo run

TODO(T14/T15): contract account, tender ids, transaction hashes for each lifecycle step, OutLayer execution, evaluator WASM hash and reproducible-build instructions, bundle link, payout transaction.

## Tests

TODO(T15): how to run; table of invariants I1–I13 and evaluator test vectors with test names.

## Prior art

TODO(T15): Bicakci et al. arXiv:2604.25200, BlindProcure, HushBid, NEAR AI Agent Market, OutLayer private DAO example — and the difference.

## Limitations and next steps

TODO(T15)

## License

TODO(T16, decided by the team)
