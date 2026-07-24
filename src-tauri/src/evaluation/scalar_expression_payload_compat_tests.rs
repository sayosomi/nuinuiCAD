//! Task 17 compatibility contract: `EvaluationInput.scalar_expression_payload`
//! is optional and its shadow validation (see `evaluate_document` in mod.rs)
//! must never change `EvaluationPayload`. Absence is already
//! exercised by every other test in this module (all pre-existing literals
//! were updated to pass `None`); this file directly proves the two cases
//! those tests don't: a well-formed payload and a malformed one both leave
//! output byte-for-byte identical to the baseline.

use super::*;
use serde_json::json;

fn baseline_elements() -> Vec<Value> {
    vec![json!({
        "id": "a",
        "name": "点A",
        "type": "freePoint",
        "visible": true,
        "enabled": true,
        "x": 10,
        "y": 20
    })]
}

fn evaluate_with(payload: Option<Value>) -> Value {
    let result = evaluate_document(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: baseline_elements(),
        evaluation_limit_index: None,
        scalar_expression_payload: payload,
        scalar_program: None,
    })
    .expect("scalar expression payload is inert");
    serde_json::to_value(&result).expect("EvaluationPayload must serialize")
}

fn evaluate_with_program(program: Option<Value>) -> Result<Value, EvaluationCommandError> {
    let result = evaluate_document(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: baseline_elements(),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: program,
    })?;
    Ok(serde_json::to_value(&result).expect("EvaluationPayload must serialize"))
}

#[test]
fn valid_shadow_payload_does_not_change_evaluation_output() {
    let baseline = evaluate_with(None);
    let valid_payload = json!({
        "kind": "numberLiteral",
        "span": {"start": 0, "end": 1},
        "value": 1.0,
        "type": {"kind": "number"}
    });
    let with_payload = evaluate_with(Some(valid_payload));
    assert_eq!(baseline, with_payload);
}

#[test]
fn malformed_shadow_payload_does_not_change_evaluation_output_or_panic() {
    let baseline = evaluate_with(None);
    let malformed_payload = json!({"kind": "not-a-real-node-kind"});
    let with_payload = evaluate_with(Some(malformed_payload));
    assert_eq!(baseline, with_payload);
}

#[test]
fn scalar_program_returns_bindings_and_rejects_malformed_payloads() {
    let baseline = evaluate_with_program(None).unwrap();
    let valid = json!({
        "statements": [{
            "kind": "declare", "bindingId": "binding:stable", "scopeId": "root", "sourceOrder": 0,
            "declaration": {
                "bindingKind": "const", "declaredType": {"kind": "number"},
                "initializer": {"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "number"}}
            }
        }]
    });
    let valid_result = evaluate_with_program(Some(valid)).unwrap();
    assert_ne!(baseline, valid_result);
    assert_eq!(
        valid_result["computedScalarBindings"][0]["bindingId"],
        "binding:stable"
    );
    let malformed = evaluate_with_program(Some(json!({"statements": "invalid"})))
        .expect_err("malformed scalar program must reject the IPC command");
    assert_eq!(malformed.code, "scalar-payload-invalid-field-type");
    assert_eq!(
        serde_json::to_value(&malformed).unwrap()["code"],
        "scalar-payload-invalid-field-type"
    );

    let duplicate = evaluate_with_program(Some(json!({
        "statements": [
            {"kind": "declare", "bindingId": "binding:duplicate", "scopeId": "root", "sourceOrder": 0,
             "declaration": {"bindingKind": "const", "declaredType": {"kind": "number"},
             "initializer": {"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "number"}}}},
            {"kind": "declare", "bindingId": "binding:duplicate", "scopeId": "root", "sourceOrder": 1,
             "declaration": {"bindingKind": "const", "declaredType": {"kind": "number"},
             "initializer": {"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 2.0, "type": {"kind": "number"}}}}
        ]
    })))
    .expect_err("duplicate binding IDs must reject the IPC command");
    assert_eq!(duplicate.code, "scalar-payload-invalid-binding-id");
}
