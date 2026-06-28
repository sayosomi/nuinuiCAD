use super::*;
use serde_json::{json, Value};

fn element(value: Value) -> Value {
    value
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
        .expect("expected computed geometry")
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-6,
        "expected {actual} to be close to {expected}"
    );
}

fn assert_close_with_tolerance(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "expected {actual} to be within {tolerance} of {expected}"
    );
}

fn free_point(id: &str, name: &str, x: f64, y: f64) -> Value {
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

fn line(id: &str, name: &str, start_id: &str, end_id: &str) -> Value {
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

fn split_line(id: &str, base_line_id: &str, point_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": "分割線",
        "type": "splitLine",
        "visible": true,
        "enabled": true,
        "baseLineId": base_line_id,
        "splitPoint": { "mode": "reference", "pointId": point_id }
    }))
}

#[test]
fn splits_line_and_updates_base_geometry() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            free_point("p", "分割点", 40.0, 0.0),
            split_line("split", "line", "p"),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "line");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("line"));
    assert_eq!(far["kind"], json!("line"));
    assert_close(near["end"]["x"].as_f64().unwrap(), 40.0);
    assert_close(near["length"].as_f64().unwrap(), 40.0);
    assert_close(far["start"]["x"].as_f64().unwrap(), 40.0);
    assert_close(far["length"].as_f64().unwrap(), 60.0);
}

#[test]
fn rejects_split_point_outside_or_at_endpoint() {
    let outside = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            free_point("p", "外側点", 160.0, 0.0),
            split_line("split", "line", "p"),
        ],
        evaluation_limit_index: None,
    });
    assert!(outside
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("split")));
    assert!(outside.errors[0].message.contains("基準線上"));

    let endpoint = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            split_line("split", "line", "a"),
        ],
        evaluation_limit_index: None,
    });
    assert!(endpoint
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("split")));
    assert!(endpoint.errors[0].message.contains("端点"));
}

#[test]
fn splits_arc_line() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
            free_point(
                "mid",
                "中点",
                std::f64::consts::SQRT_2 * 5.0,
                -std::f64::consts::SQRT_2 * 5.0,
            ),
            split_line("split", "arc", "mid"),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "arc");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("arcLine"));
    assert_eq!(far["kind"], json!("arcLine"));
    assert_close(near["sweepAngleDeg"].as_f64().unwrap(), 45.0);
    assert_close(far["startAngleDeg"].as_f64().unwrap(), 45.0);
    assert_close(far["sweepAngleDeg"].as_f64().unwrap(), 45.0);
}

#[test]
fn splits_bezier_curve() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "start" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 30,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "end" },
                "endHandleAngleDeg": 180,
                "endHandleLength": 30
            })),
            free_point("mid", "中点", 50.0, 0.0),
            split_line("split", "curve", "mid"),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "curve");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("bezierCurve"));
    assert_eq!(far["kind"], json!("bezierCurve"));
    assert_close_with_tolerance(
        near["segments"].as_array().unwrap().last().unwrap()["end"]["x"]
            .as_f64()
            .unwrap(),
        50.0,
        0.01,
    );
    assert_close_with_tolerance(
        far["segments"][0]["start"]["x"].as_f64().unwrap(),
        50.0,
        0.01,
    );
}

#[test]
fn splits_offset_line() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "visible": true,
                "enabled": true,
                "baseLineIds": ["line"],
                "offset": 10,
                "side": "right",
                "closed": false
            })),
            free_point("mid", "中点", 50.0, 10.0),
            split_line("split", "offset", "mid"),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "offset");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("offsetLine"));
    assert_eq!(far["kind"], json!("offsetLine"));
    assert_close(near["segments"][0]["end"]["x"].as_f64().unwrap(), 50.0);
    assert_close(far["segments"][0]["start"]["x"].as_f64().unwrap(), 50.0);
    assert_close(near["length"].as_f64().unwrap(), 50.0);
    assert_close(far["length"].as_f64().unwrap(), 50.0);
}

#[test]
fn reports_base_and_split_point_dependencies() {
    let base_missing = evaluate_document_input(EvaluationInput {
        elements: vec![split_line("split", "line", "p")],
        evaluation_limit_index: None,
    });
    assert_eq!(base_missing.errors[0].element_id, "split");
    assert_eq!(base_missing.errors[0].missing_dependency_id, "line");

    let point_missing = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            split_line("split", "line", "p"),
        ],
        evaluation_limit_index: None,
    });
    assert_eq!(point_missing.errors[0].element_id, "split");
    assert_eq!(point_missing.errors[0].missing_dependency_id, "p");
}

#[test]
fn split_line_can_feed_downstream_line_helpers() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            free_point("p", "分割点", 40.0, 0.0),
            split_line("split", "line", "p"),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "split", "endpointKey": "start" },
                "placementMode": "ratio",
                "distance": 0,
                "ratio": 0.5
            })),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "visible": true,
                "enabled": true,
                "baseLineIds": ["split"],
                "offset": 10,
                "side": "right",
                "closed": false
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 70.0);
    assert_close(
        geometry(&result, "offset")["segments"][0]["start"]["y"]
            .as_f64()
            .unwrap(),
        10.0,
    );
}
