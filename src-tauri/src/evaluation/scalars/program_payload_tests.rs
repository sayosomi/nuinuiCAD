use serde_json::json;

use super::program_payload::validate_scalar_program_payload;

fn valid_program() -> serde_json::Value {
    json!({
        "statements": [{
            "kind": "declare",
            "bindingId": "binding:stable-statement",
            "scopeId": "root",
            "sourceOrder": 1,
            "declaration": {
                "bindingKind": "const",
                "declaredType": {"kind": "number"},
                "initializer": {
                    "kind": "numberLiteral",
                    "span": {"start": 18, "end": 19},
                    "value": 1.0,
                    "type": {"kind": "number"}
                }
            }
        }],
        "evaluationLimitSourceOrder": 3
    })
}

#[test]
fn accepts_task_19_program_wire_shape_and_task_17_ast_spans() {
    validate_scalar_program_payload(&valid_program()).unwrap();
}

#[test]
fn rejects_invalid_envelope_and_duplicate_binding_ids() {
    let mut duplicate = valid_program();
    let repeated_statement = duplicate["statements"][0].clone();
    duplicate["statements"]
        .as_array_mut()
        .unwrap()
        .push(repeated_statement);
    assert!(validate_scalar_program_payload(&duplicate).is_err());
    assert!(validate_scalar_program_payload(&json!({"statements": [], "extra": true})).is_err());
}
