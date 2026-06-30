use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

#[test]
fn extend_trim_extends_line_and_supports_coordinate_target() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "end" },
                "point": { "mode": "coordinate", "x": 140, "y": 0 }
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "extend"));
    assert_close(
        geometry(&result, "line")["end"]["x"].as_f64().unwrap(),
        140.0,
    );
    assert_close(geometry(&result, "line")["length"].as_f64().unwrap(), 140.0);
}

#[test]
fn extend_trim_reports_line_target_error_and_dependency_error() {
    let target_error = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "外点", 140.0, 20.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
    });
    assert!(target_error.errors[0]
        .message
        .contains("直線上または延長線上"));

    let dependency_error = evaluate_document_input(EvaluationInput {
        elements: vec![element(json!({
            "id": "extend",
            "name": "延長短縮",
            "type": "extendTrim",
            "visible": true,
            "enabled": true,
            "endpoint": { "lineId": "missing", "endpointKey": "end" },
            "point": { "mode": "reference", "pointId": "target" }
        }))],
        evaluation_limit_index: None,
    });
    assert_eq!(dependency_error.errors[0].missing_dependency_id, "target");
}

#[test]
fn extend_trim_moves_arc_endpoint() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            free_point("target", "目標", -10.0, 0.0),
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
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "arc", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let arc = geometry(&result, "arc");
    assert_close(arc["endAngleDeg"].as_f64().unwrap(), 180.0);
    assert_close(arc["sweepAngleDeg"].as_f64().unwrap(), 180.0);
    assert_close(arc["end"]["x"].as_f64().unwrap(), -10.0);
}

#[test]
fn extend_trim_moves_bezier_endpoint_on_tangent() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            free_point("target", "目標", -20.0, 0.0),
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
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let curve = geometry(&result, "curve");
    assert_close(curve["segments"][0]["start"]["x"].as_f64().unwrap(), -20.0);
    assert_close(
        curve["segments"][0]["control1"]["x"].as_f64().unwrap(),
        10.0,
    );
}

#[test]
fn extend_trim_moves_open_offset_line_and_rejects_closed_offset_line() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "目標", 140.0, -10.0),
            line("line", "線", "a", "b"),
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
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "offset", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    assert_close(
        offset["segments"].as_array().unwrap().last().unwrap()["end"]["x"]
            .as_f64()
            .unwrap(),
        140.0,
    );
    assert_close(
        offset["segments"].as_array().unwrap().last().unwrap()["end"]["y"]
            .as_f64()
            .unwrap(),
        -10.0,
    );

    let closed = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "目標", 140.0, -10.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "visible": true,
                "enabled": true,
                "baseLineIds": ["line"],
                "offset": 10,
                "side": "right",
                "closed": true
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "offset", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
    });
    assert!(closed.errors[0].message.contains("閉じた線"));
}

#[test]
fn updated_line_can_feed_downstream_rust_elements() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "目標", 140.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placementMode": "ratio",
                "distance": 0,
                "ratio": 0.5
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 70.0);
}
