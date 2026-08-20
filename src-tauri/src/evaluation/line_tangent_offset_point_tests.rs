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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
fn evaluates_convex_and_concave_curve_side_on_a_bezier() {
    let mut elements = vec![
        element(json!({
            "id": "a", "name": "A", "type": "freePoint", "activity": "visible", "x": 0, "y": 0
        })),
        element(json!({
            "id": "b", "name": "B", "type": "freePoint", "activity": "visible", "x": 10, "y": 0
        })),
        element(json!({
            "id": "base", "name": "Base", "type": "freePoint", "activity": "visible", "x": 5, "y": 7.5
        })),
        element(json!({
            "id": "curve",
            "name": "Curve",
            "type": "bezierCurve",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": "a" },
            "startHandleAngleDeg": 90,
            "startHandleLength": 10,
            "intermediatePoints": [],
            "endPoint": { "mode": "reference", "pointId": "b" },
            "endHandleAngleDeg": 270,
            "endHandleLength": 10
        })),
    ];
    for (id, side) in [("convex", "convex"), ("concave", "concave")] {
        elements.push(element(json!({
            "id": id,
            "name": id,
            "type": "lineTangentOffsetPoint",
            "activity": "visible",
            "baseLineId": "curve",
            "basePoint": { "mode": "reference", "pointId": "base" },
            "curveSide": side,
            "tangentAngleDeg": 0,
            "distance": 1
        })));
    }
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let convex = point(&result, "convex");
    let concave = point(&result, "concave");
    assert!((convex["x"].as_f64().unwrap() - 5.0).abs() < 1e-9);
    assert!((convex["y"].as_f64().unwrap() - 8.5).abs() < 1e-9);
    assert!((concave["x"].as_f64().unwrap() - 5.0).abs() < 1e-9);
    assert!((concave["y"].as_f64().unwrap() - 6.5).abs() < 1e-9);
}

#[test]
fn rejects_curve_side_on_non_bezier_and_negative_distance() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "base", "name": "Base", "type": "freePoint", "activity": "visible", "x": 0, "y": 0
    })));
    elements.push(element(json!({
        "id": "offset",
        "name": "Offset",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "base" },
        "curveSide": "convex",
        "tangentAngleDeg": 0,
        "distance": 1
    })));
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0].message.contains("ベジェ曲線"));

    let mut negative_elements = vec![
        element(json!({
            "id": "a", "name": "A", "type": "freePoint", "activity": "visible", "x": 0, "y": 0
        })),
        element(json!({
            "id": "b", "name": "B", "type": "freePoint", "activity": "visible", "x": 10, "y": 0
        })),
        element(json!({
            "id": "curve",
            "name": "Curve",
            "type": "bezierCurve",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": "a" },
            "startHandleAngleDeg": 90,
            "startHandleLength": 10,
            "intermediatePoints": [],
            "endPoint": { "mode": "reference", "pointId": "b" },
            "endHandleAngleDeg": 270,
            "endHandleLength": 10
        })),
    ];
    negative_elements.push(element(json!({
        "id": "base", "name": "Base", "type": "freePoint", "activity": "visible", "x": 5, "y": 7.5
    })));
    negative_elements.push(element(json!({
        "id": "negative",
        "name": "Negative",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "curve",
        "basePoint": { "mode": "reference", "pointId": "base" },
        "curveSide": "convex",
        "tangentAngleDeg": 0,
        "distance": -1
    })));
    let negative_result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: negative_elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert_eq!(negative_result.errors.len(), 1);
    assert!(negative_result.errors[0].message.contains("0以上"));
}

#[test]
fn evaluates_unique_curve_side_and_rejects_ambiguous_internal_join() {
    let joined_curve = |same_curvature_side: bool| {
        vec![
            element(json!({
                "id": "a", "name": "A", "type": "freePoint", "activity": "visible", "x": 0, "y": 0
            })),
            element(json!({
                "id": "m", "name": "M", "type": "freePoint", "activity": "visible", "x": 10, "y": 0
            })),
            element(json!({
                "id": "b", "name": "B", "type": "freePoint", "activity": "visible", "x": 20, "y": 0
            })),
            element(json!({
                "id": "base", "name": "Base", "type": "freePoint", "activity": "visible", "x": 10, "y": 0
            })),
            element(json!({
                "id": "curve",
                "name": "Curve",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 90,
                "startHandleLength": 10,
                "intermediatePoints": [{
                    "id": "middle-handle",
                    "point": { "mode": "reference", "pointId": "m" },
                    "handleAngleDeg": 90,
                    "incomingHandleLength": 5,
                    "outgoingHandleLength": 5
                }],
                "endPoint": { "mode": "reference", "pointId": "b" },
                "endHandleAngleDeg": if same_curvature_side { 33.690067525979785 } else { 270.0 },
                "endHandleLength": if same_curvature_side { 325f64.sqrt() } else { 10.0 }
            })),
        ]
    };

    let mut valid_elements = joined_curve(true);
    valid_elements.push(element(json!({
        "id": "valid",
        "name": "Valid",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "curve",
        "basePoint": { "mode": "reference", "pointId": "base" },
        "curveSide": "concave",
        "tangentAngleDeg": 0,
        "distance": 1
    })));
    let valid = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: valid_elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(valid.errors.is_empty());
    assert!((point(&valid, "valid")["x"].as_f64().unwrap() - 9.0).abs() < 1e-9);

    let mut ambiguous_elements = joined_curve(false);
    ambiguous_elements.push(element(json!({
        "id": "ambiguous",
        "name": "Ambiguous",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "curve",
        "basePoint": { "mode": "reference", "pointId": "base" },
        "curveSide": "convex",
        "tangentAngleDeg": 0,
        "distance": 1
    })));
    let ambiguous = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: ambiguous_elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(ambiguous
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("ambiguous")));
    assert_eq!(ambiguous.errors.len(), 1);
    assert!(ambiguous.errors[0].message.contains("曖昧な内部 join"));
}

#[test]
fn evaluates_line_tangent_offset_point_on_diagonal_line_using_y_up_angles() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
        module_materialization: None,
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
        module_materialization: None,
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
        module_materialization: None,
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
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
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
fn evaluates_line_tangent_offset_point_numeric_parameters() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "offset",
        "name": "式線上オフセット点",
        "type": "lineTangentOffsetPoint",
        "activity": "visible",
        "baseLineId": "line",
        "basePoint": { "mode": "reference", "pointId": "a" },
        "tangentAngleDeg": 45,
        "distance": 20
    })));
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let offset = point(&result, "offset");
    assert!(result.errors.is_empty());
    assert!((offset["x"].as_f64().unwrap() - 10.0 * 2f64.sqrt()).abs() < 1e-9);
    assert!((offset["y"].as_f64().unwrap() - 10.0 * 2f64.sqrt()).abs() < 1e-9);
}
