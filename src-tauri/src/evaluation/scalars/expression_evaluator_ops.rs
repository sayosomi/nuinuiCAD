//! Per-operator combination logic for `expression_evaluator.rs`'s iterative
//! work stack: reference trust-boundary evaluation, and the `Finish*`/
//! `ContinueLogical` handlers that combine already-resolved child result(s)
//! popped off `output`. None of these functions recurse into
//! `evaluate_typed_expression` or push an `Eval` for anything they don't
//! already hold a direct child reference to - the traversal itself lives
//! entirely in `expression_evaluator.rs`.
//!
//! Mirrors `src/scalars/expressionEvaluator.ts` field-for-field, including
//! its exact `evaluation-*` issue-code vocabulary.

use super::angle_math::{atan2_degrees_360, radians_to_degrees};
use super::builtin_function_semantics::{
    evaluate_builtin_function, BuiltinFunctionError, BuiltinFunctionValue,
};
use super::expression_evaluator::{EvalWork, ScalarEvaluationEnvironment};
use super::geometry_builtin_runtime::{
    validate_geometry_builtin_arguments, GeometryBuiltinRuntimeError, GeometryBuiltinRuntimeTarget,
};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{
    BindingId, BuiltinFunctionName, ScalarBinaryOperator, ScalarEvaluation, ScalarType,
    ScalarUnaryOperator, ScalarValue, TypedBuiltinArgument, TypedScalarCallTarget,
    TypedScalarExpression,
};

/// Documented placeholder used only when a node's static `type` is `None`.
/// `ScalarEvaluation`'s `type` field is non-nullable, so an honest "no
/// static type" cannot be represented in-band; mirrors
/// `expressionEvaluator.ts`'s `STATIC_TYPE_NULL_PLACEHOLDER` (itself mirrors
/// `expressionTypecheck.ts`'s existing "unknown -> number" default).
/// Consumers must key off `issue_code == "evaluation-static-type-null"`,
/// never off `.r#type`, to detect this case.
fn static_type_null_placeholder() -> ScalarType {
    ScalarType::Number
}

/// Mirrors TS's `staticTypeNullError(bindingId?)`: `binding_id` is passed
/// through verbatim (not always omitted) - a `reference` node whose
/// `bindingId` is set but whose `type` is `None` (a resolved binding with a
/// malformed declared type) still reports that `bindingId` in the error,
/// per `expressionEvaluator.ts:51-54`'s `node.bindingId ?? undefined`. Every
/// other node kind that can fail this way (`unary`/`binary`/`group`/
/// `choiceLiteral`) has no `bindingId` field at all, so callers there always
/// pass `None`.
pub(crate) fn static_type_null_error(binding_id: Option<BindingId>) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: static_type_null_placeholder(),
        issue_code: "evaluation-static-type-null".to_owned(),
        binding_id,
    }
}

/// Re-stamps an already-produced error to `r#type`, keeping `issue_code`/
/// `binding_id` verbatim. Only valid to call when `source` is
/// `ScalarEvaluation::Error` - mirrors TS's `propagateError`, which is typed
/// to only accept the error variant.
fn propagate_error(r#type: ScalarType, source: ScalarEvaluation) -> ScalarEvaluation {
    match source {
        ScalarEvaluation::Error {
            issue_code,
            binding_id,
            ..
        } => ScalarEvaluation::Error {
            r#type,
            issue_code,
            binding_id,
        },
        ScalarEvaluation::Ok { .. } => {
            unreachable!("propagate_error must only be called with an error result")
        }
    }
}

/// By the time a value reaches here it has already passed either the
/// reference trust-boundary check (`evaluate_reference`) or is a literal/
/// computed value that is self-consistent with its own static type by
/// construction (guaranteed by Task 15's typecheck, mirrored by Task 17's
/// payload validation). A mismatch here would be an invariant violation in
/// this module, not an expected runtime failure - mirrors
/// `expressionEvaluator.ts`'s own documented rationale for its analogous
/// `numberValueOf`/`booleanValueOf` helpers.
fn number_value_of(value: &ScalarValue) -> Option<f64> {
    match value {
        ScalarValue::Number(number) => Some(*number),
        _ => None,
    }
}

fn boolean_value_of(value: &ScalarValue) -> Option<bool> {
    match value {
        ScalarValue::Boolean(boolean) => Some(*boolean),
        _ => None,
    }
}

fn runtime_value_type_mismatch(r#type: ScalarType) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type,
        issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
        binding_id: None,
    }
}

fn finite_number_result(r#type: ScalarType, value: f64) -> ScalarEvaluation {
    if value.is_finite() {
        ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Number(value),
        }
    } else {
        ScalarEvaluation::Error {
            r#type,
            issue_code: "evaluation-non-finite-result".to_owned(),
            binding_id: None,
        }
    }
}

fn finish_builtin_call(
    target: TypedScalarCallTarget,
    r#type: ScalarType,
    values: &[f64],
) -> ScalarEvaluation {
    let TypedScalarCallTarget::Builtin(name) = target;
    match evaluate_builtin_function(name, values) {
        super::builtin_function_semantics::BuiltinFunctionEvaluation::Ok(
            BuiltinFunctionValue::Number(value),
        ) => finite_number_result(r#type, value),
        super::builtin_function_semantics::BuiltinFunctionEvaluation::Ok(
            BuiltinFunctionValue::Boolean(value),
        ) => ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(value),
        },
        super::builtin_function_semantics::BuiltinFunctionEvaluation::Error(error) => {
            let issue_code = match error {
                BuiltinFunctionError::InvalidArgument => "evaluation-invalid-builtin-argument",
                BuiltinFunctionError::SqrtNegativeInput => "evaluation-sqrt-negative-input",
                BuiltinFunctionError::RoundToNonPositiveStep => {
                    "evaluation-round-to-non-positive-step"
                }
                BuiltinFunctionError::IsCloseNegativeTolerance => {
                    "evaluation-is-close-negative-tolerance"
                }
                BuiltinFunctionError::TanOddMultipleOf90 => "evaluation-tan-odd-multiple-of-90",
                BuiltinFunctionError::AsinOutOfRange => "evaluation-asin-out-of-range",
                BuiltinFunctionError::AcosOutOfRange => "evaluation-acos-out-of-range",
                BuiltinFunctionError::NonFiniteResult => "evaluation-non-finite-result",
            };
            ScalarEvaluation::Error {
                r#type,
                issue_code: issue_code.to_owned(),
                binding_id: None,
            }
        }
    }
}

/// Evaluates call arguments one at a time from left to right. A continuation
/// is re-pushed only after the current argument succeeds, so an argument
/// error prevents every later argument from being evaluated.
pub(crate) fn continue_builtin_call<'a>(
    target: TypedScalarCallTarget,
    r#type: ScalarType,
    args: &'a [TypedBuiltinArgument],
    next_index: usize,
    mut values: Vec<f64>,
    work: &mut Vec<EvalWork<'a>>,
    output: &mut Vec<ScalarEvaluation>,
) {
    if next_index >= args.len() {
        output.push(finish_builtin_call(target, r#type, &values));
        return;
    }

    let argument = output
        .pop()
        .expect("builtin argument must already be resolved before its continuation");
    let ScalarEvaluation::Ok { value, .. } = &argument else {
        output.push(propagate_error(r#type, argument));
        return;
    };
    let Some(number) = number_value_of(value) else {
        output.push(runtime_value_type_mismatch(r#type));
        return;
    };
    values.push(number);

    let next_index = next_index + 1;
    if next_index < args.len() {
        let TypedBuiltinArgument::Scalar { expression } = &args[next_index] else {
            output.push(ScalarEvaluation::Error {
                r#type,
                issue_code: "evaluation-invalid-builtin-argument".to_owned(),
                binding_id: None,
            });
            return;
        };
        work.push(EvalWork::ContinueBuiltinCall {
            target,
            r#type,
            args,
            next_index,
            values,
        });
        work.push(EvalWork::Eval(expression));
    } else {
        output.push(finish_builtin_call(target, r#type, &values));
    }
}

pub(crate) fn evaluate_geometry_builtin_call(
    name: BuiltinFunctionName,
    r#type: ScalarType,
    arguments: &[TypedBuiltinArgument],
    environment: &impl ScalarEvaluationEnvironment,
) -> ScalarEvaluation {
    match validate_geometry_builtin_arguments(name, arguments, |target| {
        environment.lookup_geometry_builtin_target(target)
    }) {
        Ok(runtime_targets) => {
            let result = match (name, runtime_targets.as_slice()) {
                (
                    BuiltinFunctionName::Distance,
                    [GeometryBuiltinRuntimeTarget::Point(first), GeometryBuiltinRuntimeTarget::Point(second)],
                ) => {
                    let dx = second.x - first.x;
                    let dy = second.y - first.y;
                    dx.hypot(dy)
                }
                (
                    BuiltinFunctionName::Angle,
                    [GeometryBuiltinRuntimeTarget::Point(first), GeometryBuiltinRuntimeTarget::Point(second)],
                ) => {
                    let dx = second.x - first.x;
                    let dy = second.y - first.y;
                    atan2_degrees_360(dy, dx)
                }
                (
                    BuiltinFunctionName::LineDistance,
                    [GeometryBuiltinRuntimeTarget::Point(point), GeometryBuiltinRuntimeTarget::Line { start, end }],
                ) => {
                    let dx = end.x - start.x;
                    let dy = end.y - start.y;
                    let length = dx.hypot(dy);
                    (dx * (start.y - point.y) - (start.x - point.x) * dy).abs() / length
                }
                (
                    BuiltinFunctionName::LineAngle,
                    [GeometryBuiltinRuntimeTarget::Line {
                        start: first_start,
                        end: first_end,
                    }, GeometryBuiltinRuntimeTarget::Line {
                        start: second_start,
                        end: second_end,
                    }],
                ) => {
                    let first_dx = first_end.x - first_start.x;
                    let first_dy = first_end.y - first_start.y;
                    let second_dx = second_end.x - second_start.x;
                    let second_dy = second_end.y - second_start.y;
                    let first_length = first_dx.hypot(first_dy);
                    let second_length = second_dx.hypot(second_dy);
                    let ratio = (first_dx * second_dx + first_dy * second_dy).abs()
                        / (first_length * second_length);
                    radians_to_degrees(ratio.clamp(0.0, 1.0).acos())
                }
                _ => {
                    return ScalarEvaluation::Error {
                        r#type,
                        issue_code: "evaluation-geometry-builtin-unavailable".to_owned(),
                        binding_id: None,
                    };
                }
            };
            finite_number_result(r#type, result)
        }
        Err(GeometryBuiltinRuntimeError::Unavailable) => ScalarEvaluation::Error {
            r#type,
            issue_code: "evaluation-geometry-builtin-unavailable".to_owned(),
            binding_id: None,
        },
        Err(GeometryBuiltinRuntimeError::InvalidArgument) => ScalarEvaluation::Error {
            r#type,
            issue_code: "evaluation-invalid-builtin-argument".to_owned(),
            binding_id: None,
        },
        Err(GeometryBuiltinRuntimeError::Disabled) => ScalarEvaluation::Error {
            r#type,
            issue_code: "evaluation-geometry-builtin-disabled".to_owned(),
            binding_id: None,
        },
        Err(GeometryBuiltinRuntimeError::ZeroLengthLine) => ScalarEvaluation::Error {
            r#type,
            issue_code: "evaluation-zero-length-line".to_owned(),
            binding_id: None,
        },
    }
}

/// The one real trust boundary in this module: a reference's value crosses
/// from the caller-supplied environment. Validated unconditionally here -
/// not deferred to whichever parent happens to consume it - so a bare
/// top-level reference, a reference under a no-op `group`, an operand of
/// unary/binary, and an equality operand are all covered by the same check.
/// Mirrors `expressionEvaluator.ts`'s `evaluateReference` exactly, including
/// forwarding the environment's own error **unmodified** (not re-stamped to
/// this reference's declared type) - only the mismatch case below
/// constructs a new error.
pub(crate) fn evaluate_reference(
    node_type: &Option<ScalarType>,
    binding_id: &Option<BindingId>,
    environment: &impl ScalarEvaluationEnvironment,
) -> ScalarEvaluation {
    let (Some(declared_type), Some(id)) = (node_type, binding_id) else {
        return static_type_null_error(binding_id.clone());
    };

    let result = environment.lookup_binding(id);
    match &result {
        ScalarEvaluation::Error { .. } => result,
        ScalarEvaluation::Ok {
            r#type: runtime_type,
            value,
        } => {
            if declared_type != runtime_type || !scalar_value_matches_type(runtime_type, value) {
                return ScalarEvaluation::Error {
                    r#type: declared_type.clone(),
                    issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
                    binding_id: Some(id.clone()),
                };
            }
            result
        }
    }
}

/// Combines a unary operand's already-resolved result (top of `output`) with
/// the unary node's own `operator`/`r#type`. `!` negates a boolean; `-`/`+`
/// act on a number (`+` is identity, matching TS).
pub(crate) fn finish_unary(
    operator: ScalarUnaryOperator,
    r#type: ScalarType,
    output: &mut Vec<ScalarEvaluation>,
) {
    let operand = output
        .pop()
        .expect("unary operand must already be resolved (post-order evaluation invariant)");
    let ScalarEvaluation::Ok { value, .. } = &operand else {
        output.push(propagate_error(r#type, operand));
        return;
    };

    let result = match operator {
        ScalarUnaryOperator::Not => {
            boolean_value_of(value).map(|value| ScalarValue::Boolean(!value))
        }
        ScalarUnaryOperator::Negate => {
            number_value_of(value).map(|value| ScalarValue::Number(-value))
        }
        ScalarUnaryOperator::Plus => number_value_of(value).map(ScalarValue::Number),
    };
    output.push(match result {
        Some(value) => ScalarEvaluation::Ok { r#type, value },
        None => runtime_value_type_mismatch(r#type),
    });
}

/// `&&`/`||`: the only short-circuiting operators. Pops the already-resolved
/// left result; on error, propagates immediately (the actual short-circuit
/// gate - `right` is never pushed in that case). Otherwise checks whether
/// left's boolean value already determines the result (`&&` + `false`,
/// `||` + `true`) and, if not, defers to `FinishLogicalRight` after pushing
/// `right` for evaluation.
pub(crate) fn continue_logical<'a>(
    operator: ScalarBinaryOperator,
    r#type: ScalarType,
    right: &'a TypedScalarExpression,
    work: &mut Vec<EvalWork<'a>>,
    output: &mut Vec<ScalarEvaluation>,
) {
    let left = output
        .pop()
        .expect("logical left must already be resolved (post-order evaluation invariant)");
    let ScalarEvaluation::Ok { value, .. } = &left else {
        output.push(propagate_error(r#type, left));
        return;
    };
    let Some(left_value) = boolean_value_of(value) else {
        output.push(runtime_value_type_mismatch(r#type));
        return;
    };
    let short_circuits = match operator {
        ScalarBinaryOperator::And => !left_value,
        ScalarBinaryOperator::Or => left_value,
        _ => unreachable!("continue_logical is only ever pushed for And/Or"),
    };
    if short_circuits {
        output.push(ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(left_value),
        });
        return;
    }

    work.push(EvalWork::FinishLogicalRight { r#type });
    work.push(EvalWork::Eval(right));
}

/// Pops the already-resolved right operand of a non-short-circuited `&&`/
/// `||`; on error, propagates; else the result is simply the right operand's
/// own boolean value (matches TS returning `booleanValueOf(right.value)`
/// directly, not re-combining with left).
pub(crate) fn finish_logical_right(r#type: ScalarType, output: &mut Vec<ScalarEvaluation>) {
    let right = output
        .pop()
        .expect("logical right must already be resolved (post-order evaluation invariant)");
    let ScalarEvaluation::Ok { value, .. } = &right else {
        output.push(propagate_error(r#type, right));
        return;
    };
    output.push(match boolean_value_of(value) {
        Some(value) => ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(value),
        },
        None => runtime_value_type_mismatch(r#type),
    });
}

/// Combines the two already-resolved, unconditionally-evaluated operands of
/// every non-short-circuiting binary operator (`==`/`!=` and the 8
/// arithmetic/comparison operators). Pops `right` then `left` (`right` was
/// pushed to `output` second); if `left` errored, that error wins even if
/// `right` also errored - matches the fixture's own documented convention
/// ("for binary operators other than && and ||... if both error, the LEFT
/// operand's error wins").
pub(crate) fn finish_eager_binary(
    operator: ScalarBinaryOperator,
    r#type: ScalarType,
    output: &mut Vec<ScalarEvaluation>,
) {
    let right = output
        .pop()
        .expect("binary right must already be resolved (post-order evaluation invariant)");
    let left = output
        .pop()
        .expect("binary left must already be resolved (post-order evaluation invariant)");

    let (left_value, right_value) = match (&left, &right) {
        (ScalarEvaluation::Error { .. }, _) => {
            output.push(propagate_error(r#type, left));
            return;
        }
        (_, ScalarEvaluation::Error { .. }) => {
            output.push(propagate_error(r#type, right));
            return;
        }
        (ScalarEvaluation::Ok { value: left, .. }, ScalarEvaluation::Ok { value: right, .. }) => {
            (left, right)
        }
    };

    if matches!(
        operator,
        ScalarBinaryOperator::Eq | ScalarBinaryOperator::NotEq
    ) {
        // Choice-identity-aware equality for free: `ScalarValue`'s derived
        // `PartialEq` compares a `Choice` variant's `value` *and* `options`
        // (in order, by length+element), which is exactly D07's choice-
        // identity rule - the same comparison TS's hand-written
        // `scalarValuesEqual` performs. No second implementation needed.
        let equal = left_value == right_value;
        let result = if matches!(operator, ScalarBinaryOperator::Eq) {
            equal
        } else {
            !equal
        };
        output.push(ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(result),
        });
        return;
    }

    let (Some(left_number), Some(right_number)) =
        (number_value_of(left_value), number_value_of(right_value))
    else {
        output.push(runtime_value_type_mismatch(r#type));
        return;
    };
    let result = match operator {
        ScalarBinaryOperator::Add => finite_number_result(r#type, left_number + right_number),
        ScalarBinaryOperator::Sub => finite_number_result(r#type, left_number - right_number),
        ScalarBinaryOperator::Mul => finite_number_result(r#type, left_number * right_number),
        ScalarBinaryOperator::Pow => finite_number_result(r#type, left_number.powf(right_number)),
        ScalarBinaryOperator::Div => {
            let quotient = left_number / right_number;
            if right_number == 0.0 {
                ScalarEvaluation::Error {
                    r#type,
                    issue_code: "evaluation-divide-by-zero".to_owned(),
                    binding_id: None,
                }
            } else {
                finite_number_result(r#type, quotient)
            }
        }
        ScalarBinaryOperator::Remainder => {
            if right_number == 0.0 {
                ScalarEvaluation::Error {
                    r#type,
                    issue_code: "evaluation-remainder-by-zero".to_owned(),
                    binding_id: None,
                }
            } else {
                finite_number_result(r#type, left_number % right_number)
            }
        }
        ScalarBinaryOperator::Lt => ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(left_number < right_number),
        },
        ScalarBinaryOperator::LtEq => ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(left_number <= right_number),
        },
        ScalarBinaryOperator::Gt => ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(left_number > right_number),
        },
        ScalarBinaryOperator::GtEq => ScalarEvaluation::Ok {
            r#type,
            value: ScalarValue::Boolean(left_number >= right_number),
        },
        ScalarBinaryOperator::Eq | ScalarBinaryOperator::NotEq => {
            unreachable!("handled above")
        }
        ScalarBinaryOperator::Or | ScalarBinaryOperator::And => {
            unreachable!("Or/And never reach finish_eager_binary")
        }
    };
    output.push(result);
}
