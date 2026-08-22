use super::condition_evaluation_trace::evaluate_condition_expression_with_trace;
use super::expression_evaluator::ScalarEvaluationEnvironment;
use super::types::{
    ScalarBinaryOperator, ScalarEvaluation, ScalarSpan, ScalarType, ScalarValue,
    TypedScalarExpression,
};

fn span(start: usize) -> ScalarSpan {
    ScalarSpan {
        start,
        end: start + 1,
    }
}

fn bool_literal(value: bool, start: usize) -> TypedScalarExpression {
    TypedScalarExpression::BooleanLiteral {
        span: span(start),
        value,
        r#type: ScalarType::Boolean,
    }
}

fn number_literal(value: f64, start: usize) -> TypedScalarExpression {
    TypedScalarExpression::NumberLiteral {
        span: span(start),
        value,
        r#type: ScalarType::Number,
    }
}

fn reference(
    name: &str,
    binding_id: &str,
    r#type: ScalarType,
    start: usize,
) -> TypedScalarExpression {
    TypedScalarExpression::Reference {
        span: span(start),
        name_span: span(start),
        name: name.to_owned(),
        binding_id: Some(binding_id.to_owned()),
        r#type: Some(r#type),
    }
}

fn binary(
    operator: ScalarBinaryOperator,
    left: TypedScalarExpression,
    right: TypedScalarExpression,
    start: usize,
) -> TypedScalarExpression {
    TypedScalarExpression::Binary {
        span: ScalarSpan {
            start,
            end: start + 3,
        },
        operator,
        left: Box::new(left),
        right: Box::new(right),
        r#type: Some(ScalarType::Boolean),
    }
}

struct PanicLookup;

impl ScalarEvaluationEnvironment for PanicLookup {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        panic!("short-circuited binding must not be reached: {binding_id}")
    }
}

#[test]
fn trace_omits_short_circuited_and_right_side() {
    let expression = binary(
        ScalarBinaryOperator::And,
        bool_literal(false, 0),
        reference("unused", "binding:unused", ScalarType::Boolean, 4),
        0,
    );

    let (evaluation, trace) = evaluate_condition_expression_with_trace(&expression, &PanicLookup);

    assert_eq!(
        evaluation,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: ScalarValue::Boolean(false),
        }
    );
    let nodes = trace["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0]["kind"], "booleanLiteral");
    assert_eq!(nodes[1]["kind"], "binary");
    assert_eq!(nodes[1]["operator"], "&&");
    let children = nodes[1]["children"].as_array().unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0]["role"], "left");
    assert!(nodes.iter().all(|node| node["kind"] != "reference"));
}

#[test]
fn trace_captures_safe_comparison_operand_values() {
    let expression = binary(
        ScalarBinaryOperator::Gt,
        number_literal(42.0, 0),
        number_literal(45.0, 5),
        0,
    );

    let (_, trace) = evaluate_condition_expression_with_trace(&expression, &PanicLookup);
    let root_index = trace["rootNodeIndex"].as_u64().unwrap() as usize;
    let root = &trace["nodes"][root_index];
    assert_eq!(root["comparisonOperands"]["left"]["value"], 42.0);
    assert_eq!(root["comparisonOperands"]["right"]["value"], 45.0);
    assert_eq!(trace["finalEvaluation"]["value"]["value"], false);
}

struct PoisonLookup;

impl ScalarEvaluationEnvironment for PoisonLookup {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "poisoned-binding".to_owned(),
            binding_id: Some(binding_id.to_owned()),
            context: None,
        }
    }
}

#[test]
fn trace_keeps_error_without_fabricating_failed_operand_value() {
    let expression = binary(
        ScalarBinaryOperator::Gt,
        number_literal(42.0, 0),
        reference("bad", "binding:bad", ScalarType::Number, 5),
        0,
    );

    let (evaluation, trace) = evaluate_condition_expression_with_trace(&expression, &PoisonLookup);
    assert!(matches!(evaluation, ScalarEvaluation::Error { .. }));
    let root_index = trace["rootNodeIndex"].as_u64().unwrap() as usize;
    let root = &trace["nodes"][root_index];
    assert_eq!(root["comparisonOperands"]["left"]["value"], 42.0);
    assert!(root["comparisonOperands"].get("right").is_none());
    assert_eq!(trace["finalEvaluation"]["status"], "error");
    assert!(trace["finalEvaluation"].get("value").is_none());
}
