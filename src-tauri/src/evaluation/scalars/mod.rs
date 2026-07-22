//! Rust-side typed scalar expression payload validation (Task 17 of
//! docs/typed-variables/plan.md). Turns untyped `serde_json::Value` crossing
//! the IPC boundary into validated Rust enums mirroring TypeScript's
//! `ScalarType`/`ScalarValue`/`ScalarEvaluation` (Task 08) and
//! `TypedScalarExpression` (Task 15) shapes, fail-closed on any structural
//! or semantic inconsistency. No operator evaluation, binding environment,
//! or document integration lives here - see `expression_payload.rs`'s
//! module doc for the exact scope boundary.

mod expression_leaf_payload;
mod expression_payload;
mod expression_shape_payload;
mod issue;
mod json_helpers;
mod scalar_payload;
mod types;

#[cfg(test)]
mod expression_payload_tests;
#[cfg(test)]
mod scalar_payload_tests;

pub(crate) use expression_payload::validate_typed_expression_payload;
