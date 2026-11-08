//! Storage and view types (docs/03-contract.md "Storage"). Deviations from the doc are listed
//! in docs/DECISIONS.md D-018. Every `*_ns` field is `U64` (borsh-identical to u64) so JSON
//! views carry it as a string: nanosecond timestamps exceed JavaScript's safe integers.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, NearToken, near};

/// One allowed evaluator build. Copied into each tender at creation and never changed there.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluatorRef {
    pub wasm_url: String,
    pub wasm_sha256: String,
    pub build_target: String,
    pub source_tag: String,
}

/// OutLayer secrets profile the evaluator reads (MASTER_SECRET, API keys).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SecretsRef {
    pub profile: String,
    pub account_id: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitteeMember {
    pub account: AccountId,
    /// Compressed secp256k1 public key (66 hex chars) the committee report is encrypted to.
    pub report_pubkey: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    PendingKey,
    AwaitingFunds,
    Open,
    Cancelled,
    NoBids,
    Evaluating,
    Evaluated,
    EvalFailed,
    Failed,
    Awarded,
    PayingOut,
    Paid,
    ClosedNoAward,
}

/// Bid set frozen at close (T04).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frozen {
    pub slots: Vec<u32>,
    pub leaves: Vec<String>,
    pub root: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttemptOutcome {
    Pending,
    Accepted,
    Failed { reason: String },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub n: u8,
    pub started_at_ns: U64,
    pub outcome: AttemptOutcome,
}

/// Where the winner is paid (docs/09-payout.md).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PayoutTarget {
    Near {
        account: AccountId,
    },
    Intents {
        destination_asset: String,
        recipient: String,
    },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PayoutState {
    None,
    PayingOut { deposit_address: Option<String> },
    Paid,
    PayoutFailed { reason: String },
    PayoutRefunded,
}

/// Award (T08). `bid_index: None` is a proposal to close without award.
/// Stays `None` on every tender until T08, so its shape can still change there.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Award {
    pub bid_index: Option<u32>,
    pub amount: U128,
    pub rationale: String,
    pub deviation: bool,
    pub approvals: Vec<AccountId>,
    pub approved_at_ns: Option<U64>,
    pub accept_by_ns: Option<U64>,
    pub lapsed: Vec<u32>,
    pub payout: Option<PayoutTarget>,
    pub payout_state: PayoutState,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tender {
    pub id: u64,
    pub buyer: AccountId,
    /// Exact JCS string of the rubric (checked canonical at creation).
    pub rubric_json: String,
    /// sha256(rubric_json bytes), lowercase hex, computed by the contract.
    pub rubric_hash: String,
    /// From rubric.currency.asset with the "nep141:" prefix stripped.
    pub currency_token: AccountId,
    pub budget_cap: U128,
    pub approvals_required: u8,
    pub acceptance_window_ns: U64,
    /// Block timestamp of the creating transaction. Immutable like the rest of the brief (I1).
    ///
    /// It is here so a verifier can order creation against the first bid directly, and so prove
    /// the rubric existed before anyone sealed a bid against it. Without it the only evidence is
    /// the deadline rule, which bounds creation at `deadline - min_deadline_delay_ns` and so
    /// settles the question only when the first bid lands inside that last window. A bid earlier
    /// than that leaves the bound short and the check can say nothing either way (D-035).
    pub created_at_ns: U64,
    pub deadline_ns: U64,
    pub bond: NearToken,
    pub committee: Vec<CommitteeMember>,
    pub evaluator: EvaluatorRef,
    pub tender_pubkey: Option<String>,
    pub escrowed: U128,
    /// NEAR left for OutLayer executions; refunded to the buyer when the tender ends.
    pub eval_fee_remaining: NearToken,
    /// Deposit attached to each OutLayer request: eval fee / (2 actions × MAX_ATTEMPTS).
    pub exec_deposit: NearToken,
    pub status: Status,
    /// Slots ever used (withdrawn ones included).
    pub bid_slots: u32,
    /// Slots of bids not withdrawn, in submission order (at most MAX_BIDS).
    pub active_slots: Vec<u32>,
    pub frozen: Option<Frozen>,
    pub attempts: Vec<Attempt>,
    pub result_json: Option<String>,
    pub award: Option<Award>,
}

/// Stored bid. Ciphertext stays on-chain (public); views leave it out (`BidView`).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bid {
    pub bidder: AccountId,
    pub submitted_at_ns: U64,
    pub ciphertext: Vec<u8>,
    pub ciphertext_sha256: String,
    pub debrief_pubkey: String,
    pub bond: NearToken,
    pub withdrawn: bool,
    pub bond_settled: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BidView {
    pub slot: u32,
    pub bidder: AccountId,
    pub submitted_at_ns: U64,
    pub ciphertext_sha256: String,
    pub ciphertext_len: u32,
    pub debrief_pubkey: String,
    pub bond: NearToken,
    pub withdrawn: bool,
    pub bond_settled: bool,
}

/// Returned by `submit_bid`: what the bidder keeps to check their leaf later.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BidReceipt {
    pub slot: u32,
    pub ciphertext_sha256: String,
    pub submitted_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner: AccountId,
    pub outlayer: AccountId,
    pub secrets_ref: SecretsRef,
    pub min_deadline_delay_ns: U64,
    pub next_tender_id: u64,
}
