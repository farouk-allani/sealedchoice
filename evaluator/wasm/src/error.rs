//! Why a run refuses or fails. Only fixed codes and short fixed texts: nothing here may carry a
//! secret, a key, bid plaintext or a model answer, because codes are printed (stderr and the
//! compact error object on stdout).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
    /// stdin is not the JSON shape of a known action.
    Input(&'static str),
    /// `NEAR_SENDER_ID` is not the input's `contract_id`.
    SenderMismatch,
    /// A secret or environment value is missing or malformed (the value is never printed).
    Env(&'static str),
    /// `rubric_json` is not its own JCS form, or not a rubric.
    Rubric(&'static str),
    /// The bids do not hash to `bids_root`.
    RootMismatch,
    /// `attempt` outside 1..=3.
    Attempt,
    /// The prompt template could not be rendered.
    Prompt(&'static str),
    /// The scoring core refused its input.
    Scoring(&'static str),
    /// An external service (models, signatures, attestation, bundle store) failed.
    Service(&'static str),
    /// The action exists but is not built yet (quote, payout_status: T13).
    NotImplemented(&'static str),
}

impl RunError {
    pub fn code(&self) -> &'static str {
        match self {
            RunError::Input(_) => "E_INPUT",
            RunError::SenderMismatch => "E_SENDER",
            RunError::Env(_) => "E_ENV",
            RunError::Rubric(_) => "E_RUBRIC",
            RunError::RootMismatch => "E_ROOT_MISMATCH",
            RunError::Attempt => "E_ATTEMPT",
            RunError::Prompt(_) => "E_PROMPT",
            RunError::Scoring(_) => "E_SCORING",
            RunError::Service(_) => "E_SERVICE",
            RunError::NotImplemented(_) => "E_NOT_IMPLEMENTED",
        }
    }

    fn detail(&self) -> &'static str {
        match self {
            RunError::Input(d)
            | RunError::Env(d)
            | RunError::Rubric(d)
            | RunError::Prompt(d)
            | RunError::Scoring(d)
            | RunError::Service(d)
            | RunError::NotImplemented(d) => d,
            RunError::SenderMismatch => "NEAR_SENDER_ID is not the input contract_id",
            RunError::RootMismatch => "bids do not hash to bids_root",
            RunError::Attempt => "attempt outside 1..=3",
        }
    }
}

impl fmt::Display for RunError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code(), self.detail())
    }
}

impl From<evaluator_core::EvalError> for RunError {
    fn from(e: evaluator_core::EvalError) -> Self {
        RunError::Scoring(e.code())
    }
}
