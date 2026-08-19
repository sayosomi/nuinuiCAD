//! Task 25: connects validated typed-boolean control sources
//! (`conditionalGroup.condition`, `forGroup.showGenerated`) to the
//! document's existing `ScalarBindingResolver` at evaluation time. Mirrors
//! `src/geometry/controlBooleanRuntime.ts` - see that file's module comment
//! for the full design rationale. Never evaluates a scalar program itself,
//! never re-parses/re-resolves a name; only calls the caller-supplied
//! resolver, at most once per condition/showGenerated per group entry.

use super::numeric_expression::computed_reference_value;
use super::scalars::{
    evaluate_typed_expression, ScalarDocumentBindingResolver, ScalarEvaluation,
    ScalarEvaluationEnvironment, ScalarType, TypedScalarExpression, ValidatedPropertyBinding,
};
use super::types::EvaluationState;

/// Adapts `(resolver, state)` to the pure expression evaluator's
/// environment trait - `resolver.resolve` already does its own memoized
/// cycle-guarded lookup, so this is a zero-cost forwarding shim, never a
/// second resolver.
struct ResolverEnvironment<'a> {
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
}

impl<'a> ScalarEvaluationEnvironment for ResolverEnvironment<'a> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.resolver.resolve_binding(binding_id, self.state)
    }

    fn lookup_geometry_property(
        &self,
        element_id: &str,
        property: &str,
        _target_source_order: usize,
    ) -> ScalarEvaluation {
        let Some(geometry) = self.state.computed_geometry.get(element_id) else {
            return ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-geometry-property-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        };
        let Some(value) = computed_reference_value(geometry, property) else {
            return ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-geometry-property-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        };
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: super::scalars::ScalarValue::Number(value),
        }
    }
}

/// A `conditionalGroup`'s active branch from its typed boolean condition:
/// evaluated exactly once via the caller's existing binding resolver. Any
/// result other than a clean `Ok` boolean becomes `None` (poisoned - both
/// branches inactive), identical to the established poison semantics so the
/// caller's `activeBranch != branch` comparison keeps working unmodified.
pub(crate) fn resolve_conditional_group_branch(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
) -> Option<&'static str> {
    let environment = ResolverEnvironment { resolver, state };
    match evaluate_typed_expression(expression, &environment) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value,
        } => match value {
            super::scalars::ScalarValue::Boolean(true) => Some("then"),
            super::scalars::ScalarValue::Boolean(false) => Some("else"),
            _ => None,
        },
        _ => None,
    }
}

/// `showGenerated`'s effective value: the literal, unchanged, when unbound
/// (today's evaluation-inert behavior, exact parity); the resolved binding
/// value when bound, failing closed to `false` on anything other than a
/// clean `Ok` boolean `true` (poison, wrong runtime type, or an evaluation
/// error). Never affects iteration count/rows - presentation-only.
pub(crate) fn resolve_for_group_effective_show_generated(
    entry: Option<&ValidatedPropertyBinding>,
    literal_show_generated: bool,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
) -> bool {
    let Some(entry) = entry else {
        return literal_show_generated;
    };
    let evaluation = if let Some(expression) = entry.expression.as_ref() {
        evaluate_typed_expression(expression, &ResolverEnvironment { resolver, state })
    } else if let Some(binding_id) = entry.binding_id.as_ref() {
        resolver.resolve_binding(binding_id, state)
    } else {
        ScalarEvaluation::Error {
            r#type: entry.expected_type.clone(),
            issue_code: "property-binding-missing-source".to_owned(),
            binding_id: None,
            context: None,
        }
    };
    matches!(
        evaluation,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: super::scalars::ScalarValue::Boolean(true),
        }
    )
}
