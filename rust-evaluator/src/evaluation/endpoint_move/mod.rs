use serde_json::Value;

use super::types::Point as ComputedPoint;

mod arc;
mod bezier;
mod line;
mod offset;
mod primitives;

pub(crate) enum EndpointMoveResult {
    Geometry(Value),
    Error(String),
}

pub(crate) fn is_supported_line_geometry(geometry: &Value) -> bool {
    matches!(
        geometry.get("kind").and_then(Value::as_str),
        Some("line" | "arcLine" | "bezierCurve" | "offsetLine" | "joinedPath")
    )
}

pub(crate) fn move_endpoint(
    geometry: &Value,
    endpoint_key: &str,
    target: &ComputedPoint,
    target_point_id: Value,
) -> EndpointMoveResult {
    match geometry.get("kind").and_then(Value::as_str) {
        Some("line") => line::move_line_endpoint(geometry, endpoint_key, target, target_point_id),
        Some("arcLine") => arc::move_arc_endpoint(geometry, endpoint_key, target),
        Some("bezierCurve") => {
            bezier::move_bezier_endpoint(geometry, endpoint_key, target, target_point_id)
        }
        Some("offsetLine") => offset::move_offset_endpoint(geometry, endpoint_key, target),
        Some("joinedPath") => offset::move_offset_endpoint(geometry, endpoint_key, target),
        _ => EndpointMoveResult::Error("端点を変更できません。".to_owned()),
    }
}
