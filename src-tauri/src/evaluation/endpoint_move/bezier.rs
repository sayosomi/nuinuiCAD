use serde_json::{json, Value};

use super::super::bezier_path::{approximate_segment_length, cubic_point_at};
use super::super::point_anchor::computed_point;
use super::super::types::Point as ComputedPoint;
use super::primitives::{value_point, Point, EPSILON, TOLERANCE_MM};
use super::EndpointMoveResult;

fn point_on_angle_line(point: Point, origin: Point, angle_deg: f64) -> f64 {
    let angle_rad = angle_deg.to_radians();
    let direction = Point {
        x: angle_rad.cos(),
        y: angle_rad.sin(),
    };
    ((point.x - origin.x) * direction.y - (point.y - origin.y) * direction.x).abs()
}

fn handle_point(point: Point, angle_deg: f64, length: f64) -> Value {
    let angle_rad = angle_deg.to_radians();
    json!({
        "x": point.x + angle_rad.cos() * length,
        "y": point.y + angle_rad.sin() * length
    })
}

pub(super) fn move_bezier_endpoint(
    curve: &Value,
    endpoint_key: &str,
    target: &ComputedPoint,
    target_point_id: Value,
) -> EndpointMoveResult {
    let name = curve
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(source_segments) = curve.get("segments").and_then(Value::as_array) else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };
    let Some(first) = source_segments.first() else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };
    let Some(last) = source_segments.last() else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };
    let source_point = if endpoint_key == "start" {
        first.get("start").and_then(value_point)
    } else {
        last.get("end").and_then(value_point)
    };
    let Some(source_point) = source_point else {
        return EndpointMoveResult::Error("端点を変更できません。".to_owned());
    };
    let angle_deg = if endpoint_key == "start" {
        curve
            .get("startHandleAngleDeg")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    } else {
        curve
            .get("endHandleAngleDeg")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let target_point = Point {
        x: target.x,
        y: target.y,
    };
    if point_on_angle_line(target_point, source_point, angle_deg) > TOLERANCE_MM {
        return EndpointMoveResult::Error(format!(
            "{name} の{}は、指定点が端点角度の直線上にないため移動できません。",
            if endpoint_key == "start" {
                "始点"
            } else {
                "終点"
            }
        ));
    }
    let element_id = curve
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let start_handle_angle = curve
        .get("startHandleAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let start_handle_length = curve
        .get("startHandleLength")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let end_handle_angle = curve
        .get("endHandleAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let end_handle_length = curve
        .get("endHandleLength")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let segments = source_segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let mut next = segment.clone();
            if endpoint_key == "start" && index == 0 {
                let start = computed_point(
                    format!("{element_id}:start"),
                    format!("{name}.始点"),
                    target.x,
                    target.y,
                );
                next["startPointId"] = target_point_id.clone();
                next["start"] = start;
                next["control1"] =
                    handle_point(target_point, start_handle_angle, start_handle_length);
            }
            if endpoint_key == "end" && index == source_segments.len() - 1 {
                let end = computed_point(
                    format!("{element_id}:end"),
                    format!("{name}.終点"),
                    target.x,
                    target.y,
                );
                next["endPointId"] = target_point_id.clone();
                next["control2"] =
                    handle_point(target_point, end_handle_angle + 180.0, end_handle_length);
                next["end"] = end;
            }
            next
        })
        .collect::<Vec<_>>();
    let length = segments
        .iter()
        .filter_map(|segment| approximate_segment_length(segment, 32))
        .sum::<f64>();
    if length <= EPSILON {
        return EndpointMoveResult::Error(format!(
            "{name} の端点移動後の長さが0になるため、変更できません。"
        ));
    }
    let mut geometry = curve.clone();
    geometry["startPointId"] = if endpoint_key == "start" {
        target_point_id.clone()
    } else {
        curve.get("startPointId").cloned().unwrap_or(Value::Null)
    };
    geometry["endPointId"] = if endpoint_key == "end" {
        target_point_id
    } else {
        curve.get("endPointId").cloned().unwrap_or(Value::Null)
    };
    geometry["segments"] = json!(segments);
    geometry["length"] = json!(length);
    EndpointMoveResult::Geometry(geometry)
}

pub(super) fn cubic_point(segment: &Value, t: f64) -> Option<Point> {
    cubic_point_at(segment, t).map(|point| Point {
        x: point.x,
        y: point.y,
    })
}
