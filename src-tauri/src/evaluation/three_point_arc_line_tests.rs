use super::*;
use serde_json::json;
use serde_json::Value;

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

fn base_three_point_arc() -> Vec<Value> {
    vec![
        free_point("p1", "点1", 10.0, 0.0),
        free_point("p2", "点2", 0.0, -10.0),
        free_point("p3", "点3", -10.0, 0.0),
        element(json!({
            "id": "arc",
            "name": "三点円弧",
            "type": "threePointArcLine",
            "visible": true,
            "enabled": true,
            "point1": { "mode": "reference", "pointId": "p1" },
            "point2": { "mode": "reference", "pointId": "p2" },
            "point3": { "mode": "reference", "pointId": "p3" },
            "startAngleDeg": 0,
            "endAngleDeg": 90
        })),
    ]
}

#[test]
fn evaluates_three_point_arc_line() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: base_three_point_arc(),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let arc = geometry(&result, "arc");
    assert!(result.errors.is_empty());
    assert_eq!(arc["kind"], json!("arcLine"));
    assert_eq!(arc["centerPointId"], Value::Null);
    assert!((arc["center"]["x"].as_f64().unwrap()).abs() < 1e-9);
    assert!((arc["center"]["y"].as_f64().unwrap()).abs() < 1e-9);
    assert_eq!(arc["radius"], json!(10.0));
    assert_eq!(arc["startAngleDeg"], json!(0.0));
    assert_eq!(arc["endAngleDeg"], json!(90.0));
    assert_eq!(arc["sweepAngleDeg"], json!(90.0));
    assert_eq!(arc["startTangentAngleDeg"], json!(90.0));
    assert_eq!(arc["endTangentAngleDeg"], json!(0.0));
    assert!((arc["start"]["x"].as_f64().unwrap() - 10.0).abs() < 1e-9);
    assert!(arc["start"]["y"].as_f64().unwrap().abs() < 1e-9);
    assert!(arc["end"]["x"].as_f64().unwrap().abs() < 1e-9);
    assert!((arc["end"]["y"].as_f64().unwrap() - 10.0).abs() < 1e-9);
    assert!((arc["length"].as_f64().unwrap() - std::f64::consts::PI * 5.0).abs() < 1e-9);
}

#[test]
fn evaluates_three_point_arc_wrap_and_measurement_reference() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("p1", "点1", 20.0, 0.0),
            free_point("p2", "点2", 0.0, -20.0),
            free_point("p3", "点3", -20.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "三点円弧",
                "type": "threePointArcLine",
                "visible": true,
                "enabled": true,
                "point1": { "mode": "reference", "pointId": "p1" },
                "point2": { "mode": "reference", "pointId": "p2" },
                "point3": { "mode": "reference", "pointId": "p3" },
                "startAngleDeg": 300,
                "endAngleDeg": 30
            })),
            element(json!({
                "id": "measure",
                "name": "計測点",
                "type": "offsetPoint",
                "visible": true,
                "enabled": true,
                "fromPointId": "p1",
                "dx": { "kind": "expression", "expression": "arc.length" },
                "dy": { "kind": "expression", "expression": "arc.endAngleDeg" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let arc = geometry(&result, "arc");
    let measure = geometry(&result, "measure");
    assert!(result.errors.is_empty());
    assert_eq!(arc["sweepAngleDeg"], json!(90.0));
    assert!((measure["x"].as_f64().unwrap() - (20.0 + std::f64::consts::PI * 10.0)).abs() < 1e-9);
    assert_eq!(measure["y"], json!(30.0));
}

#[test]
fn reports_three_point_arc_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("p1", "点1", 10.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "三点円弧",
                "type": "threePointArcLine",
                "visible": true,
                "enabled": true,
                "point1": { "mode": "reference", "pointId": "p1" },
                "point2": { "mode": "reference", "pointId": "p2" },
                "point3": { "mode": "reference", "pointId": "missing" },
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
            free_point("p2", "点2", 0.0, -10.0),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert_eq!(result.errors[0].element_id, "arc");
    assert_eq!(result.errors[0].missing_dependency_id, "p2");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("点2")
    );
}

#[test]
fn reports_three_point_arc_geometry_error_for_collinear_points() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("p1", "点1", 0.0, 0.0),
            free_point("p2", "点2", 10.0, 10.0),
            free_point("p3", "点3", 20.0, 20.0),
            element(json!({
                "id": "arc",
                "name": "三点円弧",
                "type": "threePointArcLine",
                "visible": true,
                "enabled": true,
                "point1": { "mode": "reference", "pointId": "p1" },
                "point2": { "mode": "reference", "pointId": "p2" },
                "point3": { "mode": "reference", "pointId": "p3" },
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("arc")));
    assert_eq!(result.errors[0].element_id, "arc");
    assert_eq!(result.errors[0].missing_dependency_id, "arc");
    assert!(result.errors[0]
        .message
        .contains("点1・点2・点3から円を作れません"));
}

#[test]
fn evaluates_three_point_arc_numeric_variables_and_expressions() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("p1", "点1", 10.0, 0.0),
            free_point("p2", "点2", 0.0, -10.0),
            free_point("p3", "点3", -10.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "式三点円弧",
                "type": "threePointArcLine",
                "visible": true,
                "enabled": true,
                "numericVariables": [
                    { "id": "start", "name": "開始", "value": 300 },
                    { "id": "sweep", "name": "角度", "value": 90 }
                ],
                "point1": { "mode": "reference", "pointId": "p1" },
                "point2": { "mode": "reference", "pointId": "p2" },
                "point3": { "mode": "reference", "pointId": "p3" },
                "startAngleDeg": { "kind": "expression", "expression": "@開始" },
                "endAngleDeg": { "kind": "expression", "expression": "@開始 + @角度" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let arc = geometry(&result, "arc");
    assert!(result.errors.is_empty());
    assert_eq!(arc["startAngleDeg"], json!(300.0));
    assert_eq!(arc["endAngleDeg"], json!(390.0));
    assert_eq!(arc["sweepAngleDeg"], json!(90.0));
}

#[test]
fn allows_supported_point_elements_to_reference_three_point_arc() {
    let mut elements = base_three_point_arc();
    elements.extend([
        element(json!({
            "id": "division",
            "name": "円弧分点",
            "type": "lineDivisionPoint",
            "visible": true,
            "enabled": true,
            "endpoint": { "lineId": "arc", "endpointKey": "start" },
            "placement": { "kind": "ratio", "value": 0.5 }
        })),
        element(json!({
            "id": "tangent-offset",
            "name": "円弧接線点",
            "type": "lineTangentOffsetPoint",
            "visible": true,
            "enabled": true,
            "baseLineId": "arc",
            "basePoint": { "mode": "derived", "elementId": "arc", "pointKey": "start" },
            "tangentAngleDeg": 0,
            "distance": 10
        })),
        element(json!({
            "id": "cross-line-start",
            "name": "交差線始点",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": -20,
            "y": 7
        })),
        element(json!({
            "id": "cross-line-end",
            "name": "交差線終点",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 20,
            "y": 7
        })),
        element(json!({
            "id": "cross-line",
            "name": "交差線",
            "type": "line",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "cross-line-start" },
            "endPoint": { "mode": "reference", "pointId": "cross-line-end" }
        })),
        element(json!({
            "id": "intersection",
            "name": "交点",
            "type": "intersectionPoint",
            "visible": true,
            "enabled": true,
            "line1Id": "arc",
            "line2Id": "cross-line",
            "intersectionIndex": 0,
            "useExtensions": false
        })),
    ]);
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(geometry(&result, "division")["kind"], json!("point"));
    assert_eq!(geometry(&result, "tangent-offset")["kind"], json!("point"));
    assert_eq!(geometry(&result, "intersection")["kind"], json!("point"));
}
