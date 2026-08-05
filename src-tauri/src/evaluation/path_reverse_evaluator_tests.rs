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
