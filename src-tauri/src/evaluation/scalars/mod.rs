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
mod condition_expression_payload;
mod control_boolean_payload;
#[allow(dead_code)]
mod expression_evaluator;
#[allow(dead_code)]
mod expression_evaluator_ops;
mod expression_leaf_payload;
mod expression_payload;
mod expression_shape_payload;
#[allow(dead_code)]
mod for_group_mutation_core;
mod issue;
mod json_helpers;
mod mutation;
mod mutation_payload;
mod program_payload;
mod property_binding_payload;
mod scalar_payload;
mod text;
mod text_property_binding_payload;
mod text_template_payload;
mod types;

#[cfg(test)]
mod bindings_tests;
#[cfg(test)]
mod condition_expression_payload_tests;
#[cfg(test)]
mod control_boolean_payload_tests;
#[cfg(test)]
mod expression_evaluator_tests;
#[cfg(test)]
mod expression_payload_tests;
#[cfg(test)]
mod for_group_mutation_core_tests;
#[cfg(test)]
mod program_payload_tests;
#[cfg(test)]
mod property_binding_payload_tests;
#[cfg(test)]
mod scalar_payload_tests;
#[cfg(test)]
mod text_property_binding_payload_tests;
#[cfg(test)]
mod text_template_payload_tests;
#[cfg(test)]
mod text_tests;

pub(crate) use bindings::{ScalarBindingResolver, ScalarDocumentBindingResolver};
pub(crate) use condition_expression_payload::{
    validate_condition_expressions_payload, ValidatedConditionExpression,
};
pub(crate) use control_boolean_payload::validate_control_boolean_bindings_payload;
#[allow(unused_imports)]
pub(crate) use expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
pub(crate) use expression_payload::validate_typed_expression_payload;
pub(crate) use for_group_mutation_core::{
    ForGroupMutationEnvironment, ForGroupMutationError, ForGroupMutationRunOutcome,
};
pub(crate) use mutation::{ForGroupMutationStatement, ScalarMutationResolver};
pub(crate) use mutation_payload::{validate_binding_versions_payload, ValidatedBindingVersions};
pub(crate) use program_payload::{validate_scalar_program_payload, ValidatedScalarProgram};
pub(crate) use property_binding_payload::{
    validate_property_bindings_payload, ValidatedPropertyBinding,
};
pub(crate) use text::{
    evaluate_text_template_segments, NumericExpressionHoleEvaluator, TextTemplateHoleOrigin,
};
pub(crate) use text_property_binding_payload::validate_text_property_bindings_payload;
pub(crate) use text_template_payload::{validate_text_templates_payload, ValidatedTextTemplate};
pub(crate) use types::{ScalarEvaluation, ScalarType, ScalarValue, TypedScalarExpression};
