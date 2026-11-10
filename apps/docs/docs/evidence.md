---
title: Recorded demo evidence
description: Real tender outcomes, transaction receipts, evaluator artifacts and measured attack results.
---

These records were captured on **November 10, 2026**, on NEAR **testnet**. The final contract is `tenders-v1.sealedchoice.testnet`. Amounts are tUSDC, a test token with six decimals, issued by `usdc.sealedchoice.testnet`.

## Demo 1: top-ranked bid awarded

Open [tender 1](https://sealedchoice.com/tenders/1), its [verifier](https://sealedchoice.com/tenders/1/verify) and [paid award](https://sealedchoice.com/tenders/1/award).

| Stage | Recorded evidence |
| --- | --- |
| Create and derive key | [Creation transaction](https://testnet.nearblocks.io/txns/9wj99pY4tgb439B8VJzHLi18XjwY4iwD5TVjSvQKpXKn), [OutLayer 15039](https://outlayer.ai/requests/15039) |
| Fund 15,000 tUSDC | [Funding transaction](https://testnet.nearblocks.io/txns/FX9JxaM5Yz6jgKLyWZEDUvJg4zSctiNUhMiHKe1R87mX) |
| Bid A | [Submission](https://testnet.nearblocks.io/txns/4H5xVJZ7Yz7jM5ejyfA5JoLuVC8bdMPxzL7tit7BRwqR) |
| Bid B | [Submission](https://testnet.nearblocks.io/txns/3S4BXGW3pH7NwQ4Uorz2fgQS5bwXSYbiYy9Z9TDLLHav) |
| Bid C | [Submission](https://testnet.nearblocks.io/txns/CaHYK4dpFvY14MV9C4H93BuoKy8AWb4iZyETee2Jp2iW) |
| Close, attempt 1 | [Close transaction](https://testnet.nearblocks.io/txns/6SBTFG5pbkV2FR1XXVvnWoKgRFkRTQYsin9bnZUY7fne), [OutLayer 15056](https://outlayer.ai/requests/15056), failed model availability |
| Retry, accepted attempt 2 | [Retry transaction](https://testnet.nearblocks.io/txns/VmVCu2p6SnakYxvCcGHcF2qjeMwtsexY8Tp4W96Yrac), [OutLayer 15517](https://outlayer.ai/requests/15517), 35,095 ms |
| Ranking | A 86.66, C 52.00 with injection flag, B 47.55; all eligible |
| Award A, 12,000 tUSDC | [Award transaction](https://testnet.nearblocks.io/txns/F6GLGTEr578fMvXyaCVp6HXxTFncAWiETisudZC1cxMN) |
| Acceptance and payment | [Payment transaction](https://testnet.nearblocks.io/txns/8ZMMLktGoLx3zAiR3GSCYazdMutHYbFvueWc2zEqwPnG), winner `vendor-a.sealedchoice.testnet`, 3,000 tUSDC remainder to buyer |

The [accepted public bundle](https://sealedchoice-lab.vercel.app/api/bundles/b51e5e927d344ac456054e979fd4e82bb132571e0b91665b39e2aeec54d518a7) contains 817,201 bytes. Its SHA-256 is:

```text
b51e5e927d344ac456054e979fd4e82bb132571e0b91665b39e2aeec54d518a7
```

The compact on-chain result is 309 bytes. The six recorded model calls have provider-TEE signatures. The after-payment public verification passed 10/10, with no skips.

## Demo 2: a recorded committee deviation

Open [tender 2](https://sealedchoice.com/tenders/2), its [verifier](https://sealedchoice.com/tenders/2/verify) and [paid award](https://sealedchoice.com/tenders/2/award).

| Stage | Recorded evidence |
| --- | --- |
| Create | [Creation transaction](https://testnet.nearblocks.io/txns/4JcwbkSnCjK2cGcTr8WYgLc7vNy4Ni7Gkqq4mStym5Ah) |
| Fund | [Funding transaction](https://testnet.nearblocks.io/txns/EbNZb6kxD5nkCPTTopeWziwwcMtd5xA6MyJWQFc9fJ3m) |
| Bid A | [Submission](https://testnet.nearblocks.io/txns/EFDAfJKkpszLwXxdw65Gm5fudy3D7PGWPt6V7HUC33bY) |
| Bid B | [Submission](https://testnet.nearblocks.io/txns/2U5X3nitaxnXedXoanScj8yx86xm6emtntv5sBCZdoE8) |
| Bid C | [Submission](https://testnet.nearblocks.io/txns/66rDww3XKQZgMrWo77insLXj7B9AcqSkF67zYwy7VDen) |
| Accepted attempt 1 | [Close transaction](https://testnet.nearblocks.io/txns/F2tqqFPLNmFgcEkv8oEnySK9mKjm3XCLPvCFCSUnTtyy), [OutLayer 15566](https://outlayer.ai/requests/15566), 35,316 ms |
| Ranking | A 81.66, B 47.55, C 45.00; C flagged |
| Award lower-ranked B | [Award transaction](https://testnet.nearblocks.io/txns/4LkAknhPVghNU4ySXwKPGHKNWeK2WMa4ssn42retuGXX), deviation recorded |
| Pay 9,000 tUSDC to B | [Acceptance and payout](https://testnet.nearblocks.io/txns/7EVG9uV34qn7WGwjY4rXyzvTMDgUvzT66TiLZL78CmFG), 6,000 tUSDC remainder to buyer |

The committee's recorded rationale is: “Demo deviation: the committee chooses the lower-priced 14-day proposal despite its lower model score; the decision and reason are recorded for review.”

The [accepted bundle](https://sealedchoice-lab.vercel.app/api/bundles/5f34d4361c46fef68ca71995ef876ce55688a354307c3c823723260466bfe8f8) contains 772,407 bytes. After-payment verification passed 10/10, with no skips.

## Attack records

[Tender 3](https://sealedchoice.com/tenders/3) is the dedicated attack tender. Its [public verifier](https://sealedchoice.com/tenders/3/verify) passed 10/10 after payment. The [attack page](https://sealedchoice.com/attacks) and the table below use the same recorded dataset, `apps/web/src/data/attacks.json`.

<!-- attack-table:start -->
| Attempt | Recorded outcome | Testnet evidence |
| --- | --- | --- |
| 1. Read bids through a direct request | Access denied | [Transaction](https://testnet.nearblocks.io/txns/HSuJU5SMZQiedf3FB1NMCWDtFpLs5YMoQpuSwmAuuVGn), [OutLayer 15559](https://outlayer.ai/requests/15559) |
| 3. Change the published rubric | MethodNotFound | [Transaction](https://testnet.nearblocks.io/txns/95r9z2AuNW33Q7iVDvxbHnzy2PGcUt35mvz84jCtsN25) |
| 4. Close before the deadline | E_DEADLINE_NOT_REACHED | [Transaction](https://testnet.nearblocks.io/txns/9S3aYuJUW76mk913wy5wXo8XhFmzVxPfDxUnZN6LB58B) |
| 5. Copy a sealed bid | E_DUPLICATE_CIPHERTEXT | [Transaction](https://testnet.nearblocks.io/txns/9xR5rfo8Ua7x8cjhAG72zBNMAwrFxXGA6sDaVgacAMEL) |
| 6. Deliver a fake evaluation | Private callback | [Transaction](https://testnet.nearblocks.io/txns/J5pa7f8ykjMHmT2GPz7wdZqDAFTXGPDcPvTfkMFDWFcF) |
| 7. Evaluate a second time | E_BAD_STATUS | [Transaction](https://testnet.nearblocks.io/txns/F5nAoEsWQHeNpsViRhkqaKjRE9w2ZZ6uLRa17gnpJPy8) |
| 8. Award as an outsider | E_NOT_COMMITTEE | [Transaction](https://testnet.nearblocks.io/txns/J4nRsu49sZqYQZJ95BeXPxjTuzGTi3ZweKSBLDgmANEE) |
| 9. Deviate without a rationale | E_RATIONALE_REQUIRED | [Transaction](https://testnet.nearblocks.io/txns/4N7pLkDmwhUHQXSjgNydi8x5fbippeoWB2axR6DaGcqh) |
| 10. Accept and redirect another bidder's award | E_NOT_WINNER | [Transaction](https://testnet.nearblocks.io/txns/3fBhz7ds8ebGNpKZ4xCW9uZroYJKyo9zzectH9mtDNXo) |
| 11. Inject instructions into a proposal | INJECTION_SUSPECTED | [Transaction](https://testnet.nearblocks.io/txns/E1uqsogvgd3wKYK3Hhtm4eBEzfMRRh4NinKTFYwbaW5N), [OutLayer 15568](https://outlayer.ai/requests/15568) |
<!-- attack-table:end -->

The direct request was refused before guest execution, with zero guest instructions. The injection bid was flagged during scoring, rather than rejected. The experiment does not establish universal resistance to prompt injection.

## Frozen artifacts

| Artifact | SHA-256 |
| --- | --- |
| Frozen contract WASM | `21e94da15087a942debeaa547bf5e5caaec4a4dc0a669e07e7af0e78b762b307` |
| Frozen evaluator WASM | `737b91e724b25facefce9d9e53655bd18e3a4070c857af54f88f0e7b5f18d470` |

The evaluator is available from the [immutable artifact commit](https://raw.githubusercontent.com/farouk-allani/sealedchoice-artifacts/392c47bc342dc818d0676f32d71ff63239ab1e0d/evaluator/evaluator-v1.0.0-737b91e7.wasm). The [contract account](https://testnet.nearblocks.io/address/tenders-v1.sealedchoice.testnet) reports deployed NEAR code hash `3HNnjqgBrxMXhJnmBk2vxHax2iFDrFzp94vVAdXEtGuU`.

The release was compared with clean pinned-image builds. Frozen source references `contract-v1.0.0` and `evaluator-v1.0.0` remain local pending source publication. Do not confuse a successful artifact download/hash check with independently rebuilding that source. See [development and build boundaries](./developers.md#builds-and-frozen-artifacts).

The contract and secret-owner keys remain retained. See [deployment trust assumptions](./security.md#operator-powers-that-remain).

## Model variability

These earlier measurements belong to the previous contract, `tenders.sealedchoice.testnet`:

| Earlier tender | Bid A | Bid C |
| --- | --- | --- |
| 1, [OutLayer 9603](https://outlayer.ai/requests/9603) | 81.66 | 52.00 |
| 2, [OutLayer 9605](https://outlayer.ai/requests/9605) | 86.66 | 52.00 |
| 3, recorded prior-run dataset | 86.66 | 45.00 |

The same rubric and proposals produced different model judgments despite temperature zero and the same seed. The scoring rules were deterministic for the recorded outputs. These historical tender IDs must not be mixed with the final contract's tenders 1, 2 and 3.
