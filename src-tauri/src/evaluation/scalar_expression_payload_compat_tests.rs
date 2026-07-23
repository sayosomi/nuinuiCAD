//! Task 17 compatibility contract: `EvaluationInput.scalar_expression_payload`
//! is optional and its shadow validation (see `evaluate_document_input` in
//! mod.rs) must never change `EvaluationPayload`. Absence is already
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
    let result = evaluate_document_input(EvaluationInput {
        elements: baseline_elements(),
        evaluation_limit_index: None,
        scalar_expression_payload: payload,
        scalar_program: None,
    });
    serde_json::to_value(&result).expect("EvaluationPayload must serialize")
}

fn evaluate_with_program(program: Option<Value>) -> Value {
    let result = evaluate_document_input(EvaluationInput {
        elements: baseline_elements(),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: program,
    });
    serde_json::to_value(&result).expect("EvaluationPayload must serialize")
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
fn scalar_program_validation_is_inert_for_valid_and_malformed_payloads() {
    let baseline = evaluate_with_program(None);
    let valid = json!({
        "statements": [{
            "kind": "declare", "bindingId": "binding:stable", "scopeId": "root", "sourceOrder": 0,
            "declaration": {
                "bindingKind": "const", "declaredType": {"kind": "number"},
                "initializer": {"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "number"}}
            }
        }]
    });
    assert_eq!(baseline, evaluate_with_program(Some(valid)));
    assert_eq!(
        baseline,
        evaluate_with_program(Some(json!({"statements": "invalid"})))
    );
}
