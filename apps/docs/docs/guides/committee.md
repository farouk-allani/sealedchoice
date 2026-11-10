---
title: Review, award and pay
description: Open the private committee report and record a human award decision on NEAR.
---

The committee makes the award. The evaluation supplies a recorded recommendation and the evidence behind it.

## Open the private report

Connect an account registered as a committee member when the tender was created. Open **Committee** from the tender and sign its reader-key message. The app verifies the accepted bundle hash, decrypts the report key for your account, and opens the report locally.

The committee report contains all proposals, prices, criterion scores, quotes, model request and response bytes, flags and the recommended ranking. This is privileged access to every bid. Treat the report as confidential.

A public visitor can inspect the aggregate ranking and award, but cannot open this report. A different wallet signing key may derive a different reader key even for the same account.

## Review the evidence

Read the rubric and the proposals alongside the scores. Inspect flags and missing-evidence notes. Check disagreement and incomplete results instead of interpreting the total as a guarantee of proposal quality.

The models never make the award. The deterministic scoring code also does not validate whether a supplier's claims are true or whether its team can deliver.

## Propose an award

Select an eligible, non-lapsed bid. Confirm the amount and the rationale. A choice that deviates from the recommended eligible ranking requires a written explanation. The configured committee approval threshold must be reached before the tender is **Awarded**.

The deployed demo uses one approver. The contract supports threshold approvals, but that is distinct from demonstrating a multi-member approval flow.

## Compare the recorded decisions

| Recorded tender | Decision | Payout |
| --- | --- | --- |
| [Tender 1](https://sealedchoice.com/tenders/1/award) | Award the top eligible bid, A | 12,000 tUSDC |
| [Tender 2](https://sealedchoice.com/tenders/2/award) | Choose lower-ranked B with a published rationale | 9,000 tUSDC |

![Tender 2 records the committee's deviation separately from the completed payment.](/img/deviation.png)

The second decision explicitly selects the lower-priced, 14-day proposal despite its lower model score. That explanation is stored on-chain and visible on the award page.

## Acceptance and payment

Only the awarded bidder can accept and set its payout target. Acceptance starts the transfer from escrow. A failed token transfer is recorded and can be retried through the contract's payout flow; a pending transaction must not be treated as a completed payment.

Successful winner payment marks the tender **Paid** and starts a separate unused-budget refund to the buyer. That refund can fail and require `retry_escrow_refund`; Paid confirms the winner's transfer rather than guaranteeing the separate refund completed. In the recorded examples, award 1 returned 3,000 tUSDC from a 15,000 tUSDC budget and award 2 returned 6,000 tUSDC. See [transaction evidence](../evidence.md).

If the winner does not accept in time, the award can lapse and that bid cannot be awarded again. The committee can also close without an award through the contract with a recorded reason. These are lifecycle capabilities; the two payment examples above demonstrate the successful acceptance path.
