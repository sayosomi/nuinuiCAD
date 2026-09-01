//! End-to-end coverage for Task 28, through the full `evaluate_document_input`
//! pipeline (hand-built JSON fixtures, mirroring
//! `control_boolean_runtime_tests.rs`'s style): compiled text templates
//! (`text_templates`) and the bare `@binding` `text.text` case
//! (`text_property_bindings`). Focused unit coverage for the payload
//! decoders themselves lives in `scalars/text_template_payload_tests.rs`
//! and `scalars/text_property_binding_payload_tests.rs`; the pure segment
//! walker's own coverage lives in `scalars/text_tests.rs`.

use super::*;
use serde_json::{json, Value};

fn input(
    elements: Vec<Value>,
    scalar_program: Option<Value>,
    text_templates: Option<Value>,
    text_property_bindings: Option<Value>,
) -> EvaluationInput {
    EvaluationInput {
        module_materialization: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates,
        text_property_bindings,
    }
}

fn text_element(id: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "text", "activity": "visible",
        "text": "placeholder - replaced by a compiled template or bound property",
        "anchor": Value::Null, "fontSize": 3
    })
}

fn free_point(id: &str, name: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "name": name,
        "type": "freePoint",
        "activity": "visible",
        "x": x,
        "y": y
    })
}

fn line_element(id: &str, name: &str, start_id: &str, end_id: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "type": "line",
        "activity": "visible",
        "startPoint": {"mode": "reference", "pointId": start_id},
        "endPoint": {"mode": "reference", "pointId": end_id}
    })
}

fn bezier_element(id: &str, name: &str, start_id: &str, end_id: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "type": "bezierCurve",
        "activity": "visible",
        "startPoint": {"mode": "reference", "pointId": start_id},
        "startHandleAngleDeg": 0,
        "startHandleLength": 20,
        "intermediatePoints": [],
        "endPoint": {"mode": "reference", "pointId": end_id},
        "endHandleAngleDeg": 180,
        "endHandleLength": 20
    })
}

fn literal_segment(cooked: &str) -> Value {
    json!({"kind": "literal", "cooked": cooked})
}

fn numeric_expression_hole_segment(raw: &str) -> Value {
    json!({"kind": "hole", "holeKind": "numeric", "raw": raw})
}

fn string_hole_segment(expression: Value) -> Value {
    json!({"kind": "hole", "holeKind": "string", "expression": expression})
}

fn number_hole_segment(expression: Value) -> Value {
    json!({"kind": "hole", "holeKind": "number", "expression": expression})
}

fn boolean_hole_segment(expression: Value) -> Value {
    json!({"kind": "hole", "holeKind": "boolean", "expression": expression})
}

fn string_literal_expr(value: &str) -> Value {
    json!({"kind": "stringLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "string"}})
}

fn number_literal_expr(value: f64) -> Value {
    json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "number"}})
}

fn boolean_literal_expr(value: bool) -> Value {
    json!({"kind": "booleanLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "boolean"}})
}

fn string_reference_expr(binding_id: &str) -> Value {
    json!({"kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1}, "name": binding_id, "bindingId": binding_id, "type": {"kind": "string"}})
}

fn number_reference_expr(binding_id: &str) -> Value {
    json!({"kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1}, "name": binding_id, "bindingId": binding_id, "type": {"kind": "number"}})
}

fn boolean_reference_expr(binding_id: &str) -> Value {
    json!({"kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1}, "name": binding_id, "bindingId": binding_id, "type": {"kind": "boolean"}})
}

fn string_statement(binding_id: &str, initializer: Value) -> Value {
    json!({
        "kind": "declare",
        "bindingId": binding_id,
        "scopeId": "root",
        "sourceOrder": 0,
        "declaration": {"bindingKind": "const", "declaredType": {"kind": "string"}, "initializer": initializer}
    })
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

fn boolean_statement(binding_id: &str, initializer: Value) -> Value {
    json!({
        "kind": "declare",
        "bindingId": binding_id,
        "scopeId": "root",
        "sourceOrder": 0,
        "declaration": {"bindingKind": "const", "declaredType": {"kind": "boolean"}, "initializer": initializer}
    })
}

fn program(statements: Vec<Value>) -> Value {
    json!({ "statements": statements })
}

fn text_template_entry(element_id: &str, segments: Vec<Value>) -> Value {
    json!({"elementId": element_id, "segments": segments})
}

fn text_property_binding_entry(element_id: &str, binding_id: &str) -> Value {
    json!({
        "elementId": element_id, "parameterKey": "text", "bindingId": binding_id,
        "expectedType": {"kind": "string"}
    })
}

fn text_value(result: &EvaluationPayload, element_id: &str) -> String {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(element_id))
        .and_then(|geometry| geometry["text"].as_str())
        .unwrap_or_else(|| panic!("no computed text geometry for \"{element_id}\""))
        .to_owned()
}

#[test]
fn assembles_a_literal_only_template_with_no_scalar_program() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        None,
        Some(json!([text_template_entry(
            "t",
            vec![literal_segment("前身頃を2枚カット")]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "前身頃を2枚カット");
}

#[test]
fn normalizes_unaffected_japanese_geometry_property_aliases_in_text_templates() {
    let result = evaluate_document_input(input(
        vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line_element("line", "直線AB", "a", "b"),
            bezier_element("curve", "曲線AC", "a", "b"),
            text_element("t"),
        ],
        None,
        Some(json!([text_template_entry(
            "t",
            vec![numeric_expression_hole_segment(
                "直線AB.長さ + 曲線AC.始点ハンドル長 + 曲線AC.終点ハンドル長",
            )]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "140");
}

#[test]
fn assembles_a_numeric_expression_hole_only_template_with_no_scalar_program() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        None,
        Some(json!([text_template_entry(
            "t",
            vec![
                literal_segment("計算: "),
                numeric_expression_hole_segment("2 + 3")
            ]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "計算: 5");
}

#[test]
fn substitutes_a_typed_string_hole() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![string_statement(
            "binding:label",
            string_literal_expr("前身頃"),
        )])),
        Some(json!([text_template_entry(
            "t",
            vec![
                string_hole_segment(string_reference_expr("binding:label")),
                literal_segment("を2枚カット")
            ]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "前身頃を2枚カット");
}

#[test]
fn substitutes_a_typed_number_hole_and_formats_it() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![number_statement(
            "binding:count",
            number_literal_expr(12.0),
        )])),
        Some(json!([text_template_entry(
            "t",
            vec![number_hole_segment(number_reference_expr("binding:count"))]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "12");
}

#[test]
fn substitutes_typed_boolean_holes_as_lowercase_true_and_false() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![boolean_statement(
            "binding:enabled",
            boolean_literal_expr(true),
        )])),
        Some(json!([text_template_entry(
            "t",
            vec![
                boolean_hole_segment(boolean_reference_expr("binding:enabled")),
                literal_segment(","),
                boolean_hole_segment(boolean_literal_expr(false)),
            ]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "true,false");
}

#[test]
fn interleaves_numeric_expression_and_typed_holes() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![string_statement(
            "binding:label",
            string_literal_expr("前身頃"),
        )])),
        Some(json!([text_template_entry(
            "t",
            vec![
                string_hole_segment(string_reference_expr("binding:label")),
                literal_segment(" 計算:"),
                numeric_expression_hole_segment("2 + 3")
            ]
        )])),
        None,
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "前身頃 計算:5");
}

/// A numeric-expression hole referencing a nonexistent element - `evaluate_numeric_or_push`
/// already pushes the correct
/// `DependencyError` and returns `None`; the new template walker must not
/// push a second, duplicate one for the same failing hole.
#[test]
fn a_numeric_expression_hole_failure_produces_exactly_one_error_no_duplicate() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        None,
        Some(json!([text_template_entry(
            "t",
            vec![numeric_expression_hole_segment("存在しない.length")]
        )])),
        None,
    ));
    assert_eq!(result.errors.len(), 1);
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("t")));
}

/// A typed hole referencing a binding whose *own* initializer fails
/// (poisoned), not a hole referencing a nonexistent binding id directly -
/// distinct from the "dangling binding" scenario below.
#[test]
fn a_typed_hole_referencing_a_poisoned_binding_fails_closed_self_referentially() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![string_statement(
            "binding:poisoned",
            string_reference_expr("binding:does-not-exist-anywhere"),
        )])),
        Some(json!([text_template_entry(
            "t",
            vec![string_hole_segment(string_reference_expr(
                "binding:poisoned"
            ))]
        )])),
        None,
    ));
    assert_eq!(result.errors.len(), 1);
    let error = &result.errors[0];
    assert_eq!(error.element_id, "t");
    assert_eq!(error.missing_dependency_id, "t");
    assert_eq!(error.missing_dependency_name.as_deref(), Some("t"));
    assert!(error.message.contains("評価に失敗"));
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("t")));
}

/// A typed hole whose reference `bindingId` does not correspond to any
/// statement in `scalar_program` at all - resolved through the same
/// `evaluation-binding-unavailable` path any other binding consumer
/// already uses (`bindings.rs`'s `unavailable_binding`), not a new
/// decode-time check.
#[test]
fn a_typed_hole_referencing_a_completely_dangling_binding_fails_closed_self_referentially() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![])),
        Some(json!([text_template_entry(
            "t",
            vec![string_hole_segment(string_reference_expr(
                "binding:does-not-exist-anywhere"
            ))]
        )])),
        None,
    ));
    assert_eq!(result.errors.len(), 1);
    let error = &result.errors[0];
    assert_eq!(error.element_id, "t");
    assert_eq!(error.missing_dependency_id, "t");
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("t")));
}

#[test]
fn materializes_a_bare_text_property_binding_with_no_compiled_template() {
    let result = evaluate_document_input(input(
        vec![text_element("t")],
        Some(program(vec![string_statement(
            "binding:label",
            string_literal_expr("前身頃"),
        )])),
        None,
        Some(json!([text_property_binding_entry("t", "binding:label")])),
    ));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "前身頃");
}

/// No `text_templates`/`text_property_bindings` entry at all for this
/// element: raw text remains literal. The production nui1 path always sends
/// a compiled template for source-authored text interpolation.
#[test]
fn a_text_element_with_no_compiled_entry_keeps_braces_literal() {
    let mut element = text_element("t");
    element["text"] = json!("直接の文字列 {2 + 3}");
    let result = evaluate_document_input(input(vec![element], None, None, None));
    assert!(result.errors.is_empty());
    assert_eq!(text_value(&result, "t"), "直接の文字列 {2 + 3}");
}

fn for_group_el(id: &str, count: f64) -> Value {
    json!({
        "id": id, "name": id, "type": "forGroup", "activity": "visible",
        "variableName": "i", "start": 0, "count": count, "step": 1, "showGenerated": false
    })
}

/// A `text` element templated inside a `forGroup`, with a typed hole that
/// fails - resolved/erroring by the *template* id's compiled entry on every
/// generated iteration (the `TextTemplateContext.lookup_id` convention,
/// mirroring `ConditionalGroupContext`/property-binding `template_id`
/// lookup), with each generated clone's own error self-referential to that
/// clone (matching Task 27's `context.currentElement.id` convention - the
/// *clone* being evaluated, not the template).
#[test]
fn a_for_group_generated_text_elements_typed_hole_failure_is_self_referential_per_clone() {
    let mut templated_text = text_element("label");
    templated_text["parentGroupId"] = json!("loop");

    let result = evaluate_document_input(input(
        vec![for_group_el("loop", 2.0), templated_text],
        Some(program(vec![])),
        Some(json!([text_template_entry(
            "label",
            vec![string_hole_segment(string_reference_expr(
                "binding:does-not-exist-anywhere"
            ))]
        )])),
        None,
    ));

    let generated_rows: Vec<_> = result
        .for_group_generated_rows
        .iter()
        .filter(|row| row.template_element_id == "label")
        .collect();
    assert_eq!(generated_rows.len(), 2);
    assert_eq!(result.errors.len(), 2);
    for row in &generated_rows {
        assert!(result
            .errors
            .iter()
            .any(|error| error.element_id == row.generated_element_id
                && error.missing_dependency_id == row.generated_element_id));
        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != json!(row.generated_element_id)));
    }
}
