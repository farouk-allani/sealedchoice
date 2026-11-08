# T11 acceptance: the combined wallet run

Everything in T11 is built and smoke-tested. What is left needs a wallet, because the whole point
is that a key only you hold opens the envelope and only the committee can award.

Two parts. **Part A is the acceptance criterion and takes about 10 minutes.** Part B exists only to
show the deviation rule on screen, and costs roughly another 20 minutes and a wallet import. The
rule itself is already pinned by tests (`i8_*` in the contract, `committee.test.ts` in the
verifier), so Part B is a demo, not a proof.

Claude drives the browser and fills every field. You approve each signature in the Meteor
extension. Claude never signs and never switches accounts.

## Before you start

Meteor on **testnet**, with `buyer.sealedchoice.testnet` and `vendor-a.sealedchoice.testnet`
imported, as in the T09 run. Part B also needs `vendor-b.sealedchoice.testnet`
(`VENDOR_B_PRIVATE_KEY` in `.env`).

Checked on chain 2026-11-08, so nothing below should fail on a precondition:

| Thing | Value |
|---|---|
| Tender 4 status | `Evaluated`, escrow 15,000 tUSDC, no award yet |
| Tender 4 committee | `buyer.sealedchoice.testnet`, 1 approval required |
| Tender 4 bid | slot 0, `vendor-a.sealedchoice.testnet` |
| `buyer` NEAR | 3.18 |
| `vendor-a` NEAR | 1.92 |
| `vendor-b` NEAR | 1.97 |

Why tender 4 and not tender 3: tender 3's reader keys come from the public `TEST_SIGNATURE` the
e2e script uses, so a real wallet cannot derive them. Tender 4 was made through the UI, so its
debrief and committee keys are the ones your wallet signs for.

## Part A: the acceptance criterion, on tender 4

**1. The debrief, as vendor-a.** Connect Meteor as `vendor-a`, open
`/tenders/4/debrief`, press **Open my debrief**.

- One signature: a NEP-413 message, no funds. It derives the reader key, opens the envelope, and
  the key is wiped straight after.
- Expect: rank 1 of 1, the score by criterion with what each model said and how many quotes
  matched, and checks 1, 2, 3 and 5 passing.
- Check 4 will say **not checked**, which is correct: it needs the proposal text, and your bid is
  sealed to the tender key inside the TEE, so nobody can recover it from the chain. Open
  **Recompute my score from my own proposal** and paste the text Claude submitted at T09 (Claude
  has it) to turn that row green.

**2. The award, as buyer.** Switch Meteor to `buyer`, open `/tenders/4/committee`, press
**Open the report**.

- One signature: NEP-413 again, purpose `committee`, no funds.
- Expect: vendor-a's full proposal readable, flags explained, and the ranking recommending bid 0.
- The amount pre-fills with the bid's own price (11,800 tUSDC). Press **Propose this award**.
  No rationale is needed: bid 0 is the top eligible bid, so this is not a deviation.
- **Signature 2: a transaction**, `propose_award`, no deposit.
- The tender needs 1 approval, so approve it as well: **Signature 3**, `approve_award`.

**3. Accept and get paid, as vendor-a.** Switch Meteor back to `vendor-a`, open
`/tenders/4/award`.

- Expect: winner `vendor-a`, amount 11,800 tUSDC, the approval shown, and an acceptance deadline.
- Leave the payout account blank to use the connected account. Press **Accept**.
- **Signature 4: a transaction**, `accept_award`, no deposit. The escrow pays out, and the
  remainder (3,200 tUSDC) goes back to the buyer.

That is the acceptance criterion: four signatures, all through the UI.

## Part B (optional): show the deviation rule

Needs a tender with two eligible bids, because awarding the only eligible bid can never be a
deviation. Claude creates tender 5 through the UI exactly as at T09, with a **1 hour** bidding
window this time so there is no rush, then:

- buyer: committee key, create (0.5 NEAR), fund (15,000 tUSDC) = **3 signatures**
- vendor-a: seal, submit (0.1 NEAR bond) = **2 signatures**
- switch to vendor-b, import it first: seal, submit = **2 signatures**
- Claude runs `pnpm evaluate --tender 5` with no wallet
- buyer: propose the **second** bid with a rationale, then approve = **2 signatures**
- the winner accepts = **1 signature**

The page will refuse to send the proposal until the rationale is at least 20 characters, and will
say in words that it is a deviation and that the contract will record it as one. That refusal
happens in the browser, before any signature, because `checkAward` is a port of the same rule
`propose_award` applies.

## What to send back

The transaction hashes, and whether anything on screen disagreed with what the chain then did.
Claude writes them into PROGRESS.md with the evidence and ticks T11's acceptance items.
