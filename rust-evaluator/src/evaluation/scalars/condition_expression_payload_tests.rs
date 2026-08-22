use std::collections::HashMap;

use serde_json::json;

use super::condition_expression_payload::validate_condition_expressions_payload;

fn conditional_group_type_map() -> HashMap<&'static str, &'static str> {
    HashMap::from([("cond", "conditionalGroup"), ("loop", "forGroup")])
}

fn boolean_literal_expression(value: bool) -> serde_json::Value {
    json!({"kind": "booleanLiteral", "span": {"start": 0, "end": 4}, "value": value, "type": {"kind": "boolean"}})
}

fn valid_entry() -> serde_json::Value {
    json!({"elementId": "cond", "expression": boolean_literal_expression(true)})
}

#[test]
fn accepts_a_valid_boolean_condition_expression() {
    let payload = json!([valid_entry()]);
    let decoded =
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).unwrap();
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].element_id, "cond");
}

#[test]
fn rejects_a_non_boolean_root_type() {
    let mut entry = valid_entry();
    entry["expression"] = json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "number"}});
    let payload = json!([entry]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_a_null_root_type() {
    let mut entry = valid_entry();
    entry["expression"] = json!({
        "kind": "reference",
        "span": {"start": 0, "end": 5},
        "nameSpan": {"start": 1, "end": 5},
        "name": "flag",
        "bindingId": null,
        "type": null
    });
    let payload = json!([entry]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_an_element_id_that_does_not_match_any_element() {
    let mut entry = valid_entry();
    entry["elementId"] = json!("does-not-exist");
    let payload = json!([entry]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_an_element_that_is_not_a_conditional_group() {
    let mut entry = valid_entry();
    entry["elementId"] = json!("loop"); // forGroup, not conditionalGroup
    let payload = json!([entry]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_a_duplicate_element_id() {
    let payload = json!([valid_entry(), valid_entry()]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_an_unexpected_field() {
    let mut entry = valid_entry();
    entry["extra"] = json!(true);
    let payload = json!([entry]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_a_malformed_expression_payload() {
    let mut entry = valid_entry();
    entry["expression"] = json!({"kind": "mystery", "span": {"start": 0, "end": 1}});
    let payload = json!([entry]);
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}

#[test]
fn rejects_a_non_array_payload() {
    let payload = json!({"not": "an array"});
    assert!(
        validate_condition_expressions_payload(&payload, &conditional_group_type_map()).is_err()
    );
}
