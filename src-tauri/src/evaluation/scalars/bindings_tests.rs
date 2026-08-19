//! Tests for `bindings.rs`'s `ScalarBindingResolver` - the Task 23 refactor
//! from a one-shot sweep to an on-demand, memoized resolver. Broader
//! whole-document coverage (binding resolution, poison propagation, evaluation limits)
//! stays in `scalar_program_integration_tests.rs`; these are focused on the
//! resolver's own new behavior: out-of-order resolution, memoization, and
//! the defense-in-depth cycle guard.

use std::collections::HashMap;

use super::bindings::{scalar_evaluation_json, ScalarBindingResolver};
use super::program_payload::{ValidatedScalarProgram, ValidatedScalarProgramStatement};
use super::types::{
    ScalarEvaluation, ScalarEvaluationErrorContext, ScalarSpan, ScalarType, ScalarValue,
    TypedScalarExpression,
};
use crate::evaluation::types::EvaluationState;

const SPAN: ScalarSpan = ScalarSpan { start: 0, end: 0 };

fn number_literal(value: f64) -> TypedScalarExpression {
    TypedScalarExpression::NumberLiteral {
        span: SPAN,
        value,
        r#type: ScalarType::Number,
    }
}

fn reference(name: &str, binding_id: &str) -> TypedScalarExpression {
    TypedScalarExpression::Reference {
        span: SPAN,
        name_span: SPAN,
        name: name.to_owned(),
        binding_id: Some(binding_id.to_owned()),
        r#type: Some(ScalarType::Number),
    }
}

fn declare(
    binding_id: &str,
    source_order: usize,
    initializer: TypedScalarExpression,
) -> ValidatedScalarProgramStatement {
    ValidatedScalarProgramStatement {
        binding_id: binding_id.to_owned(),
        source_order,
        declared_type: ScalarType::Number,
        initializer: Ok(initializer),
    }
}

fn program(statements: Vec<ValidatedScalarProgramStatement>) -> ValidatedScalarProgram {
    ValidatedScalarProgram {
        statements,
        evaluation_limit_source_order: None,
        post_stop_binding_ids: std::collections::HashSet::new(),
    }
}

fn empty_state() -> EvaluationState {
    EvaluationState {
        elements: Vec::new(),
        elements_by_id: HashMap::new(),
        drawing_modifiers: serde_json::json!([]),
        group_states: HashMap::new(),
        computed_geometry: HashMap::new(),
        computed_geometry_order: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    }
}

#[test]
fn resolves_bindings_out_of_array_order_and_caches_each_at_most_once() {
    let program = program(vec![
        declare("binding:a", 0, number_literal(10.0)),
        declare("binding:b", 1, reference("a", "binding:a")),
        declare("binding:c", 2, reference("b", "binding:b")),
    ]);
    let state = empty_state();
    let resolver = ScalarBindingResolver::new(&program);

    // Ask for "c" first - it recurses through "b" into "a" on demand.
    let c = resolver.resolve("binding:c", &state);
    match c {
        ScalarEvaluation::Ok { value, .. } => {
            assert_eq!(value, ScalarValue::Number(10.0));
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // Re-asking for "a" must hit the cache (same value, and importantly
    // this must not panic from a re-entrant RefCell borrow).
    let a = resolver.resolve("binding:a", &state);
    match a {
        ScalarEvaluation::Ok { value, .. } => {
            assert_eq!(value, ScalarValue::Number(10.0));
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn finalize_output_order_matches_program_statements_order_even_when_resolved_out_of_order_first() {
    let program = program(vec![
        declare("binding:a", 0, number_literal(1.0)),
        declare("binding:b", 1, number_literal(2.0)),
        declare("binding:c", 2, number_literal(3.0)),
    ]);
    let state = empty_state();
    let resolver = ScalarBindingResolver::new(&program);

    // Force "c" to be cached before finalize ever walks the array.
    resolver.resolve("binding:c", &state);

    let output = resolver.finalize(&state);
    let binding_ids: Vec<&str> = output
        .iter()
        .map(|entry| entry["bindingId"].as_str().unwrap())
        .collect();
    assert_eq!(binding_ids, vec!["binding:a", "binding:b", "binding:c"]);
}

#[test]
fn returns_a_cycle_guard_error_instead_of_infinite_recursing_on_a_synthetic_cyclic_program() {
    let program = program(vec![
        declare("binding:a", 0, reference("b", "binding:b")),
        declare("binding:b", 1, reference("a", "binding:a")),
    ]);
    let state = empty_state();
    let resolver = ScalarBindingResolver::new(&program);

    let result = resolver.resolve("binding:a", &state);
    match result {
        ScalarEvaluation::Error { issue_code, .. } => {
            assert_eq!(issue_code, "evaluation-binding-cycle-guard");
        }
        other => panic!("expected a cycle-guard error, got {other:?}"),
    }
}

#[test]
fn scalar_evaluation_json_round_trips_geometry_builtin_target_context() {
    let evaluation = ScalarEvaluation::Error {
        r#type: ScalarType::Number,
        issue_code: "evaluation-geometry-builtin-disabled".to_owned(),
        binding_id: None,
        context: Some(ScalarEvaluationErrorContext::GeometryBuiltinTarget {
            target_element_id: "shoulder".to_owned(),
            point_key: Some("start".to_owned()),
        }),
    };
    let payload = scalar_evaluation_json(&evaluation);
    assert_eq!(payload["context"]["kind"], "geometryBuiltinTarget");
    assert_eq!(payload["context"]["targetElementId"], "shoulder");
    assert_eq!(payload["context"]["pointKey"], "start");
    assert_eq!(
        super::scalar_payload::decode_scalar_evaluation(&payload).unwrap(),
        evaluation
    );
}
