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
    });

    assert!(result.errors.is_empty());
    assert_eq!(result.computed_variables[0]["value"], json!(12.0));
    assert_eq!(result.computed_geometry[0]["x"], json!(20.0));
    assert_eq!(result.computed_geometry[1]["x"], json!(30.0));
    assert_eq!(result.computed_geometry[2]["kind"], json!("line"));
    assert_eq!(result.computed_geometry[3]["kind"], json!("arcLine"));
}

#[test]
fn reports_too_late_dependency() {
    let result = evaluate_document_input(EvaluationInput {
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
    });

    assert_eq!(result.computed_geometry.len(), 0);
    assert_eq!(result.errors[0].element_id, "line");
    assert_eq!(result.errors[0].missing_dependency_id, "a");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("点A")
    );
}

#[test]
fn applies_group_visibility_and_enabled_masks() {
    let result = evaluate_document_input(EvaluationInput {
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
        elements,
        evaluation_limit_index: None,
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
        elements,
        evaluation_limit_index: None,
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
        elements,
        evaluation_limit_index: None,
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
    });

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors[0].element_id, "line");
    assert_eq!(result.errors[0].missing_dependency_id, "then-point");
    assert!(result.errors[0].message.contains("寸法分岐"));
    assert!(result.errors[0].message.contains("評価OFF"));
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
        "placementMode": "distance",
        "distance": 15,
        "ratio": 0.5
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
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
        "placementMode": "ratio",
        "distance": 30,
        "ratio": 0.5
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
    });

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(25.0));
    assert_eq!(division["y"], json!(22.5));
}

#[test]
fn reports_division_point_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
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
                "placementMode": "ratio",
                "distance": 30,
                "ratio": 0.5
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
                "placementMode": "distance",
                "distance": 15,
                "ratio": 0.5
            })),
        ],
        evaluation_limit_index: None,
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
        "placementMode": "ratio",
        "distance": 30,
        "ratio": { "kind": "expression", "expression": "@基準 + 0.25" }
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
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
        "placementMode": "distance",
        "distance": 25,
        "ratio": 0.5
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
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
        "placementMode": "ratio",
        "distance": 25,
        "ratio": 1.2
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
    });

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(-20.0));
    assert_eq!(division["y"], json!(0.0));
}

#[test]
fn evaluates_line_division_point_on_arc_line() {
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
                "id": "division",
                "name": "円弧分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "arc", "endpointKey": "start" },
                "placementMode": "ratio",
                "distance": 0,
                "ratio": 0.5
            })),
        ],
        evaluation_limit_index: None,
    });

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert!((division["x"].as_f64().unwrap() - 10.0 / 2f64.sqrt()).abs() < 0.2);
    assert!((division["y"].as_f64().unwrap() - 10.0 / 2f64.sqrt()).abs() < 0.2);
}

#[test]
fn reports_line_division_point_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placementMode": "ratio",
                "distance": 0,
                "ratio": 0.5
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
                "placementMode": "distance",
                "distance": 10,
                "ratio": 0
            })),
        ],
        evaluation_limit_index: None,
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
        "placementMode": "ratio",
        "distance": 0,
        "ratio": { "kind": "expression", "expression": "@基準 + 0.25" }
    })));
    let result = evaluate_document_input(EvaluationInput {
        elements,
        evaluation_limit_index: None,
    });

    let division = point(&result, "division");
    assert!(result.errors.is_empty());
    assert_eq!(division["x"], json!(50.0));
    assert_eq!(division["y"], json!(0.0));
}
