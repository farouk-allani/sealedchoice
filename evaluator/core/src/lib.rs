//! Pure scoring core. Spec: docs/04-evaluator.md, reference: specs/reference/reference.py.
//! Built at T02. No I/O, no clock, no randomness, no floats.

/// Scores are integers in basis points.
pub const BPS_SCALE: u32 = 10_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bps_scale_is_ten_thousand() {
        assert_eq!(BPS_SCALE, 10_000);
    }
}
