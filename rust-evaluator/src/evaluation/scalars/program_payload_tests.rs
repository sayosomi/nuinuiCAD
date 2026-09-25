use serde_json::json;

use super::program_payload::{
    validate_scalar_program_payload, ValidatedScalarProgramCollectionValue,
};

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
        }]
    })
}

fn optional_match_program() -> serde_json::Value {
    let mut program = valid_program();
    program["collectionValues"] = json!([{
        "valueId": "match:note",
        "kind": "match",
        "scrutinee": {
            "kind": "reference",
            "span": {"start": 0, "end": 6},
            "nameSpan": {"start": 1, "end": 6},
            "name": "Maybe",
            "bindingId": "binding:stable-statement",
            "type": {"kind": "optional", "valueType": {"kind": "number"}}
        },
        "arms": [
            {"label": "none", "valueId": "match:note:none"},
            {
                "label": "some",
                "valueId": "match:note:some",
                "binderId": "optional-match-binder:1:2:3",
                "binderType": {"kind": "number"}
            }
        ],
        "sourceOrder": 1.0
    }]);
    program
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

#[test]
fn validates_and_retains_optional_collection_match_binder_metadata() {
    let program = validate_scalar_program_payload(&optional_match_program()).unwrap();
    let ValidatedScalarProgramCollectionValue::Match { arms, .. } =
        &program.collection_values[0].value
    else {
        panic!("expected a collection match value");
    };
    assert_eq!(arms[1].label, "some");
    assert_eq!(
        arms[1].binder_id.as_deref(),
        Some("optional-match-binder:1:2:3")
    );
    assert_eq!(arms[1].binder_type, Some(super::types::ScalarType::Number));
}

#[test]
fn rejects_incomplete_or_type_mismatched_optional_match_binder_metadata() {
    let mut missing_type = optional_match_program();
    missing_type["collectionValues"][0]["arms"][1]
        .as_object_mut()
        .unwrap()
        .remove("binderType");
    assert!(validate_scalar_program_payload(&missing_type).is_err());

    let mut wrong_type = optional_match_program();
    wrong_type["collectionValues"][0]["arms"][1]["binderType"] = json!({"kind": "string"});
    assert!(validate_scalar_program_payload(&wrong_type).is_err());
}
