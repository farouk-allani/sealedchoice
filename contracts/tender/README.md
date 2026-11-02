# Tender contract

Rust near-sdk 5.29.1 contract. Design: [`docs/03-contract.md`](../../docs/03-contract.md). This file lists what is implemented, every public method and every error code. A unit test (`i1_method_list_has_no_setter_for_immutable_fields`) fails if a public method is missing here.

Build: `cargo near build non-reproducible-wasm` (in this folder) → `target/near/tender_contract/tender_contract.wasm`. Tests: `cargo test -p tender-contract`.

Status: create, tender key, escrow funding, deposits, bids, withdrawals, cancellation and views (T03). Close and evaluation come at T04, award and payout at T08.

## Methods

### Admin

| Method | Who | What |
|---|---|---|
| `new` | init | `owner`, `outlayer` (OutLayer contract), `secrets_ref` (`{profile, account_id}`), `min_deadline_delay_ns` |
| `add_evaluator` | owner | Append an evaluator build (`wasm_url` https, `wasm_sha256` lowercase hex, `build_target` `wasm32-wasip2`, `source_tag`). Returns its index. Existing tenders keep the copy they made at creation. The owner has no other power. |

### Buyer

| Method | What |
|---|---|
| `create_tender` | Payable. `rubric_json` (canonical JCS, checked), `deadline_ns` (string, ≥ now + min delay), `bond` (yoctoNEAR string, per bid), `committee` (`[{account, report_pubkey}]`, 1–10, unique, compressed secp256k1 hex), `evaluator_index`. Attached NEAR pays the tender's storage; the rest is the eval fee, split in 6 equal OutLayer deposits (derive_pubkey and evaluate, up to 3 attempts each). Starts the OutLayer `derive_pubkey` request and returns the tender id. Status `PendingKey`. |
| `retry_pubkey` | Buyer, in `PendingKey`, only while the fee still covers 3 evaluation attempts after this request (so at most 2 retries). |
| `on_pubkey` | `#[private]` callback. Reads OutLayer's result (the evaluator's stdout as a JSON string, `null` on failure), expects `{"v":1,"tid":"<id>","pk":"02…"}`. Success: key stored, status `AwaitingFunds`. Anything else: logged, status unchanged. |
| `ft_on_transfer` | NEP-141 receiver, `msg = {"fund_tender":"<id>"}`. Accepted only from the rubric token, from the buyer, in `AwaitingFunds`, before the deadline, for exactly the budget cap; otherwise every token is returned. Status `Open`. |
| `cancel_tender` | Buyer, before the deadline, in `PendingKey`/`AwaitingFunds`/`Open`. Refunds every active bond, the remaining eval fee and the escrow (ft_transfer). Status `Cancelled`. |
| `retry_escrow_refund` | Anyone. If an escrow refund failed (booked back by `on_escrow_refund`), sends it again. Only in `Cancelled`/`NoBids`/`Failed`/`ClosedNoAward`. |
| `on_escrow_refund` | `#[private]` callback of the escrow ft_transfer. On a failed receipt, books the amount back as escrowed. |

### Bidder

| Method | What |
|---|---|
| `deposit` | Payable. Credits the caller's balance for a tender (for a function-call key, which cannot attach deposits). Storage of a new balance entry is paid from the deposit. |
| `withdraw_balance` | Returns the caller's whole balance for a tender. |
| `submit_bid` | Payable or from balance. `ciphertext_b64` (standard base64, 1–4500 decoded bytes), `debrief_pubkey`. Requires `Open`, before the deadline, no active bid from the caller, fewer than 5 active bids, a ciphertext hash never seen in this tender, attached + balance ≥ bond + storage. Excess attached deposit is refunded. Returns `{slot, ciphertext_sha256, submitted_at_ns}`. |
| `withdraw_bid` | Before the deadline. Refunds the bond once, frees the slot; the ciphertext hash stays used. |

### Views

`version`, `get_config`, `get_evaluators`, `get_tender`, `list_tenders` (`from`, `limit` ≤ 50), `get_bids` (no ciphertexts), `get_bid_ciphertext`, `get_frozen`, `get_attempts`, `get_result`, `get_award`, `get_balance`, `is_ciphertext_used`.

All nanosecond times are JSON strings (`U64`): they exceed JavaScript's safe integers.

## Events (NEP-297, standard `sealedchoice`, version `1.0.0`)

`evaluator_added`, `tender_created`, `key_requested`, `tender_key_set`, `tender_funded`, `tender_cancelled`, `bonds_settled`, `escrow_refund_failed`, `deposited`, `balance_withdrawn`, `bid_submitted`, `bid_withdrawn`.

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
| `E_DEADLINE_PASSED` | At or after the deadline |
| `E_DEADLINE_TOO_SOON` | Deadline earlier than now + `min_deadline_delay_ns` |
| `E_DUPLICATE_CIPHERTEXT` | This ciphertext hash was already submitted to this tender (withdrawn bids included) |
| `E_EVAL_FEE_LOW` | Eval fee too small to split, or a key retry would leave less than 3 evaluation deposits |
| `E_INSUFFICIENT_DEPOSIT` | Attached (plus balance) does not cover storage (and bond) |
| `E_KEY_PROMISE_FAILED` | OutLayer request failed, or its result was over 4096 bytes (logged, not a panic) |
| `E_KEY_RESULT_FORMAT` | Key result is not a JSON string holding `{"v","tid","pk"}` (logged) |
| `E_KEY_RESULT_TID` | Key result names another tender (logged) |
| `E_KEY_RESULT_VERSION` | Key result `v` is not 1 (logged) |
| `E_KEY_RUN_FAILED` | OutLayer returned `null`: the run failed or timed out (logged) |
| `E_MAX_BIDS` | 5 active bids already |
| `E_NOTHING_TO_REFUND` | No escrow left to refund |
| `E_NOT_BUYER` | Caller (or token sender) is not the tender's buyer |
| `E_NOT_OPEN` | Tender is not `Open` |
| `E_NOT_OWNER` | Caller is not the contract owner |
| `E_NO_ACTIVE_BID` | The caller has no active bid to withdraw |
| `E_NO_BALANCE` | The caller has no balance for this tender |
| `E_NO_EVALUATOR` | No evaluator at that index |
| `E_NO_TENDER` | No tender with that id |
| `E_RATIONALE_TOO_LONG` | Reason over 1000 characters |
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
| `E_WRONG_AMOUNT` | Funding amount is not exactly the budget cap (tokens returned) |
| `E_WRONG_TOKEN` | Funding from a token other than the rubric's (tokens returned) |
