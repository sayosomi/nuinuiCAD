//! Shared document runtime adapter for already-validated typed scalar
//! expressions. The expression evaluator remains pure; this module only
//! connects stable binding IDs and resolved geometry-property targets to the
//! current document evaluation state.

use super::numeric_expression::computed_reference_value;
use super::numeric_expression::parameter_value;
use super::scalars::{
    evaluate_typed_expression, ScalarDocumentBindingResolver, ScalarEvaluation,
    ScalarEvaluationEnvironment, ScalarType, ScalarValue, TypedScalarExpression,
};
use super::scalars::{
    resolve_geometry_builtin_target, GeometryBuiltinRuntimeError, GeometryBuiltinRuntimeTarget,
};
use super::types::EvaluationState;
use serde_json::Value;

struct ResolverEnvironment<'a> {
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
    current_source_order: Option<usize>,
}

fn unavailable_geometry_property(property_type: &ScalarType) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: property_type.clone(),
        issue_code: "evaluation-geometry-property-unavailable".to_owned(),
        binding_id: None,
        context: None,
    }
}

/// Resolves an already-validated geometry-property reference against the
/// current evaluator-owned state. Numeric properties keep the canonical
/// computed-geometry accessor; choice properties read the current effective
/// element value and carry the supplied option list through unchanged.
pub(crate) fn lookup_geometry_property(
    state: &EvaluationState,
    element_id: &str,
    property: &str,
    target_source_order: usize,
    current_source_order: Option<usize>,
    property_type: &ScalarType,
) -> ScalarEvaluation {
    if current_source_order.is_some_and(|source_order| target_source_order >= source_order) {
        return unavailable_geometry_property(property_type);
    }

    match property_type {
        ScalarType::Number => state
            .computed_geometry
            .get(element_id)
            .and_then(|geometry| computed_reference_value(geometry, property))
            .map(|value| ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(value),
            })
            .unwrap_or_else(|| unavailable_geometry_property(property_type)),
        ScalarType::Choice { options } => {
            let Some(element) = state
                .elements_by_id
                .get(element_id)
                .and_then(|index| state.elements.get(*index))
            else {
                return unavailable_geometry_property(property_type);
            };

            let value = if element.get("type").and_then(Value::as_str) == Some("arcLine")
                && property == "direction"
            {
                let Some(geometry) = state.computed_geometry.get(element_id) else {
                    return unavailable_geometry_property(property_type);
                };
                if geometry.get("kind").and_then(Value::as_str) != Some("arcLine") {
                    return unavailable_geometry_property(property_type);
                }
                let Some(sweep) = geometry.get("sweepAngleDeg").and_then(Value::as_f64) else {
                    return unavailable_geometry_property(property_type);
                };
                if sweep > 0.0 {
                    "counterclockwise"
                } else if sweep < 0.0 {
                    "clockwise"
                } else {
                    parameter_value(element, property)
                        .and_then(Value::as_str)
                        .unwrap_or("counterclockwise")
                }
            } else {
                let Some(value) = parameter_value(element, property).and_then(Value::as_str) else {
                    return unavailable_geometry_property(property_type);
                };
                value
            };

            if options.iter().any(|option| option == value) {
                ScalarEvaluation::Ok {
                    r#type: property_type.clone(),
                    value: ScalarValue::Choice {
                        value: value.to_owned(),
                        options: options.clone(),
                    },
                }
            } else {
                unavailable_geometry_property(property_type)
            }
        }
        ScalarType::String | ScalarType::Boolean => unavailable_geometry_property(property_type),
    }
}

impl ScalarEvaluationEnvironment for ResolverEnvironment<'_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.resolver.resolve_binding(binding_id, self.state)
    }

    fn lookup_geometry_property(
        &self,
        element_id: &str,
        property: &str,
        target_source_order: usize,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_property(
            self.state,
            element_id,
            property,
            target_source_order,
            self.current_source_order,
            property_type,
        )
    }

    fn lookup_geometry_builtin_target(
        &self,
        target: &super::scalars::ScalarExpressionResolvedGeometryTarget,
    ) -> Result<GeometryBuiltinRuntimeTarget, GeometryBuiltinRuntimeError> {
        let Some(source_order) = self.current_source_order else {
            return Err(GeometryBuiltinRuntimeError::Unavailable);
        };
        resolve_geometry_builtin_target(self.state, source_order, target)
    }
}

/// Evaluates a typed expression using the document's existing scalar binding
/// resolver and computed geometry state. No source text is parsed here.
pub(crate) fn evaluate_document_typed_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    current_source_order: Option<usize>,
) -> ScalarEvaluation {
    evaluate_typed_expression(
        expression,
        &ResolverEnvironment {
            resolver,
            state,
            current_source_order,
        },
    )
}
