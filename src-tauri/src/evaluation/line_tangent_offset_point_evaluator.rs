use serde_json::Value;
use std::collections::HashMap;

use super::errors::{dependency_error, geometry_error};
use super::line_path::tangent_at_point_on_geometry;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{computed_point, point_anchor_or_error};
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

const LINE_POINT_TOLERANCE: f64 = 0.001;

pub(crate) fn evaluate_line_tangent_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(base_line_id) = element.get("baseLineId").and_then(Value::as_str) else {
        return;
    };
    let Some(base_line) = state.computed_geometry.get(base_line_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    };
    if !matches!(
        base_line.get("kind").and_then(Value::as_str),
        Some("line" | "arcLine")
    ) {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    }

    let Some(base_point) = point_anchor_or_error(
        element,
        element.get("basePoint").unwrap_or(&Value::Null),
        "basePoint",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let Some((base_tangent_angle_deg, _distance_from_line)) = tangent_at_point_on_geometry(
        &base_line,
        (base_point.x, base_point.y),
        LINE_POINT_TOLERANCE,
    ) else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の基準点は基準線上にありません。基準線上の点を指定してください。",
                element_name(element)
            ),
        ));
        return;
    };

    let Some(tangent_angle_deg) = evaluate_numeric_or_push(
        element.get("tangentAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(distance) = evaluate_numeric_or_push(
        element.get("distance").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let angle_rad = (base_tangent_angle_deg + tangent_angle_deg).to_radians();
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            base_point.x + angle_rad.cos() * distance,
            base_point.y - angle_rad.sin() * distance,
        ),
    );
}
