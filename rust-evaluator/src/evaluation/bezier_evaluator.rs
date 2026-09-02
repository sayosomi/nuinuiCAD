use serde_json::{json, Value};
use std::collections::HashMap;

use super::bezier_path::approximate_segment_length;
use super::math::normalize_degrees;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{anchor_reference_element_id, computed_point, point_anchor_or_error};
use super::types::{element_id, element_name, insert_geometry, EvaluationState, Point};

const BEZIER_LENGTH_STEPS: usize = 32;

struct IntermediatePoint {
    point: Point,
    angle_deg: f64,
    incoming_length: f64,
    outgoing_length: f64,
}

fn handle_point(point: &Point, angle_deg: f64, length: f64) -> Value {
    let angle_rad = angle_deg.to_radians();
    json!({
        "x": point.x + angle_rad.cos() * length,
        "y": point.y + angle_rad.sin() * length
    })
}

fn anchor_point_id(anchor: &Value) -> Option<String> {
    anchor_reference_element_id(anchor)
}

pub(crate) fn evaluate_bezier_curve(
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

    let mut intermediate_points = Vec::new();
    let mut intermediate_slot_ids = Vec::new();
    for intermediate in element
        .get("intermediatePoints")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = intermediate.get("id").and_then(Value::as_str) else {
            return;
        };
        intermediate_slot_ids.push(id.to_owned());
        let Some(point_anchor) = intermediate.get("point") else {
            return;
        };
        let Some(point) = point_anchor_or_error(
            element,
            point_anchor,
            &format!("intermediate:{id}"),
            state,
            &local_variables.0,
            &local_variables.1,
        ) else {
            return;
        };
        let Some(angle_deg) = evaluate_numeric_or_push(
            intermediate.get("handleAngleDeg").unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ) else {
            return;
        };
        let Some(incoming_length) = evaluate_numeric_or_push(
            intermediate
                .get("incomingHandleLength")
                .unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ) else {
            return;
        };
        let Some(outgoing_length) = evaluate_numeric_or_push(
            intermediate
                .get("outgoingHandleLength")
                .unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ) else {
            return;
        };
        intermediate_points.push(IntermediatePoint {
            point,
            angle_deg,
            incoming_length,
            outgoing_length,
        });
    }

    let Some(start_handle_angle_deg) = evaluate_numeric_or_push(
        element.get("startHandleAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(start_handle_length) = evaluate_numeric_or_push(
        element.get("startHandleLength").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_handle_angle_deg) = evaluate_numeric_or_push(
        element.get("endHandleAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_handle_length) = evaluate_numeric_or_push(
        element.get("endHandleLength").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let anchors = std::iter::once(start.clone())
        .chain(
            intermediate_points
                .iter()
                .map(|intermediate| intermediate.point.clone()),
        )
        .chain(std::iter::once(end.clone()))
        .collect::<Vec<_>>();
    let outgoing_handles = std::iter::once(handle_point(
        &start,
        start_handle_angle_deg,
        start_handle_length,
    ))
    .chain(intermediate_points.iter().map(|intermediate| {
        handle_point(
            &intermediate.point,
            intermediate.angle_deg,
            intermediate.outgoing_length,
        )
    }))
    .collect::<Vec<_>>();
    let incoming_handles = intermediate_points
        .iter()
        .map(|intermediate| {
            handle_point(
                &intermediate.point,
                intermediate.angle_deg + 180.0,
                intermediate.incoming_length,
            )
        })
        .chain(std::iter::once(handle_point(
            &end,
            end_handle_angle_deg + 180.0,
            end_handle_length,
        )))
        .collect::<Vec<_>>();

    let segments = anchors
        .windows(2)
        .enumerate()
        .map(|(index, pair)| {
            json!({
                "startPointId": pair[0].element_id,
                "endPointId": pair[1].element_id,
                "start": computed_point(pair[0].element_id.clone(), pair[0].name.clone(), pair[0].x, pair[0].y),
                "control1": outgoing_handles[index],
                "control2": incoming_handles[index],
                "end": computed_point(pair[1].element_id.clone(), pair[1].name.clone(), pair[1].x, pair[1].y)
            })
        })
        .collect::<Vec<_>>();
    let length = segments
        .iter()
        .filter_map(|segment| approximate_segment_length(segment, BEZIER_LENGTH_STEPS))
        .sum::<f64>();
    let intermediate_point_ids = element
        .get("intermediatePoints")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|intermediate| intermediate.get("point"))
        .filter_map(anchor_point_id)
        .collect::<Vec<_>>();

    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "bezierCurve",
            "elementId": id,
            "name": element_name(element),
            "startPointId": anchor_point_id(start_anchor),
            "endPointId": anchor_point_id(end_anchor),
            "intermediatePointIds": intermediate_point_ids,
            "intermediateSlotIds": intermediate_slot_ids,
            "segments": segments,
            "length": length,
            "startTangentAngleDeg": normalize_degrees(start_handle_angle_deg),
            "endTangentAngleDeg": normalize_degrees(end_handle_angle_deg + 180.0),
            "startHandleAngleDeg": start_handle_angle_deg,
            "startHandleLength": start_handle_length,
            "endHandleAngleDeg": end_handle_angle_deg,
            "endHandleLength": end_handle_length
        }),
    );
}
