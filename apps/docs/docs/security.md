---
title: Security, privacy and limits
description: The protection boundaries, remaining operator powers and limitations of the SealedChoice testnet prototype.
---

SealedChoice records a constrained procurement process. Its protection depends on the deployed contract, evaluator and secret-release configuration, the TEE services and the browser code a participant uses.

## Current deployment status

The final demo is on NEAR **testnet**, with test tokens and static completed tenders. The contract account `tenders-v1.sealedchoice.testnet` has **no access keys**: its only full-access key was deleted on 2026-11-12 ([transaction](https://testnet.nearblocks.io/txns/7DcmnScDaQLMJTcviw5u9FdjZhKK1snpREJ2nX5VT1NP)). The OutLayer secret-row owner, `sealedchoice.testnet`, **keeps its full-access key**.

The published frozen contract and evaluator artifacts were compared in clean release builds. Frozen source tags are published with the public repository. The private working repository is not a public source release. Artifact identity, source reproducibility and source publication are separate facts.

## Operator powers that remain

With no access keys, the contract account cannot have its code replaced, and nobody can sign a call as the contract, including an OutLayer request that the secret's caller rule would accept. The secret-row owner can still change the secret's build binding and caller rule. That power could make a different build, or a different caller, read bids.

The tender's on-chain evaluator pin and public evidence help reviewers inspect the recorded process. They do not remove the secret owner's power. That account was not locked because it is the team's main account and also the contract owner, whose only contract power is registering evaluator builds for new tenders.

## Protection in the current code

| Attempt | Enforced boundary |
| --- | --- |
| Submit after deadline | Contract checks block time |
| Edit published criteria | No setter for the fixed rubric or other fixed configuration |
| Substitute the accepted bid set | Frozen Merkle root, recomputed by evaluator and verifier |
| Forge a callback | Private callback plus tender/root/rubric/attempt checks |
| Accept another result | State guards and capped, recorded attempts |
| Award an ineligible bid | Eligibility guard |
| Deviate without a reason | Committee rationale requirement |
| Redirect another winner's payment | Only the awarded bidder may accept and select its target |
| Replace the evidence bundle | SHA-256 compared with the accepted on-chain hash before decryption |

These code rules are supported by invariant tests and the [recorded attack transactions](./evidence.md#attack-records). A public demo is evidence of specific outcomes, not an exhaustive audit.

## Privacy boundaries

Bid plaintext is encrypted in the supplier's browser. The intended evaluator opens it inside OutLayer after closing. The bidder can later read its own debrief; the committee can read every proposal in its report.

Participation, timestamps, ciphertext lengths, ranking, flags, award amount and payout are public. Losing bid prices are encrypted, but a bidder may infer the lowest eligible price from its own price score. Published model request hashes allow confirmation of a near-exact guess at a proposal's text.

The structured price is excluded from model prompts. A supplier can still disclose a price by writing it in prose. Browser compromise, a malicious delivered frontend or a lost wallet signing key can defeat the reader's own confidentiality or access.

## Model and injection limits

Quote checks confirm that supporting text exists. They do not verify that the text is true. Models may share correlated errors, miss subtle persuasion or produce different scores on a later call.

The measured injection bid was flagged and remained eligible. In tender 1 it ranked second at 52.00. The flag itself did not reduce its score. Do not interpret detection as a guarantee that an adversarial proposal cannot influence a model.

## Availability and retry limits

The bundle store can withhold evidence. RPC services, OutLayer and model APIs can fail or change availability. The contract records failed attempts and caps retries at three; a later attempt can produce a different judgment. A single accepted result does not mean there was only one execution attempt.

The current five-bid limit also permits slot exhaustion by funded accounts. Bid bonds and storage costs raise the cost of spam without eliminating it.

## Attestation boundary

The verifier checks signatures and recorded attestation fields, including the run nonce. It does not perform complete Intel TDX/GPU certificate-chain verification. Hardware and service trust remain assumptions. See [verification](./technical/verification.md).

## Outside the system

A biased rubric, false supplier claims, private bribes, collusion and poor human judgment are not solved by encryption. A committee can intentionally choose a lower-ranked eligible bid if it records a rationale.

Cross-chain delivery, production procurement use and a multi-member committee demonstration are not established by the current two paid testnet examples.
