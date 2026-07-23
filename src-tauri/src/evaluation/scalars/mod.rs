//! Rust-side typed scalar expression payload validation (Task 17 of
//! docs/typed-variables/plan.md). Turns untyped `serde_json::Value` crossing
//! the IPC boundary into validated Rust enums mirroring TypeScript's
//! `ScalarType`/`ScalarValue`/`ScalarEvaluation` (Task 08) and
//! `TypedScalarExpression` (Task 15) shapes, fail-closed on any structural
//! or semantic inconsistency. No operator evaluation, binding environment,
//! or document integration lives here - see `expression_payload.rs`'s
//! module doc for the exact scope boundary.

// Task 18 (evaluate_typed_expression and its supporting work-stack/operator
// modules) has no production caller yet, same status Tasks 16/17 had before
// their own consumers landed - exercised directly by
// expression_evaluator_tests.rs, not dead code. Allowed module-wide rather
// than per-item because the traversal/combination split (mirroring
// expression_payload.rs/expression_shape_payload.rs) means most items in
// both files are only reachable from each other, not individually from a
// single annotated entry point.
#[allow(dead_code)]
mod expression_evaluator;
#[allow(dead_code)]
mod expression_evaluator_ops;
mod expression_leaf_payload;
mod expression_payload;
mod expression_shape_payload;
mod issue;
mod json_helpers;
mod numeric_function_adapter;
mod program_payload;
mod scalar_payload;
mod types;

#[cfg(test)]
mod expression_evaluator_tests;
#[cfg(test)]
mod expression_payload_tests;
#[cfg(test)]
mod numeric_function_adapter_tests;
#[cfg(test)]
mod program_payload_tests;
#[cfg(test)]
mod scalar_payload_tests;

// evaluate_typed_expression/ScalarEvaluationEnvironment and
// adapt_numeric_result have no production caller yet (Task 18 is still
// shadow-parity, like Tasks 16/17 before their own consumers landed) -
// exercised directly by expression_evaluator_tests.rs/
// numeric_function_adapter_tests.rs today, not dead code.
#[allow(unused_imports)]
pub(crate) use expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
pub(crate) use expression_payload::validate_typed_expression_payload;
#[allow(unused_imports)]
pub(crate) use numeric_function_adapter::adapt_numeric_result;
pub(crate) use program_payload::validate_scalar_program_payload;
