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

fn optional_collection_presence_projection() -> serde_json::Value {
    json!({
        "kind": "optionalMember",
        "span": {"start": 0, "end": 6},
        "receiverSpan": {"start": 0, "end": 6},
        "operatorSpan": {"start": 6, "end": 6},
        "memberSpan": {"start": 6, "end": 6},
        "member": "length",
        "target": {
            "kind": "collectionLength",
            "collectionValueId": "collection:items",
            "collectionLength": 0.0,
            "targetSourceOrder": 1.0
        },
        "type": {"kind": "optional", "valueType": {"kind": "number"}}
    })
}

fn optional_collection_match_program() -> serde_json::Value {
    let mut program = optional_match_program();
    program["collectionValues"][0]["scrutinee"] = optional_collection_presence_projection();
    let some_arm = &mut program["collectionValues"][0]["arms"][1];
    some_arm.as_object_mut().unwrap().remove("binderId");
    some_arm.as_object_mut().unwrap().remove("binderType");
    some_arm["collectionBinderId"] = json!("optional-match-binder:1:2:3");
    program
}

fn replace_with_reference_type(program: &mut serde_json::Value, r#type: serde_json::Value) {
    program["collectionValues"][0]["scrutinee"] = json!({
        "kind": "reference",
        "span": {"start": 0, "end": 6},
        "nameSpan": {"start": 1, "end": 6},
        "name": "Maybe",
        "bindingId": "binding:stable-statement",
        "type": r#type
    });
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
fn validates_optional_collection_match_collection_binder_identity() {
    let program = optional_collection_match_program();
    let program = validate_scalar_program_payload(&program).unwrap();
    let ValidatedScalarProgramCollectionValue::Match { arms, .. } =
        &program.collection_values[0].value
    else {
        panic!("expected a collection match value");
    };
    assert_eq!(arms[1].binder_id, None);
    assert_eq!(arms[1].binder_type, None);
    assert_eq!(
        arms[1].collection_binder_id.as_deref(),
        Some("optional-match-binder:1:2:3")
    );
}

#[test]
fn rejects_collection_binder_ids_outside_optional_collection_presence_matches() {
    let mut choice_scrutinee = optional_collection_match_program();
    replace_with_reference_type(
        &mut choice_scrutinee,
        json!({"kind": "choice", "options": ["ready", "done"]}),
    );

    let mut optional_scalar_scrutinee = optional_collection_match_program();
    replace_with_reference_type(
        &mut optional_scalar_scrutinee,
        json!({"kind": "optional", "valueType": {"kind": "boolean"}}),
    );

    let mut non_optional_scrutinee = optional_collection_match_program();
    non_optional_scrutinee["collectionValues"][0]["scrutinee"] = json!({
        "kind": "numberLiteral",
        "span": {"start": 0, "end": 1},
        "value": 1.0,
        "type": {"kind": "number"}
    });

    let mut non_some_arm = optional_collection_match_program();
    non_some_arm["collectionValues"][0]["arms"][0]["collectionBinderId"] =
        json!("optional-match-binder:1:2:3");

    let mut scalar_metadata = optional_collection_match_program();
    let some_arm = &mut scalar_metadata["collectionValues"][0]["arms"][1];
    some_arm["binderId"] = json!("optional-match-binder:1:2:3");
    some_arm["binderType"] = json!({"kind": "number"});

    for (name, program) in [
        ("choice scrutinee", choice_scrutinee),
        (
            "unrelated optional scalar scrutinee",
            optional_scalar_scrutinee,
        ),
        ("non-optional scrutinee", non_optional_scrutinee),
        ("non-some arm", non_some_arm),
        ("scalar binder metadata", scalar_metadata),
    ] {
        assert!(
            validate_scalar_program_payload(&program).is_err(),
            "accepted collectionBinderId with {name}"
        );
    }
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

    let mut missing_both = optional_match_program();
    missing_both["collectionValues"][0]["arms"][1]
        .as_object_mut()
        .unwrap()
        .remove("binderId");
    missing_both["collectionValues"][0]["arms"][1]
        .as_object_mut()
        .unwrap()
        .remove("binderType");
    assert!(validate_scalar_program_payload(&missing_both).is_err());
}
