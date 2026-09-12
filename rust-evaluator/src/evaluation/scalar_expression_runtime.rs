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
use super::scalars::{GeometryBuiltinRuntimeError, GeometryBuiltinRuntimeTarget};
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

pub(crate) struct ForGroupGeometryPropertyRequest<'a> {
    pub(crate) template_element_id: &'a str,
    pub(crate) index: Option<&'a TypedScalarExpression>,
    pub(crate) point_key: Option<&'a str>,
    pub(crate) property: &'a str,
    pub(crate) target_source_order: f64,
    pub(crate) current_source_order: Option<f64>,
    pub(crate) property_type: &'a ScalarType,
}

fn unavailable_geometry_property(property_type: &ScalarType) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: property_type.clone(),
        issue_code: "evaluation-geometry-property-unavailable".to_owned(),
        binding_id: None,
        context: None,
    }
}

pub(crate) fn for_group_occurrence_element_id(
    state: &EvaluationState,
    resolver: &dyn ScalarDocumentBindingResolver,
    template_element_id: &str,
    index: Option<&TypedScalarExpression>,
    target_source_order: f64,
    current_source_order: Option<f64>,
) -> Result<String, String> {
    if current_source_order.is_some_and(|source_order| target_source_order >= source_order) {
        return Err("evaluation-collection-index-unavailable".to_owned());
    }
    let rows = state
        .for_group_generated_rows
        .iter()
        .filter(|row| row.template_element_id == template_element_id)
        .collect::<Vec<_>>();
    let ordinal = if let Some(index) = index {
        let evaluation =
            evaluate_document_typed_expression(index, resolver, state, current_source_order);
        match evaluation {
            ScalarEvaluation::Ok {
                value: ScalarValue::Number(value),
                ..
            } if value.is_finite() && value.fract() == 0.0 && value >= 0.0 => value as usize,
            ScalarEvaluation::Error { issue_code, .. } => return Err(issue_code),
            ScalarEvaluation::Ok { .. } => {
                return Err("evaluation-collection-index-invalid".to_owned())
            }
        }
    } else if state
        .for_group_expected_occurrence_count_by_template_id
        .get(template_element_id)
        .copied()
        .unwrap_or(rows.len())
        == 1
        && rows.len() == 1
    {
        0
    } else {
        return Err("evaluation-collection-index-unavailable".to_owned());
    };
    let row = rows
        .get(ordinal)
        .ok_or_else(|| "evaluation-collection-index-invalid".to_owned())?;
    if !state
        .computed_geometry
        .contains_key(&row.generated_element_id)
    {
        return Err("evaluation-collection-index-unavailable".to_owned());
    }
    Ok(row.generated_element_id.clone())
}

pub(crate) fn lookup_for_group_geometry_property(
    state: &EvaluationState,
    resolver: &dyn ScalarDocumentBindingResolver,
    request: ForGroupGeometryPropertyRequest<'_>,
) -> ScalarEvaluation {
    let generated_id = match for_group_occurrence_element_id(
        state,
        resolver,
        request.template_element_id,
        request.index,
        request.target_source_order,
        request.current_source_order,
    ) {
        Ok(id) => id,
        Err(issue_code) => {
            return ScalarEvaluation::Error {
                r#type: request.property_type.clone(),
                issue_code,
                binding_id: None,
                context: None,
            }
        }
    };
    if request.point_key.is_some() {
        let Some(geometry) = state.computed_geometry.get(&generated_id) else {
            return unavailable_geometry_property(request.property_type);
        };
        let Some(point) = request
            .point_key
            .and_then(|key| super::point_anchor::resolve_derived_point(geometry, key, state))
        else {
            return unavailable_geometry_property(request.property_type);
        };
        let value = match request.property {
            "x" => Some(point.x),
            "y" => Some(point.y),
            _ => None,
        };
        return value
            .map(|value| ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(value),
            })
            .unwrap_or_else(|| unavailable_geometry_property(request.property_type));
    }
    lookup_geometry_property(
        state,
        &generated_id,
        request.property,
        -1.0,
        None,
        request.property_type,
    )
}

pub(crate) fn resolve_for_group_geometry_builtin_target(
    state: &EvaluationState,
    resolver: &dyn ScalarDocumentBindingResolver,
    current_source_order: f64,
    target: &super::scalars::ScalarExpressionResolvedGeometryTarget,
) -> Result<super::scalars::GeometryBuiltinRuntimeTarget, super::scalars::GeometryBuiltinRuntimeError>
{
    if let Some(template_element_id) = target.for_group_template_element_id.as_deref() {
        let generated_id = for_group_occurrence_element_id(
            state,
            resolver,
            template_element_id,
            target.for_group_index.as_deref(),
            target
                .for_group_target_source_order
                .unwrap_or(target.statement_index),
            Some(current_source_order),
        )
        .map_err(|issue_code| match issue_code.as_str() {
            "evaluation-collection-index-invalid" => {
                super::scalars::GeometryBuiltinRuntimeError::CollectionIndexInvalid
            }
            "evaluation-collection-index-unavailable" => {
                super::scalars::GeometryBuiltinRuntimeError::CollectionIndexUnavailable
            }
            _ => super::scalars::GeometryBuiltinRuntimeError::EvaluationIssue(issue_code),
        })?;
        let mut bound = target.clone();
        bound.statement_id = generated_id;
        bound.statement_index = -1.0;
        bound.for_group_template_element_id = None;
        bound.for_group_target_source_order = None;
        bound.for_group_index = None;
        return super::scalars::resolve_geometry_builtin_target(
            state,
            current_source_order,
            &bound,
        );
    }
    super::scalars::resolve_geometry_builtin_target(state, current_source_order, target)
}

fn geometry_collection_length_for_node(
    node: &GeometryInputCollectionNode,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
) -> Option<f64> {
    match node {
        GeometryInputCollectionNode::None => None,
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
        GeometryInputCollectionNode::Coalesce {
            left_branch,
            right_branch,
        } => geometry_collection_length_for_node(left_branch, resolver, state)
            .or_else(|| geometry_collection_length_for_node(right_branch, resolver, state)),
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
        | GeometryInputTarget::CollectionIndex { .. }
        | GeometryInputTarget::ForGroupOccurrence { .. } => {
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
        ScalarType::String | ScalarType::Boolean | ScalarType::Optional { .. } => {
            unavailable_geometry_property(property_type)
        }
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

    fn lookup_for_group_geometry_property(
        &self,
        template_element_id: &str,
        index: Option<&TypedScalarExpression>,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_for_group_geometry_property(
            self.state,
            self.resolver,
            ForGroupGeometryPropertyRequest {
                template_element_id,
                index,
                point_key,
                property,
                target_source_order,
                current_source_order: self.current_source_order,
                property_type,
            },
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
        resolve_for_group_geometry_builtin_target(self.state, self.resolver, source_order, target)
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
