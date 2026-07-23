//! Rust-side typed scalar expression payload validation (Task 17 of
//! docs/typed-variables/plan.md). Turns untyped `serde_json::Value` crossing
//! the IPC boundary into validated Rust enums mirroring TypeScript's
//! `ScalarType`/`ScalarValue`/`ScalarEvaluation` (Task 08) and
//! `TypedScalarExpression` (Task 15) shapes, fail-closed on any structural
//! or semantic inconsistency. Task 21 evaluates that validated data only
//! after the production geometry pass, through the document binding adapter.

// Task 21's binding evaluator is the production caller of Task 18's pure
// expression evaluator. The narrow `allow(dead_code)` annotations remain
// for helpers exercised directly by compatibility tests.
mod bindings;
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
mod property_binding_payload;
mod scalar_payload;
mod types;

#[cfg(test)]
mod bindings_tests;
#[cfg(test)]
mod expression_evaluator_tests;
#[cfg(test)]
mod expression_payload_tests;
#[cfg(test)]
mod numeric_function_adapter_tests;
#[cfg(test)]
mod program_payload_tests;
#[cfg(test)]
mod property_binding_payload_tests;
#[cfg(test)]
mod scalar_payload_tests;

pub(crate) use bindings::ScalarBindingResolver;
#[allow(unused_imports)]
pub(crate) use expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
pub(crate) use expression_payload::validate_typed_expression_payload;
#[allow(unused_imports)]
pub(crate) use numeric_function_adapter::adapt_numeric_result;
pub(crate) use program_payload::{validate_scalar_program_payload, ValidatedScalarProgram};
pub(crate) use property_binding_payload::{
    validate_property_bindings_payload, ValidatedPropertyBinding,
};
pub(crate) use types::{ScalarEvaluation, ScalarType, ScalarValue};
