# 09 — Escrow, award acceptance and payout

## Escrow

At creation the buyer escrows exactly `budget_cap` of the rubric token with `ft_transfer_call` (msg `{"fund_tender":"<id>"}`). No interest, no yield, no lending: the tokens sit in the contract. After payout the remainder (`budget_cap − amount`) goes back to the buyer. Cancel (before deadline), no-award decision or final failure returns everything.

Testnet token: deploy the reference NEP-141 (near-examples FT contract) as `usdc.sealedchoice.testnet` with 6 decimals, symbol `tUSDC`. Every receiver needs NEP-145 storage registration: the scripts register bidders and the buyer; the contract registers itself at deployment.

## Award acceptance

The committee's award states the amount (normally the winner's bid price, which the committee read in the report). The winner calls `accept_award(tender_id, payout_target)`, which is also their agreement to the amount. Until then nothing moves.

## Route 1 — NEAR account (default, testnet and mainnet)

`PayoutTarget::Near { account }` → contract `ft_transfer(account, amount)` with a callback. On failure (usually the receiver is not storage-registered): state `PayoutFailed`, the winner registers and calls `retry_payout`. On success: remainder to buyer, state `Paid`, event `payout_completed`.

## Route 2 — any chain through NEAR Intents 1Click (mainnet only)

1Click has no testnet. This route is shown in the optional mainnet demo with a small amount (for example 2 USDC), every transaction confirmed by the human. If G4 fails or mainnet is skipped, the README shows a dry quote (`dry: true`) and says the route was not executed.

Flow (contract-driven, so the deposit address comes from attested code, not from a person):

1. Winner: `accept_award(id, Intents { destination_asset, recipient })`. `destination_asset` must be an asset id from `GET /v0/tokens`.
2. Contract → OutLayer `request_execution` with the evaluator WASM, action `quote` (no secrets needed except the 1Click JWT if we use one), input:
   ```json
   {"action":"quote","tender_id":"7","origin_asset":"nep141:<usdc token id>","destination_asset":"...",
    "amount":"2000000","recipient":"...","refund_to":"<buyer account>","deadline_iso":"..."}
   ```
3. WASM: `POST https://1click.chaindefuser.com/v0/quote` with `dry: false`, `swapType: "EXACT_INPUT"`, `depositType: "ORIGIN_CHAIN"`, `recipientType: "DESTINATION_CHAIN"`, `refundType: "ORIGIN_CHAIN"`, `slippageTolerance` (bp, e.g. 100), `deadline`, and `confidentiality` if G4 shows it works with this deposit type. Prints `{"v":1,"tid","deposit_address","amount_in","min_amount_out","recipient","destination_asset","deadline"}` (≤ 900 bytes).
4. Contract callback checks the echo (`recipient`, `destination_asset`, `amount_in == amount`, deadline at least 10 minutes away), then `ft_transfer(deposit_address, amount)`. State `PayingOut { deposit_address }`.
5. Anyone (web app) may call `POST /v0/deposit/submit` with the tx hash to speed things up, and polls `GET /v0/status?depositAddress=…` until `SUCCESS`, `REFUNDED` or `FAILED`.
6. Anyone calls `record_payout_status(id)` → contract → OutLayer action `payout_status` → callback sets `Paid` on `SUCCESS`, `PayoutRefunded` on `REFUNDED` (funds went back to `refund_to` = buyer). Simplification for the hackathon: on refund the tender ends; the buyer pays manually.

Status values to handle: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, `FAILED`.

Trust note for the README: the cross-chain leg relies on the 1Click service and solvers. The contract guarantees the funds leave escrow only to a deposit address quoted for the winner's declared recipient.

## Confidentiality of the payment

1Click has a `confidentiality` parameter (`public` | `basic` | `advanced`, per docs read in Oct 2026; verify at G4, including which `depositType` it requires, e.g. `CONFIDENTIAL_INTENTS`). Even with it, the award amount is public in our contract. Do not claim the payment is private; claim the bids are.

## JWT

1Click works without a JWT but charges an extra 0.25 % fee (per docs, verify). If the human obtains a JWT, it is an OutLayer secret (`ONECLICK_JWT`) for the WASM and a server-side env var for the web proxy. Never in the repo.
