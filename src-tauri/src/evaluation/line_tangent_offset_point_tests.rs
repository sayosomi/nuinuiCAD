use super::*;
use serde_json::json;
use serde_json::Value;

fn element(value: Value) -> Value {
    value
}

fn point<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
        .expect("expected computed point")
}

fn base_line_elements() -> Vec<Value> {
    vec![
        element(json!({
            "id": "a",
            "name": "点A",
            "type": "freePoint",
            "activity": "visible",
            "x": 0,
            "y": 0
        })),
        element(json!({
            "id": "b",
            "name": "点B",
            "type": "freePoint",
            "activity": "visible",
            "x": 100,
            "y": 0
        })),
        element(json!({
            "id": "line",
            "name": "直線AB",
            "type": "line",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" }
        })),
    ]
}

#[test]
fn evaluates_line_tangent_offset_point_on_line() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "offset",
        "name": "線上オフセット点",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "a" },
        "tangentAngleDeg": 90,
        "distance": 10
    })));
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
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

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!(offset["x"].as_f64().unwrap().abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() - 10.0).abs() < 1e-9);
}

#[test]
fn evaluates_line_tangent_offset_point_on_diagonal_line_using_y_up_angles() {
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "a",
                "name": "点A",
                "type": "freePoint",
                "activity": "visible",
                "x": 0,
                "y": 0
            })),
            element(json!({
                "id": "b",
                "name": "点B",
                "type": "freePoint",
                "activity": "visible",
                "x": 10,
                "y": 10
            })),
            element(json!({
                "id": "line",
                "name": "斜線",
                "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            })),
            element(json!({
                "id": "offset",
                "name": "線上オフセット点",
                "type": "lineTangentOffsetPoint",
                "activity": "visible",
                "baseLineId": "line",
                "basePoint": { "mode": "reference", "pointId": "a" },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 5.0 * 2f64.sqrt()).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() - 5.0 * 2f64.sqrt()).abs() < 1e-9);
}

#[test]
fn evaluates_line_tangent_offset_point_on_arc_line() {
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "center",
                "name": "中心",
                "type": "freePoint",
                "activity": "visible",
                "x": 0,
                "y": 0
            })),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "activity": "visible",
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
            element(json!({
                "id": "offset",
                "name": "円弧接線点",
                "type": "lineTangentOffsetPoint",
                "activity": "visible",
                "baseLineId": "arc",
                "basePoint": { "mode": "derived", "elementId": "arc", "pointKey": "start" },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    // The tangent at the arc start (angle 0°) is the analytic tangent (0, 1),
    // so offsetting 10 along it lands exactly at (10, 10). (The old expectation
    // encoded the 32-step chord tangent, ~5.6° off the true tangent.)
    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 10.0).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() - 10.0).abs() < 1e-9);
}

#[test]
fn evaluates_line_tangent_offset_point_on_bezier_intermediate_point_tangent() {
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "start",
                "name": "始点",
                "type": "freePoint",
                "activity": "visible",
                "x": 62.1,
                "y": 59.52
            })),
            element(json!({
                "id": "middle",
                "name": "中間点",
                "type": "freePoint",
                "activity": "visible",
                "x": 68.05,
                "y": 27.18
            })),
            element(json!({
                "id": "end",
                "name": "終点",
                "type": "freePoint",
                "activity": "visible",
                "x": 89.92,
                "y": 39.33
            })),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "start" },
                "startHandleAngleDeg": 254.72,
                "startHandleLength": 18.52,
                "intermediatePoints": [
                    {
                        "id": "middle-handle",
                        "point": { "mode": "reference", "pointId": "middle" },
                        "handleAngleDeg": 336.35,
                        "incomingHandleLength": 8.2,
                        "outgoingHandleLength": 7.22
                    }
                ],
                "endPoint": { "mode": "reference", "pointId": "end" },
                "endHandleAngleDeg": 75.86,
                "endHandleLength": 13.85
            })),
            element(json!({
                "id": "offset",
                "name": "線上オフセット点",
                "type": "lineTangentOffsetPoint",
                "activity": "visible",
                "baseLineId": "curve",
                "basePoint": { "mode": "reference", "pointId": "middle" },
                "tangentAngleDeg": 270,
                "distance": 10
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 64.038_514_426_475_33).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() - 18.019_869_897_572_224).abs() < 1e-9);
}

#[test]
fn reports_line_tangent_offset_point_base_line_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "offset",
                "name": "線上オフセット点",
                "type": "lineTangentOffsetPoint",
                "activity": "visible",
                "baseLineId": "line",
                "basePoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
            element(json!({
                "id": "line",
                "name": "参照線",
                "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "endPoint": { "mode": "coordinate", "x": 100, "y": 0 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("offset")));
    assert_eq!(result.errors[0].element_id, "offset");
    assert_eq!(result.errors[0].missing_dependency_id, "line");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("参照線")
    );
}

#[test]
fn reports_line_tangent_offset_point_base_point_dependency() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "offset",
        "name": "線上オフセット点",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "missing" },
        "tangentAngleDeg": 0,
        "distance": 10
    })));
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
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

    assert_eq!(result.errors[0].element_id, "offset");
    assert_eq!(result.errors[0].missing_dependency_id, "missing");
}

#[test]
fn reports_line_tangent_offset_point_when_base_point_is_not_on_line() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "c",
        "name": "点C",
        "type": "freePoint",
        "activity": "visible",
        "x": 50,
        "y": 5
    })));
    elements.push(element(json!({
        "id": "offset",
        "name": "線上オフセット点",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "c" },
        "tangentAngleDeg": 0,
        "distance": 10
    })));
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
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

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("offset")));
    assert_eq!(result.errors[0].element_id, "offset");
    assert_eq!(result.errors[0].missing_dependency_id, "offset");
    assert!(result.errors[0]
        .message
        .contains("基準点は基準線上にありません"));
}

#[test]
fn evaluates_line_tangent_offset_point_numeric_variables_and_expressions() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "offset",
        "name": "式線上オフセット点",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "numericVariables": [
            { "id": "angle", "name": "角度", "value": 45 },
            { "id": "length", "name": "距離", "value": 10 }
        ],
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "a" },
        "tangentAngleDeg": { "kind": "expression", "expression": "@角度" },
        "distance": { "kind": "expression", "expression": "@距離 * 2" }
    })));
    let result = evaluate_document_input(EvaluationInput {
        path_mutations: None,
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

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 10.0 * 2f64.sqrt()).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() - 10.0 * 2f64.sqrt()).abs() < 1e-9);
}
