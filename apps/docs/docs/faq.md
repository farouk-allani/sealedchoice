---
title: Common questions
description: Wallet access, testnet tokens, privacy, evaluation and the current demo scope.
---

## Do I need a wallet to try the demo?

No. Browse tenders, rankings, verification, attacks and paid awards without connecting one. Signing is required for transactions and for opening a registered reader's private report.

## Can I bid on the demo tenders?

The three current demos are completed. They cannot accept new bids. A new funded tender can accept bids before its own deadline, subject to the five-active-bid limit.

## Is this using real USDC?

The demonstration uses `usdc.sealedchoice.testnet`, displayed as tUSDC. It has six decimals and no mainnet value. It is not mainnet USDC.

## Does AI choose the winner?

Models judge text criteria. Code checks quotes, computes eligibility and price scores, combines the recorded outputs and ranks bids. The committee makes the award, and must explain a deviation from the recommendation.

## Does an injection flag disqualify a bid?

No. It warns the committee. Ineligibility is determined by separate rules. The recorded injection bid remained eligible and ranked second in tender 1.

## Does 10/10 mean everything is independently proven?

It means the ten implemented public checks pass for the fetched evidence. It is not a full hardware-attestation audit, source-reproducibility proof or assessment of proposal truth. Private score verification requires an authorized report. See [the check boundaries](./technical/verification.md).

## Why might a later model run produce different scores?

Inference is not guaranteed to repeat exactly. Verification uses the recorded response bytes and signatures, so reviewers can recompute how that accepted judgment became a score. The demo publishes measured examples of [model variability](./evidence.md#model-variability).

## Can the operator read bids early?

The configured caller and build rules restrict normal secret access to the evaluator's intended flow. However, retained contract-account and secret-owner keys create powers to change that flow. Both are retained in this demo. Read [security and limits](./security.md).

## Can I pay a winner on another chain?

The current recorded payments transfer tUSDC on NEAR testnet. The optional NEAR Intents 1Click demonstration is deferred, and there is no demonstrated live cross-chain payout in this release. The documentation does not present planned integration as a completed payment feature.

## Why can't my wallet open a debrief?

Only the registered bidder or committee reader can derive the expected report key. Use the original account and signing key. An unrelated wallet, a changed signing key or an unavailable bundle can prevent opening. Never share a private key to troubleshoot access.

## What happens after the hackathon?

Potential next steps include external security review, improved availability, reducing retained operator powers, production payment validation and testing procurement with an actual buyer. These are future work. The first target users are small DAOs and ecosystem teams purchasing digital services.
