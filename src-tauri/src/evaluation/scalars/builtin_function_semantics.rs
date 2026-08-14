//! Pure Rust implementation of the resolved numeric builtin contract.
//!
//! This mirrors `src/scalars/builtinFunctionSemantics.ts`. It receives only a
//! closed builtin identity and already-evaluated numeric arguments; source
//! names, arity/type resolution, and AST traversal belong to other layers.

use super::types::BuiltinFunctionName;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum BuiltinFunctionValue {
    Number(f64),
    Boolean(bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BuiltinFunctionError {
    InvalidArgument,
    NonFiniteResult,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum BuiltinFunctionEvaluation {
    Ok(BuiltinFunctionValue),
    Error(BuiltinFunctionError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecimalShiftStatus {
    Finite,
    Overflow,
    Underflow,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct DecimalShift {
    status: DecimalShiftStatus,
    value: f64,
}

const MAX_FINITE_DECIMAL_EXPONENT: i32 = 308;
const MIN_SUBNORMAL_DECIMAL_EXPONENT: i32 = -324;

fn invalid_argument() -> BuiltinFunctionEvaluation {
    BuiltinFunctionEvaluation::Error(BuiltinFunctionError::InvalidArgument)
}

fn non_finite_result() -> BuiltinFunctionEvaluation {
    BuiltinFunctionEvaluation::Error(BuiltinFunctionError::NonFiniteResult)
}

fn finite_number_result(value: f64) -> BuiltinFunctionEvaluation {
    if value.is_finite() {
        BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Number(value))
    } else {
        non_finite_result()
    }
}

fn has_finite_arguments(args: &[f64], expected_length: usize) -> bool {
    args.len() == expected_length && args.iter().all(|argument| argument.is_finite())
}

/// Explicitly implements the language's midpoint rule instead of inheriting
/// a platform/library default: every half-way value rounds away from zero.
fn round_away_from_zero(value: f64) -> f64 {
    let magnitude = value.abs();
    let rounded_magnitude = if magnitude.fract() >= 0.5 {
        magnitude.ceil()
    } else {
        magnitude.floor()
    };
    if value.is_sign_negative() {
        -rounded_magnitude
    } else {
        rounded_magnitude
    }
}

fn decimal_scientific_parts(value: f64) -> (String, i32) {
    debug_assert!(value.is_finite() && value != 0.0);

    // Rust's shortest round-tripping decimal is sufficient here. Normalize
    // either its fixed or scientific spelling into the same coefficient and
    // base-10 exponent that JavaScript's `toExponential()` exposes.
    let text = value.abs().to_string();
    let (mantissa, explicit_exponent) = match text.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, exponent.parse::<i32>().unwrap()),
        None => (text.as_str(), 0),
    };
    let decimal_index = mantissa.find('.').unwrap_or(mantissa.len());
    let mut digits = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect::<Vec<_>>();
    let leading_zero_count = digits
        .iter()
        .take_while(|character| **character == '0')
        .count();
    digits.drain(..leading_zero_count);
    while digits.len() > 1 && digits.last() == Some(&'0') {
        digits.pop();
    }

    let exponent = explicit_exponent + decimal_index as i32 - leading_zero_count as i32 - 1;
    let coefficient_text = if digits.len() == 1 {
        digits[0].to_string()
    } else {
        let mut text = String::with_capacity(digits.len() + 1);
        text.push(digits[0]);
        text.push('.');
        text.extend(digits[1..].iter());
        text
    };
    (coefficient_text, exponent)
}

/// Applies a decimal exponent without constructing `10^digits` for an
/// unbounded input. Parsing the normalized scientific spelling mirrors
/// JavaScript's `Number(`${coefficient}e${exponent}`)` conversion, including
/// its decimal-to-binary rounding and subnormal boundary behavior.
fn decimal_scale(coefficient: &str, exponent: i32) -> f64 {
    format!("{coefficient}e{exponent}").parse::<f64>().unwrap()
}

fn shift_decimal_exponent(value: f64, digits: f64) -> DecimalShift {
    if value == 0.0 {
        return DecimalShift {
            status: DecimalShiftStatus::Finite,
            value: 0.0,
        };
    }

    let (coefficient, exponent) = decimal_scientific_parts(value);
    let shifted_exponent = exponent as f64 + digits;
    if !shifted_exponent.is_finite() || shifted_exponent > MAX_FINITE_DECIMAL_EXPONENT as f64 {
        return DecimalShift {
            status: DecimalShiftStatus::Overflow,
            value,
        };
    }
    if shifted_exponent < MIN_SUBNORMAL_DECIMAL_EXPONENT as f64 {
        return DecimalShift {
            status: DecimalShiftStatus::Underflow,
            value,
        };
    }

    let shifted = decimal_scale(&coefficient, shifted_exponent as i32);
    if shifted == 0.0 {
        DecimalShift {
            status: DecimalShiftStatus::Underflow,
            value: 0.0,
        }
    } else if shifted.is_finite() {
        DecimalShift {
            status: DecimalShiftStatus::Finite,
            value: value.signum() * shifted,
        }
    } else {
        DecimalShift {
            status: DecimalShiftStatus::Overflow,
            value,
        }
    }
}

fn round_scaled_value(operation: DecimalRoundingOperation, value: f64) -> f64 {
    match operation {
        DecimalRoundingOperation::Round => round_away_from_zero(value),
        DecimalRoundingOperation::Floor => value.floor(),
        DecimalRoundingOperation::Ceil => value.ceil(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecimalRoundingOperation {
    Round,
    Floor,
    Ceil,
}

fn underflow_rounded_value(operation: DecimalRoundingOperation, value: f64) -> f64 {
    match operation {
        DecimalRoundingOperation::Round => 0.0,
        DecimalRoundingOperation::Floor => {
            if value < 0.0 {
                -1.0
            } else {
                0.0
            }
        }
        DecimalRoundingOperation::Ceil => {
            if value > 0.0 {
                1.0
            } else {
                0.0
            }
        }
    }
}

fn evaluate_decimal_rounding(
    operation: DecimalRoundingOperation,
    value: f64,
    digits: f64,
) -> BuiltinFunctionEvaluation {
    let scaled = shift_decimal_exponent(value, digits);

    // At a precision finer than the representable range, the original finite
    // value is already the most precise value the runtime can preserve.
    if scaled.status == DecimalShiftStatus::Overflow {
        return finite_number_result(value);
    }

    let rounded = if scaled.status == DecimalShiftStatus::Underflow {
        underflow_rounded_value(operation, value)
    } else {
        round_scaled_value(operation, scaled.value)
    };
    let unscaled = shift_decimal_exponent(rounded, -digits);
    if unscaled.status == DecimalShiftStatus::Overflow {
        return non_finite_result();
    }
    if unscaled.status == DecimalShiftStatus::Underflow {
        return BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Number(0.0));
    }
    finite_number_result(unscaled.value)
}

fn evaluate_unary_decimal_rounding(
    operation: DecimalRoundingOperation,
    value: f64,
) -> BuiltinFunctionEvaluation {
    finite_number_result(round_scaled_value(operation, value))
}

pub(crate) fn evaluate_builtin_function(
    name: BuiltinFunctionName,
    args: &[f64],
) -> BuiltinFunctionEvaluation {
    match name {
        BuiltinFunctionName::Abs => {
            if !has_finite_arguments(args, 1) {
                return invalid_argument();
            }
            finite_number_result(args[0].abs())
        }
        BuiltinFunctionName::Min => {
            if !has_finite_arguments(args, 2) {
                return invalid_argument();
            }
            finite_number_result(args[0].min(args[1]))
        }
        BuiltinFunctionName::Max => {
            if !has_finite_arguments(args, 2) {
                return invalid_argument();
            }
            finite_number_result(args[0].max(args[1]))
        }
        BuiltinFunctionName::Sqrt => {
            if !has_finite_arguments(args, 1) || args[0] < 0.0 {
                return invalid_argument();
            }
            finite_number_result(args[0].sqrt())
        }
        BuiltinFunctionName::Round | BuiltinFunctionName::Floor | BuiltinFunctionName::Ceil => {
            let operation = match name {
                BuiltinFunctionName::Round => DecimalRoundingOperation::Round,
                BuiltinFunctionName::Floor => DecimalRoundingOperation::Floor,
                BuiltinFunctionName::Ceil => DecimalRoundingOperation::Ceil,
                _ => unreachable!(),
            };
            if !has_finite_arguments(args, 1) && !has_finite_arguments(args, 2) {
                return invalid_argument();
            }
            if args.len() == 1 {
                return evaluate_unary_decimal_rounding(operation, args[0]);
            }
            if !args[1].is_finite() || args[1].fract() != 0.0 {
                return invalid_argument();
            }
            evaluate_decimal_rounding(operation, args[0], args[1])
        }
        BuiltinFunctionName::RoundTo => {
            if !has_finite_arguments(args, 2) || args[1] <= 0.0 {
                return invalid_argument();
            }
            let quotient = args[0] / args[1];
            if !quotient.is_finite() {
                return non_finite_result();
            }
            finite_number_result(round_away_from_zero(quotient) * args[1])
        }
        BuiltinFunctionName::IsClose => {
            if !has_finite_arguments(args, 3) || args[2] < 0.0 {
                return invalid_argument();
            }
            BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Boolean(
                (args[0] - args[1]).abs() <= args[2],
            ))
        }
        BuiltinFunctionName::Distance
        | BuiltinFunctionName::Angle
        | BuiltinFunctionName::LineDistance => invalid_argument(),
    }
}
