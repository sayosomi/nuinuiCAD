use std::collections::{HashMap, HashSet};

use super::super::mutation_payload::ValidatedBindingVersions;
use super::super::program_payload::{
    ValidatedScalarProgramCollection, ValidatedScalarProgramCollectionMember,
    ValidatedScalarProgramCollectionValue, ValidatedScalarProgramRecordField,
};
use super::super::types::{
    ScalarEvaluation, ScalarExpressionRecordFieldTarget,
    ScalarExpressionResolvedOptionalMemberTarget, ScalarType, ScalarValue,
};
use super::{MutationEnvironment, ScalarMutationResolver};
use crate::evaluation::scalars::expression_evaluator::ScalarEvaluationEnvironment;
use crate::evaluation::scalars::mutation_payload::ValidatedImmutableForGroupPlan;
use crate::evaluation::types::EvaluationState;

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
