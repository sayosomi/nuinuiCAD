//! Task 32 production-command coverage, including terminal mutation passes.

use super::*;
use serde_json::{json, Value};

fn number(value: f64) -> Value {
    json!({"kind":"numberLiteral","span":{"start":0,"end":1},"value":value,"type":{"kind":"number"}})
}

fn reference(binding_id: &str) -> Value {
    json!({"kind":"reference","span":{"start":0,"end":1},"nameSpan":{"start":0,"end":1},"name":binding_id,"bindingId":binding_id,"type":{"kind":"number"}})
}

fn control() -> Value {
    json!({"scopeId":"root","ownerChain":[],"kind":"linear"})
}

fn declaration(id: &str, binding: &str, order: usize, value: Value) -> Value {
    json!({
        "versionId": id, "statementId": id, "kind":"declare", "bindingId":binding,
        "bindingKind":"let", "declaredType":{"kind":"number"}, "sourceOrder":order,
        "scopeId":"root", "control":control(), "initialState":{"kind":"uncomputed"}, "initializer":value
    })
}

fn set(id: &str, binding: &str, predecessor: &str, order: usize, value: Value) -> Value {
    json!({
        "versionId":id, "statementId":id, "kind":"set", "bindingId":binding, "targetBindingId":binding,
        "bindingKind":"let", "declaredType":{"kind":"number"}, "sourceOrder":order,
        "scopeId":"root", "control":control(), "predecessorId":predecessor,
        "initialState":{"kind":"uncomputed"}, "expression":value
    })
}

fn input(elements: Vec<Value>, versions: Vec<Value>, cutoff: Option<usize>) -> EvaluationInput {
    let element_source_orders = elements
        .iter()
        .enumerate()
        .map(|(index, element)| json!({"elementId": element["id"], "sourceOrder": index + 1}))
        .collect::<Vec<_>>();
    let mut binding_versions = json!({
        "versions": versions,
        "elementSourceOrders": element_source_orders,
    });
    if let Some(cutoff) = cutoff {
        binding_versions["evaluationLimitSourceOrder"] = json!(cutoff);
    }
    EvaluationInput {
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: Some(binding_versions),
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
    }
}

fn point(id: &str) -> Value {
    json!({"id":id,"name":id,"type":"freePoint","visible":true,"enabled":true,"x":0,"y":0})
}

#[test]
fn production_command_finalizes_a_set_after_the_last_element() {
    let result = evaluate_document(input(
        vec![point("p")],
        vec![
            declaration("decl:x", "binding:x", 0, number(1.0)),
            set("set:x", "binding:x", "decl:x", 2, number(2.0)),
        ],
        None,
    ))
    .unwrap();
    assert_eq!(
        result.computed_scalar_bindings.unwrap()[0]["evaluation"]["value"]["value"],
        2.0
    );
    assert_eq!(
        result
            .computed_scalar_binding_versions
            .unwrap()
            .iter()
            .map(|entry| entry["versionId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["decl:x", "set:x"]
    );
}

#[test]
fn production_command_finalizes_a_document_with_no_elements() {
    let result = evaluate_document(input(
        vec![],
        vec![
            declaration("decl:x", "binding:x", 0, number(1.0)),
            set("set:x", "binding:x", "decl:x", 1, number(4.0)),
        ],
        None,
    ))
    .unwrap();
    assert_eq!(
        result.computed_scalar_bindings.unwrap()[0]["evaluation"]["value"]["value"],
        4.0
    );
    assert_eq!(result.computed_scalar_binding_versions.unwrap().len(), 2);
}

#[test]
fn terminal_finalize_never_executes_versions_at_or_after_stop() {
    let result = evaluate_document(input(
        vec![point("p")],
        vec![
            declaration("decl:x", "binding:x", 0, number(1.0)),
            set("set:x", "binding:x", "decl:x", 2, number(9.0)),
        ],
        Some(2),
    ))
    .unwrap();
    assert_eq!(
        result.computed_scalar_bindings.unwrap()[0]["evaluation"]["value"]["value"],
        1.0
    );
    assert_eq!(result.computed_scalar_binding_versions.unwrap().len(), 1);
}

#[test]
fn history_and_final_binding_order_match_the_linear_ts_contract() {
    let result = evaluate_document(input(
        vec![],
        vec![
            declaration("decl:x", "binding:x", 0, number(1.0)),
            declaration("decl:y", "binding:y", 1, number(2.0)),
            set("set:x", "binding:x", "decl:x", 2, reference("binding:y")),
            set("set:y", "binding:y", "decl:y", 3, reference("binding:x")),
        ],
        None,
    ))
    .unwrap();
    assert_eq!(
        result
            .computed_scalar_bindings
            .unwrap()
            .iter()
            .map(|entry| entry["bindingId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["binding:x", "binding:y"]
    );
    assert_eq!(
        result
            .computed_scalar_binding_versions
            .unwrap()
            .iter()
            .map(|entry| entry["versionId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["decl:x", "decl:y", "set:x", "set:y"]
    );
}

#[test]
fn mutation_payload_rejects_inconsistent_ids_types_choices_and_control_owners() {
    let baseline = input(
        vec![],
        vec![
            declaration("decl:x", "binding:x", 0, number(1.0)),
            set("set:x", "binding:x", "decl:x", 1, number(2.0)),
        ],
        None,
    );
    let payload = baseline.binding_versions.unwrap();
    let mut malformed = vec![];
    let mut duplicate = payload.clone();
    duplicate["versions"]
        .as_array_mut()
        .unwrap()
        .push(payload["versions"][0].clone());
    malformed.push(duplicate);
    let mut target = payload.clone();
    target["versions"][1]["targetBindingId"] = json!("binding:other");
    malformed.push(target);
    let mut predecessor = payload.clone();
    predecessor["versions"][1]["predecessorId"] = json!("missing:version");
    malformed.push(predecessor);
    let mut type_mismatch = payload.clone();
    type_mismatch["versions"][0]["declaredType"] = json!({"kind":"boolean"});
    malformed.push(type_mismatch);
    let mut source_order = payload.clone();
    source_order["versions"][1]["sourceOrder"] = json!(0);
    malformed.push(source_order);
    let mut control_owner = payload.clone();
    control_owner["versions"][0]["control"] = json!({"scopeId":"root","ownerChain":[{"kind":"forGroup","ownerStatementId":"loop","scopeId":"loop"}],"kind":"forGroup"});
    malformed.push(control_owner);
    for binding_versions in malformed {
        let error = evaluate_document(EvaluationInput {
            binding_versions: Some(binding_versions),
            ..input(vec![], vec![], None)
        })
        .unwrap_err();
        assert!(error.code.starts_with("scalar-payload-"));
    }

    let choice = json!({
        "versionId":"decl:choice", "statementId":"decl:choice", "kind":"declare", "bindingId":"binding:choice",
        "bindingKind":"let", "declaredType":{"kind":"choice","options":["right","left"]}, "sourceOrder":0,
        "scopeId":"root", "control":control(), "initialState":{"kind":"uncomputed"},
        "initializer":{"kind":"choiceLiteral","span":{"start":0,"end":1},"value":"invalid","type":{"kind":"choice","options":["right","left"]}}
    });
    let error = evaluate_document(input(vec![], vec![choice], None)).unwrap_err();
    assert_eq!(error.code, "scalar-payload-invalid-choice-member");
}
