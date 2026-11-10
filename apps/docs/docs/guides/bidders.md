---
title: Submit a sealed bid and read your debrief
description: Understand the rubric, encrypt a proposal and privately verify your recorded scores.
---

A supplier can inspect a tender without a wallet. Submission and private debrief access require the bidder's own account.

## 1. Read the tender first

Open its published rubric, eligibility rules, deadline, bid bond and evaluator reference. Check that the tender is **Open**. A completed demo is read-only for new bidding.

The proposed price uses the configured token's minor units internally; the form handles the displayed amount. Check delivery time and required proposal fields carefully. A bid that decrypts successfully can still be ineligible.

## 2. Connect a testnet wallet

Choose the account that will submit the bid and later open the debrief. The tested reader flow uses Meteor with NEP-413 message signing. Keep access to the same signing key: rotating or deleting it can make the old reader key impossible to derive again.

## 3. Write the proposal

Use the bid form for price, delivery time, methodology and track record. Observe the form's byte limits. Bid text remains in page memory while you edit; save your own proposal separately if you need a backup.

The models receive the allowed text fields, so do not put confidential pricing into methodology or track-record text. The evaluator excludes the structured price field from its model requests, but cannot remove a price you write into prose.

## 4. Encrypt and submit

The app asks you to sign a message to derive your private debrief reader key locally. This message signature is separate from the transaction that submits the bid.

The browser constructs the bid, encrypts it to the tender public key, and submits the ciphertext with the bond. The private tender key is derived inside OutLayer. Public chain records include your account, time, ciphertext length and hash; proposal text is encrypted.

Save the transaction receipt and bid inclusion information. Wait for a successful transaction. A full tender or a bid that reaches the chain at or after the deadline is refused.

## 5. Open your debrief after evaluation

From the tender, choose **Debrief**. Connect the original bidder account and sign its reader-key message again. The browser checks the downloaded bundle against the accepted on-chain bundle hash before decrypting your envelope.

The report includes your criterion scores, evidence quotes, model responses, flags and rank. Verification recomputes the recorded scores from those responses. It does not ask the models to judge your proposal a second time.

An unrelated account cannot open the report. Your reader private key stays in the browser. Do not paste it into support messages, commands or another website.

## 6. If you receive the award

Open **Award**, review the amount and payout destination, then accept through the awarded account before the acceptance window closes. The current demo pays tUSDC to the winner's NEAR testnet account.

After successful payment, the page shows **Payment complete**. Use the transaction link to inspect the transfer. The cross-chain payout demonstration is deferred; see [FAQ](../faq.md).

## What the result means

An injection flag is an instruction-pattern warning, not an automatic rejection. Eligibility flags have a different effect. A lower score is not proof that a supplier's claims are false. Read [scoring](../technical/scoring.md) and [privacy limits](../security.md) before interpreting the ranking.
