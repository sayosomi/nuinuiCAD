//! Shared document runtime adapter for already-validated typed scalar
//! expressions. The expression evaluator remains pure; this module only
//! connects stable binding IDs and resolved geometry-property targets to the
//! current document evaluation state.

use super::numeric_expression::computed_reference_value;
use super::scalars::{
    evaluate_typed_expression, ScalarDocumentBindingResolver, ScalarEvaluation,
    ScalarEvaluationEnvironment, ScalarType, ScalarValue, TypedScalarExpression,
};
use super::types::EvaluationState;

struct ResolverEnvironment<'a> {
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
}

impl ScalarEvaluationEnvironment for ResolverEnvironment<'_> {
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
            };
        };
        let Some(value) = computed_reference_value(geometry, property) else {
            return ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-geometry-property-unavailable".to_owned(),
                binding_id: None,
            };
        };
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(value),
        }
    }
}

/// Evaluates a typed expression using the document's existing scalar binding
/// resolver and computed geometry state. No source text is parsed here.
pub(crate) fn evaluate_document_typed_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
) -> ScalarEvaluation {
    evaluate_typed_expression(expression, &ResolverEnvironment { resolver, state })
}
