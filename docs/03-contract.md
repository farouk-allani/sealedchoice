# 03 — Tender contract spec

Crate: `contracts/tender`. near-sdk 5.29.1 (pinned at T00, D-015). Build with `cargo near build non-reproducible-wasm` (reproducible mode for the final deployment). Implementation choices and storage deviations: DECISIONS D-018; method list and error codes: `contracts/tender/README.md`. All amounts are `U128` (JSON strings). All hashes are lowercase hex of 32 bytes. Time is `env::block_timestamp()` in nanoseconds.

## Constants

| Name | Value | Why |
|---|---|---|
| `MAX_BIDS` | 5 | OutLayer `input_data` ≤ 32 KB without extra deposit and the 180 s time budget (see 04-evaluator §7). Raise only after G1/G3 numbers allow it |
| `MAX_CIPHERTEXT_BYTES` | 4500 | plaintext limits (2000 + 1200 bytes text + fields) + ECIES overhead (97 bytes) |
| `MAX_ATTEMPTS` | 3 | first run + 2 retries |
| `MAX_RATIONALE_CHARS` | 1000 | |
| `MIN_DEVIATION_RATIONALE_CHARS` | 20 | |
| `MIN_DEADLINE_DELAY_NS` | 5 minutes (testnet), 1 hour (mainnet) | config at init |
| Prepaid gas for request_execution + callback | measure at G1; start at 150 Tgas + 50 Tgas callback | |

## Storage

```rust
pub struct Contract {
    owner: AccountId,                  // can only add evaluator versions
    outlayer: AccountId,               // outlayer.testnet / outlayer.near
    evaluators: Vector<EvaluatorRef>,  // append-only list of allowed evaluator builds
    secrets_ref: SecretsRef,           // {profile, account_id} of the OutLayer secrets
    tenders: IterableMap<u64, Tender>, // or LookupMap + counter
    bids: LookupMap<(u64, u32), Bid>,  // (tender_id, slot)
    balances: LookupMap<(u64, AccountId), NearToken>, // pre-deposited bond+storage for function-call-key bidders
    next_tender_id: u64,
    min_deadline_delay_ns: u64,
}

pub struct EvaluatorRef { wasm_url: String, wasm_sha256: String, build_target: String, source_tag: String }

pub struct Tender {
    id: u64,
    buyer: AccountId,
    rubric_json: String,               // exact JCS string
    rubric_hash: String,               // sha256(rubric_json bytes), computed by the contract
    currency_token: AccountId,         // parsed from rubric.currency.asset ("nep141:" prefix stripped)
    budget_cap: U128,                  // parsed from rubric
    approvals_required: u8,            // parsed from rubric.award_policy
    acceptance_window_ns: u64,         // parsed from rubric.award_policy
    deadline_ns: u64,
    bond: NearToken,
    committee: Vec<CommitteeMember>,   // {account, report_pubkey}
    evaluator: EvaluatorRef,           // copied at creation, never changes
    tender_pubkey: Option<String>,     // set by derive_pubkey callback
    escrowed: U128,
    eval_fee_remaining: NearToken,     // NEAR attached by buyer to pay OutLayer
    status: Status,
    bid_slots: u32,                    // slots ever used
    active_bids: u32,
    frozen: Option<Frozen>,            // set at close: ordered slot list, leaves, root
    attempts: Vec<Attempt>,            // every evaluation attempt with outcome
    result_json: Option<String>,       // accepted compact result, verbatim
    award: Option<Award>,
}

pub struct Bid { bidder: AccountId, submitted_at_ns: u64, ciphertext: Vec<u8>, ciphertext_sha256: String,
                 debrief_pubkey: String, bond: NearToken, withdrawn: bool, bond_settled: bool }
pub struct Frozen { slots: Vec<u32>, leaves: Vec<String>, root: String }
pub struct Attempt { n: u8, started_at_ns: u64, outcome: AttemptOutcome } // Pending | Accepted | Failed{reason}
pub struct Award { bid_index: u32, amount: U128, rationale: String, deviation: bool,
                   approvals: Vec<AccountId>, approved_at_ns: Option<u64>, accept_by_ns: Option<u64>,
                   lapsed: Vec<u32>, payout: Option<PayoutTarget>, payout_state: PayoutState }
```

Parse the rubric with serde_json into a minimal struct (only the fields the contract needs) and also validate: `v == 1`, weights sum to 10000, `budget_cap_minor` positive integer string, models has 3 entries, `approvals_required ≤ committee.len()`. Reject on any error.

## Methods

### Admin
- `new(owner, outlayer, secrets_ref, min_deadline_delay_ns)` — init.
- `add_evaluator(EvaluatorRef)` — owner only. Append-only. Existing tenders keep their pinned copy.

### Buyer
- `create_tender(rubric_json, deadline_ns, bond, committee, evaluator_index) -> u64` — payable. Attached NEAR must cover storage + `eval_fee` (estimate with OutLayer `estimate_execution_cost` view for 2 executions × 3 attempts worst case; refund the rest at the end). Status `PendingKey`. Immediately calls OutLayer `request_execution` with `{"action":"derive_pubkey","contract_id","tender_id"}` and callback `on_pubkey`.
- `on_pubkey(tender_id)` — `#[private]`. Parse `{"v":1,"tid","pk"}`; check `tid`; check `pk` is a 33-byte compressed secp256k1 point (hex 66 chars, prefix 02/03). Status `AwaitingFunds`. On failure: status stays `PendingKey`, `retry_pubkey` allowed (buyer).
- `ft_on_transfer(sender_id, amount, msg)` — NEP-141 receiver. `msg = {"fund_tender": "<id>"}`. Accept only from `currency_token`, only from the buyer, only in `AwaitingFunds`, only `amount == budget_cap`; otherwise return the full amount (refund). Status `Open`.
- `cancel_tender(tender_id, reason)` — buyer, only in `Open`/`AwaitingFunds`/`PendingKey` and before the deadline. Refund escrow, all bonds, remaining eval fee. Status `Cancelled`.

### Bidder
- `deposit(tender_id)` — payable. Credits `balances[(tender_id, caller)]`. For bidders using a function-call key (cannot attach deposits).
- `submit_bid(tender_id, ciphertext_b64, debrief_pubkey)` — payable (or uses balance). Requires `Open`, `now < deadline`, caller has no active bid, `active_bids < MAX_BIDS`, ciphertext decodes and `≤ MAX_CIPHERTEXT_BYTES`, `debrief_pubkey` valid compressed point, `ciphertext_sha256` never seen before in this tender (including withdrawn bids: `E_DUPLICATE_CIPHERTEXT`), attached + balance ≥ `bond + storage_cost`. Stores bid, emits `bid_submitted {tender_id, slot, bidder, ciphertext_sha256, submitted_at_ns}`. Returns the receipt `{slot, ciphertext_sha256, submitted_at_ns}`.
- `withdraw_bid(tender_id)` — before deadline only. Refunds bond, frees the slot (marks withdrawn).

### Anyone
- `close_and_evaluate(tender_id)` — requires `Open` and `now ≥ deadline`. If no active bids: refund escrow and fee, status `NoBids`. Otherwise freeze: ordered list of active slots by `submitted_at_ns` (ties by slot), indices 0..n-1, leaves and root exactly as `specs/reference/reference.py` (`merkle_leaf`, `merkle_root`) computed with `env::sha256`. Push `Attempt{n:1}`, status `Evaluating`, call `request_execution` with the input in 04-evaluator §6 and callback `on_evaluate(tender_id, attempt)`.
- `retry_evaluate(tender_id)` — requires `EvalFailed` and `attempts.len() < MAX_ATTEMPTS`. Same frozen input with `attempt = n+1`.
- `on_evaluate(tender_id, attempt)` — `#[private]`. If the promise failed or the output is invalid: record `Failed{reason}` (truncate to 200 chars), status `EvalFailed`, or `Failed` if this was attempt 3 (then refund everything). If valid: store `result_json` verbatim, mark attempt `Accepted`, status `Evaluated`, settle bonds (refund all, except bids flagged DECRYPT_FAILED or ACCOUNT_MISMATCH: those bonds go to the buyer). A result for a tender that is not `Evaluating` with the same attempt number is rejected.

Validation of the compact result (all must hold):
1. Valid JSON matching `specs/schemas/compact-result.schema.json` (check by hand in Rust, no schema lib).
2. `tid == tender_id`, `root == frozen.root`, `rubric == rubric_hash`, `attempt == current attempt`.
3. `rk` contains each index 0..n-1 exactly once; totals ≤ 10000; flags ≤ 127.
4. Eligible entries come before ineligible ones and are sorted by total descending (the contract cannot check the price tie-break, the verifier does).
5. `status` consistent: `no_eligible_bids` iff every entry has flag bit 0; `needs_committee` iff some eligible entry has bit 6.

### Committee
- `propose_award(tender_id, bid_index, amount, rationale)` — member only; status `Evaluated`; bid eligible per stored result; not lapsed; `0 < amount ≤ budget_cap`; `deviation = bid_index != first eligible index in rk`; if deviation, `rationale.len() ≥ MIN_DEVIATION_RATIONALE_CHARS`. Replaces any pending proposal (resets approvals). Proposer counts as first approval. If approvals reach `approvals_required`, status `Awarded`, `accept_by_ns = now + acceptance_window_ns`. Emits `award_proposed` / `award_approved`.
- `approve_award(tender_id, bid_index, amount)` — member only; must match the pending proposal exactly (prevents approving a different proposal than you read).
- `close_without_award(tender_id, rationale)` — needs the same approvals threshold (implement as a proposal with `bid_index = None`). Refunds escrow to buyer. Status `ClosedNoAward`.

### Winner
- `accept_award(tender_id, payout: PayoutTarget)` — caller must be the awarded bid's bidder; before `accept_by_ns`. `PayoutTarget::Near { account }` or `PayoutTarget::Intents { destination_asset, recipient }`. Status `PayingOut` and starts payout (09-payout.md).
- `lapse_award(tender_id)` — anyone, after `accept_by_ns`. Marks bid lapsed, status back to `Evaluated` so the committee can award the next one.

### Views
`get_tender(id)`, `list_tenders(from, limit)`, `get_bids(id)` (no ciphertext: bidder, slot, submitted_at, ciphertext_sha256, debrief_pubkey, withdrawn), `get_bid_ciphertext(id, slot)`, `get_frozen(id)` (slots, leaves, root), `get_attempts(id)`, `get_result(id)` (verbatim JSON string), `get_award(id)`, `get_balance(id, account)`, `get_evaluators()`.

## Events (NEP-297)

`EVENT_JSON:{"standard":"sealedchoice","version":"1.0.0","event":"<name>","data":[{...}]}` for: `tender_created`, `tender_key_set`, `tender_funded`, `tender_cancelled`, `bid_submitted`, `bid_withdrawn`, `tender_closed` (root, n), `evaluation_requested` (attempt), `evaluation_failed` (attempt, reason), `evaluation_accepted` (attempt, bundle hash, status), `bonds_settled`, `award_proposed`, `award_approved`, `award_accepted`, `award_lapsed`, `payout_started`, `payout_completed`, `payout_failed`, `closed_without_award`.

## Invariants (each one is a named test; the attack page in the demo calls the same methods)

| Id | Invariant | Test |
|---|---|---|
| I1 | No method changes `rubric_json`, `rubric_hash`, `evaluator`, `committee`, `deadline_ns` or `bond` after creation | unit: there is no setter; integration: `update_rubric` does not exist, call fails. T03: `i1_method_list_has_no_setter_for_immutable_fields`, `i1_no_method_changes_the_fixed_fields` |
| I2 | No bid accepted at or after the deadline | unit with mocked block timestamp. T03: `i2_no_bid_at_or_after_the_deadline`, `i2_bid_exactly_at_deadline_panics_with_code` |
| I3 | No evaluation before the deadline | unit |
| I4 | Bid set frozen at close: no submit/withdraw after; leaves/root match reference vectors | unit + `merkle.json` vectors |
| I5 | At most one accepted result per tender; a second callback is rejected | integration with mock-outlayer |
| I6 | Result with wrong tid/root/rubric/attempt or incomplete ranking is rejected | unit with crafted JSON |
| I7 | Only the contract's own callback can deliver a result (`#[private]`) and only for the request it made | integration: direct call to `on_evaluate` fails |
| I8 | Only committee members propose/approve; deviation needs rationale; ineligible or lapsed bids cannot be awarded | unit |
| I9 | Payout only to the awarded bidder's declared target, only once, amount ≤ escrow; remainder back to buyer | integration with test FT |
| I10 | Each bond is settled exactly once (refund or forfeit), never both | unit. T03 (refund paths): `i10_withdraw_refunds_the_bond_exactly_once`, `cancel_refunds_everything_once`; forfeits at T04 |
| I11 | Escrow only accepted from the buyer, in the rubric token, for exactly the cap | unit. T03: `i11_escrow_only_from_buyer_in_rubric_token_for_exact_cap`, `ft_on_transfer_refunds_bad_messages_and_late_funding` |
| I13 | A ciphertext hash can be submitted only once per tender | unit. T03: `i13_duplicate_ciphertext_is_rejected`, `i13_withdrawn_ciphertext_cannot_be_resubmitted` |
| I12 | `retry_evaluate` only after a failure and at most twice; every attempt recorded | integration |

## Testing

- Unit tests: `cargo test` in `contracts/tender` with `near_sdk::test_utils::VMContextBuilder`.
- Integration: `near-workspaces` (Rust) sandbox with `contracts/mock-outlayer`, which records `request_execution` calls and exposes `resolve(request_id, output)` so tests can deliver chosen outputs to the callback. Verify at T04 how OutLayer actually returns results (yield/resume vs plain promise return) and make the mock behave the same way.
- Testnet e2e: `scripts/e2e-testnet.ts` against real OutLayer (T07).
