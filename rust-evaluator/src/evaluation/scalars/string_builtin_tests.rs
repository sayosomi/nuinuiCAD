use serde_json::json;

use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::expression_payload::validate_typed_expression_payload;
use super::types::{
    BuiltinFunctionName, ScalarEvaluation, ScalarSpan, ScalarType, ScalarValue,
    TypedBuiltinArgument, TypedScalarCallTarget, TypedScalarExpression,
};

struct NoBindings;

impl ScalarEvaluationEnvironment for NoBindings {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        panic!("unexpected binding lookup: {binding_id}")
    }
}

struct WrongKindBinding;

impl ScalarEvaluationEnvironment for WrongKindBinding {
    fn lookup_binding(&self, _binding_id: &str) -> ScalarEvaluation {
        ScalarEvaluation::Ok {
            r#type: ScalarType::String,
            value: ScalarValue::String("right".to_owned()),
        }
    }
}

fn span() -> ScalarSpan {
    ScalarSpan { start: 0, end: 0 }
}

#[test]
fn closed_identity_and_payload_accept_string_choice_call() {
    assert_eq!(
        BuiltinFunctionName::from_wire_name("string"),
        Some(BuiltinFunctionName::String)
    );

    let payload = json!({
        "kind": "call",
        "span": { "start": 0, "end": 0 },
        "nameSpan": { "start": 0, "end": 0 },
        "name": "string",
        "target": { "kind": "builtin", "name": "string" },
        "args": [{
            "kind": "scalar",
            "expression": {
                "kind": "choiceLiteral",
                "span": { "start": 0, "end": 0 },
                "value": "right",
                "type": { "kind": "choice", "options": ["right", "left"] }
            }
        }],
        "type": { "kind": "string" }
    });

    let expression = validate_typed_expression_payload(&payload).expect("string choice payload");
    assert_eq!(
        evaluate_typed_expression(&expression, &NoBindings),
        ScalarEvaluation::Ok {
            r#type: ScalarType::String,
            value: ScalarValue::String("right".to_owned()),
        }
    );
}

#[test]
fn payload_rejects_wrong_string_argument_shape() {
    let payload = json!({
        "kind": "call",
        "span": { "start": 0, "end": 0 },
        "nameSpan": { "start": 0, "end": 0 },
        "name": "string",
        "target": { "kind": "builtin", "name": "string" },
        "args": [{
            "kind": "geometryReference",
            "expectedGeometryType": "point",
            "target": null
        }],
        "type": { "kind": "string" }
    });

    assert!(validate_typed_expression_payload(&payload).is_err());
}

#[test]
fn evaluator_fails_closed_when_runtime_reference_kind_mismatches_static_choice() {
    let choice_type = ScalarType::Choice {
        options: vec!["right".to_owned(), "left".to_owned()],
    };
    let expression = TypedScalarExpression::Call {
        span: span(),
        name_span: span(),
        name: "string".to_owned(),
        target: TypedScalarCallTarget::Builtin(BuiltinFunctionName::String),
        args: vec![TypedBuiltinArgument::Scalar {
            expression: TypedScalarExpression::Reference {
                span: span(),
                name_span: span(),
                name: "side".to_owned(),
                binding_id: Some("binding:side".to_owned()),
                r#type: Some(choice_type),
            },
        }],
        r#type: Some(ScalarType::String),
    };

    assert_eq!(
        evaluate_typed_expression(&expression, &WrongKindBinding),
        ScalarEvaluation::Error {
            r#type: ScalarType::String,
            issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
            binding_id: Some("binding:side".to_owned()),
            context: None,
        }
    );
}
