---
title: Scoring, flags and model variability
description: The deterministic formulas, checked AI judgments and human award boundary.
---

The buyer publishes the scoring program as a rubric. The evaluator applies it to the frozen bid set. AI supplies text judgments; code validates and aggregates those judgments; the committee decides the award.

## The rubric

Weights total 10,000 basis points. A score of 8,666 basis points is displayed as **86.66**. Token amounts use integer minor units. Canonical JSON and SHA-256 commit the rubric before bidding.

The demo assigns 40% to price, 35% to methodology and 25% to track record. Qualitative criteria include questions, allowed source fields and anchors describing scores from 0 through 5.

## 1. Eligibility

Code validates decryption, schema, bidder identity and the rubric's eligibility conditions, including price and delivery bounds. Ineligible bids receive zero and appear after eligible bids. They are not sent to the models.

## 2. Price

```text
price_bp = floor(lowest_eligible_price * 10000 / bid_price)
```

The lowest eligible price receives 10,000. A bid priced at twice that amount receives 5,000. Structured prices are not included in the model request.

## 3. Text judgments

Each configured model returns integer scores from 0 to 5, supporting quotes, missing-evidence notes and rationales for the text criteria. The demo uses two models. Three-model rubrics are also accepted.

A score at or above the rubric's evidence threshold needs a matching quote of sufficient length in the relevant proposal text. The demo requires a normalized quote of at least 12 characters for scores of 2 or higher. Missing evidence clamps the score to at most 1. This checks that a quote exists, not that a supplier's claim is true.

## 4. Lower median

Code takes the lower median of valid outputs. With scores `[2, 5]`, it takes **2**. With `[2, 4, 5]`, it takes **4**. The combined text score is multiplied by 2,000 to express it in basis points.

With fewer than the rubric's minimum valid outputs, the criterion scores zero and the bid gets an incomplete-evaluation flag. API failures and retry policy distinguish an invalid answer from a service outage; see [contract attempts](./contract.md).

## 5. Total and ranking

```text
total_bp = floor(sum(weight_bp * criterion_bp) / 10000)
```

The sum is divided once using integer arithmetic. Eligible bids sort by total descending, then price ascending, then submission index ascending. Ineligible entries follow. These rules are implemented in Rust, TypeScript and the executable Python reference with shared vectors.

## Flags

| Flag | Value | Effect |
| --- | --- | --- |
| INELIGIBLE | 1 | Zero total; cannot receive an award |
| DECRYPT_FAILED | 2 | Ineligible; malformed bid bond can be forfeited |
| ACCOUNT_MISMATCH | 4 | Ineligible; malformed bid bond can be forfeited |
| INJECTION_SUSPECTED | 8 | Human review warning; no automatic score change |
| DISAGREEMENT | 16 | Models disagree; no automatic score change |
| EVIDENCE_MISSING | 32 | Quote validation clamped a model score |
| EVAL_INCOMPLETE | 64 | A criterion lacked enough valid outputs; needs committee review |

## Recorded does not mean repeatable

New model calls can produce different scores even with temperature zero and the same seed, rubric and proposal. Earlier measurements on the previous contract gave honest bid A **81.66 / 86.66 / 86.66**, and injection bid C **52.00 / 52.00 / 45.00**. C moved relative to the weak bid. See the [recorded runs](../evidence.md#model-variability).

A verifier recomputes the recorded judgment from stored model responses. It does not expect fresh inference to reproduce the same judgment.

## Human award

The committee may choose a lower-ranked eligible bid by recording a rationale. Model ranking is advisory to that decision. [Tender 2](https://sealedchoice.com/tenders/2/award) demonstrates this boundary with a paid award to B.
