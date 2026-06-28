use serde_json::Value;
use std::collections::HashMap;

use super::errors::{dependency_error, geometry_error};
use super::numeric_expression::evaluate_numeric_or_push;
use super::offset_paths::{build_offset_line_geometry, is_line_like_geometry};
use super::types::{element_id, element_name, insert_geometry, EvaluationState, EvaluationWarning};

pub(crate) fn evaluate_offset_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(offset) = evaluate_numeric_or_push(
        element.get("offset").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let base_line_ids = element
        .get("baseLineIds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut base_geometries = Vec::new();
    let mut has_missing_base = false;
    for base_line_id in &base_line_ids {
        let geometry = state.computed_geometry.get(base_line_id);
        if !is_line_like_geometry(geometry) {
            state
                .errors
                .push(dependency_error(state, element, base_line_id));
            has_missing_base = true;
            continue;
        }
        if let Some(geometry) = geometry {
            base_geometries.push(geometry.clone());
        }
    }
    if has_missing_base {
        return;
    }

    let signed_offset = if element
        .get("side")
        .and_then(Value::as_str)
        .is_some_and(|side| side == "right")
    {
        offset
    } else {
        -offset
    };
    let id = element_id(element).unwrap_or_default();
    let name = element_name(element);
    let result = build_offset_line_geometry(
        &id,
        &name,
        base_line_ids,
        &base_geometries,
        signed_offset,
        element
            .get("closed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    );
    if let Some(error) = result.error {
        state.errors.push(geometry_error(element, error));
        return;
    }
    for message in result.warnings {
        state.warnings.push(EvaluationWarning {
            element_id: id.clone(),
            element_name: name.clone(),
            message,
        });
    }
    if let Some(geometry) = result.geometry {
        insert_geometry(state, id, geometry);
    }
}
