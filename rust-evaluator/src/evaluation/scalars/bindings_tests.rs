//! Tests for `bindings.rs`'s `ScalarBindingResolver` - the Task 23 refactor
//! from a one-shot sweep to an on-demand, memoized resolver. Broader
//! whole-document coverage (binding resolution and poison propagation)
//! stays in `scalar_program_integration_tests.rs`; these are focused on the
//! resolver's own new behavior: out-of-order resolution, memoization, and
//! the defense-in-depth cycle guard.

use std::collections::HashMap;

use super::bindings::{scalar_evaluation_json, ScalarBindingResolver};
use super::program_payload::{ValidatedScalarProgram, ValidatedScalarProgramStatement};
use super::types::{
    ScalarEvaluation, ScalarEvaluationErrorContext, ScalarExpressionResolvedOptionalMemberTarget,
    ScalarSpan, ScalarType, ScalarValue, TypedScalarExpression,
};
use crate::evaluation::scalar_expression_runtime;
use crate::evaluation::types::{EvaluationState, GeometryInputCollectionNode, GeometryInputTarget};

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

fn optional_collection_length(collection_value_id: &str) -> TypedScalarExpression {
    TypedScalarExpression::OptionalMember {
        span: SPAN,
        receiver_span: SPAN,
        operator_span: SPAN,
        member_span: SPAN,
        member: "length".to_owned(),
        target: Some(
            ScalarExpressionResolvedOptionalMemberTarget::CollectionLength {
                collection_value_id: collection_value_id.to_owned(),
                collection_length: None,
                target_source_order: 0.0,
            },
        ),
        r#type: Some(ScalarType::Optional {
            value_type: Box::new(ScalarType::Number),
        }),
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
        collection_values: Vec::new(),
    }
}

fn empty_state() -> EvaluationState {
    EvaluationState {
        completed_transformation_recipe_indices: std::collections::HashSet::new(),
        transformation_dependency_plans: None,
        geometry_input_targets: HashMap::new(),
        geometry_collection_nodes: HashMap::new(),
        geometry_value_binders: HashMap::new(),
        for_group_generated_rows: Vec::new(),
        for_group_expected_occurrence_count_by_template_id: HashMap::new(),
        elements: Vec::new(),
        elements_by_id: HashMap::new(),
        drawing_modifiers: serde_json::json!([]),
        selected_drawing_profile_id: None,
        group_states: HashMap::new(),
        computed_geometry: HashMap::new(),
        base_transformation_geometry: HashMap::new(),
        transformation_stage_geometry: HashMap::new(),
        computed_geometry_values: HashMap::new(),
        computed_geometry_order: Vec::new(),
        pre_mutation_geometry: HashMap::new(),
        geometry_mutation_executions: Vec::new(),
        condition_evaluation_traces: Vec::new(),
        instance_base_geometry: HashMap::new(),
        errors: Vec::new(),
        geometry_value_errors: Vec::new(),
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
fn scalar_geometry_property_stage_selection_uses_selected_snapshot() {
    let geometry_property =
        |stage_path: Option<Vec<String>>, property: &str| TypedScalarExpression::GeometryProperty {
            span: SPAN,
            element_name_span: SPAN,
            property_span: SPAN,
            element_name: "A".to_owned(),
            element_id: "element:A".to_owned(),
            collection_value_id: None,
            collection_length: None,
            stage_path,
            geometry_value_occurrence: None,
            geometry_value_binder_id: None,
            for_group_template_element_id: None,
            for_group_target_source_order: None,
            for_group_index: None,
            geometry_value_point_key: None,
            property: property.to_owned(),
            target_source_order: 0.0,
            r#type: ScalarType::Number,
        };
    let program = program(vec![
        declare(
            "binding:base-length",
            1,
            geometry_property(Some(vec!["base".to_owned()]), "length"),
        ),
        declare(
            "binding:named-length",
            2,
            geometry_property(Some(vec!["first".to_owned()]), "length"),
        ),
        declare(
            "binding:explicit-final-length",
            3,
            geometry_property(Some(vec!["final".to_owned()]), "length"),
        ),
        declare(
            "binding:implicit-final-length",
            4,
            geometry_property(None, "length"),
        ),
        declare(
            "binding:base-endpoint-x",
            5,
            geometry_property(Some(vec!["base".to_owned()]), "endPoint.x"),
        ),
        declare(
            "binding:named-endpoint-x",
            6,
            geometry_property(Some(vec!["first".to_owned()]), "endPoint.x"),
        ),
        declare(
            "binding:final-endpoint-x",
            7,
            geometry_property(Some(vec!["final".to_owned()]), "endPoint.x"),
        ),
    ]);
    let resolver = ScalarBindingResolver::new(&program);
    let mut state = empty_state();
    state.base_transformation_geometry.insert(
        "element:A".to_owned(),
        serde_json::json!({
            "kind": "line",
            "start": {"x": 0.0, "y": 0.0},
            "end": {"x": 10.0, "y": 0.0},
            "length": 10.0
        }),
    );
    state.transformation_stage_geometry.insert(
        "element:A\u{0}*\u{0}first".to_owned(),
        serde_json::json!({
            "kind": "line",
            "start": {"x": 5.0, "y": 0.0},
            "end": {"x": 25.0, "y": 0.0},
            "length": 20.0
        }),
    );
    state.computed_geometry.insert(
        "element:A".to_owned(),
        serde_json::json!({
            "kind": "line",
            "start": {"x": 20.0, "y": 0.0},
            "end": {"x": 60.0, "y": 0.0},
            "length": 40.0
        }),
    );

    for (binding_id, expected) in [
        ("binding:base-length", 10.0),
        ("binding:named-length", 20.0),
        ("binding:explicit-final-length", 40.0),
        ("binding:implicit-final-length", 40.0),
        ("binding:base-endpoint-x", 10.0),
        ("binding:named-endpoint-x", 25.0),
        ("binding:final-endpoint-x", 60.0),
    ] {
        assert_eq!(
            resolver.resolve(binding_id, &state),
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(expected),
            },
            "unexpected result for {binding_id}"
        );
    }
}

#[test]
fn geometry_collection_match_selects_optional_some_and_none_arms() {
    let program = program(Vec::new());
    let resolver = ScalarBindingResolver::new(&program);
    let mut state = empty_state();
    let none_scrutinee = optional_collection_length("absent-source");
    let some_scrutinee = optional_collection_length("present-source");
    state.geometry_collection_nodes.insert(
        "absent-source".to_owned(),
        GeometryInputCollectionNode::None,
    );
    state.geometry_collection_nodes.insert(
        "present-source".to_owned(),
        GeometryInputCollectionNode::Leaf {
            targets: Vec::new(),
        },
    );
    for (value_id, scrutinee, expected_length) in [
        ("absent-result", none_scrutinee, Some(1.0)),
        ("present-result", some_scrutinee, Some(2.0)),
    ] {
        state.geometry_collection_nodes.insert(
            value_id.to_owned(),
            GeometryInputCollectionNode::Match {
                scrutinee,
                source_order: 1.0,
                arms: vec![
                    (
                        "none".to_owned(),
                        GeometryInputCollectionNode::Leaf {
                            targets: vec![GeometryInputTarget::Coordinate {
                                anchor: serde_json::json!({"x": 1.0, "y": 1.0}),
                            }],
                        },
                    ),
                    (
                        "some".to_owned(),
                        GeometryInputCollectionNode::Leaf {
                            targets: vec![
                                GeometryInputTarget::Coordinate {
                                    anchor: serde_json::json!({"x": 2.0, "y": 2.0}),
                                },
                                GeometryInputTarget::Coordinate {
                                    anchor: serde_json::json!({"x": 3.0, "y": 3.0}),
                                },
                            ],
                        },
                    ),
                ],
            },
        );
        assert_eq!(
            scalar_expression_runtime::lookup_geometry_collection_length(
                &state,
                &resolver,
                value_id,
                &mut std::collections::HashSet::new(),
            ),
            expected_length
        );
    }
}

#[test]
fn geometry_collection_optional_match_selects_indexed_some_and_none_members() {
    let program = program(Vec::new());
    let resolver = ScalarBindingResolver::new(&program);
    let mut state = empty_state();
    state.geometry_collection_nodes.insert(
        "absent-source".to_owned(),
        GeometryInputCollectionNode::None,
    );
    state.geometry_collection_nodes.insert(
        "present-source".to_owned(),
        GeometryInputCollectionNode::Leaf {
            targets: vec![GeometryInputTarget::Coordinate {
                anchor: serde_json::json!({"x": 7.0, "y": 8.0}),
            }],
        },
    );

    for (value_id, scrutinee, expected_x) in [
        ("absent-result", "absent-source", 1.0),
        ("present-result", "present-source", 7.0),
    ] {
        state.geometry_collection_nodes.insert(
            value_id.to_owned(),
            GeometryInputCollectionNode::Match {
                scrutinee: optional_collection_length(scrutinee),
                source_order: 1.0,
                arms: vec![
                    (
                        "none".to_owned(),
                        GeometryInputCollectionNode::Leaf {
                            targets: vec![GeometryInputTarget::Coordinate {
                                anchor: serde_json::json!({"x": 1.0, "y": 2.0}),
                            }],
                        },
                    ),
                    (
                        "some".to_owned(),
                        GeometryInputCollectionNode::Leaf {
                            targets: vec![GeometryInputTarget::Coordinate {
                                anchor: serde_json::json!({"x": 7.0, "y": 8.0}),
                            }],
                        },
                    ),
                ],
            },
        );

        let target =
            super::super::line_geometry_input::resolve_geometry_collection_iteration_member(
                &state, &resolver, value_id, 0,
            )
            .expect("optional geometry collection match selects a member");
        match target {
            GeometryInputTarget::Coordinate { anchor } => {
                assert_eq!(anchor["x"], expected_x);
            }
            other => panic!("expected coordinate target, got {other:?}"),
        }
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
