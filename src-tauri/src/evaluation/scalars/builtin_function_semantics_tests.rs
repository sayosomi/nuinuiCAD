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

fn assert_number_close(result: BuiltinFunctionEvaluation, expected: f64) {
    match result {
        BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Number(value)) => {
            assert!(
                (value - expected).abs() < 1e-10,
                "{value} is not close to {expected}"
            );
        }
        other => panic!("expected numeric success, got {other:?}"),
    }
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
fn preserves_decimal_coefficient_text_until_the_final_parse() {
    assert_eq!(
        evaluate_builtin_function(BuiltinFunctionName::Round, &[9484088218495944.0, 1.0]),
        number(9484088218495944.0)
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

#[test]
fn evaluates_trigonometric_functions_in_degrees() {
    for (degrees, expected) in [
        (0.0, 0.0),
        (30.0, 0.5),
        (90.0, 1.0),
        (180.0, 0.0),
        (-30.0, -0.5),
        (390.0, 0.5),
    ] {
        assert_number_close(
            evaluate_builtin_function(BuiltinFunctionName::Sin, &[degrees]),
            expected,
        );
    }
    for (degrees, expected) in [
        (0.0, 1.0),
        (60.0, 0.5),
        (90.0, 0.0),
        (180.0, -1.0),
        (-60.0, 0.5),
        (420.0, 0.5),
    ] {
        assert_number_close(
            evaluate_builtin_function(BuiltinFunctionName::Cos, &[degrees]),
            expected,
        );
    }
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::Tan, &[0.0]),
        0.0,
    );
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::Tan, &[45.0]),
        1.0,
    );
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::Tan, &[135.0]),
        -1.0,
    );
}

#[test]
fn rejects_tangent_singularities_by_the_exact_degree_contract() {
    for degrees in [90.0, 270.0, -90.0, -270.0, 450.0] {
        assert_eq!(
            evaluate_builtin_function(BuiltinFunctionName::Tan, &[degrees]),
            invalid_argument()
        );
    }
    assert!(matches!(
        evaluate_builtin_function(BuiltinFunctionName::Tan, &[90.0 + 1e-10]),
        BuiltinFunctionEvaluation::Ok(BuiltinFunctionValue::Number(_))
    ));
}

#[test]
fn evaluates_inverse_trigonometric_functions_in_degrees_and_validates_domains() {
    for (name, value, expected) in [
        (BuiltinFunctionName::Asin, -1.0, -90.0),
        (BuiltinFunctionName::Asin, 0.0, 0.0),
        (BuiltinFunctionName::Asin, 0.5, 30.0),
        (BuiltinFunctionName::Asin, 1.0, 90.0),
        (BuiltinFunctionName::Acos, -1.0, 180.0),
        (BuiltinFunctionName::Acos, 0.0, 90.0),
        (BuiltinFunctionName::Acos, 0.5, 60.0),
        (BuiltinFunctionName::Acos, 1.0, 0.0),
        (BuiltinFunctionName::Atan, -1.0, -45.0),
        (BuiltinFunctionName::Atan, 0.0, 0.0),
        (BuiltinFunctionName::Atan, 1.0, 45.0),
    ] {
        assert_number_close(evaluate_builtin_function(name, &[value]), expected);
    }
    for name in [BuiltinFunctionName::Asin, BuiltinFunctionName::Acos] {
        for value in [-1.000001, 1.000001] {
            assert_eq!(
                evaluate_builtin_function(name, &[value]),
                invalid_argument()
            );
        }
    }
}

#[test]
fn normalizes_atan2_y_x_to_compass_degrees() {
    for (y, x, expected) in [
        (0.0, 1.0, 0.0),
        (1.0, 0.0, 90.0),
        (0.0, -1.0, 180.0),
        (-1.0, 0.0, 270.0),
        (1.0, 1.0, 45.0),
        (1.0, -1.0, 135.0),
        (-1.0, -1.0, 225.0),
        (-1.0, 1.0, 315.0),
        (0.0, 0.0, 0.0),
    ] {
        assert_number_close(
            evaluate_builtin_function(BuiltinFunctionName::Atan2, &[y, x]),
            expected,
        );
    }
}

#[test]
fn evaluates_spread_angle_from_chord_length_in_degrees() {
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::SpreadAngle, &[100.0, 20.0]),
        11.4783409545,
    );
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::SpreadAngle, &[100.0, 0.0]),
        0.0,
    );
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::SpreadAngle, &[100.0, 200.0]),
        180.0,
    );
    assert_number_close(
        evaluate_builtin_function(BuiltinFunctionName::SpreadAngle, &[f64::MAX, f64::MAX]),
        60.0,
    );
}

#[test]
fn rejects_invalid_spread_angle_arguments_and_arity() {
    for args in [
        vec![0.0, 0.0],
        vec![-100.0, 20.0],
        vec![100.0, -1.0],
        vec![100.0, 201.0],
        vec![f64::NAN, 20.0],
        vec![100.0, f64::NAN],
        vec![f64::INFINITY, 20.0],
        vec![100.0, f64::INFINITY],
        vec![f64::NEG_INFINITY, 20.0],
        vec![100.0, f64::NEG_INFINITY],
        vec![100.0],
        vec![100.0, 20.0, 0.0],
    ] {
        assert_eq!(
            evaluate_builtin_function(BuiltinFunctionName::SpreadAngle, &args),
            invalid_argument()
        );
    }
}

#[test]
fn rejects_non_finite_trigonometric_inputs() {
    for name in [
        BuiltinFunctionName::Sin,
        BuiltinFunctionName::Cos,
        BuiltinFunctionName::Tan,
        BuiltinFunctionName::Asin,
        BuiltinFunctionName::Acos,
        BuiltinFunctionName::Atan,
    ] {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(
                evaluate_builtin_function(name, &[value]),
                invalid_argument()
            );
        }
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            evaluate_builtin_function(BuiltinFunctionName::Atan2, &[value, 1.0]),
            invalid_argument()
        );
        assert_eq!(
            evaluate_builtin_function(BuiltinFunctionName::Atan2, &[0.0, value]),
            invalid_argument()
        );
    }
}
