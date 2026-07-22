//! Tests for `numeric_function_adapter.rs`. Mirrors
//! `src/scalars/numericFunctionAdapter.test.ts` (Task 16): proves the
//! adapter's result-consistency contract against the real, unmodified
//! legacy Rust numeric evaluator (`numeric_value`) - without wiring the
//! adapter into `expression_evaluator.rs` or any production path.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::super::numeric_expression::numeric_value;
use super::super::types::{EvaluationState, NumericEvalError};
use super::numeric_function_adapter::adapt_numeric_result;
use super::types::{ScalarEvaluation, ScalarType, ScalarValue};

// --- adapter unit tests: synthetic Ok/Err, no geometry needed -------------

#[test]
fn adapts_an_ok_result_to_a_number_scalar_evaluation() {
    let adapted = adapt_numeric_result(Ok(5.0), None);
    assert_eq!(
        adapted,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(5.0),
        }
    );
}

#[test]
fn adapts_an_error_result_with_a_binding_id() {
    let error = NumericEvalError {
        dependency_id: "zline".to_owned(),
        dependency_name: Some("ゼロ線".to_owned()),
        message: "ゼロ線 は長さ0のため点線距離を計算できません。".to_owned(),
    };
    let adapted = adapt_numeric_result(Err(error), Some("binding:zline".to_owned()));
    assert_eq!(
        adapted,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-numeric-adapter-failure".to_owned(),
            binding_id: Some("binding:zline".to_owned()),
        }
    );
}

#[test]
fn omits_binding_id_when_none_given() {
    let error = NumericEvalError {
        dependency_id: "x".to_owned(),
        dependency_name: None,
        message: "数値が必要です。".to_owned(),
    };
    let adapted = adapt_numeric_result(Err(error), None);
    assert_eq!(
        adapted,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-numeric-adapter-failure".to_owned(),
            binding_id: None,
        }
    );
}

// --- consistency with the real, unmodified legacy evaluator ---------------
//
// Mirrors numericFunctionAdapter.test.ts's own three cases exactly: a
// distance(a, b) success, a lineDistance(p, vline) success, and a zero-length
// lineDistance(p, zline) failure (the legacy 1e-9 EPSILON guard,
// numeric_expression.rs's `lineDistance` branch). `elements`/`elements_by_id`
// are left empty - `distance`/`lineDistance` resolve purely through
// `computed_geometry` (confirmed by reading `point_value`/the `lineDistance`
// branch directly), so no element/id-index setup is needed for this path.

fn state_with_geometry(computed_geometry: HashMap<String, Value>) -> EvaluationState {
    EvaluationState {
        elements: Vec::new(),
        elements_by_id: HashMap::new(),
        group_states: HashMap::new(),
        computed_geometry,
        computed_geometry_order: Vec::new(),
        computed_variables: HashMap::new(),
        computed_variable_order: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn base_geometry() -> HashMap<String, Value> {
    let mut geometry = HashMap::new();

    // 3-4-5 triangle for distance(a, b) == 5.
    geometry.insert(
        "a".to_owned(),
        json!({ "kind": "point", "elementId": "a", "name": "点A", "x": 0.0, "y": 0.0 }),
    );
    geometry.insert(
        "b".to_owned(),
        json!({ "kind": "point", "elementId": "b", "name": "点B", "x": 3.0, "y": 4.0 }),
    );

    // p + vertical line vline for lineDistance(p, vline) == 5.
    geometry.insert(
        "p".to_owned(),
        json!({ "kind": "point", "elementId": "p", "name": "点P", "x": 5.0, "y": 5.0 }),
    );
    geometry.insert(
        "vline".to_owned(),
        json!({
            "kind": "line",
            "elementId": "vline",
            "name": "縦線",
            "startPointId": "o",
            "endPointId": "o2",
            "start": { "kind": "point", "elementId": "o", "name": "原点", "x": 0.0, "y": 0.0 },
            "end": { "kind": "point", "elementId": "o2", "name": "終点", "x": 0.0, "y": 10.0 },
            "length": 10.0,
            "startAngleDeg": 90.0,
            "endAngleDeg": 270.0,
            "startTangentAngleDeg": 90.0,
            "endTangentAngleDeg": 270.0
        }),
    );

    // Degenerate zero-length line to trigger the 1e-9 EPSILON guard.
    geometry.insert(
        "zline".to_owned(),
        json!({
            "kind": "line",
            "elementId": "zline",
            "name": "ゼロ線",
            "startPointId": "o",
            "endPointId": "o",
            "start": { "kind": "point", "elementId": "o", "name": "原点", "x": 0.0, "y": 0.0 },
            "end": { "kind": "point", "elementId": "o", "name": "原点", "x": 0.0, "y": 0.0 },
            "length": 0.0,
            "startAngleDeg": 0.0,
            "endAngleDeg": 0.0,
            "startTangentAngleDeg": 0.0,
            "endTangentAngleDeg": 0.0
        }),
    );

    geometry
}

#[test]
fn wraps_a_successful_distance_result_unchanged() {
    let state = state_with_geometry(base_geometry());
    let element = json!({ "id": "caller", "name": "呼び出し元" });
    let local_variables: HashMap<String, f64> = HashMap::new();
    let local_variable_names: HashMap<String, String> = HashMap::new();

    let value = json!({ "expression": "distance(a, b)" });
    let result = numeric_value(
        &value,
        &state,
        &element,
        &local_variables,
        &local_variable_names,
    );
    assert_eq!(result.as_ref().ok().copied(), Some(5.0));

    let adapted = adapt_numeric_result(result, None);
    assert_eq!(
        adapted,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(5.0),
        }
    );
}

#[test]
fn wraps_a_successful_line_distance_result_unchanged() {
    let state = state_with_geometry(base_geometry());
    let element = json!({ "id": "caller", "name": "呼び出し元" });
    let local_variables: HashMap<String, f64> = HashMap::new();
    let local_variable_names: HashMap<String, String> = HashMap::new();

    let value = json!({ "expression": "lineDistance(p, vline)" });
    let result = numeric_value(
        &value,
        &state,
        &element,
        &local_variables,
        &local_variable_names,
    );
    assert_eq!(result.as_ref().ok().copied(), Some(5.0));

    let adapted = adapt_numeric_result(result, None);
    assert_eq!(
        adapted,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(5.0),
        }
    );
}

#[test]
fn maps_a_zero_length_line_distance_failure_to_a_typed_error() {
    let state = state_with_geometry(base_geometry());
    let element = json!({ "id": "caller", "name": "呼び出し元" });
    let local_variables: HashMap<String, f64> = HashMap::new();
    let local_variable_names: HashMap<String, String> = HashMap::new();

    let value = json!({ "expression": "lineDistance(p, zline)" });
    let result = numeric_value(
        &value,
        &state,
        &element,
        &local_variables,
        &local_variable_names,
    );
    assert!(
        result.is_err(),
        "expected the zero-length-line EPSILON guard to fire"
    );

    let adapted = adapt_numeric_result(result, Some("binding:zline".to_owned()));
    assert_eq!(
        adapted,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-numeric-adapter-failure".to_owned(),
            binding_id: Some("binding:zline".to_owned()),
        }
    );
}
