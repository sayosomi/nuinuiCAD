use std::collections::HashMap;

use serde_json::{json, Value};

use super::bindings::scalar_evaluation_json;
use super::expression_evaluator::{
    evaluate_typed_expression_with_observer, ScalarEvaluationEnvironment,
};
use super::types::{
    ScalarBinaryOperator, ScalarEvaluation, ScalarUnaryOperator, TypedBuiltinArgument,
    TypedScalarExpression,
};

fn node_identity(node: &TypedScalarExpression) -> usize {
    node as *const TypedScalarExpression as usize
}

fn node_kind(node: &TypedScalarExpression) -> &'static str {
    match node {
        TypedScalarExpression::NumberLiteral { .. } => "numberLiteral",
        TypedScalarExpression::StringLiteral { .. } => "stringLiteral",
        TypedScalarExpression::BooleanLiteral { .. } => "booleanLiteral",
        TypedScalarExpression::ChoiceLiteral { .. } => "choiceLiteral",
        TypedScalarExpression::Reference { .. } => "reference",
        TypedScalarExpression::GeometryProperty { .. } => "geometryProperty",
        TypedScalarExpression::Unary { .. } => "unary",
        TypedScalarExpression::Binary { .. } => "binary",
        TypedScalarExpression::Group { .. } => "group",
        TypedScalarExpression::Call { .. } => "call",
    }
}

fn node_span(node: &TypedScalarExpression) -> (usize, usize) {
    match node {
        TypedScalarExpression::NumberLiteral { span, .. }
        | TypedScalarExpression::StringLiteral { span, .. }
        | TypedScalarExpression::BooleanLiteral { span, .. }
        | TypedScalarExpression::ChoiceLiteral { span, .. }
        | TypedScalarExpression::Reference { span, .. }
        | TypedScalarExpression::GeometryProperty { span, .. }
        | TypedScalarExpression::Unary { span, .. }
        | TypedScalarExpression::Binary { span, .. }
        | TypedScalarExpression::Group { span, .. }
        | TypedScalarExpression::Call { span, .. } => (span.start, span.end),
    }
}

fn unary_operator_wire(operator: ScalarUnaryOperator) -> &'static str {
    match operator {
        ScalarUnaryOperator::Not => "!",
        ScalarUnaryOperator::Negate => "-",
        ScalarUnaryOperator::Plus => "+",
    }
}

fn binary_operator_wire(operator: ScalarBinaryOperator) -> &'static str {
    match operator {
        ScalarBinaryOperator::Or => "||",
        ScalarBinaryOperator::And => "&&",
        ScalarBinaryOperator::Eq => "==",
        ScalarBinaryOperator::NotEq => "!=",
        ScalarBinaryOperator::Lt => "<",
        ScalarBinaryOperator::LtEq => "<=",
        ScalarBinaryOperator::Gt => ">",
        ScalarBinaryOperator::GtEq => ">=",
        ScalarBinaryOperator::Add => "+",
        ScalarBinaryOperator::Sub => "-",
        ScalarBinaryOperator::Mul => "*",
        ScalarBinaryOperator::Div => "/",
        ScalarBinaryOperator::Remainder => "%",
        ScalarBinaryOperator::Pow => "^",
    }
}

fn is_comparison(operator: ScalarBinaryOperator) -> bool {
    matches!(
        operator,
        ScalarBinaryOperator::Eq
            | ScalarBinaryOperator::NotEq
            | ScalarBinaryOperator::Lt
            | ScalarBinaryOperator::LtEq
            | ScalarBinaryOperator::Gt
            | ScalarBinaryOperator::GtEq
    )
}

fn reached_child(
    node_index_by_identity: &HashMap<usize, usize>,
    role: &'static str,
    child: &TypedScalarExpression,
    argument_index: Option<usize>,
) -> Option<Value> {
    let node_index = node_index_by_identity.get(&node_identity(child)).copied()?;
    let mut value = json!({ "role": role, "nodeIndex": node_index });
    if let Some(argument_index) = argument_index {
        value["argumentIndex"] = json!(argument_index);
    }
    Some(value)
}

fn children_for_node(
    node: &TypedScalarExpression,
    node_index_by_identity: &HashMap<usize, usize>,
) -> Vec<Value> {
    match node {
        TypedScalarExpression::Unary { operand, .. } => reached_child(
            node_index_by_identity,
            "operand",
            operand,
            None,
        )
        .into_iter()
        .collect(),
        TypedScalarExpression::Binary { left, right, .. } => [
            reached_child(node_index_by_identity, "left", left, None),
            reached_child(node_index_by_identity, "right", right, None),
        ]
        .into_iter()
        .flatten()
        .collect(),
        TypedScalarExpression::Group { expression, .. } => reached_child(
            node_index_by_identity,
            "expression",
            expression,
            None,
        )
        .into_iter()
        .collect(),
        TypedScalarExpression::Call { args, .. } => args
            .iter()
            .enumerate()
            .filter_map(|(argument_index, argument)| match argument {
                TypedBuiltinArgument::Scalar { expression } => reached_child(
                    node_index_by_identity,
                    "argument",
                    expression,
                    Some(argument_index),
                ),
                TypedBuiltinArgument::GeometryReference { .. } => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn safe_value_json(evaluation: Option<&ScalarEvaluation>) -> Option<Value> {
    let evaluation = evaluation?;
    if !matches!(evaluation, ScalarEvaluation::Ok { .. }) {
        return None;
    }
    scalar_evaluation_json(evaluation).get("value").cloned()
}

fn comparison_operands(
    node: &TypedScalarExpression,
    evaluation_by_identity: &HashMap<usize, ScalarEvaluation>,
) -> Option<Value> {
    let TypedScalarExpression::Binary {
        operator,
        left,
        right,
        ..
    } = node
    else {
        return None;
    };
    if !is_comparison(*operator) {
        return None;
    }
    let left = safe_value_json(evaluation_by_identity.get(&node_identity(left)));
    let right = safe_value_json(evaluation_by_identity.get(&node_identity(right)));
    if left.is_none() && right.is_none() {
        return None;
    }
    let mut operands = json!({});
    if let Some(left) = left {
        operands["left"] = left;
    }
    if let Some(right) = right {
        operands["right"] = right;
    }
    Some(operands)
}

/// Evaluates the production typed-expression path exactly once while recording
/// only nodes that path actually reaches. The output is deliberately flat and
/// JSON-friendly so a deep valid expression cannot reintroduce recursive stack
/// pressure at the inspection boundary.
pub(crate) fn evaluate_condition_expression_with_trace(
    expression: &TypedScalarExpression,
    environment: &impl ScalarEvaluationEnvironment,
) -> (ScalarEvaluation, Value) {
    let mut node_index_by_identity = HashMap::<usize, usize>::new();
    let mut evaluation_by_identity = HashMap::<usize, ScalarEvaluation>::new();
    let mut nodes = Vec::<Value>::new();

    let evaluation = evaluate_typed_expression_with_observer(
        expression,
        environment,
        &mut |node, node_evaluation| {
            let (start, end) = node_span(node);
            let mut trace_node = json!({
                "kind": node_kind(node),
                "span": { "start": start, "end": end },
                "evaluation": scalar_evaluation_json(node_evaluation),
                "children": children_for_node(node, &node_index_by_identity),
            });
            match node {
                TypedScalarExpression::Unary { operator, .. } => {
                    trace_node["operator"] = json!(unary_operator_wire(*operator));
                }
                TypedScalarExpression::Binary { operator, .. } => {
                    trace_node["operator"] = json!(binary_operator_wire(*operator));
                    if let Some(operands) = comparison_operands(node, &evaluation_by_identity) {
                        trace_node["comparisonOperands"] = operands;
                    }
                }
                _ => {}
            }
            let node_index = nodes.len();
            nodes.push(trace_node);
            node_index_by_identity.insert(node_identity(node), node_index);
            evaluation_by_identity.insert(node_identity(node), node_evaluation.clone());
        },
    );

    let root_node_index = node_index_by_identity
        .get(&node_identity(expression))
        .copied()
        .expect("condition trace observer must receive the root expression");
    let trace = json!({
        "rootNodeIndex": root_node_index,
        "finalEvaluation": scalar_evaluation_json(&evaluation),
        "nodes": nodes,
    });
    (evaluation, trace)
}
