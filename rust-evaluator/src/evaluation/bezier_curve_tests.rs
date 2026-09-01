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
        "activity": "visible",
        "x": x,
        "y": y
    }))
}

fn simple_bezier() -> Value {
    element(json!({
        "id": "curve",
        "name": "曲線AB",
        "type": "bezierCurve",
        "activity": "visible",
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            free_point("b", "点B", 40.0, 25.0),
            simple_bezier(),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            free_point("b", "点B", 40.0, 25.0),
            free_point("c", "点C", 40.0, 65.0),
            element(json!({
                "id": "curve",
                "name": "曲線ABC",
                "type": "bezierCurve",
                "activity": "visible",
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["segments"].as_array().unwrap().len(), 2);
    assert_eq!(curve["intermediatePointIds"], json!(["b"]));
    assert_eq!(curve["intermediateSlotIds"], json!(["mid-1"]));
}

#[test]
fn evaluates_bezier_curve_from_coordinate_anchors() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "curve",
            "name": "直接曲線",
            "type": "bezierCurve",
            "activity": "visible",
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["startPointId"], Value::Null);
    assert_eq!(curve["endPointId"], Value::Null);
    assert_eq!(curve["intermediatePointIds"], json!([]));
    assert_eq!(curve["intermediateSlotIds"], json!(["mid-1"]));
    assert_eq!(curve["segments"].as_array().unwrap().len(), 2);
}

#[test]
fn keeps_distinct_stable_slot_ids_when_intermediate_slots_share_an_external_point() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 20.0, 10.0),
            free_point("d", "点D", 40.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 5,
                "intermediatePoints": [
                    {
                        "id": "slot-b-1",
                        "point": { "mode": "reference", "pointId": "b" },
                        "handleAngleDeg": 90,
                        "incomingHandleLength": 5,
                        "outgoingHandleLength": 5
                    },
                    {
                        "id": "slot-b-2",
                        "point": { "mode": "reference", "pointId": "b" },
                        "handleAngleDeg": 270,
                        "incomingHandleLength": 5,
                        "outgoingHandleLength": 5
                    }
                ],
                "endPoint": { "mode": "reference", "pointId": "d" },
                "endHandleAngleDeg": 180,
                "endHandleLength": 5
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["intermediatePointIds"], json!(["b", "b"]));
    assert_eq!(
        curve["intermediateSlotIds"],
        json!(["slot-b-1", "slot-b-2"])
    );
}

#[test]
fn reverse_preserves_bezier_stable_intermediate_points_and_numeric_positions() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 10.0, 0.0),
            free_point("c", "点C", 20.0, 0.0),
            free_point("d", "点D", 30.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "曲線ABCD",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 3,
                "intermediatePoints": [
                    {
                        "id": "slot-b",
                        "point": { "mode": "reference", "pointId": "b" },
                        "handleAngleDeg": 0,
                        "incomingHandleLength": 3,
                        "outgoingHandleLength": 3
                    },
                    {
                        "id": "slot-c",
                        "point": { "mode": "reference", "pointId": "c" },
                        "handleAngleDeg": 0,
                        "incomingHandleLength": 3,
                        "outgoingHandleLength": 3
                    }
                ],
                "endPoint": { "mode": "reference", "pointId": "d" },
                "endHandleAngleDeg": 0,
                "endHandleLength": 3
            })),
            element(json!({
                "id": "reverse-1", "name": "", "type": "pathReverse", "activity": "visible",
                "targetLineId": "curve"
            })),
            element(json!({
                "id": "after-b",
                "name": "反転後B",
                "type": "offsetPoint",
                "activity": "visible",
                "fromPoint": { "mode": "derived", "elementId": "curve", "pointKey": "intermediate:slot-b" },
                "dx": 1,
                "dy": 2
            })),
            element(json!({
                "id": "after-c",
                "name": "反転後C",
                "type": "offsetPoint",
                "activity": "visible",
                "fromPoint": { "mode": "derived", "elementId": "curve", "pointKey": "intermediate:slot-c" },
                "dx": 1,
                "dy": 2
            })),
            element(json!({
                "id": "numeric-first",
                "name": "数値1",
                "type": "offsetPoint",
                "activity": "visible",
                "fromPoint": { "mode": "reference", "pointId": "a" },
                "dx": { "kind": "expression", "expression": "curve.intermediatePoints[1].x" },
                "dy": 0
            })),
            element(json!({
                "id": "numeric-second",
                "name": "数値2",
                "type": "offsetPoint",
                "activity": "visible",
                "fromPoint": { "mode": "reference", "pointId": "a" },
                "dx": { "kind": "expression", "expression": "curve.intermediatePoints[2].x" },
                "dy": 0
            })),
            element(json!({
                "id": "reverse-2", "name": "", "type": "pathReverse", "activity": "visible",
                "targetLineId": "curve"
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let curve = geometry(&result, "curve");
    assert_eq!(curve["intermediatePointIds"], json!(["b", "c"]));
    assert_eq!(curve["intermediateSlotIds"], json!(["slot-b", "slot-c"]));
    assert_eq!(
        curve["segments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|segment| segment["end"]["elementId"].clone())
            .collect::<Vec<_>>(),
        vec![json!("b"), json!("c"), json!("d")]
    );
    assert_eq!(geometry(&result, "after-b")["x"], json!(11.0));
    assert_eq!(geometry(&result, "after-c")["x"], json!(21.0));
    assert_eq!(geometry(&result, "numeric-first")["x"], json!(20.0));
    assert_eq!(geometry(&result, "numeric-second")["x"], json!(10.0));
}

#[test]
fn reports_bezier_curve_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            simple_bezier(),
            free_point("b", "点B", 40.0, 25.0),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert_eq!(result.errors[0].element_id, "curve");
    assert_eq!(result.errors[0].missing_dependency_id, "b");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("点B")
    );
}

#[test]
fn evaluates_bezier_curve_numeric_parameters() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 100.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "式曲線",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 20,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "b" },
                "endHandleAngleDeg": 0,
                "endHandleLength": 20
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let curve = geometry(&result, "curve");
    assert!(result.errors.is_empty());
    assert_eq!(curve["startHandleAngleDeg"], json!(0.0));
    assert_eq!(curve["startHandleLength"], json!(20.0));
    assert_eq!(curve["endHandleAngleDeg"], json!(0.0));
    assert_eq!(curve["endHandleLength"], json!(20.0));
}

#[test]
fn evaluates_bezier_curve_with_hyphenated_element_ids() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("freePoint-mr0czcze-2", "点1", 0.0, 0.0),
            free_point("offsetPoint-mr0czf1a-3", "点2", 0.0, -100.0),
            element(json!({
                "id": "bezierCurve-mr0d07nx-4",
                "name": "曲線1",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "freePoint-mr0czcze-2" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 30,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "offsetPoint-mr0czf1a-3" },
                "endHandleAngleDeg": 180,
                "endHandleLength": 30
            })),
            element(json!({
                "id": "measurement-point",
                "name": "測定点",
                "type": "freePoint",
                "activity": "visible",
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 10.0, 20.0),
            free_point("b", "点B", 40.0, 25.0),
            free_point("c", "点C", 40.0, 65.0),
            element(json!({
                "id": "curve",
                "name": "曲線ABC",
                "type": "bezierCurve",
                "activity": "visible",
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
                "activity": "visible",
                "fromPoint": { "mode": "derived", "elementId": "curve", "pointKey": "intermediate:mid-1" },
                "dx": 5,
                "dy": 6
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let point = geometry(&result, "from-mid");
    assert!(result.errors.is_empty());
    assert_eq!(point["x"], json!(45.0));
    assert_eq!(point["y"], json!(31.0));
}

#[test]
fn allows_supported_point_elements_to_reference_bezier_curve() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 100.0, 0.0),
            simple_bezier(),
            element(json!({
                "id": "division",
                "name": "曲線分点",
                "type": "lineDivisionPoint",
                "activity": "visible",
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
            element(json!({
                "id": "tangent-offset",
                "name": "曲線接線点",
                "type": "lineTangentOffsetPoint",
                "activity": "visible",
                "baseLineId": "curve",
                "basePoint": { "mode": "reference", "pointId": "a" },
                "tangentAngleDeg": 0,
                "distance": 10
            })),
            element(json!({
                "id": "cross-start",
                "name": "交差線始点",
                "type": "freePoint",
                "activity": "visible",
                "x": 50,
                "y": -20
            })),
            element(json!({
                "id": "cross-end",
                "name": "交差線終点",
                "type": "freePoint",
                "activity": "visible",
                "x": 50,
                "y": 20
            })),
            element(json!({
                "id": "cross-line",
                "name": "交差線",
                "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "cross-start" },
                "endPoint": { "mode": "reference", "pointId": "cross-end" }
            })),
            element(json!({
                "id": "intersection",
                "name": "交点",
                "type": "intersectionPoint",
                "activity": "visible",
                "line1Id": "curve",
                "line2Id": "cross-line",
                "intersectionIndex": 0,
                "useExtensions": false
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(geometry(&result, "division")["kind"], json!("point"));
    assert_eq!(geometry(&result, "tangent-offset")["kind"], json!("point"));
    assert_eq!(geometry(&result, "intersection")["kind"], json!("point"));
}
