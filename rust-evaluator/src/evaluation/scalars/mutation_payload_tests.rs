use serde_json::{json, Value};

use super::issue::ScalarPayloadIssueCode;
use super::mutation_payload::validate_binding_versions_payload;

fn elements() -> Vec<Value> {
    vec![json!({ "id": "loop", "type": "forGroup" })]
}

fn payload(module_execution_owner: Option<Value>) -> Value {
    let mut owner = json!({
        "ownerStatementId": "loop-statement",
        "elementId": "loop",
        "scopeId": "scope:loop",
        "exitSourceOrder": 1,
        "iterationBindingId": "binding:iteration:loop-statement"
    });
    if let Some(marker) = module_execution_owner {
        owner["moduleExecutionOwner"] = marker;
    }
    json!({
        "versions": [],
        "elementSourceOrders": [{ "elementId": "loop", "sourceOrder": 0 }],
        "forGroupOwners": [owner]
    })
}

#[test]
fn accepts_a_marked_module_execution_owner_without_scalar_versions_or_carries() {
    let decoded = validate_binding_versions_payload(&payload(Some(json!(true))), &elements())
        .expect("explicit Module execution ownership is a legitimate owner reference");

    assert_eq!(decoded.for_group_owners_by_element_id.len(), 1);
    assert!(decoded.immutable_for_groups.is_empty());
    assert!(decoded.versions.is_empty());
}

#[test]
fn rejects_an_unmarked_unused_for_group_owner() {
    let issue = validate_binding_versions_payload(&payload(None), &elements())
        .expect_err("an unreferenced, unmarked owner remains invalid");

    assert_eq!(issue.code, ScalarPayloadIssueCode::InvalidControlOwner);
    assert_eq!(issue.message, "forGroupOwners contains an unused owner");
}

#[test]
fn rejects_noncanonical_module_execution_owner_markers() {
    for marker in [json!(false), json!("true"), json!(1), Value::Null] {
        let issue = validate_binding_versions_payload(&payload(Some(marker)), &elements())
            .expect_err("a present Module provenance marker must be boolean true");

        assert_eq!(issue.code, ScalarPayloadIssueCode::InvalidControlOwner);
        assert_eq!(
            issue.message,
            "forGroup moduleExecutionOwner must be true when present"
        );
    }
}
