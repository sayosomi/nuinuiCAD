use serde_json::{json, Value};
use std::collections::HashMap;

use super::errors::geometry_error;
use super::geometry_value_kernels::{
    direct_arc_geometry_kernel, segment_geometry_kernel, StructuralArcLine, StructuralPoint,
};
use super::math::{angle_from_to, circle_through_three_points};
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
    let structural = segment_geometry_kernel(
        StructuralPoint {
            x: start.x,
            y: start.y,
        },
        StructuralPoint { x: end.x, y: end.y },
    );
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
            "length": structural.length,
            "startAngleDeg": structural.start_angle_deg,
            "endAngleDeg": structural.end_angle_deg,
            "startTangentAngleDeg": structural.start_tangent_angle_deg,
            "endTangentAngleDeg": structural.end_tangent_angle_deg
        }),
    );
}

pub(crate) fn evaluate_polyline(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchors) = element.get("points").and_then(Value::as_array) else {
        return;
    };
    let closed = element
        .get("closed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let minimum = if closed { 3 } else { 2 };
    if anchors.len() < minimum {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は{}つ以上の点が必要です。",
                element_name(element),
                minimum
            ),
        ));
        return;
    }

    let points = anchors
        .iter()
        .enumerate()
        .map(|(index, anchor)| {
            point_anchor_or_error(
                element,
                anchor,
                &format!("point{}", index + 1),
                state,
                &local_variables.0,
                &local_variables.1,
            )
        })
        .collect::<Option<Vec<_>>>();
    let Some(points) = points else {
        return;
    };

    let mut segments = Vec::new();
    for pair in points.windows(2) {
        let start = &pair[0];
        let end = &pair[1];
        segments.push(json!({
            "kind": "line",
            "start": computed_point(start.element_id.clone(), start.name.clone(), start.x, start.y),
            "end": computed_point(end.element_id.clone(), end.name.clone(), end.x, end.y),
            "length": (end.x - start.x).hypot(end.y - start.y)
        }));
    }
    if closed {
        let first = points.first().expect("polyline cardinality validated");
        let last = points.last().expect("polyline cardinality validated");
        if (last.x - first.x).hypot(last.y - first.y) > super::math::CIRCLE_EPSILON {
            segments.push(json!({
                "kind": "line",
                "start": computed_point(last.element_id.clone(), last.name.clone(), last.x, last.y),
                "end": computed_point(first.element_id.clone(), first.name.clone(), first.x, first.y),
                "length": (first.x - last.x).hypot(first.y - last.y)
            }));
        }
    }
    let nonzero = segments
        .iter()
        .filter_map(|segment| {
            let start = segment
                .get("start")
                .and_then(super::point_anchor::point_from_value)?;
            let end = segment
                .get("end")
                .and_then(super::point_anchor::point_from_value)?;
            (segment.get("length")?.as_f64()? > super::math::CIRCLE_EPSILON).then_some((start, end))
        })
        .collect::<Vec<_>>();
    let start_tangent = nonzero
        .first()
        .and_then(|(start, end)| super::math::angle_from_to(start, end));
    let end_tangent = nonzero
        .last()
        .and_then(|(start, end)| super::math::angle_from_to(end, start));
    let id = element_id(element).unwrap_or_default();
    let first = points.first().expect("polyline cardinality validated");
    let last = if closed {
        first.clone()
    } else {
        segments
            .last()
            .and_then(|segment| segment.get("end"))
            .and_then(super::point_anchor::point_from_value)
            .unwrap_or_else(|| {
                points
                    .last()
                    .expect("polyline cardinality validated")
                    .clone()
            })
    };
    let length = segments
        .iter()
        .filter_map(|segment| segment.get("length").and_then(Value::as_f64))
        .sum::<f64>();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "polyline",
            "elementId": id,
            "name": element_name(element),
            "segments": segments,
            "closed": closed,
            "start": computed_point(first.element_id.clone(), first.name.clone(), first.x, first.y),
            "end": computed_point(last.element_id, last.name, last.x, last.y),
            "length": length,
            "startTangentAngleDeg": start_tangent,
            "endTangentAngleDeg": end_tangent
        }),
    );
}

pub(crate) fn evaluate_angle_length_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start_anchor) = element.get("startPoint") else {
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
    let Some(angle_deg) = evaluate_numeric_or_push(
        element.get("angleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(length) = evaluate_numeric_or_push(
        element.get("length").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let angle_rad = angle_deg.to_radians();
    let end = Point {
        element_id: format!("{}:end", element_id(element).unwrap_or_default()),
        name: format!("{}.終点", element_name(element)),
        x: start.x + angle_rad.cos() * length,
        y: start.y + angle_rad.sin() * length,
    };
    let computed_length = (end.x - start.x).hypot(end.y - start.y);
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
            "endPointId": null,
            "start": computed_point(format!("{id}:start"), format!("{}.始点", element_name(element)), start.x, start.y),
            "end": computed_point(end.element_id, end.name, end.x, end.y),
            "length": computed_length,
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
    if radius.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の半径は0より大きい値で指定してください。",
                element_name(element)
            ),
        ));
        return;
    }
    let direction = element
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or("counterclockwise");
    let structural = direct_arc_geometry_kernel(
        StructuralPoint {
            x: center.x,
            y: center.y,
        },
        radius,
        start_angle_deg,
        end_angle_deg,
        direction,
    );
    let id = element_id(element).unwrap_or_default();
    insert_arc_line_geometry(
        state,
        ArcGeometry {
            id,
            name: element_name(element),
            center_point_id: anchor_reference_element_id(center_anchor),
            center,
            structural,
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

    let structural = direct_arc_geometry_kernel(
        StructuralPoint {
            x: circle.x,
            y: circle.y,
        },
        circle.radius,
        start_angle_deg,
        end_angle_deg,
        "counterclockwise",
    );
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
            structural,
        },
    );
}

struct ArcGeometry {
    id: String,
    name: String,
    center_point_id: Option<String>,
    center: Point,
    structural: StructuralArcLine,
}

fn insert_arc_line_geometry(state: &mut EvaluationState, arc: ArcGeometry) {
    let structural = arc.structural;
    insert_geometry(
        state,
        arc.id.clone(),
        json!({
            "kind": "arcLine",
            "elementId": arc.id,
            "name": arc.name,
            "centerPointId": arc.center_point_id,
            "center": computed_point(arc.center.element_id, arc.center.name, arc.center.x, arc.center.y),
            "start": computed_point(format!("{}:start", arc.id), format!("{}.始点", arc.name), structural.start.x, structural.start.y),
            "end": computed_point(format!("{}:end", arc.id), format!("{}.終点", arc.name), structural.end.x, structural.end.y),
            "radius": structural.radius,
            "startAngleDeg": structural.start_angle_deg,
            "endAngleDeg": structural.end_angle_deg,
            "startTangentAngleDeg": structural.start_tangent_angle_deg,
            "endTangentAngleDeg": structural.end_tangent_angle_deg,
            "sweepAngleDeg": structural.sweep_angle_deg,
            "length": structural.length
        }),
    );
}
