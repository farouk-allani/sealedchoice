use std::fmt;

/// Errors are codes, like the contract's `E_*` panics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalError {
    /// Hashed JSON held a float.
    JcsFloat,
    /// Hashed JSON held an integer beyond ±(2^53 − 1).
    JcsUnsafeInteger,
    /// Hashed JSON had a non-ASCII key.
    JcsNonAsciiKey,
    /// Criterion weights do not sum to 10000.
    Weights(u64),
    /// Bid indices are not 0..n-1 in order.
    BidIndices,
    /// The rubric is not usable (message names the field).
    Rubric(&'static str),
    /// An injection pattern failed to compile.
    Pattern,
    /// Empty bid set has no Merkle root.
    EmptyBidSet,
    /// Compact result over the 900-byte stdout limit.
    ResultTooLarge(usize),
}

impl EvalError {
    pub fn code(&self) -> &'static str {
        match self {
            EvalError::JcsFloat => "E_JCS_FLOAT",
            EvalError::JcsUnsafeInteger => "E_JCS_UNSAFE_INTEGER",
            EvalError::JcsNonAsciiKey => "E_JCS_NON_ASCII_KEY",
            EvalError::Weights(_) => "E_WEIGHTS",
            EvalError::BidIndices => "E_BID_INDICES",
            EvalError::Rubric(_) => "E_RUBRIC",
            EvalError::Pattern => "E_PATTERN",
            EvalError::EmptyBidSet => "E_EMPTY_BID_SET",
            EvalError::ResultTooLarge(_) => "E_RESULT_TOO_LARGE",
        }
    }
}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EvalError::Weights(sum) => {
                write!(f, "{}: weights sum to {sum}, not 10000", self.code())
            }
            EvalError::Rubric(field) => write!(f, "{}: {field}", self.code()),
            EvalError::ResultTooLarge(len) => write!(f, "{}: {len} bytes", self.code()),
            _ => f.write_str(self.code()),
        }
    }
}

impl std::error::Error for EvalError {}
