use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

fn path_reverse(id: &str, name: &str, target_line_id: &str) -> serde_json::Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "pathReverse",
        "activity": "visible",
        "targetLineId": target_line_id
    }))
}

#[test]
fn path_reverse_flips_target_line_in_place_without_own_geometry() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            path_reverse("reverse", "", "line"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "reverse"));
    let line_geometry = geometry(&result, "line");
    assert_close(line_geometry["start"]["x"].as_f64().unwrap(), 100.0);
    assert_close(line_geometry["end"]["x"].as_f64().unwrap(), 0.0);
}

#[test]
fn path_reverse_reports_dependency_error_for_missing_target() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![path_reverse("reverse", "", "missing-line")],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].missing_dependency_id, "missing-line");
    // A blank `name` (the bare `reverse(...)` statement never carries one)
    // must fall back to a display label, never surface as an empty string.
    assert_eq!(result.errors[0].element_name, "反転");
}

// As a normal element, pathReverse now follows the standard activity gate
// (`inactive_conditional_group_id` / `base_effective_enabled_ids` in mod.rs)
// instead of the old dedicated PathMutationResolver, which ran before that
// gate and so ignored group/conditional state entirely. This is an
// intentional behavior change: a reversal inside a disabled group or an
// inactive conditional branch no longer applies.

#[test]
fn path_reverse_does_not_apply_inside_a_disabled_group() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            json!({ "id": "g", "name": "G", "type": "group", "activity": "disabled" }),
            element(json!({
                "id": "reverse", "name": "", "type": "pathReverse", "activity": "visible",
                "targetLineId": "line", "parentGroupId": "g"
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let geometry = geometry(&result, "line");
    assert_close(geometry["start"]["x"].as_f64().unwrap(), 0.0);
    assert_close(geometry["end"]["x"].as_f64().unwrap(), 100.0);
}

#[test]
fn path_reverse_only_applies_in_the_active_conditional_branch() {
    let elements_for = |condition: i32, branch: &str| {
        vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            json!({ "id": "if", "name": "IF", "type": "conditionalGroup", "activity": "visible", "condition": condition }),
            element(json!({
                "id": "reverse", "name": "", "type": "pathReverse", "activity": "visible",
                "targetLineId": "line", "parentGroupId": "if", "conditionalBranch": branch
            })),
        ]
    };
    let inactive = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: elements_for(1, "else"),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(inactive.errors.is_empty());
    let inactive_geometry = geometry(&inactive, "line");
    assert_close(inactive_geometry["start"]["x"].as_f64().unwrap(), 0.0);
    assert_close(inactive_geometry["end"]["x"].as_f64().unwrap(), 100.0);

    let active = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: elements_for(1, "then"),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(active.errors.is_empty());
    let active_geometry = geometry(&active, "line");
    assert_close(active_geometry["start"]["x"].as_f64().unwrap(), 100.0);
    assert_close(active_geometry["end"]["x"].as_f64().unwrap(), 0.0);
}

fn for_group(id: &str, name: &str, count: i64, parent_group_id: Option<&str>) -> serde_json::Value {
    let mut value = json!({
        "id": id, "name": name, "type": "forGroup", "activity": "visible",
        "variableName": "i", "start": 0, "count": count, "step": 1, "showGenerated": false
    });
    if let Some(parent) = parent_group_id {
        value["parentGroupId"] = json!(parent);
    }
    value
}

#[test]
fn path_reverse_allows_target_declared_in_the_same_for_loop() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            for_group("loop", "Loop", 2, None),
            json!({
                "id": "ab", "name": "AB", "type": "line", "activity": "visible",
                "parentGroupId": "loop",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            }),
            json!({
                "id": "rev", "name": "", "type": "pathReverse", "activity": "visible",
                "parentGroupId": "loop", "targetLineId": "ab"
            }),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
}

#[test]
fn path_reverse_generated_clone_keeps_model_name_empty_but_reports_display_name_fallback() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            for_group("loop", "Loop", 1, None),
            json!({
                "id": "ab", "name": "AB", "type": "line", "activity": "visible",
                "parentGroupId": "loop",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            }),
            json!({
                "id": "rev", "name": "", "type": "pathReverse", "activity": "visible",
                "parentGroupId": "loop", "targetLineId": "ab"
            }),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let reverse_row = result
        .for_group_generated_rows
        .iter()
        .find(|row| row.element_type == "pathReverse")
        .expect("expected a generated pathReverse row");
    // The row's presentation label falls back to the type label, never a
    // bracket-labeled model name like "[i=0] " (see element_display_name /
    // for_group_ancestor_ids' `name === ""` invariant for generated
    // mutation clones).
    assert_eq!(reverse_row.element_name, "反転");
    let line_row = result
        .for_group_generated_rows
        .iter()
        .find(|row| row.element_type == "line")
        .expect("expected a generated line row");
    assert_eq!(line_row.element_name, "[i=0] AB");
}

#[test]
fn path_reverse_rejects_target_declared_outside_its_for_loop() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("ab", "AB", "a", "b"),
            for_group("loop", "Loop", 2, None),
            json!({
                "id": "rev", "name": "", "type": "pathReverse", "activity": "visible",
                "parentGroupId": "loop", "targetLineId": "ab"
            }),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(!result.errors.is_empty());
    assert!(result
        .errors
        .iter()
        .all(|error| error.message.contains("for の外側")));
    // The rejection must prevent the mutation, not just report it alongside it.
    let line_geometry = geometry(&result, "ab");
    assert_close(line_geometry["start"]["x"].as_f64().unwrap(), 0.0);
}

#[test]
fn path_reverse_rejects_nested_inner_loop_reverse_targeting_outer_loop_only_element() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            for_group("outer", "Outer", 1, None),
            json!({
                "id": "ab", "name": "AB", "type": "line", "activity": "visible",
                "parentGroupId": "outer",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            }),
            for_group("inner", "Inner", 1, Some("outer")),
            json!({
                "id": "rev", "name": "", "type": "pathReverse", "activity": "visible",
                "parentGroupId": "inner", "targetLineId": "ab"
            }),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(!result.errors.is_empty());
    assert!(result
        .errors
        .iter()
        .all(|error| error.message.contains("for の外側")));
}

#[test]
fn path_reverse_allows_nested_inner_loop_reverse_targeting_same_inner_loop_element() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            for_group("outer", "Outer", 1, None),
            for_group("inner", "Inner", 1, Some("outer")),
            json!({
                "id": "ab", "name": "AB", "type": "line", "activity": "visible",
                "parentGroupId": "inner",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            }),
            json!({
                "id": "rev", "name": "", "type": "pathReverse", "activity": "visible",
                "parentGroupId": "inner", "targetLineId": "ab"
            }),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
}

#[test]
fn path_reverse_reports_geometry_error_for_non_line_target() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            path_reverse("reverse", "", "a"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0]
        .message
        .contains("線または曲線ではないため反転できません"));
}
