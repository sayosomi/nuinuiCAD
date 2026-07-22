use serde_json::json;

use super::issue::ScalarPayloadIssueCode as Code;
use super::scalar_payload::{decode_scalar_evaluation, decode_scalar_type, decode_scalar_value};
use super::types::{ScalarEvaluation, ScalarType, ScalarValue};

#[test]
fn decodes_each_scalar_type_kind() {
    assert_eq!(
        decode_scalar_type(&json!({"kind": "number"})).unwrap(),
        ScalarType::Number
    );
    assert_eq!(
        decode_scalar_type(&json!({"kind": "string"})).unwrap(),
        ScalarType::String
    );
    assert_eq!(
        decode_scalar_type(&json!({"kind": "boolean"})).unwrap(),
        ScalarType::Boolean
    );
    assert_eq!(
        decode_scalar_type(&json!({"kind": "choice", "options": ["right", "left"]})).unwrap(),
        ScalarType::Choice {
            options: vec!["right".to_owned(), "left".to_owned()]
        }
    );
}

#[test]
fn rejects_unknown_scalar_type_kind() {
    let error = decode_scalar_type(&json!({"kind": "mystery"})).unwrap_err();
    assert_eq!(error.code, Code::UnknownKind);
}

#[test]
fn rejects_scalar_type_with_unexpected_field() {
    let error = decode_scalar_type(&json!({"kind": "number", "options": []})).unwrap_err();
    assert_eq!(error.code, Code::UnexpectedField);
}

#[test]
fn rejects_choice_type_with_empty_string_option() {
    let error =
        decode_scalar_type(&json!({"kind": "choice", "options": ["right", ""]})).unwrap_err();
    assert_eq!(error.code, Code::InvalidChoiceOptions);
}

#[test]
fn rejects_choice_type_options_beyond_the_limit() {
    let options: Vec<String> = (0..300).map(|index| format!("option-{index}")).collect();
    let error = decode_scalar_type(&json!({"kind": "choice", "options": options})).unwrap_err();
    assert_eq!(error.code, Code::ChoiceOptionsLimitExceeded);
}

#[test]
fn decodes_each_scalar_value_kind() {
    assert_eq!(
        decode_scalar_value(&json!({"kind": "number", "value": 12.5})).unwrap(),
        ScalarValue::Number(12.5)
    );
    assert_eq!(
        decode_scalar_value(&json!({"kind": "string", "value": "前身頃"})).unwrap(),
        ScalarValue::String("前身頃".to_owned())
    );
    assert_eq!(
        decode_scalar_value(&json!({"kind": "boolean", "value": true})).unwrap(),
        ScalarValue::Boolean(true)
    );
    assert_eq!(
        decode_scalar_value(
            &json!({"kind": "choice", "value": "right", "options": ["right", "left"]})
        )
        .unwrap(),
        ScalarValue::Choice {
            value: "right".to_owned(),
            options: vec!["right".to_owned(), "left".to_owned()]
        }
    );
}

#[test]
fn rejects_non_finite_number_value() {
    let error = decode_scalar_value(&json!({"kind": "number", "value": null})).unwrap_err();
    assert_eq!(error.code, Code::InvalidFieldType);
}

#[test]
fn rejects_choice_value_not_a_member_of_its_options() {
    let error = decode_scalar_value(
        &json!({"kind": "choice", "value": "up", "options": ["right", "left"]}),
    )
    .unwrap_err();
    assert_eq!(error.code, Code::InvalidChoiceMember);
}

#[test]
fn decodes_ok_scalar_evaluation() {
    let evaluation = decode_scalar_evaluation(&json!({
        "status": "ok",
        "type": {"kind": "number"},
        "value": {"kind": "number", "value": 20}
    }))
    .unwrap();
    assert_eq!(
        evaluation,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(20.0)
        }
    );
}

#[test]
fn rejects_ok_scalar_evaluation_whose_value_does_not_match_its_type() {
    let error = decode_scalar_evaluation(&json!({
        "status": "ok",
        "type": {"kind": "number"},
        "value": {"kind": "string", "value": "not a number"}
    }))
    .unwrap_err();
    assert_eq!(error.code, Code::InvalidEvaluationValue);
}

#[test]
fn decodes_error_scalar_evaluation_with_an_open_issue_code_string() {
    // scalarJson.ts treats issueCode as an open string - "poisoned-binding" is
    // a value the shared fixture uses that no TS module defines centrally.
    let evaluation = decode_scalar_evaluation(&json!({
        "status": "error",
        "type": {"kind": "boolean"},
        "issueCode": "poisoned-binding"
    }))
    .unwrap();
    assert_eq!(
        evaluation,
        ScalarEvaluation::Error {
            r#type: ScalarType::Boolean,
            issue_code: "poisoned-binding".to_owned(),
            binding_id: None
        }
    );
}

#[test]
fn decodes_error_scalar_evaluation_with_a_binding_id() {
    let evaluation = decode_scalar_evaluation(&json!({
        "status": "error",
        "type": {"kind": "number"},
        "issueCode": "evaluation-runtime-value-type-mismatch",
        "bindingId": "binding:mismatched"
    }))
    .unwrap();
    assert_eq!(
        evaluation,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
            binding_id: Some("binding:mismatched".to_owned())
        }
    );
}

#[test]
fn rejects_error_scalar_evaluation_with_empty_issue_code() {
    let error = decode_scalar_evaluation(&json!({
        "status": "error",
        "type": {"kind": "number"},
        "issueCode": ""
    }))
    .unwrap_err();
    assert_eq!(error.code, Code::InvalidIssueCode);
}

#[test]
fn rejects_error_scalar_evaluation_with_null_binding_id() {
    // Mirrors scalarJson.ts exactly: an explicit null is not the same as an
    // absent key and must be rejected, not treated as "no bindingId".
    let error = decode_scalar_evaluation(&json!({
        "status": "error",
        "type": {"kind": "number"},
        "issueCode": "some-issue",
        "bindingId": null
    }))
    .unwrap_err();
    assert_eq!(error.code, Code::InvalidBindingId);
}

#[test]
fn rejects_unknown_scalar_evaluation_status() {
    let error = decode_scalar_evaluation(&json!({
        "status": "pending",
        "type": {"kind": "number"}
    }))
    .unwrap_err();
    assert_eq!(error.code, Code::InvalidEvaluationStatus);
}
