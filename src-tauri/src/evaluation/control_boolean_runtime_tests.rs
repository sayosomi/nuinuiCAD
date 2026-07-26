//! End-to-end coverage for Task 25, through the full `evaluate_document_input`
//! pipeline (hand-built JSON fixtures, mirroring
//! `scalar_program_integration_tests.rs`'s style): `conditionalGroup.condition`
//! typed boolean expressions and `forGroup.showGenerated` typed boolean
//! bindings. Focused unit coverage for the payload decoders themselves lives
//! in `scalars/condition_expression_payload_tests.rs` and
//! `scalars/control_boolean_payload_tests.rs`.

use super::*;
use serde_json::{json, Value};

fn input(
    elements: Vec<Value>,
    scalar_program: Option<Value>,
    control_boolean_bindings: Option<Value>,
    condition_expressions: Option<Value>,
) -> EvaluationInput {
    EvaluationInput {
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings,
        condition_expressions,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn boolean_literal(value: bool) -> Value {
    json!({ "kind": "booleanLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "boolean"} })
}

fn boolean_reference(binding_id: &str) -> Value {
    json!({ "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1}, "name": binding_id, "bindingId": binding_id, "type": {"kind": "boolean"} })
}

fn condition_expression_entry(element_id: &str, expression: Value) -> Value {
    json!({ "elementId": element_id, "expression": expression })
}

fn boolean_statement(binding_id: &str, initializer: Value) -> Value {
    json!({
        "kind": "declare",
        "bindingId": binding_id,
        "scopeId": "root",
        "sourceOrder": 0,
        "declaration": {"bindingKind": "const", "declaredType": {"kind": "boolean"}, "initializer": initializer}
    })
}

fn number_literal(value: f64) -> Value {
    json!({ "kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "number"} })
}

fn number_statement(binding_id: &str, initializer: Value) -> Value {
    json!({
        "kind": "declare",
        "bindingId": binding_id,
        "scopeId": "root",
        "sourceOrder": 0,
        "declaration": {"bindingKind": "const", "declaredType": {"kind": "number"}, "initializer": initializer}
    })
}

fn program(statements: Vec<Value>) -> Value {
    json!({ "statements": statements })
}

fn point(id: &str, x: f64, y: f64) -> Value {
    json!({ "id": id, "name": id, "type": "freePoint", "visible": true, "enabled": true, "x": x, "y": y })
}

fn conditional_group(id: &str, condition: Value) -> Value {
    json!({
        "id": id, "name": id, "type": "conditionalGroup", "visible": true, "enabled": true,
        "condition": condition, "expanded": true, "elseExpanded": true
    })
}

fn branch_point(id: &str, parent_id: &str, branch: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "freePoint", "parentGroupId": parent_id,
        "conditionalBranch": branch, "visible": true, "enabled": true, "x": 0, "y": 0
    })
}

fn control_boolean_binding_entry(element_id: &str, parameter_key: &str, binding_id: &str) -> Value {
    json!({
        "elementId": element_id, "parameterKey": parameter_key, "bindingId": binding_id,
        "expectedType": {"kind": "boolean"}
    })
}

fn for_group(id: &str, count: f64, show_generated_literal: bool) -> Value {
    json!({
        "id": id, "name": id, "type": "forGroup", "visible": true, "enabled": true,
        "variableName": "i", "start": 0, "count": count, "step": 1, "showGenerated": show_generated_literal
    })
}

#[test]
fn boolean_literal_condition_selects_the_then_branch() {
    let result = evaluate_document_input(input(
        vec![
            conditional_group("if", json!(0.0)),
            branch_point("then-point", "if", "then"),
            branch_point("else-point", "if", "else"),
        ],
        Some(program(vec![])),
        None,
        Some(json!([condition_expression_entry(
            "if",
            boolean_literal(true)
        )])),
    ));

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
fn bare_boolean_binding_reference_condition_selects_the_correct_branch() {
    let result = evaluate_document_input(input(
        vec![
            conditional_group("if", json!(0.0)),
            branch_point("then-point", "if", "then"),
            branch_point("else-point", "if", "else"),
        ],
        Some(program(vec![boolean_statement(
            "binding:flag",
            boolean_literal(false),
        )])),
        None,
        Some(json!([condition_expression_entry(
            "if",
            boolean_reference("binding:flag")
        )])),
    ));

    assert!(result.errors.is_empty());
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("else-point")));
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("then-point")));
    assert_eq!(result.condition_inactive_element_ids, vec!["then-point"]);
}

#[test]
fn a_poisoned_typed_condition_disables_both_branches() {
    // Referencing a bindingId that does not exist in the scalar program's
    // own statements is exactly the poison path `ScalarBindingResolver`
    // fails closed on - matching the legacy poison test's shape.
    let result = evaluate_document_input(input(
        vec![
            conditional_group("if", json!(0.0)),
            branch_point("then-point", "if", "then"),
            branch_point("else-point", "if", "else"),
        ],
        Some(program(vec![])),
        None,
        Some(json!([condition_expression_entry(
            "if",
            boolean_reference("binding:missing")
        )])),
    ));

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("then-point")));
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("else-point")));
    let mut inactive = result.condition_inactive_element_ids.clone();
    inactive.sort();
    assert_eq!(inactive, vec!["else-point", "then-point"]);
}

#[test]
fn a_plain_legacy_numeric_condition_with_no_condition_expressions_is_unaffected() {
    let result = evaluate_document_input(input(
        vec![
            conditional_group("if", json!(1.0)),
            branch_point("then-point", "if", "then"),
            branch_point("else-point", "if", "else"),
        ],
        None,
        None,
        None,
    ));

    assert!(result.errors.is_empty());
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("then-point")));
    assert_eq!(result.condition_inactive_element_ids, vec!["else-point"]);
}

#[test]
fn show_generated_literal_false_never_affects_iteration_count_or_rows() {
    let result = evaluate_document_input(input(
        vec![point("a", 0.0, 0.0), for_group("loop", 3.0, false)],
        None,
        None,
        None,
    ));

    assert!(result.errors.is_empty());
    assert_eq!(
        result.for_group_effective_show_generated_ids,
        Vec::<String>::new()
    );
}

#[test]
fn show_generated_bound_true_is_reflected_without_affecting_rows() {
    let result = evaluate_document_input(input(
        vec![point("a", 0.0, 0.0), for_group("loop", 3.0, false)],
        Some(program(vec![boolean_statement(
            "binding:show",
            boolean_literal(true),
        )])),
        Some(json!([control_boolean_binding_entry(
            "loop",
            "showGenerated",
            "binding:show"
        )])),
        None,
    ));

    assert!(result.errors.is_empty());
    assert_eq!(result.for_group_effective_show_generated_ids, vec!["loop"]);
}

#[test]
fn show_generated_bound_to_a_wrong_runtime_type_fails_closed_to_hidden() {
    // The payload's own `expectedType: boolean` passes decode-time
    // validation (it matches showGenerated's canonical type), but the
    // *actual* declared statement this bindingId resolves to is a number -
    // exercising the runtime (not decode-time) fail-closed path.
    let result = evaluate_document_input(input(
        vec![point("a", 0.0, 0.0), for_group("loop", 3.0, true)],
        Some(program(vec![number_statement(
            "binding:show",
            number_literal(1.0),
        )])),
        Some(json!([control_boolean_binding_entry(
            "loop",
            "showGenerated",
            "binding:show"
        )])),
        None,
    ));

    assert!(result.errors.is_empty());
    assert_eq!(
        result.for_group_effective_show_generated_ids,
        Vec::<String>::new()
    );
}

#[test]
fn a_typed_condition_inside_a_for_group_template_resolves_the_same_branch_on_every_iteration() {
    let line_a = point("a", 0.0, 0.0);
    let line_b = point("b", 10.0, 0.0);
    let base_line = json!({
        "id": "ab", "name": "ab", "type": "line", "visible": true, "enabled": true,
        "startPoint": {"mode": "reference", "pointId": "a"},
        "endPoint": {"mode": "reference", "pointId": "b"}
    });
    let for_group_el = for_group("loop", 3.0, false);
    let if_el = json!({
        "id": "if", "name": "if", "type": "conditionalGroup", "parentGroupId": "loop",
        "visible": true, "enabled": true, "condition": 0.0, "expanded": true, "elseExpanded": true
    });
    let then_line = json!({
        "id": "then-line", "name": "then-line", "type": "copyLine", "parentGroupId": "if",
        "conditionalBranch": "then", "visible": true, "enabled": true,
        "startPoint": {"mode": "reference", "pointId": "a"},
        "endPoint": {"mode": "reference", "pointId": "b"},
        "scale": 1, "angleDeg": 0, "mirrorX": false, "baseLineIds": ["ab"]
    });
    let else_line = json!({
        "id": "else-line", "name": "else-line", "type": "copyLine", "parentGroupId": "if",
        "conditionalBranch": "else", "visible": true, "enabled": true,
        "startPoint": {"mode": "reference", "pointId": "a"},
        "endPoint": {"mode": "reference", "pointId": "b"},
        "scale": 1, "angleDeg": 0, "mirrorX": true, "baseLineIds": ["ab"]
    });

    let result = evaluate_document_input(input(
        vec![
            line_a,
            line_b,
            base_line,
            for_group_el,
            if_el,
            then_line,
            else_line,
        ],
        Some(program(vec![boolean_statement(
            "binding:flag",
            boolean_literal(true),
        )])),
        None,
        Some(json!([condition_expression_entry(
            "if",
            boolean_reference("binding:flag")
        )])),
    ));

    assert!(result.errors.is_empty());
    let then_rows: Vec<_> = result
        .for_group_generated_rows
        .iter()
        .filter(|row| row.template_element_id == "then-line")
        .collect();
    let else_rows: Vec<_> = result
        .for_group_generated_rows
        .iter()
        .filter(|row| row.template_element_id == "else-line")
        .collect();
    assert_eq!(then_rows.len(), 3);
    assert_eq!(else_rows.len(), 3);
    for row in &then_rows {
        assert!(result
            .computed_geometry
            .iter()
            .any(|geometry| geometry["elementId"] == json!(row.generated_element_id)));
    }
    for row in &else_rows {
        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != json!(row.generated_element_id)));
        assert!(result
            .condition_inactive_element_ids
            .contains(&row.generated_element_id));
    }
}
