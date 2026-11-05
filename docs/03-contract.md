# 03 — Tender contract spec

Crate: `contracts/tender`. near-sdk 5.29.1 (pinned at T00, D-015). Build with `cargo near build non-reproducible-wasm` (reproducible mode for the final deployment). Implementation choices and storage deviations: DECISIONS D-018 and D-020; method list and error codes: `contracts/tender/README.md`. All amounts are `U128` (JSON strings). All hashes are lowercase hex of 32 bytes. Time is `env::block_timestamp()` in nanoseconds.

## Constants

All of them live in `contracts/tender/src/constants.rs`. ⚠️ = provisional until gate G1 (G3 where noted) measures it on testnet; G1 retuning is a change to that file only.

| Name | Value | Why |
|---|---|---|
| `MAX_BIDS` ⚠️ G1/G3 | 5 | 180 s time budget and AI latency (04-evaluator §7). Raise only after G1/G3 numbers allow it |
| `MAX_CIPHERTEXT_BYTES` | 4500 | plaintext limits (2000 + 1200 bytes text + fields) + ECIES overhead (97 bytes) |
| `MAX_ATTEMPTS` | 3 | first run + 2 retries; also the derive_pubkey budget |
| `MAX_RATIONALE_CHARS` | 1000 | cancel reason, award rationale |
| `MIN_DEVIATION_RATIONALE_CHARS` | 20 | |
| `MAX_COMMITTEE` | 10 | |
| `MAX_RUBRIC_BYTES` | 16 KiB | the rubric travels in every evaluate input |
| `MAX_RESULT_BYTES` | 900 | compact result (OutLayer stdout) |
| `MAX_REASON_CHARS` | 200 | failure reason stored per attempt |
| `MAX_CALLBACK_BYTES` | 4096 | largest OutLayer callback payload read |
| `MIN_DEADLINE_DELAY_NS` | 5 minutes (testnet), 1 hour (mainnet) | `min_deadline_delay_ns` at init |
| `EXECUTIONS_BUDGETED` | 6 | eval fee split: derive_pubkey and evaluate, up to 3 attempts each |
| `STORAGE_RESERVE_BYTES` ⚠️ G1 | 2,500 | charged at creation for what close and evaluation add (key, frozen set, attempts, result) |
| `GAS_REQUEST_EXECUTION` ⚠️ G1 | 100 Tgas, + 25 Mgas per evaluate input byte over 32 KiB | OutLayer keeps ≥ 50 Tgas of it for its resume callback |
| `GAS_ON_PUBKEY` / `GAS_ON_EVALUATE` ⚠️ G1 | 30 / 50 Tgas | callbacks; `on_evaluate` validates and settles bonds |
| `GAS_FT_TRANSFER` / `GAS_ON_ESCROW_REFUND` ⚠️ G1 | 15 / 10 Tgas | escrow refund and its callback |
| `OUTLAYER_INPUT_FREE_BYTES`, `OUTLAYER_CALLBACK_GAS_PER_INPUT_BYTE`, `OUTLAYER_STORAGE_PRICE_PER_BYTE` ⚠️ G1 | 32 KiB, 25 Mgas, 10^19 yocto | read in OutLayer's contract source (references.md); `contracts/mock-outlayer` copies them |
| `MAX_BID_ENTRY_BYTES`, `EVAL_INPUT_OVERHEAD_BYTES` | 6,250, 400 | upper bounds used to size the worst evaluate input (unit-tested against a real 5-bid input) |
| `EVAL_MAX_*` ⚠️ G1/G3 | 200 B instructions, 512 MB, 180 s | evaluate resource limits (OutLayer caps 500 B / 4096 MB / 180 s) |
| `DERIVE_MAX_*` ⚠️ G1 | 10 B instructions, 128 MB, 30 s | derive_pubkey resource limits |
| `MAX_PAGE` | 50 | `list_tenders` page |

## Storage

As implemented (DECISIONS D-018 lists every change from the first sketch). Every `*_ns` field is `U64`: borsh-identical to `u64`, a string in JSON views (nanosecond times exceed JavaScript's safe integers).

```rust
pub struct Contract {
    owner: AccountId,                  // can only add evaluator versions
    outlayer: AccountId,               // outlayer.testnet / outlayer.near
    evaluators: Vector<EvaluatorRef>,  // append-only list of allowed evaluator builds
    secrets_ref: SecretsRef,           // {profile, account_id} of the OutLayer secrets
    tenders: IterableMap<u64, Tender>,
    bids: LookupMap<(u64, u32), Bid>,  // (tender_id, slot)
    balances: LookupMap<(u64, AccountId), NearToken>, // pre-deposited bond+storage for function-call-key bidders
    ciphertext_hashes: LookupSet<(u64, String)>,      // every ciphertext sha256 ever submitted per tender (I13)
    next_tender_id: u64,
    min_deadline_delay_ns: u64,
}

pub struct EvaluatorRef { wasm_url: String, wasm_sha256: String, build_target: String, source_tag: String }

pub struct Tender {
    id: u64,
    buyer: AccountId,
    rubric_json: String,               // exact JCS string (checked canonical at creation)
    rubric_hash: String,               // sha256(rubric_json bytes), computed by the contract
    currency_token: AccountId,         // parsed from rubric.currency.asset ("nep141:" prefix stripped)
    budget_cap: U128,                  // parsed from rubric
    approvals_required: u8,            // parsed from rubric.award_policy
    acceptance_window_ns: U64,         // parsed from rubric.award_policy
    deadline_ns: U64,
    bond: NearToken,
    committee: Vec<CommitteeMember>,   // {account, report_pubkey}
    evaluator: EvaluatorRef,           // copied at creation, never changes
    tender_pubkey: Option<String>,     // set by the derive_pubkey callback
    escrowed: U128,
    eval_fee_remaining: NearToken,     // NEAR left for OutLayer executions, refunded when the tender ends
    exec_deposit: NearToken,           // deposit attached to each OutLayer request = eval fee / 6
    status: Status,
    bid_slots: u32,                    // slots ever used (withdrawn ones included)
    active_slots: Vec<u32>,            // slots of bids not withdrawn, ≤ MAX_BIDS
    frozen: Option<Frozen>,            // set at close: ordered slot list, leaves, root
    attempts: Vec<Attempt>,            // every evaluation attempt with outcome
    result_json: Option<String>,       // accepted compact result, verbatim
    award: Option<Award>,              // T08
}

pub enum Status { PendingKey, AwaitingFunds, Open, Cancelled, NoBids, Evaluating, Evaluated,
                  EvalFailed, Failed, Awarded, PayingOut, Paid, ClosedNoAward }
pub struct Bid { bidder: AccountId, submitted_at_ns: U64, ciphertext: Vec<u8>, ciphertext_sha256: String,
                 debrief_pubkey: String, bond: NearToken, withdrawn: bool, bond_settled: bool }
pub struct Frozen { slots: Vec<u32>, leaves: Vec<String>, root: String }
pub struct Attempt { n: u8, started_at_ns: U64, outcome: AttemptOutcome } // Pending | Accepted | Failed{reason}
pub struct Award { bid_index: Option<u32> /* None = close without award */, amount: U128, rationale: String,
                   deviation: bool, approvals: Vec<AccountId>, approved_at_ns: Option<U64>,
                   accept_by_ns: Option<U64>, lapsed: Vec<u32>, payout: Option<PayoutTarget>,
                   payout_state: PayoutState }
```

`Award` stays `None` on every tender until T08, so T08 can still reshape it.

Parse the rubric with serde_json into a minimal struct (only the fields the contract needs) and also validate: size ≤ 16 KiB, `rubric_json` is its own JCS form (so `rubric_hash` = sha256(JCS(rubric)) everywhere), `v == 1`, weights sum to 10000, `budget_cap_minor` positive integer string of at most 30 digits, `currency.asset` is `nep141:<account>`, 2 or 3 different non-empty model ids (D-028), `1 ≤ approvals_required ≤ min(5, committee.len())`, acceptance window 1–720 hours. Reject on any error (`E_RUBRIC_*`).

It must also refuse every rubric the pinned evaluator would refuse (I14), or a tender could take bids and bonds and never be evaluated. `contracts/tender/src/rubric.rs` reads the rubric in the evaluator's two shapes, with the same field names and types (evaluator/core `Rubric`, evaluator/wasm `PromptRubric`; the evaluator's `usize` fields as `u32`, since it runs on wasm32): `E_RUBRIC_FIELDS` if either fails. Then: criterion ids match `^[a-z][a-z0-9_]{1,31}$`, since they become JSON keys in debriefs (`E_RUBRIC_ID`); qualitative `source_fields` only `methodology` or `track_record` (`E_RUBRIC_SOURCE_FIELDS`); `aggregation.min_valid_outputs` 2 or 3 **and at most the number of models** (`E_RUBRIC_AGGREGATION`, D-024 outage rule — the second half stopped being implied when D-028 allowed two models); every qualitative criterion has a `question` and anchors `0`–`5` (`E_RUBRIC_PROMPT`). A unit test runs the same rubrics through the evaluator's own `check_rubric` (D-025).

Reader keys (committee `report_pubkey`, bid `debrief_pubkey`) and the tender key returned by `derive_pubkey` must be compressed secp256k1 points, checked as points with `k256`, not only as hex (I15, `E_BAD_PUBKEY`). The evaluator cannot encrypt to a key that is not a point, so its reader would get no debrief or report (D-024).

## Methods

### Admin
- `new(owner, outlayer, secrets_ref, min_deadline_delay_ns)` — `#[init] #[private]`: deploy and init in one transaction from the contract account.
- `add_evaluator(EvaluatorRef)` — owner only. Append-only. Existing tenders keep their pinned copy.

### Buyer
- `create_tender(rubric_json, deadline_ns, bond, committee, evaluator_index) -> u64` — payable. Committee 1–10 members, unique, report keys that are compressed secp256k1 points (I15); rubric checked as above (I14); `deadline_ns ≥ now + min_deadline_delay_ns` (`E_DEADLINE_TOO_SOON`). Attached NEAR pays:
  1. storage: the tender's own bytes plus `STORAGE_RESERVE_BYTES` (2,500) for what close and evaluation add later. Not refunded.
  2. the eval fee = the rest, split into `EXECUTIONS_BUDGETED` = 6 equal OutLayer deposits (`exec_deposit`: derive_pubkey and evaluate, up to 3 attempts each). Each deposit must be > 0 and cover OutLayer's input storage deposit (10^19 yocto per byte over 32 KiB) for the largest evaluate input this tender can produce: 5 maximum-size bids, this rubric, this committee (`E_EVAL_FEE_LOW`). The compute part is the client's job: it attaches 6 × `estimate_execution_cost` for the evaluate limits and that worst input length. Whatever is not spent goes back to the buyer when the tender ends; OutLayer refunds the unused part of each deposit to the buyer directly (`payer_account_id`).

  Status `PendingKey`. Immediately calls OutLayer `request_execution` with `{"action":"derive_pubkey","contract_id","tender_id"}`, the derive limits, `response_format: "Text"`, `payer_account_id: buyer`, one `exec_deposit` and callback `on_pubkey`.
- `retry_pubkey(tender_id)` — buyer, in `PendingKey`, before the deadline, only while `eval_fee_remaining ≥ 4 × exec_deposit` (this request plus 3 evaluation attempts; so at most 2 retries).
- `on_pubkey(tender_id)` — `#[private]`. Reads `promise_result_checked(0, 4096)`: OutLayer passes the evaluator's stdout as a JSON string (`null` when the run failed or timed out). Parse `{"v":1,"tid","pk"}`; check `tid`; check `pk` is a 33-byte compressed secp256k1 point (hex 66 chars, prefix 02/03). Success: key stored, status `AwaitingFunds`. Anything else: logged (`E_KEY_*`), never a panic, status stays `PendingKey`.
- `ft_on_transfer(sender_id, amount, msg)` — NEP-141 receiver. `msg = {"fund_tender": "<id>"}`. Accept only from `currency_token`, only from the buyer, only in `AwaitingFunds`, only before the deadline, only `amount == budget_cap`; otherwise return the full amount (never panics). Status `Open`.
- `cancel_tender(tender_id, reason)` — buyer, in `PendingKey`/`AwaitingFunds`/`Open`. Before the deadline in every one of those states; after it only in `PendingKey`/`AwaitingFunds` (no bid or escrow can exist then, and the fee must not stay locked). Refunds every active bond, the remaining eval fee and the escrow. Status `Cancelled`.
- `retry_escrow_refund(tender_id)` / `on_escrow_refund(tender_id, amount)` — the escrow refund is an `ft_transfer` with a `#[private]` callback; only a failed receipt books the amount back as escrowed, and anyone can then send it again (in `Cancelled`/`NoBids`/`Failed`/`ClosedNoAward`).

### Bidder
- `deposit(tender_id)` — payable. Credits `balances[(tender_id, caller)]`. For bidders using a function-call key (cannot attach deposits). Storage of a new balance entry is paid from the deposit.
- `withdraw_balance(tender_id)` — returns the caller's whole balance.
- `submit_bid(tender_id, ciphertext_b64, debrief_pubkey)` — payable (or uses balance). Requires `Open`, `now < deadline`, caller has no active bid, `active_slots.len() < MAX_BIDS`, ciphertext decodes and `≤ MAX_CIPHERTEXT_BYTES`, `debrief_pubkey` a compressed secp256k1 point (I15), `ciphertext_sha256` never seen before in this tender (including withdrawn bids: `E_DUPLICATE_CIPHERTEXT`), attached + balance ≥ `bond + storage_cost`. Excess attached deposit is refunded. Stores bid, records the hash in `ciphertext_hashes`, emits `bid_submitted {tender_id, slot, bidder, ciphertext_sha256, submitted_at_ns}`. Returns the receipt `{slot, ciphertext_sha256, submitted_at_ns}`.
- `withdraw_bid(tender_id)` — before deadline only. Refunds the bond once, frees the slot (marks withdrawn); the bid record and its ciphertext hash stay.

### Anyone
- `close_and_evaluate(tender_id)` — requires `Open` and `now ≥ deadline`. If no active bids: refund escrow and fee, status `NoBids`. Otherwise freeze: active slots ordered by `submitted_at_ns` (ties by slot), indices 0..n-1, leaves and root exactly as `specs/reference/reference.py` (`merkle_leaf`, `merkle_root`) computed with `env::sha256`. Push `Attempt{n:1}`, status `Evaluating`, call `request_execution` with the input in 04-evaluator §6, the evaluate limits, `response_format: "Text"`, `payer_account_id: buyer`, one `exec_deposit`, gas `100 Tgas + 25 Mgas × (input bytes − 32 KiB)` and callback `on_evaluate(tender_id, attempt)` (50 Tgas). If the fee cannot pay another deposit, the tender fails instead (below).
- `retry_evaluate(tender_id)` — requires `EvalFailed`, `attempts.len() < MAX_ATTEMPTS`, and at least `RETRY_MIN_GAP_NS` (10 minutes) since the last attempt started (`E_RETRY_TOO_SOON`). Same frozen input with `attempt = n+1`. The gap exists because the evaluator's last attempt is deliberately lenient — a bid whose model calls failed is published as `EVAL_INCOMPLETE` rather than ending the tender (D-024) — which only holds if the earlier attempts were spread out. Without it anyone could fire attempts 2 and 3 in consecutive blocks during one outage.
- `on_evaluate(tender_id, attempt)` — `#[private]`, never panics. A result for a tender that is not `Evaluating` that same attempt is ignored and logged (`E_STALE_RESULT`). If the promise failed (`E_EVAL_PROMISE_FAILED`), OutLayer returned `null` (`E_EVAL_RUN_FAILED`) or the output breaks a rule below (`E_RESULT_*`): record `Failed{reason}` (truncated to 200 chars); status `EvalFailed` if fewer than 3 attempts were made and the fee pays another deposit, else `Failed`: escrow, every unsettled bond and the remaining fee go back. If valid: store `result_json` verbatim, mark the attempt `Accepted`, status `Evaluated`, settle each bond once (I10): forfeited to the buyer for bids flagged DECRYPT_FAILED (2) or ACCOUNT_MISMATCH (4), refunded otherwise.

Validation of the compact result (all must hold; each failure has its own `E_RESULT_*` code, listed in the crate README):
1. ≤ 900 bytes; its own JCS form; JSON with exactly the fields of `specs/schemas/compact-result.schema.json` (checked by hand in Rust, no schema lib); `v == 1`; `bundle` is 64 lowercase hex.
2. `tid == tender_id`, `root == frozen.root`, `rubric == rubric_hash`, `attempt == current attempt`.
3. `rk` contains each index 0..n-1 exactly once; totals ≤ 10000; flags ≤ 127; flags 2 and 4 only together with flag 1; ineligible entries total 0.
4. Eligible entries come first, sorted by total descending (the contract cannot check the price tie-break, the verifier does); ineligible entries follow by index.
5. `status` consistent: `no_eligible_bids` iff every entry has flag bit 0; else `needs_committee` iff some eligible entry has bit 6; else `ok`.

### Committee
- `propose_award(tender_id, bid_index, amount, rationale)` — member only; status `Evaluated`; bid eligible per stored result; not lapsed; `0 < amount ≤ budget_cap`; `deviation = bid_index != first eligible index in rk`; if deviation, `rationale.len() ≥ MIN_DEVIATION_RATIONALE_CHARS`. Replaces any pending proposal (resets approvals). Proposer counts as first approval. If approvals reach `approvals_required`, status `Awarded`, `accept_by_ns = now + acceptance_window_ns`. Emits `award_proposed` / `award_approved`.
- `approve_award(tender_id, bid_index, amount)` — member only; must match the pending proposal exactly (prevents approving a different proposal than you read).
- `close_without_award(tender_id, rationale)` — needs the same approvals threshold (implement as a proposal with `bid_index = None`). Refunds escrow to buyer. Status `ClosedNoAward`.

### Winner
- `accept_award(tender_id, payout: PayoutTarget)` — caller must be the awarded bid's bidder; before `accept_by_ns`. `PayoutTarget::Near { account }` or `PayoutTarget::Intents { destination_asset, recipient }`. Status `PayingOut` and starts payout (09-payout.md).
- `lapse_award(tender_id)` — anyone, after `accept_by_ns`. Marks bid lapsed, status back to `Evaluated` so the committee can award the next one.

### Views
`version()`, `get_config()`, `get_evaluators()`, `get_tender(id)`, `list_tenders(from, limit ≤ 50)`, `get_bids(id)` (no ciphertext: slot, bidder, submitted_at_ns, ciphertext_sha256, ciphertext_len, debrief_pubkey, bond, withdrawn, bond_settled), `get_bid_ciphertext(id, slot)`, `get_frozen(id)` (slots, leaves, root), `get_attempts(id)`, `get_result(id)` (verbatim JSON string), `get_award(id)`, `get_balance(id, account)`, `is_ciphertext_used(id, sha256)`.

## Events (NEP-297)

`EVENT_JSON:{"standard":"sealedchoice","version":"1.0.0","event":"<name>","data":[{...}]}` for: `evaluator_added`, `tender_created`, `key_requested`, `tender_key_set`, `tender_funded`, `tender_cancelled`, `escrow_refund_failed`, `deposited`, `balance_withdrawn`, `bid_submitted`, `bid_withdrawn`, `tender_closed` (root, n), `evaluation_requested` (attempt, deposit, input bytes), `evaluation_failed` (attempt, reason, final), `evaluation_accepted` (attempt, bundle hash, status), `tender_failed`, `bonds_settled`; T08 adds `award_proposed`, `award_approved`, `award_accepted`, `award_lapsed`, `payout_started`, `payout_completed`, `payout_failed`, `closed_without_award`.

## Invariants (each one is a named test; the attack page in the demo calls the same methods)

| Id | Invariant | Test |
|---|---|---|
| I1 | No method changes `rubric_json`, `rubric_hash`, `evaluator`, `committee`, `deadline_ns` or `bond` after creation | unit: there is no setter; integration: `update_rubric` does not exist, call fails. T03: `i1_method_list_has_no_setter_for_immutable_fields`, `i1_no_method_changes_the_fixed_fields` |
| I2 | No bid accepted at or after the deadline | unit with mocked block timestamp. T03: `i2_no_bid_at_or_after_the_deadline`, `i2_bid_exactly_at_deadline_panics_with_code` |
| I3 | No evaluation before the deadline | unit. T04: `i3_no_evaluation_before_the_deadline`, `i3_close_at_the_deadline_requests_attempt_one`; sandbox `i3_i4_happy_path_with_the_three_bid_vector` |
| I4 | Bid set frozen at close: no submit/withdraw after; leaves/root match reference vectors | unit + `merkle.json` vectors. T04: `i4_merkle_leaves_and_roots_match_vectors`, `i4_bid_set_is_frozen_at_close`; sandbox `i3_i4_happy_path_with_the_three_bid_vector` |
| I5 | At most one accepted result per tender; a second callback is rejected | integration with mock-outlayer. T04: unit `i5_second_result_rejected`, `i12_failure_retry_success` (stale attempt); sandbox `i5_second_result_rejected` (no other delivery path exists on chain) |
| I6 | Result with wrong tid/root/rubric/attempt or incomplete ranking is rejected | unit with crafted JSON. T04: `i6_crafted_results_are_rejected` (26 crafted results), `compact_result_vector_validates`; sandbox `i6_crafted_results_rejected_and_i12_three_failures_refund_everything` |
| I7 | Only the contract's own callback can deliver a result (`#[private]`) and only for the request it made | integration: direct call to `on_evaluate` fails. T04: sandbox `i7_direct_on_evaluate_from_another_account_fails` |
| I8 | Only committee members propose/approve; deviation needs rationale; ineligible or lapsed bids cannot be awarded | unit |
| I9 | Payout only to the awarded bidder's declared target, only once, amount ≤ escrow; remainder back to buyer | integration with test FT |
| I10 | Each bond is settled exactly once (refund or forfeit), never both | unit. T03 (refund paths): `i10_withdraw_refunds_the_bond_exactly_once`, `cancel_refunds_everything_once`, `i10_settle_bond_settles_a_slot_once`; T04: `i10_bonds_settled_once_across_withdraw_failure_and_retry`, `bonds_of_unreadable_or_copied_bids_go_to_the_buyer`, `accepted_result_is_stored_verbatim_and_bonds_refunded` |
| I11 | Escrow only accepted from the buyer, in the rubric token, for exactly the cap | unit. T03: `i11_escrow_only_from_buyer_in_rubric_token_for_exact_cap`, `ft_on_transfer_refunds_bad_messages_and_late_funding` |
| I13 | A ciphertext hash can be submitted only once per tender | unit. T03: `i13_duplicate_ciphertext_is_rejected`, `i13_withdrawn_ciphertext_cannot_be_resubmitted` |
| I12 | `retry_evaluate` only after a failure, at most twice, and not inside `RETRY_MIN_GAP_NS` of the last attempt; every attempt recorded | integration. T04: unit `i12_failure_retry_success`, `i12_three_failures_fail_the_tender_and_refund_everything`, `eval_budget_survives_two_key_retries`; unit `i12_retries_cannot_be_fired_back_to_back`; sandbox `i12_failure_retry_success`, `i6_crafted_results_rejected_and_i12_three_failures_refund_everything` |
| I14 | `create_tender` refuses every rubric the pinned evaluator refuses, so a tender that takes bids can be evaluated | unit, against the evaluator's own `check_rubric`: `i14_every_rubric_the_evaluator_refuses_is_refused_at_creation` (38 rubrics, both directions), `i14_usize_fields_are_bounded_as_on_wasm32`, `i14_create_tender_refuses_a_rubric_the_prompt_cannot_show` |
| I15 | Every reader key (committee `report_pubkey`, bid `debrief_pubkey`) and the tender key is a secp256k1 point, so the evaluator can encrypt to it | unit: `i15_reader_keys_are_curve_points`, `i15_submit_bid_refuses_an_off_curve_debrief_key`, `i15_create_tender_refuses_an_off_curve_committee_key`, `i15_an_off_curve_tender_key_leaves_the_tender_pending`; sandbox gas: `gas_close_and_evaluate_with_five_large_bids` prints `submit_bid`, `gas_create_tender_with_ten_committee_keys` |

## Testing

- Unit tests: `cargo test` in `contracts/tender` with `near_sdk::test_utils::VMContextBuilder`.
- Integration: `near-workspaces` 0.23 (Rust) sandbox with `contracts/mock-outlayer`, which records `request_execution` calls and exposes `resolve(request_id, output)` so tests can deliver chosen outputs to the callback. OutLayer returns results by yield/resume (read in its source, D-018); the mock does the same, with the same resume gas. `contracts/mock-ft` is the test token. Run: `scripts/sandbox/test.sh` (CI runs the same tests; in cloud sessions the script runs neard with a shim for its open-file limit, D-022). Calls that make an OutLayer request are sent with `transact_async`, since their transaction does not finish before the mock resolves; deadlines are crossed with `fast_forward`.
- Testnet e2e: `scripts/e2e-testnet.ts` against real OutLayer (T07).
