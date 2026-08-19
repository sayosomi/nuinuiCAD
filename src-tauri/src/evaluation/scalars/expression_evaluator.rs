//! Rust counterpart to TypeScript's pure reference evaluator
//! (`src/scalars/expressionEvaluator.ts`). Consumes only validated
//! `TypedScalarExpression` enum and a caller-injected
//! [`ScalarEvaluationEnvironment`] - it never touches `serde_json::Value`,
//! never parses, tokenizes, resolves names, or typechecks. References
//! resolve solely by the stable `bindingId` already attached to each
//! reference node; scope, shadowing, declaration order, and binding
//! eligibility are established before evaluation and are never reinterpreted
//! here. Document declaration order, `set` versions, control flow, property
//! wiring, and production wiring are owned by the surrounding runtime layers.
//!
//! **Traversal is iterative, not recursive**, for the same reason
//! `expression_payload.rs`'s decoder is: the parser places no depth
//! limit on a flat `binary` chain (same-precedence-tier operators, including
//! `&&`/`||`, parse via a loop into a left-nested tree; only unary/group
//! nesting is depth-capped at 128), so a chain within the
//! `MAX_TYPED_EXPRESSION_NODE_COUNT` (20,000) node budget is a legitimate
//! payload a naive recursive `fn eval(node) { ... eval(node.left) ... }`
//! would stack-overflow on. Unlike decoding - a uniform post-order walk that
//! always visits every child - evaluation must short-circuit `&&`/`||` based
//! on a *runtime* value only known after the left operand is evaluated, so
//! the explicit work stack below has a continuation variant
//! (`ContinueLogical`) that decode's `WorkItem` doesn't need.
//!
//! Per-operator combination logic (once child values are already resolved)
//! lives in `expression_evaluator_ops.rs`, mirroring how
//! `expression_shape_payload.rs` is split out of `expression_payload.rs` on
//! the decode side.

use super::expression_evaluator_ops::{
    continue_builtin_call, continue_logical, evaluate_geometry_builtin_call, evaluate_reference,
    finish_eager_binary, finish_logical_right, finish_unary, static_type_null_error,
};
use super::geometry_builtin_runtime::{GeometryBuiltinRuntimeError, GeometryBuiltinRuntimeTarget};
use super::types::{
    ScalarBinaryOperator, ScalarEvaluation, ScalarExpressionResolvedGeometryTarget, ScalarType,
    ScalarUnaryOperator, ScalarValue, TypedBuiltinArgument, TypedScalarCallTarget,
    TypedScalarExpression,
};

/// Resolves a runtime value for an already-resolved binding ID. Mirrors TS's
/// `ScalarEvaluationEnvironment.lookupBinding` - called at most once per
/// reference node actually reached during evaluation, never for a
/// bindingId inside a short-circuited &&/|| branch. Geometry-property reads
/// use the same environment so callers can provide already-resolved,
/// already-computed geometry without re-parsing or re-resolving source.
pub(crate) trait ScalarEvaluationEnvironment {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation;
    fn lookup_geometry_property(
        &self,
        _element_id: &str,
        _property: &str,
        _target_source_order: usize,
    ) -> ScalarEvaluation {
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-geometry-property-unavailable".to_owned(),
            binding_id: None,
            context: None,
        }
    }

    fn lookup_geometry_builtin_target(
        &self,
        _target: &ScalarExpressionResolvedGeometryTarget,
    ) -> Result<GeometryBuiltinRuntimeTarget, GeometryBuiltinRuntimeError> {
        Err(GeometryBuiltinRuntimeError::Unavailable)
    }
}

/// One entry in the explicit work stack. `Eval` still needs evaluating;
/// `Finish*`/`ContinueLogical` mean the node's own fields have already been
/// captured and it's ready to combine already-resolved child result(s) that
/// are sitting on top of `output`. `pub(super)` (visible throughout
/// `scalars/`) because `expression_evaluator_ops.rs`'s `continue_logical`
/// needs to push further work items (`FinishLogicalRight`/`Eval(right)`)
/// once it decides the short-circuit doesn't apply.
pub(super) enum EvalWork<'a> {
    Eval(&'a TypedScalarExpression),
    FinishUnary {
        operator: ScalarUnaryOperator,
        r#type: ScalarType,
    },
    /// Left has not been evaluated yet when this is pushed; it is evaluated
    /// first (pushed after this marker, so it pops first), and *this* item
    /// is what decides - once popped, with the left result on `output` -
    /// whether `right` needs evaluating at all. This is the actual
    /// short-circuit gate: `Eval(right)` is only ever pushed from inside the
    /// handler for this variant, never unconditionally up front.
    ContinueLogical {
        operator: ScalarBinaryOperator,
        r#type: ScalarType,
        right: &'a TypedScalarExpression,
    },
    FinishLogicalRight {
        r#type: ScalarType,
    },
    FinishEagerBinary {
        operator: ScalarBinaryOperator,
        r#type: ScalarType,
    },
    ContinueBuiltinCall {
        target: TypedScalarCallTarget,
        r#type: ScalarType,
        args: &'a [TypedBuiltinArgument],
        next_index: usize,
        values: Vec<f64>,
    },
}

/// Entry point: evaluates a validated `TypedScalarExpression` against
/// `environment`, matching the TypeScript reference evaluator's result and
/// binding-lookup behavior exactly. No recursive call into this function (or
/// any dispatcher) anywhere - the only "recursion" is pushing more work
/// items onto a heap `Vec`, so arbitrarily deep flat binary chains (up to the
/// node-count budget) evaluate at O(1) native stack depth.
pub(crate) fn evaluate_typed_expression(
    node: &TypedScalarExpression,
    environment: &impl ScalarEvaluationEnvironment,
) -> ScalarEvaluation {
    let mut work: Vec<EvalWork> = vec![EvalWork::Eval(node)];
    let mut output: Vec<ScalarEvaluation> = Vec::new();

    while let Some(item) = work.pop() {
        match item {
            EvalWork::Eval(node) => eval_node(node, environment, &mut work, &mut output),
            EvalWork::FinishUnary { operator, r#type } => {
                finish_unary(operator, r#type, &mut output)
            }
            EvalWork::ContinueLogical {
                operator,
                r#type,
                right,
            } => continue_logical(operator, r#type, right, &mut work, &mut output),
            EvalWork::FinishLogicalRight { r#type } => finish_logical_right(r#type, &mut output),
            EvalWork::FinishEagerBinary { operator, r#type } => {
                finish_eager_binary(operator, r#type, &mut output)
            }
            EvalWork::ContinueBuiltinCall {
                target,
                r#type,
                args,
                next_index,
                values,
            } => continue_builtin_call(
                target,
                r#type,
                args,
                next_index,
                values,
                &mut work,
                &mut output,
            ),
        }
    }

    output
        .pop()
        .expect("root result must be present when the work stack empties")
}

/// Processes one `Eval` work item: literals/`reference` push a fully-resolved
/// result straight onto `output`; `unary`/`binary`/`group`/`call` either fail closed
/// immediately on a `null` static type (their child/children are never
/// touched - no `lookup_binding` call is reachable through a type-null node)
/// or push follow-up work. `group` is the one case with **no** `Finish`
/// marker at all: TS's `case "group"` is pure delegation
/// (`return evaluateTypedExpression(node.expression, environment)`, no
/// `propagateError` re-stamp), so whatever the inner `Eval` eventually
/// leaves on `output` - ok or error, in whatever `type` it already carries -
/// *is* the group's result, unmodified.
fn eval_node<'a>(
    node: &'a TypedScalarExpression,
    environment: &impl ScalarEvaluationEnvironment,
    work: &mut Vec<EvalWork<'a>>,
    output: &mut Vec<ScalarEvaluation>,
) {
    match node {
        TypedScalarExpression::NumberLiteral { value, r#type, .. } => {
            output.push(ScalarEvaluation::Ok {
                r#type: r#type.clone(),
                value: ScalarValue::Number(*value),
            });
        }
        TypedScalarExpression::StringLiteral { value, r#type, .. } => {
            output.push(ScalarEvaluation::Ok {
                r#type: r#type.clone(),
                value: ScalarValue::String(value.clone()),
            });
        }
        TypedScalarExpression::BooleanLiteral { value, r#type, .. } => {
            output.push(ScalarEvaluation::Ok {
                r#type: r#type.clone(),
                value: ScalarValue::Boolean(*value),
            });
        }
        TypedScalarExpression::ChoiceLiteral { value, r#type, .. } => match r#type {
            None => output.push(static_type_null_error(None)),
            Some(ScalarType::Choice { options }) => output.push(ScalarEvaluation::Ok {
                r#type: ScalarType::Choice {
                    options: options.clone(),
                },
                value: ScalarValue::Choice {
                    value: value.clone(),
                    options: options.clone(),
                },
            }),
            // Payload validation already guarantees a choiceLiteral's non-null `type`
            // is a `Choice` variant (LiteralTypeMismatch is rejected at
            // decode time) - this arm exists only so the match is
            // exhaustive, not as a reachable runtime path.
            Some(_) => output.push(static_type_null_error(None)),
        },
        TypedScalarExpression::Reference {
            binding_id, r#type, ..
        } => {
            output.push(evaluate_reference(r#type, binding_id, environment));
        }
        TypedScalarExpression::GeometryProperty {
            element_id,
            property,
            target_source_order,
            ..
        } => {
            output.push(environment.lookup_geometry_property(
                element_id,
                property,
                *target_source_order,
            ));
        }
        TypedScalarExpression::Unary {
            operator,
            operand,
            r#type,
            ..
        } => match r#type {
            None => output.push(static_type_null_error(None)),
            Some(concrete_type) => {
                work.push(EvalWork::FinishUnary {
                    operator: *operator,
                    r#type: concrete_type.clone(),
                });
                work.push(EvalWork::Eval(operand));
            }
        },
        TypedScalarExpression::Group {
            expression, r#type, ..
        } => match r#type {
            None => output.push(static_type_null_error(None)),
            Some(_) => work.push(EvalWork::Eval(expression)),
        },
        TypedScalarExpression::Binary {
            operator,
            left,
            right,
            r#type,
            ..
        } => match r#type {
            None => output.push(static_type_null_error(None)),
            Some(concrete_type) => match operator {
                ScalarBinaryOperator::Or | ScalarBinaryOperator::And => {
                    work.push(EvalWork::ContinueLogical {
                        operator: *operator,
                        r#type: concrete_type.clone(),
                        right,
                    });
                    work.push(EvalWork::Eval(left));
                }
                _ => {
                    work.push(EvalWork::FinishEagerBinary {
                        operator: *operator,
                        r#type: concrete_type.clone(),
                    });
                    work.push(EvalWork::Eval(right));
                    work.push(EvalWork::Eval(left));
                }
            },
        },
        TypedScalarExpression::Call {
            target,
            args,
            r#type,
            ..
        } => match r#type {
            None => output.push(static_type_null_error(None)),
            Some(concrete_type) => {
                let TypedScalarCallTarget::Builtin(name) = *target;
                if name.is_geometry() {
                    output.push(evaluate_geometry_builtin_call(
                        name,
                        concrete_type.clone(),
                        args,
                        environment,
                    ));
                } else if args.iter().any(|argument| {
                    matches!(argument, TypedBuiltinArgument::GeometryReference { .. })
                }) {
                    output.push(ScalarEvaluation::Error {
                        r#type: concrete_type.clone(),
                        issue_code: "evaluation-invalid-builtin-argument".to_owned(),
                        binding_id: None,
                        context: None,
                    });
                } else {
                    work.push(EvalWork::ContinueBuiltinCall {
                        target: *target,
                        r#type: concrete_type.clone(),
                        args,
                        next_index: 0,
                        values: Vec::with_capacity(args.len()),
                    });
                    if let Some(TypedBuiltinArgument::Scalar { expression }) = args.first() {
                        work.push(EvalWork::Eval(expression));
                    }
                }
            }
        },
    }
}
