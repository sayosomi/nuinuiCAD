use super::builtin_function_semantics::{
    evaluate_builtin_function, BuiltinFunctionError, BuiltinFunctionEvaluation,
    BuiltinFunctionValue,
};
use super::types::BuiltinFunctionName;

fn number(value: f64) -> BuiltinFunctionEvaluation {
    BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Number(value))
}

fn boolean(value: bool) -> BuiltinFunctionEvaluation {
    BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Boolean(value))
}

fn invalid_argument() -> BuiltinFunctionEvaluation {
    BuiltinFunctionEvaluation::Error(BuiltinFunctionError::InvalidArgument)
}

fn non_finite_result() -> BuiltinFunctionEvaluation {
    BuiltinFunctionEvaluation::Error(BuiltinFunctionError::NonFiniteResult)
}

#[test]
fn evaluates_basic_numeric_builtins() {
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Abs, &[-5.0]),
        number(5.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Min, &[10.0, 20.0]),
        number(10.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Max, &[10.0, 20.0]),
        number(20.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Sqrt, &[25.0]),
        number(5.0)
    );
}

#[test]
fn rejects_invalid_sqrt_argument() {
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Sqrt, &[-1.0]),
        invalid_argument()
    );
}

#[test]
fn rounds_midpoints_away_from_zero_and_supports_decimal_digits() {
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[1.5]),
        number(2.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[-1.5]),
        number(-2.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[12.3456, 2.0]),
        number(12.35)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[1234.0, -2.0]),
        number(1200.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Floor, &[12.349, 2.0]),
        number(12.34)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Floor, &[1234.0, -2.0]),
        number(1200.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Ceil, &[12.341, 2.0]),
        number(12.35)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Ceil, &[1234.0, -2.0]),
        number(1300.0)
    );
}

#[test]
fn rounds_to_a_positive_step_using_the_same_midpoint_rule() {
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::RoundTo, &[12.3, 0.5]),
        number(12.5)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::RoundTo, &[10.0, 0.0]),
        invalid_argument()
    );
}

#[test]
fn evaluates_is_close_and_rejects_negative_tolerance() {
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::IsClose, &[10.24, 10.26, 0.1]),
        boolean(true)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::IsClose, &[10.0, 10.0, -1.0]),
        invalid_argument()
    );
}

#[test]
fn matches_decimal_shift_representability_contract() {
    let extreme_digits = -1e308;
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[1.0, extreme_digits]),
        number(0.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Floor, &[1.0, extreme_digits]),
        number(0.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Ceil, &[-1.0, extreme_digits]),
        number(0.0)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Floor, &[-1.0, extreme_digits]),
        non_finite_result()
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Ceil, &[1.0, extreme_digits]),
        non_finite_result()
    );

    let value = 123.456;
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[value, 1e308]),
        number(value)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Floor, &[value, 1e308]),
        number(value)
    );
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Ceil, &[value, 1e308]),
        number(value)
    );
}

#[test]
fn rejects_non_finite_round_to_intermediates() {
    let min_subnormal = f64::from_bits(1);
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::RoundTo, &[f64::MAX, min_subnormal]),
        non_finite_result()
    );
}
