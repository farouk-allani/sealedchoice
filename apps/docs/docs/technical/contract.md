---
title: Contract lifecycle and reference
description: States, public view methods and invariant boundaries in the deployed tender contract.
---

The Rust contract lives in `contracts/tender`. The current demonstration uses `tenders-v1.sealedchoice.testnet` and the test token `usdc.sealedchoice.testnet` with six decimals.

## Main lifecycle

```text
PendingKey -> AwaitingFunds -> Open -> Evaluating -> Evaluated
Evaluated -> Awarded -> PayingOut -> Paid
```

The evaluator key must arrive before funding opens bidding. After the deadline, closing freezes the bid set. The evaluation callback must match the tender, frozen root, rubric and current attempt before it can be accepted.

## Other outcomes

| Outcome | Meaning |
| --- | --- |
| Cancelled | Buyer cancelled under the state/deadline rules; PendingKey and AwaitingFunds may also cancel after the deadline |
| NoBids | Closing found no active bids |
| EvalFailed | An attempt failed; a delayed retry may remain |
| Failed | The final allowed evaluation attempt failed; refund rules apply |
| ClosedNoAward | Committee closed without an award and recorded a reason |
| Lapsed award | Acceptance window expired; that bid is excluded from later awards |

The ordinary evaluation policy permits at most three attempts. It accepts only one result. A failure is not an accepted result. Tender 1 demonstrates a model outage on attempt 1 followed by acceptance on attempt 2.

## Read methods

| Method | Use |
| --- | --- |
| `get_config`, `get_evaluators` | Deployment configuration and available evaluator references |
| `get_tender` | Published configuration and current state |
| `list_tenders` | Paginated directory, with a maximum limit of 50 |
| `get_bids`, `get_bid_ciphertext` | Bid metadata and public ciphertext |
| `get_frozen` | Ordered active set and its root |
| `get_attempts`, `get_result` | Attempt history and accepted compact result |
| `get_award` | Committee decision, approvals and payout state |
| `get_balance` | Contract-accounted balance for an account |

Consult `contracts/tender/README.md` in the supplied source for exact argument shapes, attached deposits, state guards and error codes. Timestamps are nanosecond strings and amounts are integer strings; do not parse them as JavaScript floating-point token amounts.

## Signing actions

Creation, funding, bidding, withdrawal, closing, retries, award approvals and acceptance are transactions. Use the app's role and state checks before signing. A private callback cannot be invoked successfully by an unrelated account.

Funding uses NEP-141 `ft_transfer_call`, with the contract enforcing the configured token, buyer and exact escrow amount. Successful winner payment and bond settlement are recorded once. A failed transfer has a retry/accounting path; it does not authorize a second successful payment.

## Invariants

| IDs | Boundary |
| --- | --- |
| I1 | Tender configuration remains fixed |
| I2, I3 | No bids at/after deadline; no early evaluation |
| I4 | Frozen bid set matches the committed root |
| I5, I6, I7 | One accepted result, private callback and matching commitments |
| I8 | Committee authorization, eligibility and deviation rationale |
| I9, I10 | Award payment and bond settlement at most once |
| I11 | Correct escrow token, sender and exact amount |
| I12 | Capped and recorded attempts |
| I13 | No duplicate ciphertext |
| I14 | Creation rejects rubrics the pinned evaluator cannot accept |
| I15 | Reader and tender keys are valid secp256k1 points |

The source tests exercise these constraints. Code cannot be replaced on the deployed account: it has had no access keys since 2026-11-12 ([transaction](https://testnet.nearblocks.io/txns/7DcmnScDaQLMJTcviw5u9FdjZhKK1snpREJ2nX5VT1NP)). The secret owner's remaining power is described in [security](../security.md).
