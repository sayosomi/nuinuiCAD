//! End-to-end coverage for the generic (non-mutation-owned) nested forGroup
//! path, through the full `evaluate_document_input` pipeline (hand-built
//! JSON fixtures, mirroring `property_binding_runtime_tests.rs`'s style).
//! Low-level coverage of `expand_for_group_iteration_from_template` itself
//! lives in `for_group_tests.rs`; TS/Rust parity for the same scenario is
//! covered by `test/fixtures/evaluation/nui3-nested-generic-for-group.nui`.

use super::*;
use serde_json::{json, Value};

fn input(elements: Vec<Value>) -> EvaluationInput {
    EvaluationInput {
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn for_group(id: &str, parent: Option<&str>, variable_name: &str, count: f64) -> Value {
    let mut value = json!({
        "id": id, "name": id, "type": "forGroup", "activity": "visible",
        "variableName": variable_name, "start": 0, "count": count, "step": 1, "showGenerated": false
    });
    if let Some(parent) = parent {
        value["parentGroupId"] = json!(parent);
    }
    value
}

fn expression(expression: &str) -> Value {
    json!({ "kind": "expression", "expression": expression })
}

fn point_referencing(id: &str, parent: &str, x_ref: &str, y_ref: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "freePoint", "activity": "visible",
        "parentGroupId": parent, "x": expression(x_ref), "y": expression(y_ref)
    })
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> Option<&'a Value> {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
}

#[test]
fn evaluates_a_nested_generic_for_group_as_outer_times_inner_iterations_exactly_once_each() {
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        for_group("inner", Some("outer"), "j", 3.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];
    let result = evaluate_document_input(input(elements));

    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert!(geometry(&result, "p").is_none());

    let expected_coordinates: [(f64, f64); 6] = [
        (0.0, 0.0),
        (0.0, 1.0),
        (0.0, 2.0),
        (1.0, 0.0),
        (1.0, 1.0),
        (1.0, 2.0),
    ];
    let mut expected_ids = Vec::new();
    let mut index = 0;
    for outer_iteration in 0..2 {
        let generated_inner_id = format!("inner@outer:{outer_iteration}");
        for inner_iteration in 0..3 {
            let generated_p_id = format!("p@{generated_inner_id}:{inner_iteration}");
            expected_ids.push(generated_p_id.clone());
            let point = geometry(&result, &generated_p_id)
                .unwrap_or_else(|| panic!("missing generated geometry for {generated_p_id}"));
            let (expected_x, expected_y) = expected_coordinates[index];
            assert_eq!(point["kind"], json!("point"));
            assert_eq!(point["x"].as_f64(), Some(expected_x));
            assert_eq!(point["y"].as_f64(), Some(expected_y));
            index += 1;
        }
    }

    // Exactly 6 P instances were generated - not fewer (the pre-fix Rust
    // behavior: the inner loop's own start/count/step were never read
    // because evaluate_element_by_type no-ops on a generated forGroup) and
    // not more (double-generation, the pre-fix TS behavior). Combine several
    // independent signals so no single one can mask a duplicate-evaluation
    // regression.
    let generated_point_count = result
        .computed_geometry
        .iter()
        .filter(|geometry| geometry["kind"] == json!("point"))
        .count();
    assert_eq!(generated_point_count, 6);
    let unique_ids: std::collections::HashSet<&str> =
        expected_ids.iter().map(String::as_str).collect();
    assert_eq!(unique_ids.len(), 6);
    assert_eq!(result.for_group_generated_rows.len(), 6);
    let unique_row_ids: std::collections::HashSet<&str> = result
        .for_group_generated_rows
        .iter()
        .map(|row| row.generated_element_id.as_str())
        .collect();
    assert_eq!(unique_row_ids.len(), 6);
    for row in &result.for_group_generated_rows {
        assert_eq!(row.template_element_id, "p");
        assert!(expected_ids.contains(&row.generated_element_id));
    }
}

#[test]
fn a_generated_inner_for_groups_row_reports_the_runtime_outer_instance_id_not_the_template_id() {
    let elements = vec![
        for_group("outer", None, "i", 1.0),
        for_group("inner", Some("outer"), "j", 1.0),
        point_referencing("p", "inner", "0", "0"),
    ];
    let result = evaluate_document_input(input(elements));

    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert_eq!(result.for_group_generated_rows.len(), 1);
    assert_eq!(
        result.for_group_generated_rows[0].for_group_id,
        "inner@outer:0"
    );
    assert_ne!(result.for_group_generated_rows[0].for_group_id, "inner");
}

#[test]
fn disabled_outer_for_group_generates_nothing_for_the_nested_inner_loop() {
    let mut outer = for_group("outer", None, "i", 2.0);
    outer["activity"] = json!("disabled");
    let elements = vec![
        outer,
        for_group("inner", Some("outer"), "j", 3.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];
    let result = evaluate_document_input(input(elements));

    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert_eq!(result.for_group_generated_rows.len(), 0);
    let generated_point_count = result
        .computed_geometry
        .iter()
        .filter(|geometry| geometry["kind"] == json!("point"))
        .count();
    assert_eq!(generated_point_count, 0);
}

#[test]
fn nested_inner_for_group_with_count_zero_generates_nothing_but_outer_still_runs() {
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        for_group("inner", Some("outer"), "j", 0.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];
    let result = evaluate_document_input(input(elements));

    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert_eq!(result.for_group_generated_rows.len(), 0);
    let generated_point_count = result
        .computed_geometry
        .iter()
        .filter(|geometry| geometry["kind"] == json!("point"))
        .count();
    assert_eq!(generated_point_count, 0);
}

#[test]
fn a_nested_inner_bodys_numeric_expression_references_an_outer_owned_points_property() {
    // P (owned by Inner) reads "a.x" - a's source id, resolved dynamically
    // by the numeric-expression evaluator - which is owned by Outer, one
    // scope up. Only the ancestor-scoped remap (for_group_ancestor_reference.rs)
    // can rewrite this ahead of evaluation.
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        point_referencing("a", "outer", "@i", "0"),
        for_group("inner", Some("outer"), "j", 2.0),
        point_referencing("p", "inner", "a.x + 10", "@j"),
    ];
    let result = evaluate_document_input(input(elements));

    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    let mut generated_p_count = 0;
    for outer_iteration in 0..2 {
        let generated_inner_id = format!("inner@outer:{outer_iteration}");
        for inner_iteration in 0..2 {
            let generated_p_id = format!("p@{generated_inner_id}:{inner_iteration}");
            let point = geometry(&result, &generated_p_id)
                .unwrap_or_else(|| panic!("missing generated geometry for {generated_p_id}"));
            assert_eq!(point["x"].as_f64(), Some(outer_iteration as f64 + 10.0));
            generated_p_count += 1;
        }
    }
    assert_eq!(generated_p_count, 4);
}
