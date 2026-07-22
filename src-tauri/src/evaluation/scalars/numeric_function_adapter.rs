//! Pure shape adapter bridging the existing legacy Rust numeric-expression
//! evaluator's result convention
//! (`Result<f64, NumericEvalError>`, `super::super::numeric_expression::numeric_value`)
//! into this subsystem's `ScalarEvaluation` convention. Mirrors TypeScript's
//! `src/scalars/numericFunctionAdapter.ts` (`adaptNumericResult`)
//! field-for-field: `evaluation-numeric-adapter-failure` is the exact issue
//! code TS uses for this same seam.
//!
//! This module performs no geometry evaluation of its own and does not
//! replace `numeric_value`/`evaluate_numeric_or_push` - it exists solely as
//! a documented, tested seam for a future document-context environment
//! (mirroring TS Tasks 20/27/31) to expose legacy numeric values through
//! [`super::expression_evaluator::ScalarEvaluationEnvironment`], without
//! this task reimplementing distance/angle/line-distance math or wiring
//! anything into production. The typed-expression grammar (Task 14/17) has
//! no call-node syntax to invoke geometry functions directly, so
//! `evaluate_typed_expression` (`expression_evaluator.rs`) never calls this.
//! See `numeric_function_adapter_tests.rs` for the result-consistency proof
//! against the real, unmodified legacy evaluator.

use super::super::types::NumericEvalError;
use super::types::{BindingId, ScalarEvaluation, ScalarType, ScalarValue};

/// Wraps an already-computed legacy numeric-expression result. Performs no
/// evaluation of its own - the caller has already run `numeric_value` (or
/// `evaluate_numeric_or_push`). The raw `f64` is passed through unrounded
/// (no display formatting); text interpolation's 3-decimal display format
/// is a separate, later concern.
///
/// No production caller yet - exercised directly by this module's own tests
/// (`numeric_function_adapter_tests.rs`), same status as
/// `scalar_payload::decode_scalar_value`/`decode_scalar_evaluation` before
/// this task. Not dead code, just not yet wired into a document-context
/// environment (that's a later task, mirroring TS's own Tasks 20/27/31).
#[allow(dead_code)]
pub(crate) fn adapt_numeric_result(
    result: Result<f64, NumericEvalError>,
    binding_id: Option<BindingId>,
) -> ScalarEvaluation {
    match result {
        Ok(value) => ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(value),
        },
        Err(_error) => ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-numeric-adapter-failure".to_owned(),
            binding_id,
        },
    }
}
