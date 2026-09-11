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
use super::types::{
    EvaluationState, GeometryInputCollectionNode, GeometryInputTarget, GeometryValueOccurrence,
};
use serde_json::Value;
use std::collections::HashSet;

struct ResolverEnvironment<'a> {
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
    current_source_order: Option<f64>,
}

fn unavailable_geometry_property(property_type: &ScalarType) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: property_type.clone(),
        issue_code: "evaluation-geometry-property-unavailable".to_owned(),
        binding_id: None,
        context: None,
    }
}

fn geometry_collection_length_for_node(
    node: &GeometryInputCollectionNode,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
) -> Option<f64> {
    match node {
        GeometryInputCollectionNode::Leaf { targets } => Some(targets.len() as f64),
        GeometryInputCollectionNode::If {
            condition,
            source_order,
            then_branch,
            else_branch,
        } => match evaluate_document_typed_expression(
            condition,
            resolver,
            state,
            Some(*source_order),
        ) {
            ScalarEvaluation::Ok {
                value: ScalarValue::Boolean(true),
                ..
            } => geometry_collection_length_for_node(then_branch, resolver, state),
            ScalarEvaluation::Ok {
                value: ScalarValue::Boolean(false),
                ..
            } => geometry_collection_length_for_node(else_branch, resolver, state),
            _ => None,
        },
        GeometryInputCollectionNode::Match {
            scrutinee,
            source_order,
            arms,
        } => {
            let ScalarEvaluation::Ok {
                value: ScalarValue::Choice { value, .. },
                ..
            } = evaluate_document_typed_expression(scrutinee, resolver, state, Some(*source_order))
            else {
                return None;
            };
            arms.iter()
                .find(|(label, _)| label == &value)
                .and_then(|(_, branch)| {
                    geometry_collection_length_for_node(branch, resolver, state)
                })
        }
    }
}

pub(crate) fn lookup_geometry_collection_length(
    state: &EvaluationState,
    resolver: &dyn ScalarDocumentBindingResolver,
    collection_value_id: &str,
    seen: &mut HashSet<String>,
) -> Option<f64> {
    if !seen.insert(collection_value_id.to_owned()) {
        return None;
    }
    state
        .geometry_collection_nodes
        .get(collection_value_id)
        .and_then(|node| geometry_collection_length_for_node(node, resolver, state))
}

pub(crate) fn lookup_geometry_value_property(
    state: &EvaluationState,
    occurrence: &GeometryValueOccurrence,
    point_key: Option<&str>,
    property: &str,
    target_source_order: f64,
    current_source_order: Option<f64>,
    property_type: &ScalarType,
) -> ScalarEvaluation {
    // Presence in the separate value store is the runtime source-order check.
    // Value execution positions may be fractional within a source statement
    // gap, while the scalar resolver's current position is statement-based.
    let _ = (target_source_order, current_source_order);
    let Some(geometry) = state.computed_geometry_values.get(occurrence) else {
        return unavailable_geometry_property(property_type);
    };
    let value = if let Some(point_key) = point_key {
        geometry
            .get(point_key)
            .and_then(|point| point.get(property).and_then(Value::as_f64))
    } else if geometry.get("kind").and_then(Value::as_str) == Some("point") {
        geometry.get(property).and_then(Value::as_f64)
    } else {
        computed_reference_value(geometry, property)
    };
    value
        .map(|value| ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(value),
        })
        .unwrap_or_else(|| unavailable_geometry_property(property_type))
}

pub(crate) fn lookup_geometry_value_binder_property(
    state: &EvaluationState,
    binder_id: &str,
    point_key: Option<&str>,
    property: &str,
    target_source_order: f64,
    current_source_order: Option<f64>,
    property_type: &ScalarType,
) -> ScalarEvaluation {
    let Some(source) = state.geometry_value_binders.get(binder_id) else {
        return unavailable_geometry_property(property_type);
    };
    match source {
        GeometryInputTarget::Drawable { element_id, .. } => lookup_geometry_property(
            state,
            element_id,
            property,
            target_source_order,
            current_source_order,
            property_type,
        ),
        GeometryInputTarget::GeometryValue { occurrence, .. } => lookup_geometry_value_property(
            state,
            occurrence,
            point_key,
            property,
            target_source_order,
            current_source_order,
            property_type,
        ),
        GeometryInputTarget::Coordinate { anchor } => {
            let value = match property {
                "x" => anchor.get("x").and_then(Value::as_f64),
                "y" => anchor.get("y").and_then(Value::as_f64),
                _ => None,
            };
            value
                .map(|value| ScalarEvaluation::Ok {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(value),
                })
                .unwrap_or_else(|| unavailable_geometry_property(property_type))
        }
        GeometryInputTarget::GeometryValueMap { .. }
        | GeometryInputTarget::CollectionValue { .. }
        | GeometryInputTarget::CollectionIndex { .. } => {
            unavailable_geometry_property(property_type)
        }
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
    target_source_order: f64,
    current_source_order: Option<f64>,
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
            if !state.computed_geometry.contains_key(element_id) {
                return unavailable_geometry_property(property_type);
            }
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
        target_source_order: f64,
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

    fn lookup_geometry_value_property(
        &self,
        occurrence: &GeometryValueOccurrence,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_value_property(
            self.state,
            occurrence,
            point_key,
            property,
            target_source_order,
            self.current_source_order,
            property_type,
        )
    }

    fn lookup_geometry_value_binder_property(
        &self,
        binder_id: &str,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_value_binder_property(
            self.state,
            binder_id,
            point_key,
            property,
            target_source_order,
            self.current_source_order,
            property_type,
        )
    }

    fn lookup_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        target_source_order: f64,
    ) -> ScalarEvaluation {
        if self
            .current_source_order
            .is_some_and(|source_order| target_source_order >= source_order)
        {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        self.resolver.resolve_collection_index(
            collection_value_id,
            index,
            element_type,
            collection_length,
            target_source_order,
            self.state,
        )
    }

    fn lookup_collection_length(&self, collection_value_id: &str) -> Option<f64> {
        self.resolver.resolve_collection_length(
            collection_value_id,
            self.state,
            &mut HashSet::new(),
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
    current_source_order: Option<f64>,
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
