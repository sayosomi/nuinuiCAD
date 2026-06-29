use super::*;
use serde_json::{json, Value};

pub(super) fn element(value: Value) -> Value {
    value
}

pub(super) fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
        .expect("expected computed geometry")
}

pub(super) fn geometry_missing(result: &EvaluationPayload, id: &str) -> bool {
    result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!(id))
}

pub(super) fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-6,
        "expected {actual} to be close to {expected}"
    );
}

pub(super) fn free_point(id: &str, name: &str, x: f64, y: f64) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "freePoint",
        "visible": true,
        "enabled": true,
        "x": x,
        "y": y
    }))
}

pub(super) fn line(id: &str, name: &str, start_id: &str, end_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "line",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": start_id },
        "endPoint": { "mode": "reference", "pointId": end_id }
    }))
}
