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
            "visible": true,
            "enabled": true,
            "x": 0,
            "y": 0
        })),
        element(json!({
            "id": "b",
            "name": "点B",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 100,
            "y": 0
        })),
        element(json!({
            "id": "line",
            "name": "直線AB",
            "type": "line",
            "visible": true,
            "enabled": true,
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
        "visible": true,
        "enabled": true,
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "a" },
        "tangentAngleDeg": 90,
        "distance": 10
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
    });

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!(offset["x"].as_f64().unwrap().abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() + 10.0).abs() < 1e-9);
}

#[test]
fn evaluates_line_tangent_offset_point_on_arc_line() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            element(json!({
                "id": "center",
                "name": "中心",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
            })),
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
                "id": "offset",
                "name": "円弧接線点",
                "type": "lineTangentOffsetPoint",
                "visible": true,
                "enabled": true,
                "baseLineId": "arc",
                "basePoint": { "mode": "derived", "elementId": "arc", "pointKey": "start" },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
        ],
        evaluation_limit_index: None,
    });

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 9.019_828_596_704_393).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() + 9.951_847_266_721_97).abs() < 1e-9);
}

#[test]
fn reports_line_tangent_offset_point_base_line_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            element(json!({
                "id": "offset",
                "name": "線上オフセット点",
                "type": "lineTangentOffsetPoint",
                "visible": true,
                "enabled": true,
                "baseLineId": "line",
                "basePoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
            element(json!({
                "id": "line",
                "name": "参照線",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "endPoint": { "mode": "coordinate", "x": 100, "y": 0 }
            })),
        ],
        evaluation_limit_index: None,
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
        "visible": true,
        "enabled": true,
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "missing" },
        "tangentAngleDeg": 0,
        "distance": 10
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
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
        "visible": true,
        "enabled": true,
        "x": 50,
        "y": 5
    })));
    elements.push(element(json!({
        "id": "offset",
        "name": "線上オフセット点",
        "type": "lineTangentOffsetPoint",
        "visible": true,
        "enabled": true,
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "c" },
        "tangentAngleDeg": 0,
        "distance": 10
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
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
        "visible": true,
        "enabled": true,
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
        elements,
        evaluation_limit_index: None,
    });

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 10.0 * 2f64.sqrt()).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() + 10.0 * 2f64.sqrt()).abs() < 1e-9);
}
