use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::control_boolean_payload::validate_control_boolean_bindings_payload;

fn for_group_type_map() -> HashMap<&'static str, &'static str> {
    HashMap::from([("loop", "forGroup")])
}

fn valid_binding_ids() -> HashSet<&'static str> {
    HashSet::from(["binding:stmt-1"])
}

fn valid_entry() -> serde_json::Value {
    json!({
        "elementId": "loop",
        "parameterKey": "showGenerated",
        "bindingId": "binding:stmt-1",
        "expectedType": {"kind": "boolean"}
    })
}

#[test]
fn accepts_a_valid_show_generated_binding() {
    let payload = json!([valid_entry()]);
    let decoded = validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids(),
    )
    .unwrap();
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].element_id, "loop");
    assert_eq!(decoded[0].parameter_key, "showGenerated");
    assert_eq!(decoded[0].binding_id, "binding:stmt-1");
}

#[test]
fn rejects_an_unsupported_element_type_parameter_key_pair() {
    let mut entry = valid_entry();
    entry["parameterKey"] = json!("count"); // forGroup.count is not a control boolean target
    let payload = json!([entry]);
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_an_unsupported_element_type() {
    let mut type_map = for_group_type_map();
    type_map.insert("cond", "conditionalGroup");
    let mut entry = valid_entry();
    entry["elementId"] = json!("cond");
    let payload = json!([entry]);
    assert!(
        validate_control_boolean_bindings_payload(&payload, &type_map, &valid_binding_ids())
            .is_err()
    );
}

#[test]
fn rejects_an_expected_type_that_does_not_match_the_canonical_type() {
    let mut entry = valid_entry();
    entry["expectedType"] = json!({"kind": "number"});
    let payload = json!([entry]);
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_a_duplicate_element_id_and_parameter_key_pair() {
    let payload = json!([valid_entry(), valid_entry()]);
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_a_binding_id_that_does_not_exist_in_the_scalar_program() {
    let mut entry = valid_entry();
    entry["bindingId"] = json!("binding:does-not-exist");
    let payload = json!([entry]);
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_every_entry_when_there_is_no_scalar_program_at_all_fail_closed_not_literal_fallback() {
    let payload = json!([valid_entry()]);
    let empty_valid_binding_ids: HashSet<&str> = HashSet::new();
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &empty_valid_binding_ids
    )
    .is_err());
}

#[test]
fn rejects_an_element_id_that_does_not_match_any_element() {
    let mut entry = valid_entry();
    entry["elementId"] = json!("does-not-exist");
    let payload = json!([entry]);
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_an_unexpected_field() {
    let mut entry = valid_entry();
    entry["extra"] = json!(true);
    let payload = json!([entry]);
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}

#[test]
fn rejects_a_non_array_payload() {
    let payload = json!({"not": "an array"});
    assert!(validate_control_boolean_bindings_payload(
        &payload,
        &for_group_type_map(),
        &valid_binding_ids()
    )
    .is_err());
}
