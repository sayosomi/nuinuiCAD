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

fn base_line_elements() -> Vec<Value> {
    vec![
        element(json!({
            "id": "a",
            "name": "A",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 0,
            "y": 0
        })),
        element(json!({
            "id": "b",
            "name": "B",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 100,
            "y": 0
        })),
        element(json!({
            "id": "line",
            "name": "AB",
            "type": "line",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" }
        })),
    ]
}

fn offset_line(id: &str, base_line_ids: Vec<&str>, offset: Value) -> Value {
    element(json!({
        "id": id,
        "name": "オフセット",
        "type": "offsetLine",
        "visible": true,
        "enabled": true,
        "baseLineIds": base_line_ids,
        "offset": offset,
        "side": "right",
        "closed": false
    }))
}

#[test]
fn evaluates_line_offset() {
    let mut elements = base_line_elements();
    elements.push(offset_line("offset", vec!["line"], json!(10)));
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    assert_eq!(offset["kind"], json!("offsetLine"));
    assert_close(offset["segments"][0]["start"]["x"].as_f64().unwrap(), 0.0);
    assert_close(offset["segments"][0]["start"]["y"].as_f64().unwrap(), -10.0);
    assert_close(offset["segments"][0]["end"]["x"].as_f64().unwrap(), 100.0);
    assert_close(offset["segments"][0]["end"]["y"].as_f64().unwrap(), -10.0);
    assert_close(offset["length"].as_f64().unwrap(), 100.0);
}

#[test]
fn evaluates_local_expression_offset() {
    let mut elements = base_line_elements();
    let mut offset = offset_line(
        "offset",
        vec!["line"],
        json!({ "kind": "expression", "expression": "@ゆとり + 6" }),
    );
    offset["numericVariables"] = json!([{ "id": "ease", "name": "ゆとり", "value": 4 }]);
    elements.push(offset);
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_close(
        geometry(&result, "offset")["segments"][0]["start"]["y"]
            .as_f64()
            .unwrap(),
        -10.0,
    );
}

#[test]
fn connects_reversed_base_lines() {
    let elements = vec![
        element(
            json!({ "id": "a", "name": "A", "type": "freePoint", "visible": true, "enabled": true, "x": 0, "y": 0 }),
        ),
        element(
            json!({ "id": "b", "name": "B", "type": "freePoint", "visible": true, "enabled": true, "x": 100, "y": 0 }),
        ),
        element(
            json!({ "id": "c", "name": "C", "type": "freePoint", "visible": true, "enabled": true, "x": 100, "y": 100 }),
        ),
        element(
            json!({ "id": "ab", "name": "AB", "type": "line", "visible": true, "enabled": true, "startPoint": { "mode": "reference", "pointId": "a" }, "endPoint": { "mode": "reference", "pointId": "b" } }),
        ),
        element(
            json!({ "id": "cb", "name": "CB", "type": "line", "visible": true, "enabled": true, "startPoint": { "mode": "reference", "pointId": "c" }, "endPoint": { "mode": "reference", "pointId": "b" } }),
        ),
        offset_line("offset", vec!["ab", "cb"], json!(10)),
    ];
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    assert_close(offset["length"].as_f64().unwrap(), 220.0);
    assert_close(offset["segments"][0]["end"]["x"].as_f64().unwrap(), 110.0);
    assert_close(offset["segments"][1]["start"]["x"].as_f64().unwrap(), 110.0);
}

#[test]
fn keeps_first_base_line_direction_stable() {
    let elements = vec![
        element(
            json!({ "id": "a", "name": "A", "type": "freePoint", "visible": true, "enabled": true, "x": 0, "y": 0 }),
        ),
        element(
            json!({ "id": "b", "name": "B", "type": "freePoint", "visible": true, "enabled": true, "x": 100, "y": 0 }),
        ),
        element(
            json!({ "id": "c", "name": "C", "type": "freePoint", "visible": true, "enabled": true, "x": 0, "y": 100 }),
        ),
        element(
            json!({ "id": "ab", "name": "AB", "type": "line", "visible": true, "enabled": true, "startPoint": { "mode": "reference", "pointId": "a" }, "endPoint": { "mode": "reference", "pointId": "b" } }),
        ),
        element(json!({
            "id": "ac",
            "name": "AC",
            "type": "bezierCurve",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" },
            "startHandleAngleDeg": 270,
            "startHandleLength": 30,
            "intermediatePoints": [],
            "endPoint": { "mode": "reference", "pointId": "c" },
            "endHandleAngleDeg": 270,
            "endHandleLength": 30
        })),
        offset_line("offset", vec!["ab", "ac"], json!(10)),
    ];
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    assert_close(offset["segments"][0]["start"]["x"].as_f64().unwrap(), 0.0);
    assert_close(offset["segments"][0]["start"]["y"].as_f64().unwrap(), -10.0);
    assert_close(offset["segments"][0]["end"]["x"].as_f64().unwrap(), 100.0);
    assert_close(offset["segments"][0]["end"]["y"].as_f64().unwrap(), -10.0);
}

#[test]
fn evaluates_arc_offset_and_radius_error() {
    let elements = vec![
        element(
            json!({ "id": "a", "name": "A", "type": "freePoint", "visible": true, "enabled": true, "x": 0, "y": 0 }),
        ),
        element(
            json!({ "id": "arc", "name": "円弧", "type": "arcLine", "visible": true, "enabled": true, "centerPoint": { "mode": "reference", "pointId": "a" }, "radius": 10, "startAngleDeg": 0, "endAngleDeg": 90 }),
        ),
        offset_line("offset", vec!["arc"], json!(5)),
    ];
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_close(
        geometry(&result, "offset")["segments"][0]["radius"]
            .as_f64()
            .unwrap(),
        5.0,
    );

    let mut failing = vec![
        element(
            json!({ "id": "a", "name": "A", "type": "freePoint", "visible": true, "enabled": true, "x": 0, "y": 0 }),
        ),
        element(
            json!({ "id": "arc", "name": "円弧", "type": "arcLine", "visible": true, "enabled": true, "centerPoint": { "mode": "reference", "pointId": "a" }, "radius": 10, "startAngleDeg": 90, "endAngleDeg": 0 }),
        ),
    ];
    let mut failing_offset = offset_line("offset", vec!["arc"], json!(20));
    failing_offset["side"] = json!("right");
    failing.push(failing_offset);
    let failing_result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: failing,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(failing_result.errors[0].message.contains("円弧半径が0以下"));
}

#[test]
fn evaluates_bezier_and_nested_offset() {
    let elements = vec![
        element(json!({
            "id": "curve",
            "name": "曲線",
            "type": "bezierCurve",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
            "startHandleAngleDeg": 45,
            "startHandleLength": 80,
            "intermediatePoints": [],
            "endPoint": { "mode": "coordinate", "x": 120, "y": 0 },
            "endHandleAngleDeg": 135,
            "endHandleLength": 80
        })),
        offset_line("offset-1", vec!["curve"], json!(10)),
        offset_line("offset-2", vec!["offset-1"], json!(10)),
    ];
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset-2");
    assert!(offset["segments"]
        .as_array()
        .unwrap()
        .iter()
        .any(|segment| segment["kind"] == json!("bezier")));
}

#[test]
fn reports_bezier_trim_warning() {
    let elements = vec![
        element(json!({
            "id": "curve",
            "name": "曲線AC",
            "type": "bezierCurve",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "coordinate", "x": 50, "y": 50 },
            "startHandleAngleDeg": 0,
            "startHandleLength": 45,
            "intermediatePoints": [],
            "endPoint": { "mode": "coordinate", "x": 150, "y": 130 },
            "endHandleAngleDeg": 90,
            "endHandleLength": 35
        })),
        offset_line("offset", vec!["curve"], json!(35)),
    ];
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(result.warnings.len(), 1);
    assert!(result.warnings[0].message.contains("トリム"));
}

#[test]
fn suppresses_bezier_trim_warning_when_requested() {
    let elements = vec![
        element(json!({
            "id": "curve",
            "name": "曲線AC",
            "type": "bezierCurve",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "coordinate", "x": 50, "y": 50 },
            "startHandleAngleDeg": 0,
            "startHandleLength": 45,
            "intermediatePoints": [],
            "endPoint": { "mode": "coordinate", "x": 150, "y": 130 },
            "endHandleAngleDeg": 90,
            "endHandleLength": 35
        })),
        {
            let mut offset = offset_line("offset", vec!["curve"], json!(35));
            offset["suppressTrimWarnings"] = json!(true);
            offset
        },
    ];
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert!(result.warnings.is_empty());
    assert_eq!(geometry(&result, "offset")["kind"], json!("offsetLine"));
}

#[test]
fn reports_too_late_base_dependency() {
    let mut elements = vec![offset_line("offset", vec!["line"], json!(10))];
    elements.extend(base_line_elements());
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(geometry_missing(&result, "offset"));
    assert_eq!(result.errors[0].element_id, "offset");
    assert_eq!(result.errors[0].missing_dependency_id, "line");
}

fn geometry_missing(result: &EvaluationPayload, id: &str) -> bool {
    !result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!(id))
}

#[test]
fn offset_line_can_feed_line_point_and_intersection_helpers() {
    let mut elements = base_line_elements();
    elements.extend([
        offset_line("offset", vec!["line"], json!(10)),
        element(json!({
            "id": "mid",
            "name": "中点",
            "type": "lineDivisionPoint",
            "visible": true,
            "enabled": true,
            "endpoint": { "lineId": "offset", "endpointKey": "start" },
            "placement": { "kind": "ratio", "value": 0.5 }
        })),
        element(json!({
            "id": "cross-line",
            "name": "交差線",
            "type": "line",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "coordinate", "x": 50, "y": -10 },
            "endPoint": { "mode": "coordinate", "x": 50, "y": 20 }
        })),
        element(json!({
            "id": "cross",
            "name": "交点",
            "type": "intersectionPoint",
            "visible": true,
            "enabled": true,
            "line1Id": "offset",
            "line2Id": "cross-line",
            "intersectionIndex": 0,
            "useExtensions": false
        })),
    ]);
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 50.0);
    assert_close(geometry(&result, "mid")["y"].as_f64().unwrap(), -10.0);
    assert_close(geometry(&result, "cross")["x"].as_f64().unwrap(), 50.0);
    assert_close(geometry(&result, "cross")["y"].as_f64().unwrap(), -10.0);
}
