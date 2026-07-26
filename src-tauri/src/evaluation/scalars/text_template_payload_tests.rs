use std::collections::HashMap;

use serde_json::json;

use super::text_template_payload::validate_text_templates_payload;

fn text_type_map() -> HashMap<&'static str, &'static str> {
    HashMap::from([("label-1", "text")])
}

fn literal_segment(cooked: &str) -> serde_json::Value {
    json!({"kind": "literal", "cooked": cooked})
}

fn legacy_hole_segment(raw: &str) -> serde_json::Value {
    json!({"kind": "hole", "holeKind": "legacy", "raw": raw})
}

fn string_literal_expression(value: &str) -> serde_json::Value {
    json!({"kind": "stringLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "string"}})
}

fn number_literal_expression(value: f64) -> serde_json::Value {
    json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "number"}})
}

fn string_hole_segment(expression: serde_json::Value) -> serde_json::Value {
    json!({"kind": "hole", "holeKind": "string", "expression": expression})
}

fn number_hole_segment(expression: serde_json::Value) -> serde_json::Value {
    json!({"kind": "hole", "holeKind": "number", "expression": expression})
}

fn template(element_id: &str, segments: Vec<serde_json::Value>) -> serde_json::Value {
    json!({"elementId": element_id, "segments": segments})
}

#[test]
fn accepts_a_literal_only_template_without_a_scalar_program() {
    let payload = json!([template("label-1", vec![literal_segment("hello")])]);
    let decoded = validate_text_templates_payload(&payload, &text_type_map(), false).unwrap();
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].element_id, "label-1");
}

#[test]
fn accepts_a_legacy_hole_only_template_without_a_scalar_program() {
    let payload = json!([template(
        "label-1",
        vec![
            literal_segment("count: "),
            legacy_hole_segment("line.length")
        ]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_ok());
}

#[test]
fn accepts_a_typed_string_hole_when_a_scalar_program_is_present() {
    let payload = json!([template(
        "label-1",
        vec![string_hole_segment(string_literal_expression("front"))]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), true).is_ok());
}

#[test]
fn accepts_a_typed_number_hole_when_a_scalar_program_is_present() {
    let payload = json!([template(
        "label-1",
        vec![number_hole_segment(number_literal_expression(3.0))]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), true).is_ok());
}

#[test]
fn rejects_a_typed_string_hole_when_no_scalar_program_is_present() {
    let payload = json!([template(
        "label-1",
        vec![string_hole_segment(string_literal_expression("front"))]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_a_typed_number_hole_when_no_scalar_program_is_present() {
    let payload = json!([template(
        "label-1",
        vec![number_hole_segment(number_literal_expression(3.0))]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_a_string_hole_whose_expression_root_type_is_number() {
    let payload = json!([template(
        "label-1",
        vec![string_hole_segment(number_literal_expression(3.0))]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), true).is_err());
}

#[test]
fn rejects_a_number_hole_whose_expression_root_type_is_string() {
    let payload = json!([template(
        "label-1",
        vec![number_hole_segment(string_literal_expression("front"))]
    )]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), true).is_err());
}

#[test]
fn rejects_an_unknown_hole_kind() {
    let segment = json!({"kind": "hole", "holeKind": "boolean", "raw": "true"});
    let payload = json!([template("label-1", vec![segment])]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_an_unknown_segment_kind() {
    let segment = json!({"kind": "mystery"});
    let payload = json!([template("label-1", vec![segment])]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_a_literal_segment_with_an_unexpected_field() {
    let mut segment = literal_segment("hello");
    segment["extra"] = json!(true);
    let payload = json!([template("label-1", vec![segment])]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_a_legacy_hole_segment_with_an_unexpected_field() {
    let mut segment = legacy_hole_segment("line.length");
    segment["extra"] = json!(true);
    let payload = json!([template("label-1", vec![segment])]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_an_element_id_that_does_not_match_any_element() {
    let payload = json!([template("does-not-exist", vec![literal_segment("hello")])]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_an_owner_element_that_is_not_a_text_element() {
    let mut type_map = text_type_map();
    type_map.insert("line-1", "line");
    let payload = json!([template("line-1", vec![literal_segment("hello")])]);
    assert!(validate_text_templates_payload(&payload, &type_map, false).is_err());
}

#[test]
fn rejects_a_duplicate_element_id() {
    let entry = template("label-1", vec![literal_segment("hello")]);
    let payload = json!([entry.clone(), entry]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_an_unexpected_field_on_the_template_entry() {
    let mut entry = template("label-1", vec![literal_segment("hello")]);
    entry["extra"] = json!(true);
    let payload = json!([entry]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_a_non_array_top_level_payload() {
    let payload = json!({"not": "an array"});
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}

#[test]
fn rejects_a_non_array_segments_field() {
    let payload = json!([{"elementId": "label-1", "segments": "not an array"}]);
    assert!(validate_text_templates_payload(&payload, &text_type_map(), false).is_err());
}
