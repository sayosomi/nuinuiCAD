use serde_json::Value;
use std::collections::HashMap;

use super::errors::{dependency_error, geometry_error};
use super::line_path::{geometry_length, point_at_distance_from_endpoint};
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::computed_point;
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

pub(crate) fn evaluate_line_division_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(endpoint) = element.get("endpoint") else {
        return;
    };
    let Some(line_id) = endpoint.get("lineId").and_then(Value::as_str) else {
        return;
    };
    let Some(endpoint_key) = endpoint.get("endpointKey").and_then(Value::as_str) else {
        return;
    };
    let Some(geometry) = state.computed_geometry.get(line_id).cloned() else {
        state.errors.push(dependency_error(state, element, line_id));
        return;
    };
    if !matches!(
        geometry.get("kind").and_then(Value::as_str),
        Some("line" | "arcLine" | "bezierCurve")
    ) {
        state.errors.push(dependency_error(state, element, line_id));
        return;
    }

    let Some(distance_or_ratio) =
        (if element.get("placementMode").and_then(Value::as_str) == Some("distance") {
            evaluate_numeric_or_push(
                element.get("distance").unwrap_or(&Value::Null),
                state,
                element,
                &local_variables.0,
                &local_variables.1,
            )
        } else {
            evaluate_numeric_or_push(
                element.get("ratio").unwrap_or(&Value::Null),
                state,
                element,
                &local_variables.0,
                &local_variables.1,
            )
        })
    else {
        return;
    };

    let path_distance = if element.get("placementMode").and_then(Value::as_str) == Some("distance")
    {
        distance_or_ratio
    } else {
        let Some(length) = geometry_length(&geometry) else {
            state.errors.push(dependency_error(state, element, line_id));
            return;
        };
        length * distance_or_ratio
    };

    let Some((x, y)) = point_at_distance_from_endpoint(&geometry, endpoint_key, path_distance)
    else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は参照線から線上位置を作図できません。長さのある線を指定してください。",
                element_name(element)
            ),
        ));
        return;
    };

    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), x, y),
    );
}
