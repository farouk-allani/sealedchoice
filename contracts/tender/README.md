# Tender contract

Rust near-sdk 5.29.1 contract. Design: [`docs/03-contract.md`](../../docs/03-contract.md). This file lists what is implemented, every public method and every error code. A unit test (`i1_method_list_has_no_setter_for_immutable_fields`) fails if a public method is missing here.

Build: `cargo near build non-reproducible-wasm` (in this folder) → `target/near/tender_contract/tender_contract.wasm`. Tests: `cargo test -p tender-contract`. Every limit, gas amount and OutLayer number is in `src/constants.rs` (⚠️ = provisional until G1).

Status: create, tender key, escrow funding, deposits, bids, withdrawals, cancellation and views (T03); close, freeze, evaluation request, result validation and retries (T04). Award and payout come at T08.

## Methods

### Admin

| Method | Who | What |
|---|---|---|
| `new` | init | `owner`, `outlayer` (OutLayer contract), `secrets_ref` (`{profile, account_id}`), `min_deadline_delay_ns` |
| `add_evaluator` | owner | Append an evaluator build (`wasm_url` https, `wasm_sha256` lowercase hex, `build_target` `wasm32-wasip2`, `source_tag`). Returns its index. Existing tenders keep the copy they made at creation. The owner has no other power. |

### Buyer

| Method | What |
|---|---|
| `create_tender` | Payable. `rubric_json` (canonical JCS, checked), `deadline_ns` (string, ≥ now + min delay), `bond` (yoctoNEAR string, per bid), `committee` (`[{account, report_pubkey}]`, 1–10, unique, compressed secp256k1 hex), `evaluator_index`. Attached NEAR pays the tender's storage plus a 2,500-byte reserve for what close and evaluation add; the rest is the eval fee, split in 6 equal OutLayer deposits (derive_pubkey and evaluate, up to 3 attempts each); each must cover OutLayer's storage deposit for the largest evaluate input this tender can produce (5 maximum-size bids). Starts the OutLayer `derive_pubkey` request and returns the tender id. Status `PendingKey`. |
| `retry_pubkey` | Buyer, in `PendingKey`, only while the fee still covers 3 evaluation attempts after this request (so at most 2 retries). |
| `on_pubkey` | `#[private]` callback. Reads OutLayer's result (the evaluator's stdout as a JSON string, `null` on failure), expects `{"v":1,"tid":"<id>","pk":"02…"}`. Success: key stored, status `AwaitingFunds`. Anything else: logged, status unchanged. |
| `ft_on_transfer` | NEP-141 receiver, `msg = {"fund_tender":"<id>"}`. Accepted only from the rubric token, from the buyer, in `AwaitingFunds`, before the deadline, for exactly the budget cap; otherwise every token is returned. Status `Open`. |
| `cancel_tender` | Buyer, in `PendingKey`/`AwaitingFunds`/`Open`: before the deadline in any of them, after it only in `PendingKey`/`AwaitingFunds` (no bid or escrow can exist, so the fee is never locked). Refunds every active bond, the remaining eval fee and the escrow (ft_transfer). Status `Cancelled`. |
| `retry_escrow_refund` | Anyone. If an escrow refund failed (booked back by `on_escrow_refund`), sends it again. Only in `Cancelled`/`NoBids`/`Failed`/`ClosedNoAward`. |
| `on_escrow_refund` | `#[private]` callback of the escrow ft_transfer. On a failed receipt, books the amount back as escrowed. |

### Bidder

| Method | What |
|---|---|
| `deposit` | Payable. Credits the caller's balance for a tender (for a function-call key, which cannot attach deposits). Storage of a new balance entry is paid from the deposit. |
| `withdraw_balance` | Returns the caller's whole balance for a tender. |
| `submit_bid` | Payable or from balance. `ciphertext_b64` (standard base64, 1–4500 decoded bytes), `debrief_pubkey`. Requires `Open`, before the deadline, no active bid from the caller, fewer than 5 active bids, a ciphertext hash never seen in this tender, attached + balance ≥ bond + storage. Excess attached deposit is refunded. Returns `{slot, ciphertext_sha256, submitted_at_ns}`. |
| `withdraw_bid` | Before the deadline. Refunds the bond once, frees the slot; the ciphertext hash stays used. |

### Anyone

| Method | What |
|---|---|
| `close_and_evaluate` | At or after the deadline, in `Open` (I3). No active bids: `NoBids`, escrow and fee back to the buyer. Otherwise freezes the bid set: active slots by (submitted_at_ns, slot) become indices 0..n−1, leaves and root as `specs/reference/reference.py` (I4); pushes attempt 1 and sends the evaluate request (input per docs/04 §6, `Text` response, buyer as payer, gas 100 Tgas + 25 Mgas per input byte over 32 KiB). Status `Evaluating`. |
| `retry_evaluate` | In `EvalFailed`, fewer than 3 attempts (I12). Same frozen input, next attempt number. |
| `on_evaluate` | `#[private]` callback, bound to `(tender_id, attempt)` (I7). Accepts one result per tender, only for the attempt in flight (I5), only if every rule holds (I6): canonical JCS, ≤ 900 bytes, exact fields; `tid`, `root`, `rubric`, `attempt` echo the tender; `rk` holds each index once, totals ≤ 10000, flags ≤ 127, flags 2/4 only with flag 1, ineligible entries total 0; eligible first by total descending, then ineligible by index; `status` matches the flags. Accepted: result stored verbatim, status `Evaluated`, bonds settled once (forfeited to the buyer for flags 2 or 4, refunded otherwise; I10). Rejected or failed run: the attempt records the code; below 3 attempts status `EvalFailed`, at 3 status `Failed` and escrow, bonds and fee go back. Never panics. |

### Views

`version`, `get_config`, `get_evaluators`, `get_tender`, `list_tenders` (`from`, `limit` ≤ 50), `get_bids` (no ciphertexts), `get_bid_ciphertext`, `get_frozen`, `get_attempts`, `get_result`, `get_award`, `get_balance`, `is_ciphertext_used`.

All nanosecond times are JSON strings (`U64`): they exceed JavaScript's safe integers.

## Events (NEP-297, standard `sealedchoice`, version `1.0.0`)

`evaluator_added`, `tender_created`, `key_requested`, `tender_key_set`, `tender_funded`, `tender_cancelled`, `bonds_settled`, `escrow_refund_failed`, `deposited`, `balance_withdrawn`, `bid_submitted`, `bid_withdrawn`, `tender_closed` (n, root), `evaluation_requested` (attempt, deposit, input bytes), `evaluation_failed` (attempt, reason, final), `evaluation_accepted` (attempt, bundle, status), `tender_failed`.

## Error codes

| Code | Meaning |
|---|---|
| `E_ALREADY_BID` | The caller already has an active bid in this tender |
| `E_BAD_CIPHERTEXT` | Ciphertext is not standard base64, or empty |
| `E_BAD_EVALUATOR` | Evaluator ref: hash not 64 lowercase hex, URL not https, target not wasm32-wasip2, or empty tag |
| `E_BAD_MSG` | `ft_on_transfer` msg is not `{"fund_tender":"<id>"}` (tokens returned) |
| `E_BAD_PUBKEY` | Not a compressed secp256k1 public key in lowercase hex (66 chars, 02/03 prefix) |
| `E_BAD_STATUS` | The tender's status does not allow this call |
| `E_BOND_SETTLED` | The bond of this bid was already settled |
| `E_CIPHERTEXT_TOO_LARGE` | Decoded ciphertext over 4500 bytes |
| `E_COMMITTEE_DUPLICATE` | The same account twice in the committee |
| `E_COMMITTEE_SIZE` | Committee empty or over 10 members |
| `E_DEADLINE_NOT_REACHED` | Close before the deadline (I3) |
| `E_DEADLINE_PASSED` | At or after the deadline |
| `E_DEADLINE_TOO_SOON` | Deadline earlier than now + `min_deadline_delay_ns` |
| `E_DUPLICATE_CIPHERTEXT` | This ciphertext hash was already submitted to this tender (withdrawn bids included) |
| `E_EVAL_FEE_LOW` | Eval fee too small to split, each deposit below OutLayer's storage deposit for the worst-case evaluate input, or a key retry that would leave less than 3 evaluation deposits |
| `E_EVAL_PROMISE_FAILED` | The evaluate request failed, or its result was over 4096 bytes (recorded as the attempt's reason) |
| `E_EVAL_RUN_FAILED` | OutLayer returned `null`: the run failed or timed out (recorded) |
| `E_INSUFFICIENT_DEPOSIT` | Attached (plus balance) does not cover storage (and bond) |
| `E_KEY_PROMISE_FAILED` | OutLayer request failed, or its result was over 4096 bytes (logged, not a panic) |
| `E_KEY_RESULT_FORMAT` | Key result is not a JSON string holding `{"v","tid","pk"}` (logged) |
| `E_KEY_RESULT_TID` | Key result names another tender (logged) |
| `E_KEY_RESULT_VERSION` | Key result `v` is not 1 (logged) |
| `E_KEY_RUN_FAILED` | OutLayer returned `null`: the run failed or timed out (logged) |
| `E_MAX_ATTEMPTS` | Already 3 evaluation attempts |
| `E_MAX_BIDS` | 5 active bids already |
| `E_NOTHING_TO_REFUND` | No escrow left to refund |
| `E_NOT_BUYER` | Caller (or token sender) is not the tender's buyer |
| `E_NOT_FROZEN` | Internal: no frozen bid set where one is required |
| `E_NOT_OPEN` | Tender is not `Open` |
| `E_NOT_OWNER` | Caller is not the contract owner |
| `E_NO_ACTIVE_BID` | The caller has no active bid to withdraw |
| `E_NO_BALANCE` | The caller has no balance for this tender |
| `E_NO_BID` | Internal: a frozen slot has no stored bid |
| `E_NO_EVALUATOR` | No evaluator at that index |
| `E_NO_TENDER` | No tender with that id |
| `E_RATIONALE_TOO_LONG` | Reason over 1000 characters |
| `E_RESULT_ATTEMPT` | Result `attempt` is not the attempt in flight (recorded) |
| `E_RESULT_FORMAT` | Result is not JSON with exactly the compact-result fields, or `bundle` is not 64 hex (recorded) |
| `E_RESULT_NOT_CANONICAL` | Result is not its own JCS form (recorded) |
| `E_RESULT_ORDER` | Ranking order broken: eligible by total descending, then ineligible by index (recorded) |
| `E_RESULT_RANGE` | Total over 10000, flags over 127, flag 2/4 without flag 1, or an ineligible entry with a total (recorded) |
| `E_RESULT_RANKING` | Ranking does not hold each index 0..n−1 exactly once (recorded) |
| `E_RESULT_ROOT` | Result `root` is not the frozen Merkle root (recorded) |
| `E_RESULT_RUBRIC` | Result `rubric` is not the tender's rubric hash (recorded) |
| `E_RESULT_STATUS` | Result `status` does not match its flags (recorded) |
| `E_RESULT_TID` | Result `tid` names another tender (recorded) |
| `E_RESULT_TOO_LARGE` | Result over 900 bytes (recorded) |
| `E_RESULT_VERSION` | Result `v` is not 1 (recorded) |
| `E_RUBRIC_APPROVALS` | `approvals_required` is 0, over 5, or over the committee size |
| `E_RUBRIC_CAP` | `budget_cap_minor` is not a positive integer string of at most 30 digits |
| `E_RUBRIC_FIELDS` | A required rubric field is missing or has the wrong type |
| `E_RUBRIC_JSON` | Rubric is not JSON |
| `E_RUBRIC_MODELS` | Not exactly 3 different, non-empty model ids |
| `E_RUBRIC_NOT_CANONICAL` | Rubric is not its own JCS form (whitespace, key order, floats, integers beyond 2^53 − 1) |
| `E_RUBRIC_TOKEN` | `currency.asset` is not `nep141:<account id>` |
| `E_RUBRIC_TOO_LARGE` | Rubric over 16 KiB |
| `E_RUBRIC_VERSION` | Rubric `v` is not 1 |
| `E_RUBRIC_WEIGHTS` | Criteria weights do not sum to 10000 |
| `E_RUBRIC_WINDOW` | `acceptance_window_hours` outside 1–720 |
| `E_STALE_RESULT` | A result for a tender that is not evaluating that attempt: ignored and logged (I5) |
| `E_WRONG_AMOUNT` | Funding amount is not exactly the budget cap (tokens returned) |
| `E_WRONG_TOKEN` | Funding from a token other than the rubric's (tokens returned) |
