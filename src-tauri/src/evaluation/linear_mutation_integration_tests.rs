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
        module_materialization: None,
        elements,
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: Some(binding_versions),
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn point(id: &str) -> Value {
    json!({"id":id,"name":id,"type":"freePoint","activity": "visible","x":0,"y":0})
}

fn for_group(id: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "forGroup", "activity": "visible",
        "variableName": "i", "start": 1, "count": 2, "step": 1, "showGenerated": false
    })
}

fn binary_add(left: Value, right: Value) -> Value {
    json!({
        "kind":"binary", "span":{"start":0,"end":1}, "operator":"+", "left":left,
        "right":right, "type":{"kind":"number"}
    })
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
            module_materialization: None,
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

#[test]
fn production_command_runs_for_group_mutation_and_carries_the_final_slot() {
    let loop_id = "loop";
    let template_id = "template";
    let mut loop_set = set(
        "set:sum",
        "binding:sum",
        "decl:sum",
        2,
        binary_add(
            reference("binding:sum"),
            reference("binding:iteration:loop-statement"),
        ),
    );
    loop_set["control"] = json!({
        "scopeId":"for:loop-statement",
        "ownerChain":[{
            "kind":"forGroup", "ownerStatementId":"loop-statement", "scopeId":"for:loop-statement",
            "exitSourceOrder":4
        }],
        "kind":"forGroup"
    });
    loop_set["scopeId"] = json!("for:loop-statement");
    let mut binding_versions = json!({
        "versions":[
            declaration("decl:sum", "binding:sum", 0, number(0.0)),
            loop_set
        ],
        "elementSourceOrders":[
            {"elementId":loop_id,"sourceOrder":1},
            {"elementId":template_id,"sourceOrder":3}
        ],
        "forGroupOwners":[{
            "ownerStatementId":"loop-statement", "elementId":loop_id,
            "scopeId":"for:loop-statement", "exitSourceOrder":4,
            "iterationBindingId":"binding:iteration:loop-statement"
        }]
    });
    let template = json!({
        "id":template_id,"name":template_id,"type":"freePoint","activity": "visible",
        "parentGroupId":loop_id,"x":0,"y":0
    });
    let result = evaluate_document(EvaluationInput {
        module_materialization: None,
        elements: vec![for_group(loop_id), template],
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: Some(binding_versions.take()),
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    })
    .unwrap();
    assert_eq!(
        result.computed_scalar_bindings.unwrap()[0]["evaluation"]["value"]["value"],
        3.0
    );
    let history = result.computed_scalar_binding_versions.unwrap();
    assert_eq!(
        history
            .iter()
            .filter(|entry| entry["versionId"] == "set:sum")
            .count(),
        1
    );
    assert_eq!(result.for_group_generated_rows.len(), 2);
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == "template@loop:0"));
    assert!(!result
        .effective_visible_element_ids
        .iter()
        .any(|id| id == "template@loop:0"));
}

#[test]
fn nested_inner_stop_stops_remaining_inner_and_outer_iterations() {
    let mut outer_set = set("set:outer", "binding:sum", "decl:sum", 2, number(1.0));
    outer_set["control"] = json!({
        "scopeId":"for:outer-statement",
        "ownerChain":[{
            "kind":"forGroup", "ownerStatementId":"outer-statement", "scopeId":"for:outer-statement",
            "exitSourceOrder":7
        }],
        "kind":"forGroup"
    });
    outer_set["scopeId"] = json!("for:outer-statement");
    let mut inner_set = set("set:inner", "binding:sum", "set:outer", 4, number(11.0));
    inner_set["control"] = json!({
        "scopeId":"for:inner-statement",
        "ownerChain":[
            {
                "kind":"forGroup", "ownerStatementId":"outer-statement", "scopeId":"for:outer-statement",
                "exitSourceOrder":7
            },
            {
                "kind":"forGroup", "ownerStatementId":"inner-statement", "scopeId":"for:inner-statement",
                "exitSourceOrder":6
            }
        ],
        "kind":"forGroup"
    });
    inner_set["scopeId"] = json!("for:inner-statement");
    let mut inner = for_group("inner");
    inner["parentGroupId"] = json!("outer");
    let mut point = point("point");
    point["parentGroupId"] = json!("inner");
    let result = evaluate_document(EvaluationInput {
        module_materialization: None,
        elements: vec![for_group("outer"), inner, point],
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: Some(json!({
            "versions":[
                declaration("decl:sum", "binding:sum", 0, number(0.0)),
                outer_set,
                inner_set
            ],
            "elementSourceOrders":[
                {"elementId":"outer","sourceOrder":1},
                {"elementId":"inner","sourceOrder":3},
                {"elementId":"point","sourceOrder":5}
            ],
            "forGroupOwners":[
                {
                    "ownerStatementId":"outer-statement", "elementId":"outer",
                    "scopeId":"for:outer-statement", "exitSourceOrder":7,
                    "iterationBindingId":"binding:iteration:outer-statement"
                },
                {
                    "ownerStatementId":"inner-statement", "elementId":"inner",
                    "scopeId":"for:inner-statement", "exitSourceOrder":6,
                    "iterationBindingId":"binding:iteration:inner-statement"
                }
            ],
            "evaluationLimitSourceOrder":6
        })),
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    })
    .unwrap();

    assert_eq!(
        result.computed_scalar_bindings.unwrap()[0]["evaluation"]["value"]["value"],
        11.0
    );
    assert_eq!(result.for_group_generated_rows.len(), 1);
    assert_eq!(
        result
            .computed_scalar_binding_versions
            .unwrap()
            .iter()
            .map(|entry| entry["versionId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["decl:sum", "set:outer", "set:inner"]
    );
}
