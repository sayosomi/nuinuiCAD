use std::collections::{HashMap, HashSet};

use super::super::mutation_payload::ValidatedBindingVersions;
use super::super::mutation_payload::{
    InitialState, ValidatedBindingVersion, ValidatedBindingVersionKind,
};
use super::super::program_payload::{
    ValidatedScalarProgramCollection, ValidatedScalarProgramCollectionMember,
    ValidatedScalarProgramCollectionValue, ValidatedScalarProgramRecordField,
};
use super::super::types::{
    ScalarEvaluation, ScalarExpressionRecordFieldTarget,
    ScalarExpressionResolvedOptionalMemberTarget, ScalarSpan, ScalarType, ScalarValue,
    TypedScalarExpression,
};
use super::for_group_scheduler::resolve_collection_carry_snapshot;
use super::{
    CollectionCarrySnapshot, DependencyBindingSchedule, MutationEnvironment, ScalarMutationResolver,
};
use crate::evaluation::scalars::expression_evaluator::ScalarEvaluationEnvironment;
use crate::evaluation::scalars::mutation_payload::ValidatedImmutableForGroupPlan;
use crate::evaluation::types::{EvaluationState, GeometryInputCollectionNode, GeometryInputTarget};

const SPAN: ScalarSpan = ScalarSpan { start: 0, end: 0 };

fn evaluation_state() -> EvaluationState {
    EvaluationState {
        elements: Vec::new(),
        elements_by_id: HashMap::new(),
        drawing_modifiers: serde_json::json!([]),
        selected_drawing_profile_id: None,
        group_states: HashMap::new(),
        computed_geometry: HashMap::new(),
        base_transformation_geometry: HashMap::new(),
        transformation_stage_geometry: HashMap::new(),
        completed_transformation_recipe_indices: HashSet::new(),
        transformation_dependency_plans: None,
        computed_geometry_order: Vec::new(),
        computed_geometry_values: HashMap::new(),
        geometry_input_targets: HashMap::new(),
        geometry_collection_nodes: HashMap::new(),
        geometry_value_binders: HashMap::new(),
        for_group_generated_rows: Vec::new(),
        for_group_expected_occurrence_count_by_template_id: HashMap::new(),
        pre_mutation_geometry: HashMap::new(),
        geometry_mutation_executions: Vec::new(),
        condition_evaluation_traces: Vec::new(),
        instance_base_geometry: HashMap::new(),
        errors: Vec::new(),
        geometry_value_errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn binding_versions(
    collection_values: Vec<ValidatedScalarProgramCollection>,
) -> ValidatedBindingVersions {
    let binding_ids = ["field:x".to_owned()].into_iter().collect();
    ValidatedBindingVersions {
        versions: Vec::new(),
        binding_ids,
        declared_types: HashMap::new(),
        element_source_orders: HashMap::new(),
        conditional_owners_by_element_id: HashMap::new(),
        for_group_owners_by_element_id: HashMap::new(),
        collection_values,
        immutable_for_groups: HashMap::<String, ValidatedImmutableForGroupPlan>::new(),
    }
}

fn number_collection(value_id: &str, values: &[f64]) -> ValidatedScalarProgramCollection {
    ValidatedScalarProgramCollection {
        value_id: value_id.to_owned(),
        value: ValidatedScalarProgramCollectionValue::Literal(
            values
                .iter()
                .map(|value| ValidatedScalarProgramCollectionMember::Literal {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(*value),
                })
                .collect(),
        ),
    }
}

fn record_collection(value_id: &str) -> ValidatedScalarProgramCollection {
    ValidatedScalarProgramCollection {
        value_id: value_id.to_owned(),
        value: ValidatedScalarProgramCollectionValue::Literal(vec![
            ValidatedScalarProgramCollectionMember::Record {
                type_identity: "Pair".to_owned(),
                fields: vec![ValidatedScalarProgramRecordField {
                    record_statement_id: "Pair".to_owned(),
                    field_index: 0,
                    r#type: ScalarType::Number,
                    binding_id: "field:x".to_owned(),
                    field_path: None,
                }],
            },
        ]),
    }
}

fn optional_number_type() -> ScalarType {
    ScalarType::Optional {
        value_type: Box::new(ScalarType::Number),
    }
}

fn collection_length_target(
    value_id: &str,
    target_source_order: f64,
) -> ScalarExpressionResolvedOptionalMemberTarget {
    ScalarExpressionResolvedOptionalMemberTarget::CollectionLength {
        collection_value_id: value_id.to_owned(),
        collection_length: None,
        target_source_order,
    }
}

fn record_field_target(
    value_id: &str,
    target_source_order: f64,
) -> ScalarExpressionResolvedOptionalMemberTarget {
    ScalarExpressionResolvedOptionalMemberTarget::RecordField {
        collection_value_id: value_id.to_owned(),
        collection_length: Some(1.0),
        target_source_order,
        field: ScalarExpressionRecordFieldTarget {
            record_statement_id: "Pair".to_owned(),
            field_index: 0,
            r#type: ScalarType::Number,
            field_path: Vec::new(),
        },
    }
}

fn lookup_optional_member(
    resolver: &ScalarMutationResolver<'_>,
    state: &EvaluationState,
    target: &ScalarExpressionResolvedOptionalMemberTarget,
    source_order: f64,
) -> ScalarEvaluation {
    let environment = MutationEnvironment {
        resolver,
        state,
        source_order,
        local_binding_id: None,
        local_binding: None,
        local_bindings: None,
        record_map_context: None,
    };
    environment.lookup_optional_member(target, &optional_number_type())
}

fn assert_number(result: ScalarEvaluation, expected: f64) {
    match result {
        ScalarEvaluation::Ok {
            value: ScalarValue::Number(actual),
            ..
        } => assert_eq!(actual, expected),
        other => panic!("expected optional number {expected}, got {other:?}"),
    }
}

fn assert_none(result: ScalarEvaluation) {
    match result {
        ScalarEvaluation::Ok {
            value: ScalarValue::None,
            ..
        } => {}
        other => panic!("expected optional none, got {other:?}"),
    }
}

fn assert_issue(result: ScalarEvaluation, expected: &str) {
    match result {
        ScalarEvaluation::Error { issue_code, .. } => assert_eq!(issue_code, expected),
        other => panic!("expected error {expected}, got {other:?}"),
    }
}

#[test]
fn collection_carry_snapshot_selects_if_branch_before_iteration_scope_exits() {
    let collection_values = vec![
        ValidatedScalarProgramCollection {
            value_id: "if-value".to_owned(),
            value: ValidatedScalarProgramCollectionValue::If {
                condition: Box::new(TypedScalarExpression::BooleanLiteral {
                    span: SPAN,
                    value: true,
                    r#type: ScalarType::Boolean,
                }),
                then_value_id: "then-alias".to_owned(),
                else_value_id: "else-terminal".to_owned(),
                source_order: 12.0,
            },
        },
        ValidatedScalarProgramCollection {
            value_id: "then-alias".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Alias("selected-terminal".to_owned()),
        },
        number_collection("selected-terminal", &[7.0, 8.0]),
        number_collection("else-terminal", &[3.0]),
    ];
    let redirects = HashMap::from([
        (
            "carry-next".to_owned(),
            CollectionCarrySnapshot {
                value_id: "redirected-if".to_owned(),
                local_bindings: HashMap::new(),
                error: None,
            },
        ),
        (
            "redirected-if".to_owned(),
            CollectionCarrySnapshot {
                value_id: "if-value".to_owned(),
                local_bindings: HashMap::new(),
                error: None,
            },
        ),
    ]);

    let selected = resolve_collection_carry_snapshot(
        "carry-next",
        &redirects,
        &collection_values,
        &HashMap::new(),
        |condition, source_order, _| {
            assert_eq!(source_order, 12.0);
            match condition {
                TypedScalarExpression::BooleanLiteral {
                    value,
                    r#type: ScalarType::Boolean,
                    ..
                } => ScalarEvaluation::Ok {
                    r#type: ScalarType::Boolean,
                    value: ScalarValue::Boolean(*value),
                },
                _ => ScalarEvaluation::Error {
                    r#type: ScalarType::Boolean,
                    issue_code: "evaluation-binding-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                },
            }
        },
    );
    assert_eq!(
        selected.as_ref().map(|snapshot| snapshot.value_id.as_str()),
        Some("selected-terminal")
    );
    assert!(selected.unwrap().local_bindings.is_empty());

    let unresolved = resolve_collection_carry_snapshot(
        "carry-next",
        &redirects,
        &collection_values,
        &HashMap::new(),
        |_, _, _| ScalarEvaluation::Error {
            r#type: ScalarType::Boolean,
            issue_code: "evaluation-remainder-by-zero".to_owned(),
            binding_id: Some("binding:condition".to_owned()),
            context: None,
        },
    )
    .expect("a failed condition remains a committed snapshot");
    assert_eq!(unresolved.value_id, "if-value");
    assert_eq!(
        unresolved.error,
        Some(ScalarEvaluation::Error {
            r#type: ScalarType::Boolean,
            issue_code: "evaluation-remainder-by-zero".to_owned(),
            binding_id: Some("binding:condition".to_owned()),
            context: None,
        })
    );
}

#[test]
fn collection_carry_snapshot_redirects_preserve_committed_errors_and_local_bindings() {
    let captured = ScalarEvaluation::Ok {
        r#type: ScalarType::Number,
        value: ScalarValue::Number(19.0),
    };
    let error = ScalarEvaluation::Error {
        r#type: ScalarType::Boolean,
        issue_code: "evaluation-remainder-by-zero".to_owned(),
        binding_id: Some("binding:decision".to_owned()),
        context: None,
    };
    let redirects = HashMap::from([
        (
            "outer-carry".to_owned(),
            CollectionCarrySnapshot {
                value_id: "inner-carry".to_owned(),
                local_bindings: HashMap::new(),
                error: None,
            },
        ),
        (
            "inner-carry".to_owned(),
            CollectionCarrySnapshot {
                value_id: "failed-if".to_owned(),
                local_bindings: HashMap::from([("captured".to_owned(), captured.clone())]),
                error: Some(error.clone()),
            },
        ),
    ]);

    let resolved = resolve_collection_carry_snapshot(
        "outer-carry",
        &redirects,
        &[],
        &HashMap::new(),
        |_, _, _| panic!("a committed error must not re-evaluate its decision"),
    )
    .expect("redirected failure is a committed carry snapshot");

    assert_eq!(resolved.value_id, "failed-if");
    assert_eq!(resolved.error, Some(error));
    assert_eq!(resolved.local_bindings.get("captured"), Some(&captured));
}

#[test]
fn collection_carry_consumers_return_the_committed_error_before_unavailable() {
    let program = binding_versions(vec![number_collection("literal", &[1.0])]);
    let mut resolver = ScalarMutationResolver::new(&program);
    let error = ScalarEvaluation::Error {
        r#type: ScalarType::Boolean,
        issue_code: "evaluation-remainder-by-zero".to_owned(),
        binding_id: Some("binding:decision".to_owned()),
        context: None,
    };
    resolver.collection_carry_snapshots.insert(
        "carry".to_owned(),
        CollectionCarrySnapshot {
            value_id: "redirect".to_owned(),
            local_bindings: HashMap::new(),
            error: None,
        },
    );
    resolver.collection_carry_snapshots.insert(
        "redirect".to_owned(),
        CollectionCarrySnapshot {
            value_id: "literal".to_owned(),
            local_bindings: HashMap::new(),
            error: Some(error.clone()),
        },
    );
    let state = evaluation_state();

    let index = resolver.resolve_collection_index_with_bindings(
        "carry",
        0.0,
        &ScalarType::Number,
        None,
        &state,
        &HashMap::new(),
    );
    assert_eq!(
        index,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-remainder-by-zero".to_owned(),
            binding_id: Some("binding:decision".to_owned()),
            context: None,
        }
    );
    assert_eq!(
        resolver.resolve_collection_length_with_bindings(
            "carry",
            &state,
            &mut HashSet::new(),
            &HashMap::new(),
        ),
        Err(error.clone())
    );
    assert_eq!(
        lookup_optional_member(
            &resolver,
            &state,
            &collection_length_target("carry", 0.0),
            0.0
        ),
        ScalarEvaluation::Error {
            r#type: optional_number_type(),
            issue_code: "evaluation-remainder-by-zero".to_owned(),
            binding_id: Some("binding:decision".to_owned()),
            context: None,
        }
    );
}

#[test]
fn collection_carry_snapshot_selects_only_the_active_match_arm_through_aliases() {
    let choice_type = ScalarType::Choice {
        options: vec!["left".to_owned(), "right".to_owned()],
    };
    let collection_values = vec![
        ValidatedScalarProgramCollection {
            value_id: "match-value".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Match {
                scrutinee: Box::new(TypedScalarExpression::ChoiceLiteral {
                    span: SPAN,
                    value: "right".to_owned(),
                    r#type: Some(choice_type),
                }),
                arms: vec![
                    super::super::program_payload::ValidatedScalarProgramMatchArm {
                        label: "left".to_owned(),
                        value_id: "unselected-if".to_owned(),
                        binder_id: None,
                        binder_type: None,
                        collection_binder_id: None,
                    },
                    super::super::program_payload::ValidatedScalarProgramMatchArm {
                        label: "right".to_owned(),
                        value_id: "selected-alias".to_owned(),
                        binder_id: None,
                        binder_type: None,
                        collection_binder_id: None,
                    },
                ],
                source_order: 12.0,
            },
        },
        ValidatedScalarProgramCollection {
            value_id: "unselected-if".to_owned(),
            value: ValidatedScalarProgramCollectionValue::If {
                condition: Box::new(TypedScalarExpression::BooleanLiteral {
                    span: SPAN,
                    value: true,
                    r#type: ScalarType::Boolean,
                }),
                then_value_id: "unselected-terminal".to_owned(),
                else_value_id: "unselected-other".to_owned(),
                source_order: 13.0,
            },
        },
        ValidatedScalarProgramCollection {
            value_id: "selected-alias".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Alias("selected-terminal".to_owned()),
        },
        number_collection("selected-terminal", &[7.0, 8.0]),
        number_collection("unselected-terminal", &[3.0]),
        number_collection("unselected-other", &[4.0]),
    ];
    let redirects = HashMap::from([
        (
            "carry-next".to_owned(),
            CollectionCarrySnapshot {
                value_id: "redirected-match".to_owned(),
                local_bindings: HashMap::new(),
                error: None,
            },
        ),
        (
            "redirected-match".to_owned(),
            CollectionCarrySnapshot {
                value_id: "match-value".to_owned(),
                local_bindings: HashMap::new(),
                error: None,
            },
        ),
    ]);

    let selected = resolve_collection_carry_snapshot(
        "carry-next",
        &redirects,
        &collection_values,
        &HashMap::new(),
        |scrutinee, source_order, _| {
            assert_eq!(source_order, 12.0);
            match scrutinee {
                TypedScalarExpression::ChoiceLiteral {
                    value,
                    r#type: Some(ScalarType::Choice { options }),
                    ..
                } => ScalarEvaluation::Ok {
                    r#type: ScalarType::Choice {
                        options: options.clone(),
                    },
                    value: ScalarValue::Choice {
                        value: value.clone(),
                        options: options.clone(),
                    },
                },
                other => panic!("expected typed choice scrutinee, got {other:?}"),
            }
        },
    );
    assert_eq!(
        selected.as_ref().map(|snapshot| snapshot.value_id.as_str()),
        Some("selected-terminal")
    );
    assert!(selected.unwrap().local_bindings.is_empty());

    let failed_selection = resolve_collection_carry_snapshot(
        "carry-next",
        &redirects,
        &collection_values,
        &HashMap::new(),
        |_, _, _| ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-divide-by-zero".to_owned(),
            binding_id: Some("binding:scrutinee".to_owned()),
            context: None,
        },
    )
    .expect("a failed match scrutinee remains a committed snapshot");
    assert_eq!(failed_selection.value_id, "match-value");
    assert_eq!(
        failed_selection.error,
        Some(ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-divide-by-zero".to_owned(),
            binding_id: Some("binding:scrutinee".to_owned()),
            context: None,
        })
    );
}

#[test]
fn collection_carry_snapshot_captures_optional_some_binder_and_keeps_selected_path_lazy() {
    let optional_type = ScalarType::Optional {
        value_type: Box::new(ScalarType::Number),
    };
    let local_flag = ScalarEvaluation::Ok {
        r#type: ScalarType::Boolean,
        value: ScalarValue::Boolean(true),
    };
    let collection_values = vec![
        ValidatedScalarProgramCollection {
            value_id: "match-value".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Match {
                scrutinee: Box::new(TypedScalarExpression::Reference {
                    span: SPAN,
                    name_span: SPAN,
                    name: "optional".to_owned(),
                    binding_id: Some("optional".to_owned()),
                    r#type: Some(optional_type.clone()),
                }),
                arms: vec![
                    super::super::program_payload::ValidatedScalarProgramMatchArm {
                        label: "none".to_owned(),
                        value_id: "unselected-if".to_owned(),
                        binder_id: None,
                        binder_type: None,
                        collection_binder_id: None,
                    },
                    super::super::program_payload::ValidatedScalarProgramMatchArm {
                        label: "some".to_owned(),
                        value_id: "selected-alias".to_owned(),
                        binder_id: Some("some-x".to_owned()),
                        binder_type: Some(ScalarType::Number),
                        collection_binder_id: None,
                    },
                ],
                source_order: 17.0,
            },
        },
        ValidatedScalarProgramCollection {
            value_id: "unselected-if".to_owned(),
            value: ValidatedScalarProgramCollectionValue::If {
                condition: Box::new(TypedScalarExpression::BooleanLiteral {
                    span: SPAN,
                    value: false,
                    r#type: ScalarType::Boolean,
                }),
                then_value_id: "unselected-terminal".to_owned(),
                else_value_id: "unselected-terminal-2".to_owned(),
                source_order: 18.0,
            },
        },
        ValidatedScalarProgramCollection {
            value_id: "selected-alias".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Alias("selected-if".to_owned()),
        },
        ValidatedScalarProgramCollection {
            value_id: "selected-if".to_owned(),
            value: ValidatedScalarProgramCollectionValue::If {
                condition: Box::new(TypedScalarExpression::Reference {
                    span: SPAN,
                    name_span: SPAN,
                    name: "prior-flag".to_owned(),
                    binding_id: Some("prior-flag".to_owned()),
                    r#type: Some(ScalarType::Boolean),
                }),
                then_value_id: "selected-terminal".to_owned(),
                else_value_id: "wrong-terminal".to_owned(),
                source_order: 19.0,
            },
        },
        ValidatedScalarProgramCollection {
            value_id: "selected-terminal".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Literal(vec![
                ValidatedScalarProgramCollectionMember::Binding {
                    r#type: ScalarType::Number,
                    binding_id: "some-x".to_owned(),
                },
            ]),
        },
        number_collection("unselected-terminal", &[90.0]),
        number_collection("unselected-terminal-2", &[91.0]),
        number_collection("wrong-terminal", &[92.0]),
    ];
    let redirects = HashMap::from([(
        "carry-next".to_owned(),
        CollectionCarrySnapshot {
            value_id: "match-value".to_owned(),
            local_bindings: HashMap::from([("prior-flag".to_owned(), local_flag.clone())]),
            error: None,
        },
    )]);

    let selected = resolve_collection_carry_snapshot(
        "carry-next",
        &redirects,
        &collection_values,
        &HashMap::new(),
        |expression, source_order, local_bindings| match expression {
            TypedScalarExpression::Reference {
                binding_id: Some(binding_id),
                r#type: Some(r#type),
                ..
            } if binding_id == "optional" => ScalarEvaluation::Ok {
                r#type: r#type.clone(),
                value: ScalarValue::Number(7.0),
            },
            TypedScalarExpression::Reference {
                binding_id: Some(binding_id),
                r#type: Some(r#type),
                ..
            } if binding_id == "prior-flag" => {
                assert_eq!(source_order, 19.0);
                local_bindings
                    .get(binding_id)
                    .cloned()
                    .unwrap_or(ScalarEvaluation::Error {
                        r#type: r#type.clone(),
                        issue_code: "evaluation-binding-unavailable".to_owned(),
                        binding_id: Some(binding_id.clone()),
                        context: None,
                    })
            }
            TypedScalarExpression::BooleanLiteral { .. } => {
                panic!("unselected arm condition must remain lazy")
            }
            other => panic!("unexpected carry control expression: {other:?}"),
        },
    )
    .expect("selected optional arm should resolve");

    assert_eq!(selected.value_id, "selected-terminal");
    assert_eq!(selected.local_bindings.get("prior-flag"), Some(&local_flag));
    assert_eq!(
        selected.local_bindings.get("some-x"),
        Some(&ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(7.0),
        })
    );
}

#[test]
fn collection_carry_snapshot_captures_map_iteration_bindings_without_evaluating_body() {
    let number = |value| ScalarEvaluation::Ok {
        r#type: ScalarType::Number,
        value: ScalarValue::Number(value),
    };
    let collection_values = vec![
        ValidatedScalarProgramCollection {
            value_id: "mapped".to_owned(),
            value: ValidatedScalarProgramCollectionValue::Map {
                source_value_id: "source".to_owned(),
                source_element_type: ScalarType::Number,
                result_element_type: ScalarType::Number,
                binder_id: "map-binder".to_owned(),
                body: Box::new(TypedScalarExpression::Reference {
                    span: SPAN,
                    name_span: SPAN,
                    name: "i".to_owned(),
                    binding_id: Some("iteration".to_owned()),
                    r#type: Some(ScalarType::Number),
                }),
                source_order: 4,
            },
        },
        number_collection("source", &[1.0, 2.0]),
    ];
    let redirects = HashMap::from([(
        "carry-next".to_owned(),
        CollectionCarrySnapshot {
            value_id: "mapped".to_owned(),
            local_bindings: HashMap::from([("prior".to_owned(), number(99.0))]),
            error: None,
        },
    )]);
    let iteration_bindings = HashMap::from([
        ("iteration".to_owned(), number(2.0)),
        ("prior".to_owned(), number(3.0)),
        ("loop-local".to_owned(), number(12.0)),
        ("map-binder".to_owned(), number(100.0)),
    ]);

    let selected = resolve_collection_carry_snapshot(
        "carry-next",
        &redirects,
        &collection_values,
        &iteration_bindings,
        |_, _, _| panic!("map body must stay lazy during carry snapshot capture"),
    )
    .expect("mapped collection should retain its value identity");

    assert_eq!(selected.value_id, "mapped");
    assert_eq!(selected.local_bindings.get("iteration"), Some(&number(2.0)));
    assert_eq!(
        selected.local_bindings.get("loop-local"),
        Some(&number(12.0))
    );
    assert_eq!(selected.local_bindings.get("prior"), Some(&number(99.0)));
    assert!(!selected.local_bindings.contains_key("map-binder"));
}

fn number_reference(name: &str, binding_id: &str) -> TypedScalarExpression {
    TypedScalarExpression::Reference {
        span: SPAN,
        name_span: SPAN,
        name: name.to_owned(),
        binding_id: Some(binding_id.to_owned()),
        r#type: Some(ScalarType::Number),
    }
}

fn mutation_version(
    binding_id: &str,
    source_order: usize,
    initializer: TypedScalarExpression,
) -> ValidatedBindingVersion {
    ValidatedBindingVersion {
        version_id: binding_id.to_owned(),
        statement_id: binding_id.to_owned(),
        binding_id: binding_id.to_owned(),
        declared_type: ScalarType::Number,
        source_order,
        catalog_order: None,
        control: serde_json::json!({"ownerChain": []}),
        initial_state: InitialState::Uncomputed,
        kind: ValidatedBindingVersionKind::Declare {
            initializer: Some(initializer),
        },
    }
}

fn geometry_length_reference(element_name: &str, element_id: &str) -> TypedScalarExpression {
    TypedScalarExpression::GeometryProperty {
        span: SPAN,
        element_name_span: SPAN,
        property_span: SPAN,
        element_name: element_name.to_owned(),
        element_id: element_id.to_owned(),
        collection_value_id: None,
        collection_length: None,
        geometry_value_occurrence: None,
        geometry_value_binder_id: None,
        geometry_value_point_key: None,
        for_group_template_element_id: None,
        for_group_target_source_order: None,
        for_group_index: None,
        property: "length".to_owned(),
        stage_path: None,
        target_source_order: 0.0,
        r#type: ScalarType::Number,
    }
}

#[test]
fn dependency_scheduled_module_exports_remain_available_through_nested_forwarding_per_instance() {
    let binding_ids = [
        "binding:inner-20",
        "binding:outer-20",
        "binding:inner-40",
        "binding:outer-40",
        "binding:root-20",
        "binding:root-40",
    ];
    let versions = vec![
        mutation_version(
            binding_ids[0],
            1,
            geometry_length_reference("Shape20", "element:shape-20"),
        ),
        mutation_version(
            binding_ids[1],
            2,
            number_reference("Nested::value", binding_ids[0]),
        ),
        mutation_version(
            binding_ids[2],
            3,
            geometry_length_reference("Shape40", "element:shape-40"),
        ),
        mutation_version(
            binding_ids[3],
            4,
            number_reference("Nested::value", binding_ids[2]),
        ),
        mutation_version(
            binding_ids[4],
            5,
            number_reference("First::value", binding_ids[1]),
        ),
        mutation_version(
            binding_ids[5],
            6,
            number_reference("Second::value", binding_ids[3]),
        ),
    ];
    let declared_types = binding_ids
        .iter()
        .map(|binding_id| ((*binding_id).to_owned(), ScalarType::Number))
        .collect();
    let program = ValidatedBindingVersions {
        versions,
        binding_ids: binding_ids
            .iter()
            .map(|binding_id| (*binding_id).to_owned())
            .collect(),
        declared_types,
        element_source_orders: HashMap::new(),
        conditional_owners_by_element_id: HashMap::new(),
        for_group_owners_by_element_id: HashMap::new(),
        collection_values: Vec::new(),
        immutable_for_groups: HashMap::new(),
    };
    let mut state = evaluation_state();
    for (element_id, length) in [("element:shape-20", 20.0), ("element:shape-40", 40.0)] {
        state.computed_geometry.insert(
            element_id.to_owned(),
            serde_json::json!({"kind": "line", "length": length}),
        );
    }
    let execution_positions = binding_ids
        .iter()
        .enumerate()
        .map(|(rank, binding_id)| ((*binding_id).to_owned(), rank as f64))
        .collect::<HashMap<_, _>>();
    let all_bindings_ready = binding_ids
        .iter()
        .map(|binding_id| (*binding_id).to_owned())
        .collect::<HashSet<_>>();
    let no_scheduled_prerequisites = HashMap::new();
    let binding_schedule = DependencyBindingSchedule {
        execution_positions: &execution_positions,
        prerequisites: &no_scheduled_prerequisites,
    };
    let mut resolver = ScalarMutationResolver::new(&program);

    // Release the first child export before its forwarding declaration is
    // dependency-ready. The exact child value must remain available later.
    resolver.advance_before_with_execution_position(
        3,
        Some(0.0),
        &binding_schedule,
        &all_bindings_ready,
        true,
        &mut state,
    );
    assert_eq!(
        resolver.resolve(binding_ids[0], &state),
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(20.0),
        }
    );

    resolver.advance_before_with_execution_position(
        usize::MAX,
        Some(f64::INFINITY),
        &binding_schedule,
        &all_bindings_ready,
        true,
        &mut state,
    );

    for (binding_id, expected) in [
        (binding_ids[0], 20.0),
        (binding_ids[1], 20.0),
        (binding_ids[2], 40.0),
        (binding_ids[3], 40.0),
        (binding_ids[4], 20.0),
        (binding_ids[5], 40.0),
    ] {
        assert_eq!(
            resolver.lookup_current(binding_id),
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(expected),
            },
            "unexpected value for {binding_id}"
        );
    }
}

#[test]
fn mutation_geometry_property_stage_selection_uses_selected_snapshot() {
    let cases = vec![
        (
            "binding:base-length",
            Some(vec!["base".to_owned()]),
            "length",
            10.0,
        ),
        (
            "binding:first-length",
            Some(vec!["first".to_owned()]),
            "length",
            20.0,
        ),
        (
            "binding:final-length",
            Some(vec!["final".to_owned()]),
            "length",
            40.0,
        ),
        ("binding:implicit-final-length", None, "length", 40.0),
        (
            "binding:base-endpoint-x",
            Some(vec!["base".to_owned()]),
            "endPoint.x",
            10.0,
        ),
        (
            "binding:first-endpoint-x",
            Some(vec!["first".to_owned()]),
            "endPoint.x",
            25.0,
        ),
        (
            "binding:final-endpoint-x",
            Some(vec!["final".to_owned()]),
            "endPoint.x",
            60.0,
        ),
    ];
    let versions = cases
        .iter()
        .enumerate()
        .map(
            |(index, (binding_id, stage_path, property, _))| ValidatedBindingVersion {
                version_id: format!("version:{binding_id}"),
                statement_id: format!("statement:{binding_id}"),
                binding_id: (*binding_id).to_owned(),
                declared_type: ScalarType::Number,
                source_order: index + 1,
                catalog_order: None,
                control: serde_json::json!({"ownerChain": []}),
                initial_state: InitialState::Uncomputed,
                kind: ValidatedBindingVersionKind::Declare {
                    initializer: Some(TypedScalarExpression::GeometryProperty {
                        span: SPAN,
                        element_name_span: SPAN,
                        property_span: SPAN,
                        element_name: "A".to_owned(),
                        element_id: "element:A".to_owned(),
                        collection_value_id: None,
                        collection_length: None,
                        geometry_value_occurrence: None,
                        geometry_value_binder_id: None,
                        geometry_value_point_key: None,
                        for_group_template_element_id: None,
                        for_group_target_source_order: None,
                        for_group_index: None,
                        property: (*property).to_owned(),
                        stage_path: stage_path.clone(),
                        target_source_order: 0.0,
                        r#type: ScalarType::Number,
                    }),
                },
            },
        )
        .collect();
    let binding_ids = cases
        .iter()
        .map(|(binding_id, _, _, _)| (*binding_id).to_owned())
        .collect();
    let declared_types = cases
        .iter()
        .map(|(binding_id, _, _, _)| ((*binding_id).to_owned(), ScalarType::Number))
        .collect();
    let program = ValidatedBindingVersions {
        versions,
        binding_ids,
        declared_types,
        element_source_orders: HashMap::new(),
        conditional_owners_by_element_id: HashMap::new(),
        for_group_owners_by_element_id: HashMap::new(),
        collection_values: Vec::new(),
        immutable_for_groups: HashMap::new(),
    };
    let mut state = evaluation_state();
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

    let mut resolver = ScalarMutationResolver::new(&program);
    resolver.advance_before_statement(cases.len() + 1, &state);

    for (binding_id, _, _, expected) in cases {
        assert_eq!(
            resolver.lookup_current(binding_id),
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(expected),
            },
            "unexpected result for {binding_id}"
        );
    }
}

#[test]
fn optional_member_equal_record_field_position_returns_the_field() {
    let program = binding_versions(vec![record_collection("record")]);
    let mut resolver = ScalarMutationResolver::new(&program);
    resolver.current.insert(
        "field:x".to_owned(),
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(42.0),
        },
    );
    let state = evaluation_state();
    let target = record_field_target("record", 0.0);

    assert_number(
        lookup_optional_member(&resolver, &state, &target, 0.0),
        42.0,
    );
}

#[test]
fn optional_member_equal_absent_record_field_position_returns_none() {
    let program = binding_versions(vec![ValidatedScalarProgramCollection {
        value_id: "record".to_owned(),
        value: ValidatedScalarProgramCollectionValue::None,
    }]);
    let resolver = ScalarMutationResolver::new(&program);
    let state = evaluation_state();
    let target = record_field_target("record", 0.0);

    assert_none(lookup_optional_member(&resolver, &state, &target, 0.0));
}

#[test]
fn optional_member_equal_collection_length_position_returns_the_length() {
    let program = binding_versions(vec![number_collection("items", &[1.0, 2.0, 3.0])]);
    let resolver = ScalarMutationResolver::new(&program);
    let state = evaluation_state();
    let target = collection_length_target("items", 0.0);

    assert_number(lookup_optional_member(&resolver, &state, &target, 0.0), 3.0);
}

#[test]
fn optional_member_equal_absent_collection_length_position_returns_none() {
    let program = binding_versions(vec![ValidatedScalarProgramCollection {
        value_id: "items".to_owned(),
        value: ValidatedScalarProgramCollectionValue::None,
    }]);
    let resolver = ScalarMutationResolver::new(&program);
    let state = evaluation_state();
    let target = collection_length_target("items", 0.0);

    assert_none(lookup_optional_member(&resolver, &state, &target, 0.0));
}

#[test]
fn optional_member_geometry_collection_none_node_returns_none() {
    let program = binding_versions(Vec::new());
    let resolver = ScalarMutationResolver::new(&program);
    let mut state = evaluation_state();
    state.geometry_collection_nodes.insert(
        "geometry-items".to_owned(),
        std::sync::Arc::new(GeometryInputCollectionNode::None),
    );
    let target = collection_length_target("geometry-items", 0.0);

    assert_none(lookup_optional_member(&resolver, &state, &target, 0.0));
}

#[test]
fn optional_member_geometry_collection_empty_leaf_returns_zero_length() {
    let program = binding_versions(Vec::new());
    let resolver = ScalarMutationResolver::new(&program);
    let mut state = evaluation_state();
    state.geometry_collection_nodes.insert(
        "geometry-items".to_owned(),
        std::sync::Arc::new(GeometryInputCollectionNode::Leaf {
            targets: Vec::new(),
        }),
    );
    let target = collection_length_target("geometry-items", 0.0);

    assert_number(lookup_optional_member(&resolver, &state, &target, 0.0), 0.0);
}

#[test]
fn optional_member_geometry_collection_non_empty_leaf_returns_member_count() {
    let program = binding_versions(Vec::new());
    let resolver = ScalarMutationResolver::new(&program);
    let mut state = evaluation_state();
    state.geometry_collection_nodes.insert(
        "geometry-items".to_owned(),
        std::sync::Arc::new(GeometryInputCollectionNode::Leaf {
            targets: vec![GeometryInputTarget::Coordinate {
                anchor: serde_json::json!({"x": 0, "y": 0}),
            }],
        }),
    );
    let target = collection_length_target("geometry-items", 0.0);

    assert_number(lookup_optional_member(&resolver, &state, &target, 0.0), 1.0);
}

#[test]
fn optional_member_future_record_field_position_remains_unavailable() {
    let program = binding_versions(vec![record_collection("record")]);
    let mut resolver = ScalarMutationResolver::new(&program);
    resolver.current.insert(
        "field:x".to_owned(),
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(42.0),
        },
    );
    let state = evaluation_state();
    let target = record_field_target("record", 1.0);

    assert_issue(
        lookup_optional_member(&resolver, &state, &target, 0.0),
        "evaluation-collection-index-unavailable",
    );
}

#[test]
fn optional_member_future_collection_length_position_remains_unavailable() {
    let program = binding_versions(vec![number_collection("items", &[1.0, 2.0])]);
    let resolver = ScalarMutationResolver::new(&program);
    let state = evaluation_state();
    let target = collection_length_target("items", 1.0);

    assert_issue(
        lookup_optional_member(&resolver, &state, &target, 0.0),
        "evaluation-collection-index-unavailable",
    );
}

#[test]
fn optional_member_equal_unresolved_presence_remains_an_error() {
    let program = binding_versions(Vec::new());
    let resolver = ScalarMutationResolver::new(&program);
    let state = evaluation_state();
    let target = collection_length_target("missing-items", 0.0);

    assert_issue(
        lookup_optional_member(&resolver, &state, &target, 0.0),
        "evaluation-collection-property-unavailable",
    );
}
