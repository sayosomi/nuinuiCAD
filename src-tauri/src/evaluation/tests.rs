use super::types::DependencyError;
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

fn base_points() -> Vec<Value> {
    vec![
        element(json!({
            "id": "a",
            "name": "点A",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 10,
            "y": 20
        })),
        element(json!({
            "id": "b",
            "name": "点B",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 40,
            "y": 25
        })),
    ]
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
fn evaluates_points_lines_variables_and_arcs() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "ease",
                "name": "ゆとり",
                "type": "variable",
                "visible": true,
                "enabled": true,
                "scope": "global",
                "valueMode": "expression",
                "expression": 12,
                "point1": { "mode": "reference", "pointId": "a" },
                "point2": { "mode": "reference", "pointId": "a" },
                "point": { "mode": "reference", "pointId": "a" },
                "lineId": ""
            })),
            element(json!({
                "id": "a",
                "name": "点A",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": { "kind": "expression", "expression": "@ゆとり + 8" },
                "y": 20
            })),
            element(json!({
                "id": "b",
                "name": "点B",
                "type": "polarOffsetPoint",
                "visible": true,
                "enabled": true,
                "fromPointId": "a",
                "angleDeg": 0,
                "distance": 10
            })),
            element(json!({
                "id": "ab",
                "name": "直線AB",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            })),
            element(json!({
                "id": "angle-line",
                "name": "角度距離線",
                "type": "angleLengthLine",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "angleDeg": 90,
                "length": 10
            })),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "a" },
                "radius": 20,
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(result.computed_variables[0]["value"], json!(12.0));
    assert_eq!(result.computed_geometry[0]["x"], json!(20.0));
    assert_eq!(result.computed_geometry[1]["x"], json!(30.0));
    assert_eq!(result.computed_geometry[2]["kind"], json!("line"));
    assert_eq!(result.computed_geometry[3]["kind"], json!("line"));
    assert_eq!(result.computed_geometry[3]["end"]["x"], json!(20.0));
    assert_eq!(result.computed_geometry[3]["end"]["y"], json!(30.0));
    assert_eq!(result.computed_geometry[4]["kind"], json!("arcLine"));
}

#[test]
fn evaluates_variable_element_local_numeric_variables() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "size",
                "name": "寸法",
                "type": "variable",
                "visible": true,
                "enabled": true,
                "numericVariables": [
                    { "id": "base", "name": "基準", "value": 30 },
                    { "id": "ease", "name": "ゆとり", "value": { "kind": "expression", "expression": "@base + 5" } }
                ],
                "scope": "global",
                "valueMode": "expression",
                "expression": { "kind": "expression", "expression": "@ゆとり * 2" },
                "point1": { "mode": "reference", "pointId": "a" },
                "point2": { "mode": "reference", "pointId": "a" },
                "point": { "mode": "reference", "pointId": "a" },
                "lineId": ""
            })),
            element(json!({
                "id": "a",
                "name": "点A",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": { "kind": "expression", "expression": "@寸法" },
                "y": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(result.computed_variables[0]["value"], json!(70.0));
    assert_eq!(result.computed_geometry[0]["x"], json!(70.0));
}

#[test]
fn evaluates_text_with_anchor_and_numeric_references() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "ease",
        "name": "ゆとり",
        "type": "variable",
        "visible": true,
        "enabled": true,
        "scope": "global",
        "valueMode": "expression",
        "expression": 12,
        "point1": { "mode": "reference", "pointId": "a" },
        "point2": { "mode": "reference", "pointId": "b" },
        "point": { "mode": "reference", "pointId": "a" },
        "lineId": "line"
    })));
    elements.push(element(json!({
        "id": "text",
        "name": "注記",
        "type": "text",
        "visible": true,
        "enabled": true,
        "text": "前中心 {@ゆとり} / {直線AB.length} / 裸 @ゆとり",
        "anchor": { "mode": "reference", "pointId": "a" },
        "fontSize": 4
    })));

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
    let text = point(&result, "text");
    assert_eq!(text["kind"], json!("text"));
    assert_eq!(text["text"], json!("前中心 12 / 100 / 裸 @ゆとり"));
    assert_eq!(text["anchor"]["x"], json!(0.0));
    assert_eq!(text["anchor"]["y"], json!(0.0));
    assert_eq!(text["fontSize"], json!(4.0));
}

#[test]
fn evaluates_text_with_the_nui_3_sigil_form_of_a_property_reference() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "text",
        "name": "注記",
        "type": "text",
        "visible": true,
        "enabled": true,
        "text": "長さ {@直線AB.length}",
        "anchor": { "mode": "reference", "pointId": "a" },
        "fontSize": 4
    })));

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
    let text = point(&result, "text");
    assert_eq!(text["text"], json!("長さ 100"));
}

#[test]
fn evaluates_text_with_a_multi_segment_sigil_property_path() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "text",
        "name": "注記",
        "type": "text",
        "visible": true,
        "enabled": true,
        "text": "x={@直線AB.startPoint.x}",
        "anchor": { "mode": "reference", "pointId": "a" },
        "fontSize": 4
    })));

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
    let text = point(&result, "text");
    assert_eq!(text["text"], json!("x=0"));
}

#[test]
fn prefers_the_current_elements_own_unique_local_variable_over_a_sigil_property_reference() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "sleeve",
        "name": "袖",
        "type": "freePoint",
        "visible": true,
        "enabled": true,
        "numericVariables": [{ "id": "local-width", "name": "寸法", "value": 30 }],
        "x": 0,
        "y": 0
    })));
    elements.push(element(json!({
        "id": "text",
        "name": "袖",
        "type": "text",
        "visible": true,
        "enabled": true,
        "numericVariables": [{ "id": "local-width", "name": "寸法", "value": 30 }],
        "text": "寸法={@袖.寸法}",
        "anchor": { "mode": "reference", "pointId": "a" },
        "fontSize": 4
    })));

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
    let text = point(&result, "text");
    // "袖" here names the *text* element itself (Rule R(1): the element's own
    // unique local variable), not the unrelated freePoint also named "袖" -
    // must not be misread as a property reference to that other element.
    assert_eq!(text["text"], json!("寸法=30"));
}

#[test]
fn falls_through_to_the_property_arm_when_the_local_variable_name_is_ambiguous() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "text",
        "name": "直線AB",
        "type": "text",
        "visible": true,
        "enabled": true,
        "numericVariables": [
            { "id": "local-1", "name": "length", "value": 1 },
            { "id": "local-2", "name": "length", "value": 2 }
        ],
        "text": "length={@直線AB.length}",
        "anchor": { "mode": "reference", "pointId": "a" },
        "fontSize": 4
    })));

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
    let text = point(&result, "text");
    // Two local variables share the name "length" on the text element
    // itself (also named "直線AB", colliding with the line's own name) - the
    // ambiguous local-variable match must not be taken, so this resolves as
    // an element-property reference to the *line* (length 100), not either
    // local variable (1 or 2).
    assert_eq!(text["text"], json!("length=100"));
}

#[test]
fn evaluates_anchorless_text_as_comment_geometry() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "text",
            "name": "コメント",
            "type": "text",
            "visible": true,
            "enabled": true,
            "text": "構成リスト用",
            "anchor": null,
            "fontSize": 3
        }))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let text = point(&result, "text");
    assert_eq!(text["kind"], json!("text"));
    assert_eq!(text["text"], json!("構成リスト用"));
    assert_eq!(text["anchor"], Value::Null);
}

#[test]
fn evaluates_arc_line_with_full_360_degree_sweep() {
    let result = evaluate_document_input(EvaluationInput {
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
                "visible": true,
                "enabled": true,
                "x": 10,
                "y": 20
            })),
            element(json!({
                "id": "arc",
                "name": "完全円",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "a" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 360
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let arc = point(&result, "arc");
    assert!(result.errors.is_empty());
    assert_eq!(arc["kind"], json!("arcLine"));
    assert_eq!(arc["sweepAngleDeg"], json!(360.0));
    assert_eq!(arc["start"]["x"], json!(20.0));
    assert_eq!(arc["start"]["y"], json!(20.0));
    assert!((arc["end"]["x"].as_f64().unwrap() - 20.0).abs() < 1e-9);
    assert!((arc["end"]["y"].as_f64().unwrap() - 20.0).abs() < 1e-9);
    assert!((arc["length"].as_f64().unwrap() - std::f64::consts::PI * 20.0).abs() < 1e-9);
}

#[test]
fn evaluates_sqrt_and_pi_numeric_expressions() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "a",
            "name": "点A",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": { "kind": "expression", "expression": "sqrt(2) * pi" },
            "y": { "kind": "expression", "expression": "sqrt(pi * 4)" }
        }))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let point = point(&result, "a");
    assert!((point["x"].as_f64().unwrap() - 2f64.sqrt() * std::f64::consts::PI).abs() < 1e-9);
    assert!((point["y"].as_f64().unwrap() - (std::f64::consts::PI * 4.0).sqrt()).abs() < 1e-9);
}

#[test]
fn evaluates_numeric_reference_paths_for_geometry_parameters_and_variables() {
    let mut elements = base_line_elements();
    elements.extend(vec![
        element(json!({
            "id": "ratio-variable",
            "name": "割合変数",
            "type": "variable",
            "visible": true,
            "enabled": true,
            "scope": "global",
            "valueMode": "expression",
            "expression": 0.25,
            "point1": { "mode": "reference", "pointId": "a" },
            "point2": { "mode": "reference", "pointId": "b" },
            "point": { "mode": "reference", "pointId": "a" },
            "lineId": ""
        })),
        element(json!({
            "id": "division",
            "name": "分点",
            "type": "divisionPoint",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" },
            "placement": { "kind": "ratio", "value": { "kind": "expression", "expression": "ratio-variable.value" } }
        })),
        element(json!({
            "id": "derived",
            "name": "参照確認",
            "type": "offsetPoint",
            "visible": true,
            "enabled": true,
            "fromPoint": { "mode": "reference", "pointId": "division" },
            "dx": {
                "kind": "expression",
                "expression": "division.params.ratio * line.length + line.startPoint.x"
            },
            "dy": {
                "kind": "expression",
                "expression": "division.params.startPoint.y + line.endPoint.y"
            }
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
    assert_eq!(point(&result, "division")["x"], json!(25.0));
    assert_eq!(point(&result, "derived")["x"], json!(50.0));
    assert_eq!(point(&result, "derived")["y"], json!(0.0));
}

#[test]
fn reports_negative_sqrt_numeric_expressions() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "a",
            "name": "点A",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": { "kind": "expression", "expression": "sqrt(-1)" },
            "y": 0
        }))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0].message.contains("sqrt"));
}

#[test]
fn reports_too_late_dependency() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "line",
                "name": "参照線",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "coordinate", "x": 10, "y": 10 }
            })),
            element(json!({
                "id": "a",
                "name": "点A",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
            })),
        ],
        evaluation_limit_index: Some(1),
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert_eq!(result.computed_geometry.len(), 0);
    assert_eq!(result.errors[0].element_id, "line");
    assert_eq!(result.errors[0].missing_dependency_id, "a");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("点A")
    );
}

fn broken_parent() -> Value {
    element(json!({
        "id": "broken-parent",
        "name": "壊れた親点",
        "type": "offsetPoint",
        "visible": true,
        "enabled": true,
        "fromPointId": "ghost",
        "dx": 10,
        "dy": 0
    }))
}

fn dependent_line() -> Value {
    element(json!({
        "id": "dependent-line",
        "name": "依存線",
        "type": "line",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": "broken-parent" },
        "endPoint": { "mode": "coordinate", "x": 10, "y": 10 }
    }))
}

fn error_for<'a>(result: &'a EvaluationPayload, element_id: &str) -> &'a DependencyError {
    result
        .errors
        .iter()
        .find(|error| error.element_id == element_id)
        .expect("expected error for element")
}

#[test]
fn keeps_missing_parent_message_when_referenced_id_does_not_exist() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "line",
            "name": "参照線",
            "type": "line",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "ghost" },
            "endPoint": { "mode": "coordinate", "x": 10, "y": 10 }
        }))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let error = error_for(&result, "line");
    assert_eq!(error.missing_dependency_id, "ghost");
    assert!(error
        .message
        .contains("はこの要素より後にあるか、存在しません"));
}

#[test]
fn keeps_forward_reference_message_when_parent_appears_after_dependent() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![dependent_line(), broken_parent()],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let error = error_for(&result, "dependent-line");
    assert_eq!(error.missing_dependency_id, "broken-parent");
    assert!(error
        .message
        .contains("はこの要素より後にあるか、存在しません"));
}

#[test]
fn reports_evaluation_failed_message_when_parent_exists_earlier_but_failed() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![broken_parent(), dependent_line()],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("broken-parent")));

    let parent_error = error_for(&result, "broken-parent");
    assert_eq!(parent_error.missing_dependency_id, "ghost");

    let dependent_error = error_for(&result, "dependent-line");
    assert_eq!(dependent_error.missing_dependency_id, "broken-parent");
    assert!(dependent_error
        .message
        .contains("壊れた親点 の評価に失敗しているため評価できません"));
    assert!(!dependent_error
        .message
        .contains("はこの要素より後にあるか、存在しません"));
}

#[test]
fn reports_no_issue_for_a_valid_parent() {
    let mut valid_parent = broken_parent();
    valid_parent["fromPointId"] = json!("a");
    let result = evaluate_document_input(EvaluationInput {
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
                "visible": true,
                "enabled": true,
                "x": 10,
                "y": 20
            })),
            valid_parent,
            dependent_line(),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("dependent-line")));
}

#[test]
fn targets_only_the_failed_parent_when_one_of_several_parents_is_broken() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "valid-parent",
                "name": "正常な親点",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
            })),
            broken_parent(),
            element(json!({
                "id": "two-parent-line",
                "name": "二親線",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "valid-parent" },
                "endPoint": { "mode": "reference", "pointId": "broken-parent" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let dependent_errors: Vec<_> = result
        .errors
        .iter()
        .filter(|error| error.element_id == "two-parent-line")
        .collect();
    assert_eq!(dependent_errors.len(), 1);
    assert_eq!(dependent_errors[0].missing_dependency_id, "broken-parent");
    assert!(dependent_errors[0]
        .message
        .contains("評価に失敗しているため評価できません"));
}

#[test]
fn applies_group_visibility_and_enabled_masks() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "group",
                "name": "前身頃",
                "type": "group",
                "visible": false,
                "enabled": false,
                "expanded": true
            })),
            element(json!({
                "id": "a",
                "name": "点A",
                "type": "freePoint",
                "parentGroupId": "group",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.computed_geometry.is_empty());
    assert!(!result
        .effective_visible_element_ids
        .contains(&"a".to_owned()));
    assert!(!result
        .effective_enabled_element_ids
        .contains(&"a".to_owned()));
}

#[test]
fn evaluates_only_active_conditional_branch() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "if",
                "name": "寸法分岐",
                "type": "conditionalGroup",
                "visible": true,
                "enabled": true,
                "condition": 0,
                "expanded": true,
                "elseExpanded": true
            })),
            element(json!({
                "id": "then-point",
                "name": "then点",
                "type": "freePoint",
                "parentGroupId": "if",
                "conditionalBranch": "then",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
            })),
            element(json!({
                "id": "else-point",
                "name": "else点",
                "type": "freePoint",
                "parentGroupId": "if",
                "conditionalBranch": "else",
                "visible": true,
                "enabled": true,
                "x": 10,
                "y": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("then-point")));
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("else-point")));
    assert_eq!(result.condition_inactive_element_ids, vec!["then-point"]);
}

#[test]
fn evaluates_conditional_group_comparison_expression() {
    let mut elements = base_line_elements();
    elements.extend(vec![
        element(json!({
            "id": "c",
            "name": "点C",
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": 50,
            "y": 0
        })),
        element(json!({
            "id": "short-line",
            "name": "短い線",
            "type": "line",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "c" }
        })),
        element(json!({
            "id": "if",
            "name": "寸法分岐",
            "type": "conditionalGroup",
            "visible": true,
            "enabled": true,
            "condition": { "kind": "expression", "expression": "short-line.length >= 100 || line.length >= 100" },
            "expanded": true,
            "elseExpanded": true
        })),
        element(json!({
            "id": "then-point",
            "name": "then点",
            "type": "freePoint",
            "parentGroupId": "if",
            "conditionalBranch": "then",
            "visible": true,
            "enabled": true,
            "x": 0,
            "y": 0
        })),
        element(json!({
            "id": "else-point",
            "name": "else点",
            "type": "freePoint",
            "parentGroupId": "if",
            "conditionalBranch": "else",
            "visible": true,
            "enabled": true,
            "x": 10,
            "y": 0
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
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("then-point")));
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("else-point")));
    assert_eq!(result.condition_inactive_element_ids, vec!["else-point"]);
}

#[test]
fn evaluates_false_conditional_group_comparison_expression() {
    let mut elements = base_line_elements();
    elements.extend(vec![
        element(json!({
            "id": "if",
            "name": "寸法分岐",
            "type": "conditionalGroup",
            "visible": true,
            "enabled": true,
            "condition": { "kind": "expression", "expression": "line.length > 0 && line.length + 10 <= 10" },
            "expanded": true,
            "elseExpanded": true
        })),
        element(json!({
            "id": "then-point",
            "name": "then点",
            "type": "freePoint",
            "parentGroupId": "if",
            "conditionalBranch": "then",
            "visible": true,
            "enabled": true,
            "x": 0,
            "y": 0
        })),
        element(json!({
            "id": "else-point",
            "name": "else点",
            "type": "freePoint",
            "parentGroupId": "if",
            "conditionalBranch": "else",
            "visible": true,
            "enabled": true,
            "x": 10,
            "y": 0
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
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("then-point")));
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("else-point")));
    assert_eq!(result.condition_inactive_element_ids, vec!["then-point"]);
}

#[test]
fn does_not_treat_single_equals_as_equality_in_conditional_expression() {
    let mut elements = base_line_elements();
    elements.extend(vec![
        element(json!({
            "id": "if",
            "name": "寸法分岐",
            "type": "conditionalGroup",
            "visible": true,
            "enabled": true,
            "condition": { "kind": "expression", "expression": "line.length = 0" },
            "expanded": true,
            "elseExpanded": true
        })),
        element(json!({
            "id": "then-point",
            "name": "then点",
            "type": "freePoint",
            "parentGroupId": "if",
            "conditionalBranch": "then",
            "visible": true,
            "enabled": true,
            "x": 0,
            "y": 0
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

    assert_eq!(result.errors[0].element_id, "if");
    assert_eq!(result.errors[0].missing_dependency_id, "line.length = 0");
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("then-point")));
}

#[test]
fn reports_references_to_inactive_conditional_branch() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "if",
                "name": "寸法分岐",
                "type": "conditionalGroup",
                "visible": true,
                "enabled": true,
                "condition": 0,
                "expanded": true,
                "elseExpanded": true
            })),
            element(json!({
                "id": "then-point",
                "name": "then点",
                "type": "freePoint",
                "parentGroupId": "if",
                "conditionalBranch": "then",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
            })),
            element(json!({
                "id": "line",
                "name": "参照線",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "then-point" },
                "endPoint": { "mode": "coordinate", "x": 10, "y": 10 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors[0].element_id, "line");
    assert_eq!(result.errors[0].missing_dependency_id, "then-point");
    assert!(result.errors[0].message.contains("寸法分岐"));
    assert!(result.errors[0].message.contains("評価OFF"));
}

// Task 25: TS/Rust parity closure for a gap noted before this task landed -
// mirrors src/geometry/evaluate.test.ts's "marks a conditional group invalid
// when its condition cannot be evaluated" (a legacy numeric condition, not a
// typed one - the legacy adapter's poison behavior itself is untouched by
// Task 25, this only adds the missing Rust-side coverage for it).
#[test]
fn marks_a_conditional_group_invalid_when_its_legacy_condition_cannot_be_evaluated() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "if",
                "name": "寸法分岐",
                "type": "conditionalGroup",
                "visible": true,
                "enabled": true,
                "condition": { "kind": "expression", "expression": "missing.length" },
                "expanded": true,
                "elseExpanded": true
            })),
            element(json!({
                "id": "then-point",
                "name": "then点",
                "type": "freePoint",
                "parentGroupId": "if",
                "conditionalBranch": "then",
                "visible": true,
                "enabled": true,
                "x": 0,
                "y": 0
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
        .all(|geometry| geometry["elementId"] != json!("then-point")));
    assert_eq!(result.errors[0].element_id, "if");
    assert_eq!(result.errors[0].missing_dependency_id, "missing");
    assert_eq!(result.condition_inactive_element_ids, vec!["then-point"]);
}

#[test]
fn evaluates_division_point_by_distance() {
    let mut elements = base_points();
    elements.push(element(json!({
        "id": "division",
        "name": "分点",
        "type": "divisionPoint",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": "a" },
        "endPoint": { "mode": "reference", "pointId": "b" },
        "placement": { "kind": "distance", "value": 15 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["kind"], json!("point"));
    assert!(
        (division["x"].as_f64().unwrap() - (10.0 + (30.0 / 30.4138126514911) * 15.0)).abs() < 1e-9
    );
    assert!(
        (division["y"].as_f64().unwrap() - (20.0 + (5.0 / 30.4138126514911) * 15.0)).abs() < 1e-9
    );
}

#[test]
fn evaluates_division_point_by_ratio() {
    let mut elements = base_points();
    elements.push(element(json!({
        "id": "division",
        "name": "中点",
        "type": "divisionPoint",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": "a" },
        "endPoint": { "mode": "reference", "pointId": "b" },
        "placement": { "kind": "ratio", "value": 0.5 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(25.0));
    assert_eq!(division["y"], json!(22.5));
}

#[test]
fn reports_division_point_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
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
                "visible": true,
                "enabled": true,
                "x": 10,
                "y": 20
            })),
            element(json!({
                "id": "division",
                "name": "分点",
                "type": "divisionPoint",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
            element(json!({
                "id": "b",
                "name": "点B",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 40,
                "y": 25
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
        .all(|geometry| geometry["elementId"] != json!("division")));
    assert_eq!(result.errors[0].element_id, "division");
    assert_eq!(result.errors[0].missing_dependency_id, "b");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("点B")
    );
}

#[test]
fn reports_zero_length_distance_division_point() {
    let result = evaluate_document_input(EvaluationInput {
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
                "visible": true,
                "enabled": true,
                "x": 10,
                "y": 20
            })),
            element(json!({
                "id": "division",
                "name": "分点",
                "type": "divisionPoint",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "a" },
                "placement": { "kind": "distance", "value": 15 }
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
        .all(|geometry| geometry["elementId"] != json!("division")));
    assert_eq!(result.errors[0].element_id, "division");
    assert_eq!(result.errors[0].missing_dependency_id, "division");
    assert!(result.errors[0].message.contains("始点と終点が同じ位置"));
}

#[test]
fn evaluates_division_point_numeric_variables_and_expressions() {
    let mut elements = base_points();
    elements.push(element(json!({
        "id": "division",
        "name": "式分点",
        "type": "divisionPoint",
        "visible": true,
        "enabled": true,
        "numericVariables": [
            { "id": "base", "name": "基準", "value": 0.25 }
        ],
        "startPoint": { "mode": "reference", "pointId": "a" },
        "endPoint": { "mode": "reference", "pointId": "b" },
        "placement": { "kind": "ratio", "value": { "kind": "expression", "expression": "@基準 + 0.25" } }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(25.0));
    assert_eq!(division["y"], json!(22.5));
}

#[test]
fn evaluates_line_division_point_by_distance_from_start() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "division",
        "name": "線上分点",
        "type": "lineDivisionPoint",
        "visible": true,
        "enabled": true,
        "endpoint": { "lineId": "line", "endpointKey": "start" },
        "placement": { "kind": "distance", "value": 25 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(25.0));
    assert_eq!(division["y"], json!(0.0));
}

#[test]
fn evaluates_line_division_point_by_ratio_from_end() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "division",
        "name": "線上分点",
        "type": "lineDivisionPoint",
        "visible": true,
        "enabled": true,
        "endpoint": { "lineId": "line", "endpointKey": "end" },
        "placement": { "kind": "ratio", "value": 1.2 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(-20.0));
    assert_eq!(division["y"], json!(0.0));
}

// 04/05: DivisionPlacement characterization. `division_placement::decode_division_placement`
// is the single place a missing or unrecognized `placement.kind` falls back to the ratio
// interpretation, matching the TypeScript reference evaluator's identical fallback. This
// locks that fallback in under the tagged-union shape.
#[test]
fn evaluates_division_point_with_missing_placement_kind_as_ratio() {
    let mut elements = base_points();
    elements.push(element(json!({
        "id": "division",
        "name": "分点",
        "type": "divisionPoint",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": "a" },
        "endPoint": { "mode": "reference", "pointId": "b" },
        "placement": { "value": 0.5 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(25.0));
    assert_eq!(division["y"], json!(22.5));
}

#[test]
fn evaluates_division_point_with_unrecognized_placement_kind_as_ratio() {
    let mut elements = base_points();
    elements.push(element(json!({
        "id": "division",
        "name": "分点",
        "type": "divisionPoint",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": "a" },
        "endPoint": { "mode": "reference", "pointId": "b" },
        "placement": { "kind": "nonsense", "value": 0.5 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(25.0));
    assert_eq!(division["y"], json!(22.5));
}

#[test]
fn evaluates_line_division_point_with_missing_placement_kind_as_ratio() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "division",
        "name": "線上分点",
        "type": "lineDivisionPoint",
        "visible": true,
        "enabled": true,
        "endpoint": { "lineId": "line", "endpointKey": "start" },
        "placement": { "value": 0.4 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(40.0));
    assert_eq!(division["y"], json!(0.0));
}

#[test]
fn evaluates_line_division_point_with_unrecognized_placement_kind_as_ratio() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "division",
        "name": "線上分点",
        "type": "lineDivisionPoint",
        "visible": true,
        "enabled": true,
        "endpoint": { "lineId": "line", "endpointKey": "start" },
        "placement": { "kind": "nonsense", "value": 0.4 }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(40.0));
    assert_eq!(division["y"], json!(0.0));
}

#[test]
fn evaluates_line_division_point_on_arc_line() {
    let result = evaluate_document_input(EvaluationInput {
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
                "id": "division",
                "name": "円弧分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "arc", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert!((division["x"].as_f64().unwrap() - 10.0 / 2f64.sqrt()).abs() < 0.2);
    assert!((division["y"].as_f64().unwrap() - 10.0 / 2f64.sqrt()).abs() < 0.2);
}

#[test]
fn reports_line_division_point_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
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
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("division")));
    assert_eq!(result.errors[0].element_id, "division");
    assert_eq!(result.errors[0].missing_dependency_id, "line");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("参照線")
    );
}

#[test]
fn reports_zero_length_line_division_point() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            element(json!({
                "id": "line",
                "name": "ゼロ線",
                "type": "line",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "endPoint": { "mode": "coordinate", "x": 0, "y": 0 }
            })),
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placement": { "kind": "distance", "value": 10 }
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
        .all(|geometry| geometry["elementId"] != json!("division")));
    assert_eq!(result.errors[0].element_id, "division");
    assert_eq!(result.errors[0].missing_dependency_id, "division");
    assert!(result.errors[0].message.contains("長さのある線"));
}

#[test]
fn evaluates_line_division_point_numeric_variables_and_expressions() {
    let mut elements = base_line_elements();
    elements.push(element(json!({
        "id": "division",
        "name": "式線上分点",
        "type": "lineDivisionPoint",
        "visible": true,
        "enabled": true,
        "numericVariables": [
            { "id": "base", "name": "基準", "value": 0.25 }
        ],
        "endpoint": { "lineId": "line", "endpointKey": "start" },
        "placement": { "kind": "ratio", "value": { "kind": "expression", "expression": "@基準 + 0.25" } }
    })));
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

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(50.0));
    assert_eq!(division["y"], json!(0.0));
}
