use serde_json::{json, Value};
use std::collections::HashMap;

use super::errors::{dependency_error, geometry_error};
use super::math::normalize_degrees;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{point_anchor_or_error, point_from_value};
use super::types::{element_id, element_name, insert_variable, EvaluationState};

pub(crate) fn evaluate_variable_element(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let value_mode = element
        .get("valueMode")
        .and_then(Value::as_str)
        .unwrap_or("expression");
    let value = match value_mode {
        "expression" => evaluate_numeric_or_push(
            element.get("expression").unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ),
        "pointDistance" => {
            let Some(point1) = point_anchor_or_error(
                element,
                element.get("point1").unwrap_or(&Value::Null),
                "point1",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let Some(point2) = point_anchor_or_error(
                element,
                element.get("point2").unwrap_or(&Value::Null),
                "point2",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            Some((point2.x - point1.x).hypot(point2.y - point1.y))
        }
        "pointAngle" => {
            let Some(point1) = point_anchor_or_error(
                element,
                element.get("point1").unwrap_or(&Value::Null),
                "point1",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let Some(point2) = point_anchor_or_error(
                element,
                element.get("point2").unwrap_or(&Value::Null),
                "point2",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            Some(normalize_degrees(
                (point2.y - point1.y)
                    .atan2(point2.x - point1.x)
                    .to_degrees(),
            ))
        }
        "pointLineDistance" => {
            let Some(point) = point_anchor_or_error(
                element,
                element.get("point").unwrap_or(&Value::Null),
                "point",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let line_id = element
                .get("lineId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(line) = state.computed_geometry.get(line_id).cloned() else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let Some(start) = line.get("start").and_then(point_from_value) else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let Some(end) = line.get("end").and_then(point_from_value) else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let dx = end.x - start.x;
            let dy = end.y - start.y;
            let length = dx.hypot(dy);
            if length <= 1e-9 {
                state.errors.push(geometry_error(
                    element,
                    format!(
                        "{} は長さ0のため点線距離を計算できません。",
                        element_name(element)
                    ),
                ));
                return;
            }
            Some((dx * (start.y - point.y) - (start.x - point.x) * dy).abs() / length)
        }
        _ => None,
    };

    let Some(value) = value else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_variable(
        state,
        id.clone(),
        json!({
            "kind": "variable",
            "elementId": id,
            "name": element_name(element),
            "value": value
        }),
    );
}
