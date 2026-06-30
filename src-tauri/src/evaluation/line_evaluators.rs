use serde_json::{json, Value};
use std::collections::HashMap;

use super::errors::geometry_error;
use super::math::{
    angle_from_to, arc_tangent_angles, circle_through_three_points, normalize_degrees,
};
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{anchor_reference_element_id, computed_point, point_anchor_or_error};
use super::types::{element_id, element_name, insert_geometry, EvaluationState, Point};

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
    let dy = end.y - start.y;
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
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let id = element_id(element).unwrap_or_default();
    insert_arc_line_geometry(
        state,
        ArcGeometry {
            id,
            name: element_name(element),
            center_point_id: anchor_reference_element_id(center_anchor),
            center,
            radius,
            safe_radius,
            start_angle_deg,
            end_angle_deg,
            start_tangent_angle_deg,
            end_tangent_angle_deg,
            sweep_angle_deg,
        },
    );
}

pub(crate) fn evaluate_three_point_arc_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
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
    let Some(point3) = point_anchor_or_error(
        element,
        element.get("point3").unwrap_or(&Value::Null),
        "point3",
        state,
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
    let Some(circle) = circle_through_three_points(&point1, &point2, &point3) else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。",
                element_name(element)
            ),
        ));
        return;
    };

    let sweep_angle_deg = normalize_degrees(end_angle_deg - start_angle_deg);
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let id = element_id(element).unwrap_or_default();
    insert_arc_line_geometry(
        state,
        ArcGeometry {
            id: id.clone(),
            name: element_name(element),
            center_point_id: None,
            center: Point {
                element_id: format!("{id}:center"),
                name: format!("{}.中心点", element_name(element)),
                x: circle.x,
                y: circle.y,
            },
            radius: circle.radius,
            safe_radius: circle.radius,
            start_angle_deg,
            end_angle_deg,
            start_tangent_angle_deg,
            end_tangent_angle_deg,
            sweep_angle_deg,
        },
    );
}

struct ArcGeometry {
    id: String,
    name: String,
    center_point_id: Option<String>,
    center: Point,
    radius: f64,
    safe_radius: f64,
    start_angle_deg: f64,
    end_angle_deg: f64,
    start_tangent_angle_deg: f64,
    end_tangent_angle_deg: f64,
    sweep_angle_deg: f64,
}

fn insert_arc_line_geometry(state: &mut EvaluationState, arc: ArcGeometry) {
    let start_angle_rad = arc.start_angle_deg.to_radians();
    let end_angle_rad = arc.end_angle_deg.to_radians();
    insert_geometry(
        state,
        arc.id.clone(),
        json!({
            "kind": "arcLine",
            "elementId": arc.id,
            "name": arc.name,
            "centerPointId": arc.center_point_id,
            "center": computed_point(arc.center.element_id, arc.center.name, arc.center.x, arc.center.y),
            "start": computed_point(format!("{}:start", arc.id), format!("{}.始点", arc.name), arc.center.x + start_angle_rad.cos() * arc.safe_radius, arc.center.y + start_angle_rad.sin() * arc.safe_radius),
            "end": computed_point(format!("{}:end", arc.id), format!("{}.終点", arc.name), arc.center.x + end_angle_rad.cos() * arc.safe_radius, arc.center.y + end_angle_rad.sin() * arc.safe_radius),
            "radius": arc.radius,
            "startAngleDeg": arc.start_angle_deg,
            "endAngleDeg": arc.end_angle_deg,
            "startTangentAngleDeg": arc.start_tangent_angle_deg,
            "endTangentAngleDeg": arc.end_tangent_angle_deg,
            "sweepAngleDeg": arc.sweep_angle_deg,
            "length": arc.safe_radius * arc.sweep_angle_deg.to_radians()
        }),
    );
}
