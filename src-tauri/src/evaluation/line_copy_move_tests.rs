use super::edge_extend_test_support::*;
use super::*;
use serde_json::{json, Value};

fn bezier_curve(id: &str, start_id: &str, end_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": "曲線",
        "type": "bezierCurve",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": start_id },
        "startHandleAngleDeg": 0,
        "startHandleLength": 30,
        "intermediatePoints": [],
        "endPoint": { "mode": "reference", "pointId": end_id },
        "endHandleAngleDeg": 180,
        "endHandleLength": 30
    }))
}

fn segment_endpoint_matches(segment: &Value, key: &str, x: f64, y: f64) -> bool {
    let Some(point) = segment.get(key) else {
        return false;
    };
    let Some(actual_x) = point.get("x").and_then(Value::as_f64) else {
        return false;
    };
    let Some(actual_y) = point.get("y").and_then(Value::as_f64) else {
        return false;
    };
    (actual_x - x).abs() < 1e-6 && (actual_y - y).abs() < 1e-6
}

fn has_segment_endpoint(segments: &[Value], x: f64, y: f64) -> bool {
    segments.iter().any(|segment| {
        segment_endpoint_matches(segment, "start", x, y)
            || segment_endpoint_matches(segment, "end", x, y)
    })
}

#[test]
fn copy_line_transforms_line_arc_bezier_and_offset_line() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("move", "移動先", 20.0, 10.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("center", "中心", 0.0, 0.0),
            line("line", "線", "a", "b"),
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
            bezier_curve("curve", "a", "b"),
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
                "id": "copy",
                "name": "コピー",
                "type": "copyLine",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "move" },
                "angleDeg": 90,
                "mirrorX": false,
                "baseLineIds": ["line", "arc", "curve", "offset"]
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let copy = geometry(&result, "copy");
    assert_eq!(copy["kind"], json!("offsetLine"));
    let segments = copy["segments"].as_array().unwrap();
    assert!(segments.len() >= 4);
    assert!(has_segment_endpoint(segments, 20.0, 10.0));
    assert!(has_segment_endpoint(segments, 20.0, 110.0));
    assert!(copy["length"].as_f64().unwrap() > 230.0);
}

#[test]
fn copy_line_mirror_reverses_arc_sweep_and_supports_numeric_expression() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("move", "移動先", 0.0, 0.0),
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
            element(json!({
                "id": "copy",
                "name": "コピー",
                "type": "copyLine",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "move" },
                "angleDeg": { "kind": "expression", "expression": "@angle" },
                "mirrorX": true,
                "numericVariables": [{ "id": "angle", "name": "角度", "value": 0 }],
                "baseLineIds": ["arc"]
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let arc = &geometry(&result, "copy")["segments"][0];
    assert_eq!(arc["kind"], json!("arc"));
    assert_close(arc["sweepAngleDeg"].as_f64().unwrap(), -90.0);
}

#[test]
fn copy_line_and_move_scale_around_end_point() {
    let copy_result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("target", "移動先", 10.0, 10.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 20.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "copy",
                "name": "コピー",
                "type": "copyLine",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 0.5,
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["line"]
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(copy_result.errors.is_empty());
    let copy = geometry(&copy_result, "copy");
    assert_close(copy["segments"][0]["start"]["x"].as_f64().unwrap(), 10.0);
    assert_close(copy["segments"][0]["end"]["x"].as_f64().unwrap(), 20.0);
    assert_close(copy["length"].as_f64().unwrap(), 10.0);

    let move_result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("target", "移動先", 10.0, 10.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 20.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "move",
                "name": "移動",
                "type": "move",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 0.5,
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["line"]
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(move_result.errors.is_empty());
    assert!(geometry_missing(&move_result, "move"));
    assert_close(
        geometry(&move_result, "line")["start"]["x"]
            .as_f64()
            .unwrap(),
        10.0,
    );
    assert_close(
        geometry(&move_result, "line")["end"]["x"].as_f64().unwrap(),
        20.0,
    );
    assert_close(
        geometry(&move_result, "line")["length"].as_f64().unwrap(),
        10.0,
    );
}

#[test]
fn symmetric_copy_line_reflects_base_lines() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("axis1", "軸1", 0.0, 0.0),
            free_point("axis2", "軸2", 100.0, 0.0),
            free_point("a", "A", 0.0, 10.0),
            free_point("b", "B", 100.0, 10.0),
            line("line", "線", "a", "b"),
            bezier_curve("curve", "a", "b"),
            element(json!({
                "id": "copy",
                "name": "対称コピー",
                "type": "symmetricCopyLine",
                "visible": true,
                "enabled": true,
                "axisPoint1": { "mode": "reference", "pointId": "axis1" },
                "axisPoint2": { "mode": "reference", "pointId": "axis2" },
                "baseLineIds": ["line", "curve"]
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let copy = geometry(&result, "copy");
    assert_eq!(copy["segments"].as_array().unwrap().len(), 2);
    assert_close(copy["segments"][0]["start"]["y"].as_f64().unwrap(), -10.0);
    assert_close(
        copy["segments"][1]["control1"]["y"].as_f64().unwrap(),
        -10.0,
    );
}

#[test]
fn move_updates_existing_geometry_and_downstream_references() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("from", "From", 0.0, 0.0),
            free_point("to", "To", 20.0, 0.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "move",
                "name": "移動",
                "type": "move",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "from" },
                "endPoint": { "mode": "reference", "pointId": "to" },
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["line"]
            })),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "move"));
    assert_close(
        geometry(&result, "line")["start"]["x"].as_f64().unwrap(),
        20.0,
    );
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 70.0);
}

#[test]
fn symmetric_move_reports_axis_and_dependency_errors() {
    let axis_error = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("axis", "軸", 0.0, 0.0),
            free_point("a", "A", 0.0, 10.0),
            free_point("b", "B", 100.0, 10.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "move",
                "name": "対称移動",
                "type": "symmetricMove",
                "visible": true,
                "enabled": true,
                "axisPoint1": { "mode": "reference", "pointId": "axis" },
                "axisPoint2": { "mode": "reference", "pointId": "axis" },
                "baseLineIds": ["line"]
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    assert!(axis_error.errors[0].message.contains("同じ点"));

    let dependency_error = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("axis1", "軸1", 0.0, 0.0),
            free_point("axis2", "軸2", 100.0, 0.0),
            element(json!({
                "id": "move",
                "name": "対称移動",
                "type": "symmetricMove",
                "visible": true,
                "enabled": true,
                "axisPoint1": { "mode": "reference", "pointId": "axis1" },
                "axisPoint2": { "mode": "reference", "pointId": "axis2" },
                "baseLineIds": ["late"]
            })),
            free_point("a", "A", 0.0, 10.0),
            free_point("b", "B", 100.0, 10.0),
            line("late", "後方線", "a", "b"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    assert_eq!(dependency_error.errors[0].missing_dependency_id, "late");
}
