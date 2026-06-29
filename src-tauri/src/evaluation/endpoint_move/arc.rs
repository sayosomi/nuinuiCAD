use serde_json::{json, Value};

use super::super::math::{arc_tangent_angles, normalize_degrees};
use super::super::point_anchor::computed_point;
use super::super::types::Point as ComputedPoint;
use super::primitives::{distance, value_point, Point, EPSILON, TOLERANCE_MM};
use super::EndpointMoveResult;

pub(super) fn arc_point(center: Point, radius: f64, angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    Point {
        x: center.x + angle_rad.cos() * radius,
        y: center.y - angle_rad.sin() * radius,
    }
}

fn angle_of_point(center: Point, point: Point) -> f64 {
    normalize_degrees((center.y - point.y).atan2(point.x - center.x).to_degrees())
}

fn signed_sweep(start_angle_deg: f64, end_angle_deg: f64, prefer_negative: bool) -> f64 {
    let positive = normalize_degrees(end_angle_deg - start_angle_deg);
    if prefer_negative && positive > EPSILON {
        positive - 360.0
    } else {
        positive
    }
}

pub(super) fn move_arc_endpoint(
    arc: &Value,
    endpoint_key: &str,
    target: &ComputedPoint,
) -> EndpointMoveResult {
    let name = arc.get("name").and_then(Value::as_str).unwrap_or_default();
    let radius = arc.get("radius").and_then(Value::as_f64).unwrap_or(0.0);
    if radius <= EPSILON {
        return EndpointMoveResult::Error(format!(
            "{name} は半径が0のため、端点を変更できません。"
        ));
    }
    let Some(center) = arc.get("center").and_then(value_point) else {
        return EndpointMoveResult::Error("端点を変更できません。".to_owned());
    };
    let target_point = Point {
        x: target.x,
        y: target.y,
    };
    if (distance(target_point, center) - radius).abs() > TOLERANCE_MM {
        return EndpointMoveResult::Error(format!(
            "{name} の{}は、指定点が円弧の円周上にないため移動できません。",
            if endpoint_key == "start" {
                "始点"
            } else {
                "終点"
            }
        ));
    }
    let target_angle_deg = angle_of_point(center, target_point);
    let current_start = arc
        .get("startAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let current_end = arc
        .get("endAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let current_sweep = arc
        .get("sweepAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let start_angle_deg = if endpoint_key == "start" {
        target_angle_deg
    } else {
        current_start
    };
    let end_angle_deg = if endpoint_key == "end" {
        target_angle_deg
    } else {
        current_end
    };
    let sweep_angle_deg = signed_sweep(start_angle_deg, end_angle_deg, current_sweep < 0.0);
    if sweep_angle_deg.abs() <= EPSILON {
        return EndpointMoveResult::Error(format!(
            "{name} の端点移動後の円弧長が0になるため、変更できません。"
        ));
    }
    let element_id = arc
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let start = arc_point(center, radius, start_angle_deg);
    let end = arc_point(center, radius, end_angle_deg);
    EndpointMoveResult::Geometry(json!({
        "kind": "arcLine",
        "elementId": element_id,
        "name": name,
        "centerPointId": arc.get("centerPointId").cloned().unwrap_or(Value::Null),
        "center": arc.get("center").cloned().unwrap_or(Value::Null),
        "start": computed_point(format!("{element_id}:start"), format!("{name}.始点"), start.x, start.y),
        "end": computed_point(format!("{element_id}:end"), format!("{name}.終点"), end.x, end.y),
        "radius": radius,
        "startAngleDeg": start_angle_deg,
        "endAngleDeg": end_angle_deg,
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg,
        "sweepAngleDeg": sweep_angle_deg,
        "length": radius.max(0.0) * sweep_angle_deg.to_radians().abs()
    }))
}
