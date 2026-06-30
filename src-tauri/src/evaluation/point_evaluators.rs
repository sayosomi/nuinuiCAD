use serde_json::Value;
use std::collections::HashMap;

use super::errors::geometry_error;
use super::math::CIRCLE_EPSILON;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{
    computed_point, get_computed_point_or_error, point_anchor_for_element, point_anchor_or_error,
};
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

pub(crate) fn evaluate_free_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(x) = evaluate_numeric_or_push(
        element.get("x").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(y) = evaluate_numeric_or_push(
        element.get("y").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), x, y),
    );
}

pub(crate) fn evaluate_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchor) = point_anchor_for_element(element) else {
        return;
    };
    let from_point = if anchor.get("mode").and_then(Value::as_str) == Some("reference") {
        get_computed_point_or_error(
            element,
            anchor
                .get("pointId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            state,
        )
    } else {
        point_anchor_or_error(
            element,
            &anchor,
            "from",
            state,
            &local_variables.0,
            &local_variables.1,
        )
    };
    let Some(from_point) = from_point else {
        return;
    };
    let Some(dx) = evaluate_numeric_or_push(
        element.get("dx").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(dy) = evaluate_numeric_or_push(
        element.get("dy").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            from_point.x + dx,
            from_point.y + dy,
        ),
    );
}

pub(crate) fn evaluate_polar_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchor) = point_anchor_for_element(element) else {
        return;
    };
    let from_point = if anchor.get("mode").and_then(Value::as_str) == Some("reference") {
        get_computed_point_or_error(
            element,
            anchor
                .get("pointId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            state,
        )
    } else {
        point_anchor_or_error(
            element,
            &anchor,
            "from",
            state,
            &local_variables.0,
            &local_variables.1,
        )
    };
    let Some(from_point) = from_point else {
        return;
    };
    let Some(angle_deg) = evaluate_numeric_or_push(
        element.get("angleDeg").unwrap_or(&Value::Null),
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
    let angle_rad = angle_deg.to_radians();
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            from_point.x + angle_rad.cos() * distance,
            from_point.y + angle_rad.sin() * distance,
        ),
    );
}

pub(crate) fn evaluate_division_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start) = point_anchor_or_error(
        element,
        element.get("startPoint").unwrap_or(&Value::Null),
        "start",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end) = point_anchor_or_error(
        element,
        element.get("endPoint").unwrap_or(&Value::Null),
        "end",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let vector_x = end.x - start.x;
    let vector_y = end.y - start.y;
    let length = vector_x.hypot(vector_y);

    let (x, y) = if element.get("placementMode").and_then(Value::as_str) == Some("distance") {
        let Some(distance) = evaluate_numeric_or_push(
            element.get("distance").unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ) else {
            return;
        };
        if length <= CIRCLE_EPSILON {
            state.errors.push(geometry_error(
                element,
                format!(
                    "{} は始点と終点が同じ位置のため、距離方向を決められません。始点と終点を別の位置にしてください。",
                    element_name(element)
                ),
            ));
            return;
        }
        (
            start.x + (vector_x / length) * distance,
            start.y + (vector_y / length) * distance,
        )
    } else {
        let Some(ratio) = evaluate_numeric_or_push(
            element.get("ratio").unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ) else {
            return;
        };
        (start.x + vector_x * ratio, start.y + vector_y * ratio)
    };

    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), x, y),
    );
}
