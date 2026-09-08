use serde_json::{json, Value};
use std::collections::HashMap;

use super::scalar_expression_runtime::evaluate_document_typed_expression;
use super::scalars::{ScalarDocumentBindingResolver, ScalarEvaluation, ScalarValue};
use super::types::{
    ElementId, EvaluationCommandError, EvaluationState, GeometryInputTarget,
    GeometryValueOccurrence,
};

pub(crate) type GeometryInputTargets =
    HashMap<ElementId, HashMap<String, Vec<GeometryInputTarget>>>;

fn invalid(message: impl Into<String>) -> EvaluationCommandError {
    EvaluationCommandError {
        code: "geometry-input-targets-invalid".to_owned(),
        message: message.into(),
    }
}

fn reject_unexpected_fields(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
    context: &str,
) -> Result<(), EvaluationCommandError> {
    if let Some(field) = object
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        return Err(invalid(format!("{context}.{field} is not supported")));
    }
    Ok(())
}

fn non_empty_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<String, EvaluationCommandError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("{context}.{key} must be a non-empty string")))
}

fn decode_occurrence(
    value: &Value,
    context: &str,
) -> Result<GeometryValueOccurrence, EvaluationCommandError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid(format!("{context} must be an object")))?;
    reject_unexpected_fields(object, &["sourceStatementId", "instancePath"], context)?;
    let source_statement_id = non_empty_string(object, "sourceStatementId", context)?;
    let instance_path = object
        .get("instancePath")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{context}.instancePath must be an array")))?
        .iter()
        .enumerate()
        .map(|(index, part)| {
            part.as_str()
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    invalid(format!(
                        "{context}.instancePath[{index}] must be a non-empty string"
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GeometryValueOccurrence {
        source_statement_id,
        instance_path,
    })
}

fn decode_target(
    value: &Value,
    context: &str,
) -> Result<GeometryInputTarget, EvaluationCommandError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid(format!("{context} must be an object")))?;
    let kind = non_empty_string(object, "kind", context)?;
    match kind.as_str() {
        "drawable" => {
            reject_unexpected_fields(object, &["kind", "elementId", "geometryType", "pointKey"], context)?;
            let geometry_type = non_empty_string(object, "geometryType", context)?;
            if geometry_type != "point" && geometry_type != "line" && geometry_type != "path" {
                return Err(invalid(format!("{context}.geometryType must be point, line, or path")));
            }
            Ok(GeometryInputTarget::Drawable {
                element_id: non_empty_string(object, "elementId", context)?,
                geometry_type,
                point_key: object.get("pointKey").and_then(Value::as_str).map(ToOwned::to_owned),
            })
        }
        "geometryValue" => {
            reject_unexpected_fields(object, &["kind", "occurrence", "geometryType", "pointKey"], context)?;
            let geometry_type = non_empty_string(object, "geometryType", context)?;
            if geometry_type != "point" && geometry_type != "line" && geometry_type != "path" {
                return Err(invalid(format!("{context}.geometryType must be point, line, or path")));
            }
            Ok(GeometryInputTarget::GeometryValue {
                occurrence: decode_occurrence(
                    object
                        .get("occurrence")
                        .ok_or_else(|| invalid(format!("{context}.occurrence is required")))?,
                    &format!("{context}.occurrence"),
                )?,
                geometry_type,
                point_key: object.get("pointKey").and_then(Value::as_str).map(ToOwned::to_owned),
            })
        }
        "coordinate" => {
            reject_unexpected_fields(object, &["kind", "anchor"], context)?;
            let anchor = object
                .get("anchor")
                .ok_or_else(|| invalid(format!("{context}.anchor is required")))?;
            if !anchor.is_object() {
                return Err(invalid(format!("{context}.anchor must be an object")));
            }
            Ok(GeometryInputTarget::Coordinate { anchor: anchor.clone() })
        }
        "collectionIndex" => {
            reject_unexpected_fields(
                object,
                &[
                    "kind",
                    "collectionValueId",
                    "collectionLength",
                    "targetSourceOrder",
                    "index",
                    "members",
                ],
                context,
            )?;
            let collection_length = match object.get("collectionLength") {
                None | Some(Value::Null) => None,
                Some(value) => {
                    let length = value.as_f64().ok_or_else(|| {
                        invalid(format!("{context}.collectionLength must be a number or null"))
                    })?;
                    if !length.is_finite() || length < 0.0 || length.fract() != 0.0 {
                        return Err(invalid(format!(
                            "{context}.collectionLength must be a non-negative integer"
                        )));
                    }
                    Some(length)
                }
            };
            let target_source_order = object
                .get("targetSourceOrder")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .ok_or_else(|| invalid(format!("{context}.targetSourceOrder must be a finite number")))?;
            let index = super::scalars::validate_typed_expression_payload(
                object
                    .get("index")
                    .ok_or_else(|| invalid(format!("{context}.index is required")))?,
            )
            .map_err(|issue| invalid(format!("{context}.index is invalid: {issue:?}")))?;
            let members = object
                .get("members")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid(format!("{context}.members must be an array")))?
                .iter()
                .enumerate()
                .map(|(member_index, member)| {
                    decode_target(member, &format!("{context}.members[{member_index}]"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            if members
                .iter()
                .any(|member| matches!(member, GeometryInputTarget::CollectionIndex { .. }))
            {
                return Err(invalid(format!(
                    "{context}.members must not contain collectionIndex targets"
                )));
            }
            Ok(GeometryInputTarget::CollectionIndex {
                collection_value_id: non_empty_string(object, "collectionValueId", context)?,
                collection_length,
                target_source_order,
                index,
                members,
            })
        }
        _ => Err(invalid(format!("{context}.kind is unsupported"))),
    }
}

pub(crate) fn decode_geometry_input_targets(
    payload: Option<&Value>,
) -> Result<GeometryInputTargets, EvaluationCommandError> {
    let Some(payload) = payload else {
        return Ok(HashMap::new());
    };
    let entries = payload
        .as_array()
        .ok_or_else(|| invalid("geometryInputTargets must be an array"))?;
    let mut output = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        let context = format!("geometryInputTargets[{index}]");
        let object = entry
            .as_object()
            .ok_or_else(|| invalid(format!("{context} must be an object")))?;
        reject_unexpected_fields(object, &["elementId", "parameters"], &context)?;
        let element_id = non_empty_string(object, "elementId", &context)?;
        if output.contains_key(&element_id) {
            return Err(invalid(format!("{context}.elementId is duplicated")));
        }
        let parameters = object
            .get("parameters")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid(format!("{context}.parameters must be an array")))?;
        let mut by_parameter = HashMap::new();
        for (parameter_index, parameter) in parameters.iter().enumerate() {
            let parameter_context = format!("{context}.parameters[{parameter_index}]");
            let parameter_object = parameter
                .as_object()
                .ok_or_else(|| invalid(format!("{parameter_context} must be an object")))?;
            reject_unexpected_fields(
                parameter_object,
                &["parameterKey", "target"],
                &parameter_context,
            )?;
            let parameter_key =
                non_empty_string(parameter_object, "parameterKey", &parameter_context)?;
            if by_parameter.contains_key(&parameter_key) {
                return Err(invalid(format!(
                    "{parameter_context}.parameterKey is duplicated"
                )));
            }
            let target_value = parameter_object
                .get("target")
                .ok_or_else(|| invalid(format!("{parameter_context}.target is required")))?;
            let targets = if let Some(targets) = target_value.as_array() {
                targets
                    .iter()
                    .enumerate()
                    .map(|(target_index, target)| {
                        decode_target(
                            target,
                            &format!("{parameter_context}.target[{target_index}]"),
                        )
                    })
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                vec![decode_target(
                    target_value,
                    &format!("{parameter_context}.target"),
                )?]
            };
            by_parameter.insert(parameter_key, targets);
        }
        output.insert(element_id, by_parameter);
    }
    Ok(output)
}

fn point_anchor_for_target(target: &GeometryInputTarget) -> Option<Value> {
    match target {
        GeometryInputTarget::Drawable {
            geometry_type,
            element_id,
            point_key,
        } if geometry_type == "point" => Some(match point_key {
            Some(point_key) => json!({
                "mode": "derived",
                "elementId": element_id,
                "pointKey": point_key,
            }),
            None => json!({ "mode": "reference", "pointId": element_id }),
        }),
        GeometryInputTarget::GeometryValue {
            geometry_type,
            occurrence,
            point_key,
        } if geometry_type == "point" => {
            let mut anchor = json!({
                "mode": "geometryValue",
                "occurrence": {
                    "sourceStatementId": occurrence.source_statement_id,
                    "instancePath": occurrence.instance_path,
                },
            });
            if let Some(point_key) = point_key {
                anchor["pointKey"] = Value::String(point_key.clone());
            }
            Some(anchor)
        }
        GeometryInputTarget::Coordinate { anchor } => Some(anchor.clone()),
        _ => None,
    }
}

fn materialize_target(
    target: GeometryInputTarget,
    resolver: Option<&dyn ScalarDocumentBindingResolver>,
    state: &EvaluationState,
    current_source_order: Option<f64>,
) -> Result<GeometryInputTarget, String> {
    let GeometryInputTarget::CollectionIndex {
        collection_value_id: _collection_value_id,
        collection_length,
        target_source_order,
        index,
        members,
    } = target
    else {
        return Ok(target);
    };
    if current_source_order.is_some_and(|source_order| target_source_order >= source_order) {
        return Err("evaluation-collection-index-unavailable".to_owned());
    }
    let Some(resolver) = resolver else {
        return Err("evaluation-binding-unavailable".to_owned());
    };
    let evaluation = evaluate_document_typed_expression(&index, resolver, state, current_source_order);
    let index = match evaluation {
        ScalarEvaluation::Ok {
            value: ScalarValue::Number(index),
            ..
        } if index.is_finite()
            && index.fract() == 0.0
            && index >= 0.0
            && collection_length.map_or(true, |length| index < length) => index as usize,
        ScalarEvaluation::Ok { .. } => {
            return Err("evaluation-collection-index-invalid".to_owned())
        }
        ScalarEvaluation::Error { issue_code, .. } => return Err(issue_code),
    };
    let selected = members
        .into_iter()
        .nth(index)
        .filter(|member| !matches!(member, GeometryInputTarget::CollectionIndex { .. }))
        .ok_or_else(|| "evaluation-collection-index-invalid".to_owned())?;
    Ok(selected)
}

/// Resolves deferred geometry collection indexes at the same document/runtime
/// position as the consuming element. The target members are already lowered
/// identities; this function only evaluates the typed numeric index and never
/// reparses the authored reference.
pub(crate) fn materialize_geometry_input_targets(
    state: &mut EvaluationState,
    element: &mut Value,
    element_id: &str,
    resolver: Option<&dyn ScalarDocumentBindingResolver>,
    current_source_order: Option<f64>,
) -> Result<(), String> {
    let Some(parameters) = state.geometry_input_targets.remove(element_id) else {
        return Ok(());
    };
    let mut materialized_parameters = HashMap::new();
    for (parameter_key, targets) in parameters {
        let target_count = targets.len();
        let materialized = targets
            .into_iter()
            .map(|target| materialize_target(target, resolver, state, current_source_order))
            .collect::<Result<Vec<_>, _>>()?;
        if target_count == 1 {
            if let Some(anchor) = materialized.first().and_then(point_anchor_for_target) {
                if let Some(object) = element.as_object_mut() {
                    object.insert(parameter_key.clone(), anchor);
                }
            }
        }
        materialized_parameters.insert(parameter_key, materialized);
    }
    state
        .geometry_input_targets
        .insert(element_id.to_owned(), materialized_parameters);
    Ok(())
}

fn geometry_for_target(state: &EvaluationState, target: &GeometryInputTarget) -> Option<Value> {
    match target {
        GeometryInputTarget::Drawable { geometry_type, .. }
            if geometry_type != "line" && geometry_type != "path" =>
        {
            None
        }
        GeometryInputTarget::GeometryValue { geometry_type, .. }
            if geometry_type != "line" && geometry_type != "path" =>
        {
            None
        }
        GeometryInputTarget::Drawable { element_id, .. } => {
            state.computed_geometry.get(element_id).cloned()
        }
        GeometryInputTarget::GeometryValue { occurrence, .. } => {
            state.computed_geometry_values.get(occurrence).cloned()
        }
        GeometryInputTarget::Coordinate { .. }
        | GeometryInputTarget::CollectionIndex { .. } => None,
    }
}

pub(crate) fn resolve_line_geometry_input(
    state: &EvaluationState,
    element_id: &str,
    parameter_key: &str,
    fallback_id: &str,
) -> Option<Value> {
    let target = state
        .geometry_input_targets
        .get(element_id)
        .and_then(|parameters| parameters.get(parameter_key))
        .and_then(|targets| targets.first());
    if let Some(target) = target {
        return geometry_for_target(state, target);
    }
    state.computed_geometry.get(fallback_id).cloned()
}

pub(crate) fn resolve_line_geometry_input_at(
    state: &EvaluationState,
    element_id: &str,
    parameter_key: &str,
    index: usize,
    fallback_id: &str,
) -> Option<Value> {
    let targets = state
        .geometry_input_targets
        .get(element_id)
        .and_then(|parameters| parameters.get(parameter_key));
    if let Some(targets) = targets {
        return targets
            .get(index)
            .and_then(|target| geometry_for_target(state, target));
    }
    state.computed_geometry.get(fallback_id).cloned()
}

pub(crate) fn resolve_line_geometry_inputs(
    state: &EvaluationState,
    element_id: &str,
    parameter_key: &str,
    fallback_ids: &[ElementId],
) -> Vec<Value> {
    if let Some(targets) = state
        .geometry_input_targets
        .get(element_id)
        .and_then(|parameters| parameters.get(parameter_key))
    {
        return targets
            .iter()
            .filter_map(|target| geometry_for_target(state, target))
            .collect();
    }
    fallback_ids
        .iter()
        .filter_map(|id| state.computed_geometry.get(id).cloned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::decode_geometry_input_targets;
    use serde_json::json;

    #[test]
    fn decodes_drawable_and_immutable_value_targets_without_coercing_identity() {
        let decoded = decode_geometry_input_targets(Some(&json!([
            {
                "elementId": "consumer",
                "parameters": [
                    {
                        "parameterKey": "line1Id",
                        "target": {
                            "kind": "geometryValue",
                            "occurrence": { "sourceStatementId": "value:line", "instancePath": ["instance"] },
                            "geometryType": "path"
                        }
                    },
                    {
                        "parameterKey": "line2Id",
                        "target": { "kind": "drawable", "elementId": "authored-line", "geometryType": "line" }
                    }
                ]
            }
        ])))
        .expect("valid geometry input target payload");
        assert_eq!(decoded["consumer"].len(), 2);
        assert!(matches!(
            decoded["consumer"]["line1Id"][0],
            super::super::types::GeometryInputTarget::GeometryValue { .. }
        ));
    }

    #[test]
    fn rejects_duplicate_parameter_targets() {
        let result = decode_geometry_input_targets(Some(&json!([
            {
                "elementId": "consumer",
                "parameters": [
                    { "parameterKey": "line1Id", "target": { "kind": "drawable", "elementId": "a", "geometryType": "line" } },
                    { "parameterKey": "line1Id", "target": { "kind": "drawable", "elementId": "b", "geometryType": "line" } }
                ]
            }
        ])));
        assert!(result.is_err());
    }
}
