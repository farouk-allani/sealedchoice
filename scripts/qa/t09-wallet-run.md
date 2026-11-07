# T09 last acceptance item: the wallet run

One sitting, about 25 minutes of which 15 is waiting for the bidding window to close.
Everything below was checked against testnet on 2026-11-07 before you start, so nothing
here should fail on a precondition.

## Checked for you already

| Thing | Value | Needed |
|---|---|---|
| `buyer.sealedchoice.testnet` NEAR | 3.54 | 0.5 create deposit + gas |
| `buyer.sealedchoice.testnet` tUSDC | 958,000 | the budget cap you set |
| `vendor-a.sealedchoice.testnet` NEAR | 1.95 | 0.1 bond + storage + gas |
| `tenders.sealedchoice.testnet` tUSDC storage | registered | escrow transfer |
| `vendor-a.sealedchoice.testnet` tUSDC storage | registered | payout, later |
| `next_tender_id` | 4 | the page predicts this (D-031) |
| `min_deadline_delay_ns` | 300 s | your bidding window must beat it |
| evaluator pinned at index 0 | `b5e34a07...e0811fb6` | the page sends index 0 |

## Before you open the browser

```
git checkout t09-web-create-bid
pnpm --filter web dev
```

Have Meteor unlocked with **both** `buyer.sealedchoice.testnet` and
`vendor-a.sealedchoice.testnet` available. You will switch accounts once, between step 2
and step 3.

Do not use the parent `sealedchoice.testnet` for either role. A reader key is HKDF of a
NEP-413 signature, so it can only be re-derived while that account can still sign, and T14
deletes the parent's full-access keys.

## 1. Create the tender, as buyer

`http://localhost:3000/tenders/new`, connect Meteor as `buyer.sealedchoice.testnet`.

Four steps: the brief, scoring, committee, review.

- **The brief.** Keep the template title, scope, budget and delivery days. The one field to
  change is **the bidding window: enter `0.25`** (15 minutes) instead of the default 24.
  The field is in hours and accepts fractions. Keep the bond at `0.1`.

  Do not enter the minimum `0.0834`. The contract wants `deadline >= block timestamp + 300 s`,
  and the page reads the clock when you sign, so a window at exactly the minimum loses the
  race to block time and comes back `E_DEADLINE_TOO_SOON`.

- **Scoring.** Leave the weights alone. They total 100% and the canonical rubric hashes to
  the same value tender 3 stored, which the web tests pin.

- **Committee.** Press **get my committee key**. Meteor asks you to sign a NEP-413 message;
  that signature derives the key, and the page registers only its public half. One member is
  enough for the demo, and the rubric asks for one approval.

- **Review.** Check the shown `rubric_json` and its sha256, then create. Meteor asks for
  **0.5 NEAR**.

  **Record the tx hash and the tender id.** The id should be **4**. If the page reports an id
  mismatch, something else created a tender in between: `cancel_tender` for a full refund and
  start over, because the committee key you just signed binds id 4 only.

- **Fund the escrow** on the same page. Meteor asks for an `ft_transfer_call` of the budget
  cap in tUSDC. **Record this tx hash too.** The tender is `Open` once this lands.

## 2. Bid, as vendor A

Switch Meteor to `vendor-a.sealedchoice.testnet`, then
`http://localhost:3000/tenders/4/bid`.

Fill the price, delivery days, methodology and track record. Watch the byte counter: it
counts the real JCS bytes plus the envelope, not the raw text, so quotes and newlines count.

Press to seal. Meteor asks for one NEP-413 signature, which derives your debrief key. The
plaintext never leaves the browser's memory.

Review the sealed bid, then submit. Meteor asks for **0.1 NEAR plus a storage margin**; the
excess comes back.

**Download the receipt** and record the tx hash, the slot and the ciphertext sha256.

## 3. Let it close, then evaluate

Wait out the 15 minutes. There is no single-tender script yet, only `pnpm e2e`, which builds
its own tender from scratch. Use the script added for exactly this:

```
pnpm evaluate --tender 4
```

It closes the tender if the deadline has passed, waits for the OutLayer round trip, prints the
ranking with each entry joined to its bidder, and checks the published bundle. If you would
rather send the one call by hand, near-cli-rs 0.30.1 is already on this machine:

```
near contract call-function as-transaction tenders.sealedchoice.testnet close_and_evaluate \
  json-args '{"tender_id":4}' \
  prepaid-gas '300 Tgas' attached-deposit '0 NEAR' \
  sign-as buyer.sealedchoice.testnet network-config testnet sign-with-keychain send
```

Anyone may call this once the deadline has passed, so the buyer's own key is fine. It freezes
the bid set with the Merkle root and starts the OutLayer round trip, which took 31 s at T05.
Record this tx hash.

Then open `http://localhost:3000/tenders/4` and confirm the ranking shows your UI-made bid
with the score and flags it earned.

## What to send back

The five tx hashes (create, fund, bid, close, and the evaluate callback), the tender id, and
whether the ranking on `/tenders/4` matched. That closes T09's last two acceptance items and
I will write them into PROGRESS.md with the evidence.
