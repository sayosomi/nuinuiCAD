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

fn simple_bezier() -> Value {
    element(json!({
        "id": "curve",
        "name": "曲線AB",
        "type": "bezierCurve",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": "a" },
        "startHandleAngleDeg": 0,
        "startHandleLength": 20,
        "intermediatePoints": [],
        "endPoint": { "mode": "reference", "pointId": "b" },
        "endHandleAngleDeg": 0,
        "endHandleLength": 20
    }))
}

#[test]
fn evaluates_single_segment_bezier_curve() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            free_point("b", "点B", 40.0, 25.0),
            simple_bezier(),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["kind"], json!("bezierCurve"));
    assert_eq!(curve["startPointId"], json!("a"));
    assert_eq!(curve["endPointId"], json!("b"));
    assert_eq!(curve["segments"].as_array().unwrap().len(), 1);
    assert!(curve["length"].as_f64().unwrap() > 0.0);
    assert_eq!(curve["startTangentAngleDeg"], json!(0.0));
    assert_eq!(curve["endTangentAngleDeg"], json!(180.0));
}

#[test]
fn evaluates_multi_segment_bezier_curve() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            free_point("b", "点B", 40.0, 25.0),
            free_point("c", "点C", 40.0, 65.0),
            element(json!({
                "id": "curve",
                "name": "曲線ABC",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 20,
                "intermediatePoints": [
                    {
                        "id": "mid-1",
                        "point": { "mode": "reference", "pointId": "b" },
                        "handleAngleDeg": 90,
                        "incomingHandleLength": 10,
                        "outgoingHandleLength": 15
                    }
                ],
                "endPoint": { "mode": "reference", "pointId": "c" },
                "endHandleAngleDeg": 90,
                "endHandleLength": 20
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["segments"].as_array().unwrap().len(), 2);
    assert_eq!(curve["intermediatePointIds"], json!(["b"]));
}

#[test]
fn evaluates_bezier_curve_from_coordinate_anchors() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![element(json!({
            "id": "curve",
            "name": "直接曲線",
            "type": "bezierCurve",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
            "startHandleAngleDeg": 0,
            "startHandleLength": 10,
            "intermediatePoints": [
                {
                    "id": "mid-1",
                    "point": { "mode": "coordinate", "x": 10, "y": 10 },
                    "handleAngleDeg": 90,
                    "incomingHandleLength": 5,
                    "outgoingHandleLength": 5
                }
            ],
            "endPoint": { "mode": "coordinate", "x": 20, "y": 0 },
            "endHandleAngleDeg": 0,
            "endHandleLength": 10
        }))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["startPointId"], Value::Null);
    assert_eq!(curve["endPointId"], Value::Null);
    assert_eq!(curve["intermediatePointIds"], json!([]));
    assert_eq!(curve["segments"].as_array().unwrap().len(), 2);
}

#[test]
fn reports_bezier_curve_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            simple_bezier(),
            free_point("b", "点B", 40.0, 25.0),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert_eq!(result.errors[0].element_id, "curve");
    assert_eq!(result.errors[0].missing_dependency_id, "b");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("点B")
    );
}

#[test]
fn evaluates_bezier_curve_numeric_variables_and_expressions() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 100.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "式曲線",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "numericVariables": [
                    { "id": "angle", "name": "角度", "value": 0 },
                    { "id": "length", "name": "長さ", "value": 20 }
                ],
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": { "kind": "expression", "expression": "@角度" },
                "startHandleLength": { "kind": "expression", "expression": "@長さ" },
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "b" },
                "endHandleAngleDeg": { "kind": "expression", "expression": "@角度" },
                "endHandleLength": { "kind": "expression", "expression": "@長さ" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["startHandleAngleDeg"], json!(0.0));
    assert_eq!(curve["startHandleLength"], json!(20.0));
    assert_eq!(curve["endHandleAngleDeg"], json!(0.0));
    assert_eq!(curve["endHandleLength"], json!(20.0));
}

#[test]
fn evaluates_bezier_curve_numeric_variable_ids_with_hyphens() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("freePoint-mr0czcze-2", "点1", 0.0, 0.0),
            free_point("offsetPoint-mr0czf1a-3", "点2", 0.0, -100.0),
            element(json!({
                "id": "bezierCurve-mr0d07nx-4",
                "name": "曲線1",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "numericVariables": [
                    { "id": "bezierCurve-mr0d0mvz-5", "name": "v1", "value": 30 }
                ],
                "startPoint": { "mode": "reference", "pointId": "freePoint-mr0czcze-2" },
                "startHandleAngleDeg": 0,
                "startHandleLength": {
                    "kind": "expression",
                    "expression": "@bezierCurve-mr0d0mvz-5"
                },
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "offsetPoint-mr0czf1a-3" },
                "endHandleAngleDeg": 180,
                "endHandleLength": {
                    "kind": "expression",
                    "expression": "@bezierCurve-mr0d0mvz-5"
                }
            })),
            element(json!({
                "id": "measurement-point",
                "name": "測定点",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": {
                    "kind": "expression",
                    "expression": "bezierCurve-mr0d07nx-4.length"
                },
                "y": {
                    "kind": "expression",
                    "expression": "距離(freePoint-mr0czcze-2, offsetPoint-mr0czf1a-3)"
                }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let curve = geometry(&result, "bezierCurve-mr0d07nx-4");
    let measurement_point = geometry(&result, "measurement-point");
    assert!(result.errors.is_empty());
    assert_eq!(curve["startHandleLength"], json!(30.0));
    assert_eq!(curve["endHandleLength"], json!(30.0));
    assert_eq!(measurement_point["x"], curve["length"]);
    assert_eq!(measurement_point["y"], json!(100.0));
}

#[test]
fn resolves_bezier_derived_points() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            free_point("b", "点B", 40.0, 25.0),
            free_point("c", "点C", 40.0, 65.0),
            element(json!({
                "id": "curve",
                "name": "曲線ABC",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 20,
                "intermediatePoints": [
                    {
                        "id": "mid-1",
                        "point": { "mode": "reference", "pointId": "b" },
                        "handleAngleDeg": 90,
                        "incomingHandleLength": 10,
                        "outgoingHandleLength": 15
                    }
                ],
                "endPoint": { "mode": "reference", "pointId": "c" },
                "endHandleAngleDeg": 90,
                "endHandleLength": 20
            })),
            element(json!({
                "id": "from-mid",
                "name": "中間点からの点",
                "type": "offsetPoint",
                "visible": true,
                "enabled": true,
                "fromPoint": { "mode": "derived", "elementId": "curve", "pointKey": "intermediate:mid-1" },
                "dx": 5,
                "dy": 6
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    let point = geometry(&result, "from-mid");
    assert!(result.errors.is_empty());
    assert_eq!(point["x"], json!(45.0));
    assert_eq!(point["y"], json!(31.0));
}

#[test]
fn allows_supported_point_elements_to_reference_bezier_curve() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 100.0, 0.0),
            simple_bezier(),
            element(json!({
                "id": "division",
                "name": "曲線分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
            element(json!({
                "id": "tangent-offset",
                "name": "曲線接線点",
                "type": "lineTangentOffsetPoint",
                "visible": true,
                "enabled": true,
                "baseLineId": "curve",
                "basePoint": { "mode": "reference", "pointId": "a" },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
            element(json!({
                "id": "cross-start",
                "name": "交差線始点",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 50,
                "y": -20
            })),
            element(json!({
                "id": "cross-end",
                "name": "交差線終点",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 50,
                "y": 20
            })),
            element(json!({
                "id": "cross-line",
                "name": "交差線",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "cross-start" },
                "endPoint": { "mode": "reference", "pointId": "cross-end" }
            })),
            element(json!({
                "id": "intersection",
                "name": "交点",
                "type": "intersectionPoint",
                "visible": true,
                "enabled": true,
                "line1Id": "curve",
                "line2Id": "cross-line",
                "intersectionIndex": 0,
                "useExtensions": false
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(geometry(&result, "division")["kind"], json!("point"));
    assert_eq!(geometry(&result, "tangent-offset")["kind"], json!("point"));
    assert_eq!(geometry(&result, "intersection")["kind"], json!("point"));
}
