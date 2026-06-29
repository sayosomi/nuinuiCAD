use serde_json::Value;
use std::collections::HashMap;

use super::corner_radius_path::{
    corner_radius_geometry, point_from_intersection, points_same_from_geometry,
    ray_direction_for_endpoint, samples_for_geometry,
};
use super::corner_radius_trim::{tangent_point_distance, trimmed_geometry};
use super::errors::{dependency_error, geometry_error};
use super::line_intersections::find_line_intersections;
use super::numeric_expression::evaluate_numeric_or_push;
use super::offset_paths::is_line_like_geometry;
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

fn endpoint_line_id(element: &Value, endpoint_key: &str) -> Option<String> {
    element
        .get(endpoint_key)?
        .get("lineId")?
        .as_str()
        .map(ToOwned::to_owned)
}

fn endpoint_key(element: &Value, endpoint_key: &str) -> Option<String> {
    element
        .get(endpoint_key)?
        .get("endpointKey")?
        .as_str()
        .map(ToOwned::to_owned)
}

fn validate_integer_index(
    element: &Value,
    index: f64,
    state: &mut EvaluationState,
) -> Option<usize> {
    if !index.is_finite() || index < 0.0 || index.fract() != 0.0 {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の番号は0以上の整数で指定してください。",
                element_name(element)
            ),
        ));
        return None;
    }
    Some(index as usize)
}

fn update_trimmed_geometry(
    state: &mut EvaluationState,
    line_id: &str,
    endpoint_key: &str,
    geometry: &Value,
    tangent_point: super::corner_radius_path::Point,
) -> bool {
    let Some(trimmed) = trimmed_geometry(geometry, endpoint_key, tangent_point) else {
        return false;
    };
    insert_geometry(state, line_id.to_owned(), trimmed);
    true
}

pub(crate) fn evaluate_corner_radius_arc_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(line1_id) = endpoint_line_id(element, "endpoint1") else {
        return;
    };
    let Some(line2_id) = endpoint_line_id(element, "endpoint2") else {
        return;
    };
    let Some(endpoint1_key) = endpoint_key(element, "endpoint1") else {
        return;
    };
    let Some(endpoint2_key) = endpoint_key(element, "endpoint2") else {
        return;
    };

    let name = element_name(element);
    if line1_id == line2_id {
        state.errors.push(geometry_error(
            element,
            format!(
                "{name} は同じ線を2回参照しているため、角R円弧線を作図できません。端点1と端点2に別の線を指定してください。"
            ),
        ));
        return;
    }

    let Some(line1) = state.computed_geometry.get(&line1_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, &line1_id));
        return;
    };
    if !is_line_like_geometry(Some(&line1)) {
        state
            .errors
            .push(dependency_error(state, element, &line1_id));
        return;
    }
    let Some(line2) = state.computed_geometry.get(&line2_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, &line2_id));
        return;
    };
    if !is_line_like_geometry(Some(&line2)) {
        state
            .errors
            .push(dependency_error(state, element, &line2_id));
        return;
    }

    let Some(radius) = evaluate_numeric_or_push(
        element.get("radius").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(intersection_index) = evaluate_numeric_or_push(
        element.get("intersectionIndex").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if radius <= 0.0 {
        state.errors.push(geometry_error(
            element,
            format!("{name} の半径は0より大きい値で指定してください。"),
        ));
        return;
    }
    let Some(intersection_index) = validate_integer_index(element, intersection_index, state)
    else {
        return;
    };

    let Some(result) = find_line_intersections(&line1, &line2, true) else {
        state
            .errors
            .push(dependency_error(state, element, &line1_id));
        return;
    };
    if let Some(error) = result.error {
        state.errors.push(geometry_error(element, error));
        return;
    }
    let Some(intersection) = result.intersections.get(intersection_index) else {
        let message = if result.intersections.is_empty() {
            format!("{name} は参照線同士の交点を見つけられません。端点1・端点2を確認してください。")
        } else {
            format!(
                "{name} の番号 {intersection_index} に対応する交点はありません。交点数は {} 個です。",
                result.intersections.len()
            )
        };
        state.errors.push(geometry_error(element, message));
        return;
    };

    let corner = point_from_intersection(intersection.x, intersection.y);
    let Some(samples1) = samples_for_geometry(&line1) else {
        state
            .errors
            .push(dependency_error(state, element, &line1_id));
        return;
    };
    let Some(samples2) = samples_for_geometry(&line2) else {
        state
            .errors
            .push(dependency_error(state, element, &line2_id));
        return;
    };
    let direction1 = ray_direction_for_endpoint(&line1, &endpoint1_key, corner, &samples1);
    let direction2 = ray_direction_for_endpoint(&line2, &endpoint2_key, corner, &samples2);
    let (Some(direction1), Some(direction2)) = (direction1, direction2) else {
        state.errors.push(geometry_error(
            element,
            format!("{name} は参照端点から接線方向を決められません。長さのある線端点を指定してください。"),
        ));
        return;
    };
    let Some(arc) = corner_radius_geometry(
        &element_id(element).unwrap_or_default(),
        &name,
        corner,
        direction1,
        direction2,
        radius,
    ) else {
        state.errors.push(geometry_error(
            element,
            format!("{name} は指定した2線から角R円弧線を作図できません。平行または一直線上ではない2線を指定してください。"),
        ));
        return;
    };
    if tangent_point_distance(&samples1, &endpoint1_key, arc.start).is_none()
        || tangent_point_distance(&samples2, &endpoint2_key, arc.end).is_none()
    {
        state.errors.push(geometry_error(
            element,
            format!("{name} は指定半径が大きすぎるか、接点が参照線上にありません。半径を小さくするか、端点を変更してください。"),
        ));
        return;
    }
    if !update_trimmed_geometry(state, &line1_id, &endpoint1_key, &line1, arc.start)
        || !update_trimmed_geometry(state, &line2_id, &endpoint2_key, &line2, arc.end)
    {
        state.errors.push(geometry_error(
            element,
            format!("{name} は元線を接点までトリムできません。参照線に長さが残る半径を指定してください。"),
        ));
        return;
    }

    let id = element_id(element).unwrap_or_default();
    let same_endpoints = points_same_from_geometry(&arc);
    insert_geometry(state, id, arc.geometry);
    if same_endpoints {
        state.errors.push(geometry_error(
            element,
            format!("{name} の始点と終点が同じ位置です。"),
        ));
    }
}
