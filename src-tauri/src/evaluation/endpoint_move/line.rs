use serde_json::{json, Value};

use super::super::math::normalize_degrees;
use super::super::point_anchor::computed_point;
use super::super::types::Point as ComputedPoint;
use super::primitives::{
    angle_from_to, distance, line_distance, value_point, Point, EPSILON, TOLERANCE_MM,
};
use super::EndpointMoveResult;

pub(super) fn computed_line(
    line: &Value,
    start: Point,
    end: Point,
    start_point_id: Value,
    end_point_id: Value,
) -> Option<Value> {
    if distance(start, end) <= EPSILON {
        return None;
    }
    let element_id = line.get("elementId")?.as_str()?;
    let name = line.get("name")?.as_str()?;
    let start_angle = angle_from_to(start, end);
    let end_angle = angle_from_to(end, start);
    Some(json!({
        "kind": "line",
        "elementId": element_id,
        "name": name,
        "startPointId": start_point_id,
        "endPointId": end_point_id,
        "start": computed_point(format!("{element_id}:start"), format!("{name}.始点"), start.x, start.y),
        "end": computed_point(format!("{element_id}:end"), format!("{name}.終点"), end.x, end.y),
        "length": distance(start, end),
        "startAngleDeg": start_angle,
        "endAngleDeg": end_angle,
        "startTangentAngleDeg": start_angle,
        "endTangentAngleDeg": end_angle
    }))
}

pub(super) fn move_line_endpoint(
    line: &Value,
    endpoint_key: &str,
    target: &ComputedPoint,
    target_point_id: Value,
) -> EndpointMoveResult {
    let Some(start) = line.get("start").and_then(value_point) else {
        return EndpointMoveResult::Error("端点を変更できません。".to_owned());
    };
    let Some(end) = line.get("end").and_then(value_point) else {
        return EndpointMoveResult::Error("端点を変更できません。".to_owned());
    };
    let target_point = Point {
        x: target.x,
        y: target.y,
    };
    if line_distance(target_point, start, end).map_or(true, |value| value > TOLERANCE_MM) {
        return EndpointMoveResult::Error(format!(
            "{} の{}は、指定点が直線上または延長線上にないため移動できません。",
            line.get("name").and_then(Value::as_str).unwrap_or_default(),
            if endpoint_key == "start" {
                "始点"
            } else {
                "終点"
            }
        ));
    }
    let geometry = computed_line(
        line,
        if endpoint_key == "start" {
            target_point
        } else {
            start
        },
        if endpoint_key == "end" {
            target_point
        } else {
            end
        },
        if endpoint_key == "start" {
            target_point_id.clone()
        } else {
            line.get("startPointId").cloned().unwrap_or(Value::Null)
        },
        if endpoint_key == "end" {
            target_point_id
        } else {
            line.get("endPointId").cloned().unwrap_or(Value::Null)
        },
    );
    geometry.map_or_else(
        || {
            EndpointMoveResult::Error(format!(
                "{} の端点移動後の長さが0になるため、変更できません。",
                line.get("name").and_then(Value::as_str).unwrap_or_default()
            ))
        },
        EndpointMoveResult::Geometry,
    )
}

pub(super) fn reversed_angle(angle: &Value) -> Value {
    angle
        .as_f64()
        .map(|value| json!(normalize_degrees(value + 180.0)))
        .unwrap_or(Value::Null)
}
