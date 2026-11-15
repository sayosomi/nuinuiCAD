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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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

// Exercise real extraction output at the shared pure kernel boundary; authored
// drawable and pure production payloads are also covered by TS/Rust parity.
fn curve_side_extract(source: &Value, reverse: bool) -> Value {
    use super::extract_path_interval::{extract_path_interval, ExtractBoundary};
    let (left, right) = if reverse {
        (ExtractBoundary::End, ExtractBoundary::Start)
    } else {
        (ExtractBoundary::Start, ExtractBoundary::End)
    };
    let result = extract_path_interval(source, &left, &right, "part", "Part").unwrap();
    assert_eq!(result.geometry["kind"], "joinedPath");
    result.geometry
}

fn curve_side_cubic_source() -> Value {
    json!({"kind": "bezierCurve", "segments": [{
        "start": {"x": 0, "y": 0}, "control1": {"x": 0, "y": 10},
        "control2": {"x": 10, "y": 10}, "end": {"x": 10, "y": 0}
    }]})
}

#[test]
fn curve_side_extracted_cubic_preserves_physical_normals_and_validation() {
    use super::bezier_math::Point;
    use super::line_tangent_offset_point_evaluator::tangent_offset_point_geometry_kernel as kernel;
    use super::path_reverse_geometry::reverse_line_like_geometry;
    // B(1/2)=(5,7.5), B'=(15,0), B''=(0,-60): concave points down.
    for reverse in [false, true] {
        let extracted = curve_side_extract(&curve_side_cubic_source(), reverse);
        assert_eq!(extracted["segments"][0]["kind"], "bezier");
        for geometry in [&extracted, &reverse_line_like_geometry(&extracted).unwrap()] {
            for (side, y) in [("convex", 8.5), ("concave", 6.5)] {
                let p = kernel(geometry, Point { x: 5.0, y: 7.5 }, Some(side), None, 1.0).unwrap();
                assert!((p.x - 5.0).abs() < 1e-9);
                assert!((p.y - y).abs() < 1e-9);
            }
            let zero = kernel(
                geometry,
                Point { x: 5.0, y: 7.5 },
                Some("convex"),
                None,
                0.0,
            )
            .unwrap();
            assert!((zero.y - 7.5).abs() < 1e-9);
        }
        for (base, side, distance, message) in [
            (
                Point { x: 5.0, y: 8.0 },
                "convex",
                1.0,
                "曲線上にありません",
            ),
            (
                Point { x: 5.0, y: 8.0 },
                "convex",
                0.0,
                "曲線上にありません",
            ),
            (
                Point { x: 5.0, y: 7.5 },
                "sideways",
                1.0,
                "convex または concave",
            ),
            (Point { x: 5.0, y: 7.5 }, "concave", -1.0, "0以上"),
        ] {
            assert!(kernel(&extracted, base, Some(side), None, distance)
                .err()
                .unwrap()
                .contains(message));
        }
    }
}

#[test]
fn curve_side_extracted_multi_cubic_endpoints_join_and_interior() {
    use super::bezier_math::Point;
    use super::line_tangent_offset_point_evaluator::tangent_offset_point_geometry_kernel as kernel;
    // Two exact halves of x=10t, y=30t(1-t), meeting at (5,7.5).
    let source = json!({"kind": "bezierCurve", "segments": [
        {"start": {"x": 0, "y": 0}, "control1": {"x": 5.0/3.0, "y": 5},
         "control2": {"x": 10.0/3.0, "y": 7.5}, "end": {"x": 5, "y": 7.5}},
        {"start": {"x": 5, "y": 7.5}, "control1": {"x": 20.0/3.0, "y": 7.5},
         "control2": {"x": 25.0/3.0, "y": 5}, "end": {"x": 10, "y": 0}}
    ]});
    for reverse in [false, true] {
        let extracted = curve_side_extract(&source, reverse);
        assert_eq!(extracted["segments"].as_array().unwrap().len(), 2);
        for (base, normal) in [
            (
                Point { x: 0.0, y: 0.0 },
                Point {
                    x: 3.0 / 10f64.sqrt(),
                    y: -1.0 / 10f64.sqrt(),
                },
            ),
            (Point { x: 5.0, y: 7.5 }, Point { x: 0.0, y: -1.0 }),
            (
                Point { x: 10.0, y: 0.0 },
                Point {
                    x: -3.0 / 10f64.sqrt(),
                    y: -1.0 / 10f64.sqrt(),
                },
            ),
            (
                Point { x: 2.5, y: 5.625 },
                Point {
                    x: 1.5 / 3.25f64.sqrt(),
                    y: -1.0 / 3.25f64.sqrt(),
                },
            ),
        ] {
            let p = kernel(&extracted, base, Some("concave"), None, 1.0).unwrap();
            assert!((p.x - base.x - normal.x).abs() < 1e-8);
            assert!((p.y - base.y - normal.y).abs() < 1e-8);
        }
    }
}

#[test]
fn curve_side_extracted_paths_reject_non_cubic_kinds_and_degeneracy() {
    use super::bezier_math::Point;
    use super::line_tangent_offset_point_evaluator::tangent_offset_point_geometry_kernel as kernel;
    let path = curve_side_extract(&curve_side_cubic_source(), false);
    let mut empty = path.clone();
    empty["segments"] = json!([]);
    let mut incomplete_cubic = path.clone();
    incomplete_cubic["segments"][0]
        .as_object_mut()
        .unwrap()
        .remove("control2");
    let mut offset = path.clone();
    offset["kind"] = json!("offsetLine");
    let mut polyline = path.clone();
    polyline["kind"] = json!("polyline");
    let mut mixed_line = path.clone();
    mixed_line["segments"]
        .as_array_mut()
        .unwrap()
        .push(json!({"kind": "line", "start": {"x":10,"y":0}, "end": {"x":20,"y":0}, "length":10}));
    let mut mixed_arc = path.clone();
    mixed_arc["segments"].as_array_mut().unwrap().push(json!({"kind": "arc", "start": {"x":10,"y":0}, "end": {"x":20,"y":10}, "center": {"x":20,"y":0}, "radius":10,"startAngleDeg":180,"sweepAngleDeg":-90,"length":15.7}));
    for geometry in [
        empty,
        incomplete_cubic,
        offset,
        polyline,
        mixed_line,
        mixed_arc,
    ] {
        assert!(kernel(
            &geometry,
            Point { x: 5.0, y: 7.5 },
            Some("convex"),
            None,
            0.0
        )
        .err()
        .unwrap()
        .contains("ベジェ曲線"));
    }
    for (c1, c2, base) in [
        (
            json!({"x":0,"y":0}),
            json!({"x":10,"y":10}),
            Point { x: 0.0, y: 0.0 },
        ),
        (
            json!({"x":3,"y":0}),
            json!({"x":7,"y":0}),
            Point { x: 5.0, y: 0.0 },
        ),
        (
            json!({"x":0,"y":1e-10}),
            json!({"x":10,"y":1e-10}),
            Point { x: 5.0, y: 0.0 },
        ),
    ] {
        let mut source = curve_side_cubic_source();
        source["segments"][0]["control1"] = c1;
        source["segments"][0]["control2"] = c2;
        let extracted = curve_side_extract(&source, false);
        assert!(kernel(&extracted, base, Some("convex"), None, 0.0)
            .err()
            .unwrap()
            .contains("接線または曲率"));
    }
}

#[test]
fn curve_side_extracted_join_rejects_corner_and_conflicting_curvature() {
    use super::bezier_math::Point;
    use super::line_tangent_offset_point_evaluator::tangent_offset_point_geometry_kernel as kernel;
    let source = json!({"kind": "bezierCurve", "segments": [
        {"start": {"x": 0, "y": 0}, "control1": {"x": 0, "y": 5},
         "control2": {"x": 2.5, "y": 7.5}, "end": {"x": 5, "y": 7.5}},
        {"start": {"x": 5, "y": 7.5}, "control1": {"x": 7.5, "y": 7.5},
         "control2": {"x": 10, "y": 10}, "end": {"x": 15, "y": 10}}
    ]});
    for corner in [false, true] {
        let mut source = source.clone();
        if corner {
            source["segments"][1]["control1"] = json!({"x":5,"y":10});
        }
        for reverse in [false, true] {
            let path = curve_side_extract(&source, reverse);
            assert!(
                kernel(&path, Point { x: 5.0, y: 7.5 }, Some("convex"), None, 0.0)
                    .err()
                    .unwrap()
                    .contains("曖昧な内部 join")
            );
        }
    }
}
