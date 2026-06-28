use serde_json::Value;
use std::collections::HashMap;

use super::errors::{dependency_error, geometry_error};
use super::line_intersections::find_line_intersections;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::computed_point;
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

fn is_supported_line_geometry(geometry: &Value) -> bool {
    matches!(
        geometry.get("kind").and_then(Value::as_str),
        Some("line" | "arcLine")
    )
}

pub(crate) fn evaluate_intersection_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(line1_id) = element.get("line1Id").and_then(Value::as_str) else {
        return;
    };
    let Some(line2_id) = element.get("line2Id").and_then(Value::as_str) else {
        return;
    };

    if line1_id == line2_id {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は同じ線を2回参照しているため、交点を作図できません。線1と線2に別の線を指定してください。",
                element_name(element)
            ),
        ));
        return;
    }

    let Some(line1) = state.computed_geometry.get(line1_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, line1_id));
        return;
    };
    if !is_supported_line_geometry(&line1) {
        state
            .errors
            .push(dependency_error(state, element, line1_id));
        return;
    }

    let Some(line2) = state.computed_geometry.get(line2_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, line2_id));
        return;
    };
    if !is_supported_line_geometry(&line2) {
        state
            .errors
            .push(dependency_error(state, element, line2_id));
        return;
    }

    let Some(intersection_index) = evaluate_numeric_or_push(
        element.get("intersectionIndex").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if !intersection_index.is_finite()
        || intersection_index < 0.0
        || intersection_index.fract() != 0.0
    {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の番号は0以上の整数で指定してください。",
                element_name(element)
            ),
        ));
        return;
    }

    let Some(result) = find_line_intersections(
        &line1,
        &line2,
        element
            .get("useExtensions")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    ) else {
        state
            .errors
            .push(dependency_error(state, element, line1_id));
        return;
    };

    if let Some(error) = result.error {
        state.errors.push(geometry_error(element, error));
        return;
    }

    let intersection_index = intersection_index as usize;
    let Some(intersection) = result.intersections.get(intersection_index) else {
        let message = if result.intersections.is_empty() {
            format!(
                "{} は参照線同士の交点を見つけられません。線1・線2または延長設定を確認してください。",
                element_name(element)
            )
        } else {
            format!(
                "{} の番号 {} に対応する交点はありません。交点数は {} 個です。",
                element_name(element),
                intersection_index,
                result.intersections.len()
            )
        };
        state.errors.push(geometry_error(element, message));
        return;
    };

    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), intersection.x, intersection.y),
    );
}
