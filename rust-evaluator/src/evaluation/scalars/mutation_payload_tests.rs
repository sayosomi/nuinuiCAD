use serde_json::{json, Value};

use super::issue::ScalarPayloadIssueCode;
use super::mutation_payload::{validate_binding_versions_payload, ValidatedBindingCatalogOrder};

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

fn binding_version_payload(initializer: Value) -> Value {
    json!({
        "versions": [{
            "versionId": "version:result",
            "statementId": "version:result",
            "kind": "declare",
            "bindingId": "binding:result",
            "bindingKind": "const",
            "declaredType": {"kind": "number"},
            "sourceOrder": 0,
            "scopeId": "scope:root",
            "control": {
                "scopeId": "scope:root",
                "ownerChain": [],
                "kind": "linear"
            },
            "initialState": {"kind": "uncomputed"},
            "initializer": initializer
        }],
        "elementSourceOrders": []
    })
}

fn number_literal() -> Value {
    json!({
        "kind": "numberLiteral",
        "span": {"start": 0, "end": 1},
        "value": 1.0,
        "type": {"kind": "number"}
    })
}

fn reference(binding_id: &str) -> Value {
    json!({
        "kind": "reference",
        "span": {"start": 0, "end": 1},
        "nameSpan": {"start": 0, "end": 1},
        "name": "value",
        "bindingId": binding_id,
        "type": {"kind": "number"}
    })
}

fn optional_number_none() -> Value {
    json!({
        "kind": "noneLiteral",
        "span": {"start": 0, "end": 4},
        "type": {"kind": "optional", "valueType": {"kind": "number"}}
    })
}

fn match_arm(label: &str, binder: Option<(&str, &str)>, expression: Value) -> Value {
    let mut arm = json!({
        "label": label,
        "labelSpan": {"start": 0, "end": 1},
        "expression": expression
    });
    if let Some((binder, binder_id)) = binder {
        arm["binder"] = json!(binder);
        arm["binderSpan"] = json!({"start": 0, "end": 1});
        arm["binderId"] = json!(binder_id);
        arm["binderType"] = json!({"kind": "number"});
    }
    arm
}

fn value_match(arms: Vec<Value>) -> Value {
    json!({
        "kind": "valueMatch",
        "span": {"start": 0, "end": 10},
        "scrutinee": optional_number_none(),
        "arms": arms,
        "type": {"kind": "number"}
    })
}

fn value_if(then_branch: Value, else_branch: Value) -> Value {
    json!({
        "kind": "valueIf",
        "span": {"start": 0, "end": 10},
        "condition": {
            "kind": "booleanLiteral",
            "span": {"start": 0, "end": 4},
            "value": true,
            "type": {"kind": "boolean"}
        },
        "thenBranch": then_branch,
        "elseBranch": else_branch,
        "type": {"kind": "number"}
    })
}

fn validate_initializer(initializer: Value) -> Result<(), super::issue::ScalarPayloadIssue> {
    validate_binding_versions_payload(&binding_version_payload(initializer), &[]).map(|_| ())
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

#[test]
fn accepts_a_value_match_binder_reference_inside_its_arm_without_registering_it_globally() {
    let binder_id = "optional-match-binder:arbitrary-name";
    let initializer = value_match(vec![
        match_arm("some", Some(("renamed", binder_id)), reference(binder_id)),
        match_arm("none", None, number_literal()),
    ]);

    let decoded = validate_binding_versions_payload(&binding_version_payload(initializer), &[])
        .expect("the some-arm binder is a lexical reference in its own arm");

    assert!(!decoded.binding_ids.contains(binder_id));
}

#[test]
fn rejects_unknown_nonlocal_references_in_binding_version_initializers() {
    let issue = validate_initializer(reference("binding:missing"))
        .expect_err("unknown ordinary references remain fail-closed");

    assert_eq!(issue.code, ScalarPayloadIssueCode::InvalidBindingId);
    assert_eq!(issue.message, "unknown binding reference binding:missing");
}

#[test]
fn decodes_optional_binding_catalog_order_and_rejects_unknown_values() {
    let mut source_payload = binding_version_payload(number_literal());
    source_payload["versions"][0]["catalogOrder"] = json!("source");
    let source = validate_binding_versions_payload(&source_payload, &[])
        .expect("source catalog ownership is accepted");
    assert_eq!(
        source.versions[0].catalog_order,
        Some(ValidatedBindingCatalogOrder::Source)
    );

    let mut append_payload = binding_version_payload(number_literal());
    append_payload["versions"][0]["catalogOrder"] = json!("append");
    let append = validate_binding_versions_payload(&append_payload, &[])
        .expect("append catalog ownership is accepted");
    assert_eq!(
        append.versions[0].catalog_order,
        Some(ValidatedBindingCatalogOrder::Append)
    );

    let missing =
        validate_binding_versions_payload(&binding_version_payload(number_literal()), &[])
            .expect("missing catalogOrder retains the source-declaration default");
    assert_eq!(missing.versions[0].catalog_order, None);

    let mut unknown_payload = binding_version_payload(number_literal());
    unknown_payload["versions"][0]["catalogOrder"] = json!("runtime");
    let issue = validate_binding_versions_payload(&unknown_payload, &[])
        .expect_err("unknown catalog ownership values fail payload validation");
    assert_eq!(issue.code, ScalarPayloadIssueCode::UnknownKind);
}

#[test]
fn value_match_binders_do_not_leak_outside_their_arm_or_into_sibling_arms() {
    let binder_id = "optional-match-binder:local";
    let local_match = value_match(vec![
        match_arm("some", Some(("item", binder_id)), number_literal()),
        match_arm("none", None, reference(binder_id)),
    ]);
    let sibling_issue = validate_initializer(local_match)
        .expect_err("a binder must not be visible in a sibling arm");
    assert_eq!(sibling_issue.code, ScalarPayloadIssueCode::InvalidBindingId);

    let outside_issue = validate_initializer(value_if(
        value_match(vec![
            match_arm("some", Some(("item", binder_id)), number_literal()),
            match_arm("none", None, number_literal()),
        ]),
        reference(binder_id),
    ))
    .expect_err("a binder must not be visible after leaving its match arm");
    assert_eq!(outside_issue.code, ScalarPayloadIssueCode::InvalidBindingId);
}

#[test]
fn nested_value_match_binders_compose_lexically() {
    let outer_binder = "optional-match-binder:outer";
    let inner_binder = "optional-match-binder:inner";
    let nested_match = value_match(vec![
        match_arm(
            "some",
            Some(("inner", inner_binder)),
            value_if(reference(outer_binder), reference(inner_binder)),
        ),
        match_arm("none", None, reference(outer_binder)),
    ]);
    let initializer = value_match(vec![
        match_arm("some", Some(("outer", outer_binder)), nested_match),
        match_arm("none", None, number_literal()),
    ]);

    validate_initializer(initializer)
        .expect("outer binders remain visible inside nested matches and inner binders are local");
}

#[test]
fn nested_value_match_binder_does_not_leak_to_a_sibling_arm() {
    let outer_binder = "optional-match-binder:outer";
    let inner_binder = "optional-match-binder:inner";
    let nested_match = value_match(vec![
        match_arm("some", Some(("inner", inner_binder)), number_literal()),
        match_arm("none", None, reference(inner_binder)),
    ]);
    let initializer = value_match(vec![
        match_arm("some", Some(("outer", outer_binder)), nested_match),
        match_arm("none", None, number_literal()),
    ]);

    let issue = validate_initializer(initializer)
        .expect_err("an inner binder must leave scope before its sibling arm");

    assert_eq!(issue.code, ScalarPayloadIssueCode::InvalidBindingId);
}
