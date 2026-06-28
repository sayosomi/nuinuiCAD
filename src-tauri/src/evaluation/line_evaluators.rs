use serde_json::{json, Value};
use std::collections::HashMap;

use super::math::{angle_from_to, normalize_degrees};
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{anchor_reference_element_id, computed_point, point_anchor_or_error};
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

pub(crate) fn evaluate_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start_anchor) = element.get("startPoint") else {
        return;
    };
    let Some(end_anchor) = element.get("endPoint") else {
        return;
    };
    let Some(start) = point_anchor_or_error(
        element,
        start_anchor,
        "start",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end) = point_anchor_or_error(
        element,
        end_anchor,
        "end",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    let start_angle = angle_from_to(&start, &end);
    let end_angle = angle_from_to(&end, &start);
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "line",
            "elementId": id,
            "name": element_name(element),
            "startPointId": anchor_reference_element_id(start_anchor),
            "endPointId": anchor_reference_element_id(end_anchor),
            "start": computed_point(start.element_id, start.name, start.x, start.y),
            "end": computed_point(end.element_id, end.name, end.x, end.y),
            "length": length,
            "startAngleDeg": start_angle,
            "endAngleDeg": end_angle,
            "startTangentAngleDeg": start_angle,
            "endTangentAngleDeg": end_angle
        }),
    );
}

pub(crate) fn evaluate_arc_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(center_anchor) = element.get("centerPoint") else {
        return;
    };
    let Some(center) = point_anchor_or_error(
        element,
        center_anchor,
        "center",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(radius) = evaluate_numeric_or_push(
        element.get("radius").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(start_angle_deg) = evaluate_numeric_or_push(
        element.get("startAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_angle_deg) = evaluate_numeric_or_push(
        element.get("endAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let safe_radius = if radius > 0.0 { radius } else { 0.0 };
    let sweep_angle_deg = normalize_degrees(end_angle_deg - start_angle_deg);
    let start_angle_rad = start_angle_deg.to_radians();
    let end_angle_rad = end_angle_deg.to_radians();
    let tangent_offset = if sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "arcLine",
            "elementId": id,
            "name": element_name(element),
            "centerPointId": anchor_reference_element_id(center_anchor),
            "center": computed_point(center.element_id, center.name, center.x, center.y),
            "start": computed_point(format!("{}:start", element_id(element).unwrap_or_default()), format!("{}.始点", element_name(element)), center.x + start_angle_rad.cos() * safe_radius, center.y - start_angle_rad.sin() * safe_radius),
            "end": computed_point(format!("{}:end", element_id(element).unwrap_or_default()), format!("{}.終点", element_name(element)), center.x + end_angle_rad.cos() * safe_radius, center.y - end_angle_rad.sin() * safe_radius),
            "radius": radius,
            "startAngleDeg": start_angle_deg,
            "endAngleDeg": end_angle_deg,
            "startTangentAngleDeg": normalize_degrees(start_angle_deg + tangent_offset),
            "endTangentAngleDeg": normalize_degrees(end_angle_deg + tangent_offset + 180.0),
            "sweepAngleDeg": sweep_angle_deg,
            "length": safe_radius * sweep_angle_deg.to_radians()
        }),
    );
}
