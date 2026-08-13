use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::text_property_binding_payload::validate_text_property_bindings_payload;

fn text_type_map() -> HashMap<&'static str, &'static str> {
    HashMap::from([("label-1", "text")])
}

fn valid_binding_ids() -> HashSet<&'static str> {
    HashSet::from(["binding:stmt-1"])
}

fn valid_entry() -> serde_json::Value {
    json!({
        "elementId": "label-1",
        "parameterKey": "text",
        "bindingId": "binding:stmt-1",
        "expectedType": {"kind": "string"}
    })
}

fn string_expression() -> serde_json::Value {
    json!({
        "kind": "group",
        "span": {"start": 0, "end": 8},
        "expression": {
            "kind": "reference",
            "span": {"start": 1, "end": 8},
            "nameSpan": {"start": 2, "end": 8},
            "name": "label",
            "bindingId": "binding:stmt-1",
            "type": {"kind": "string"}
        },
        "type": {"kind": "string"}
    })
}

#[test]
fn accepts_a_compound_typed_expression_source() {
    let mut entry = valid_entry();
    entry.as_object_mut().unwrap().remove("bindingId");
    entry["expression"] = string_expression();
    let decoded = validate_text_property_bindings_payload(
        &json!([entry]),
        &text_type_map(),
        &valid_binding_ids(),
    )
    .unwrap();
    assert!(decoded[0].binding_id.is_none());
    assert!(decoded[0].expression.is_some());
}

#[test]
fn accepts_a_valid_text_binding() {
    let payload = json!([valid_entry()]);
    let decoded =
        validate_text_property_bindings_payload(&payload, &text_type_map(), &valid_binding_ids())
            .unwrap();
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].element_id, "label-1");
    assert_eq!(decoded[0].parameter_key, "text");
    assert_eq!(decoded[0].binding_id.as_deref(), Some("binding:stmt-1"));
}

#[test]
fn accepts_a_schema_driven_parameter_key_without_a_property_allowlist() {
    let mut entry = valid_entry();
    entry["parameterKey"] = json!("fontSize"); // text.fontSize is not a text property binding target
    let payload = json!([entry]);
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_ok());
}

#[test]
fn accepts_an_element_type_when_the_compiled_contract_supplies_the_type() {
    let mut type_map = text_type_map();
    type_map.insert("line-1", "line");
    let mut entry = valid_entry();
    entry["elementId"] = json!("line-1");
    let payload = json!([entry]);
    assert!(
        validate_text_property_bindings_payload(&payload, &type_map, &valid_binding_ids()).is_ok()
    );
}

#[test]
fn accepts_the_compiled_expected_type_without_a_rust_schema_duplicate() {
    let mut entry = valid_entry();
    entry["expectedType"] = json!({"kind": "number"});
    let payload = json!([entry]);
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_ok());
}

#[test]
fn rejects_a_duplicate_element_id_and_parameter_key_pair() {
    let payload = json!([valid_entry(), valid_entry()]);
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_a_binding_id_that_does_not_exist_in_the_scalar_program() {
    let mut entry = valid_entry();
    entry["bindingId"] = json!("binding:does-not-exist");
    let payload = json!([entry]);
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_every_entry_when_there_is_no_scalar_program_at_all_fail_closed_not_literal_fallback() {
    let payload = json!([valid_entry()]);
    let empty_valid_binding_ids: HashSet<&str> = HashSet::new();
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &empty_valid_binding_ids
    )
    .is_err());
}

#[test]
fn rejects_an_element_id_that_does_not_match_any_element() {
    let mut entry = valid_entry();
    entry["elementId"] = json!("does-not-exist");
    let payload = json!([entry]);
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_an_unexpected_field() {
    let mut entry = valid_entry();
    entry["extra"] = json!(true);
    let payload = json!([entry]);
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_a_non_array_payload() {
    let payload = json!({"not": "an array"});
    assert!(validate_text_property_bindings_payload(
        &payload,
        &text_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}
