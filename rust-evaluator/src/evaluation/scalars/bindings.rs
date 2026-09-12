//! Runtime evaluation for an already-resolved nui1 scalar program.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::super::scalar_expression_runtime::{
    lookup_for_group_geometry_property, lookup_geometry_collection_length,
    lookup_geometry_property, lookup_geometry_value_property,
    resolve_for_group_geometry_builtin_target, ForGroupGeometryPropertyRequest,
};
use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::program_payload::{
    ValidatedScalarProgram, ValidatedScalarProgramCollectionMember,
    ValidatedScalarProgramCollectionValue, ValidatedScalarProgramRecordField,
    ValidatedScalarProgramRecordFieldIdentity, ValidatedScalarProgramStatement,
};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{
    BindingId, ScalarEvaluation, ScalarEvaluationErrorContext, ScalarType, ScalarValue,
};
use crate::evaluation::types::EvaluationState;

const BINDING_UNAVAILABLE: &str = "evaluation-binding-unavailable";
const RUNTIME_VALUE_TYPE_MISMATCH: &str = "evaluation-runtime-value-type-mismatch";
const BINDING_CYCLE_GUARD: &str = "evaluation-binding-cycle-guard";

pub(crate) trait ScalarDocumentBindingResolver {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation;

    fn resolve_collection_index(
        &self,
        _collection_value_id: &str,
        _index: f64,
        element_type: &ScalarType,
        _collection_length: Option<f64>,
        _target_source_order: f64,
        _state: &EvaluationState,
    ) -> ScalarEvaluation {
        ScalarEvaluation::Error {
            r#type: element_type.clone(),
            issue_code: "evaluation-collection-index-unavailable".to_owned(),
            binding_id: None,
            context: None,
        }
    }

    fn resolve_collection_length(
        &self,
        _collection_value_id: &str,
        _state: &EvaluationState,
        _seen: &mut HashSet<String>,
    ) -> Option<f64> {
        None
    }
}

fn unavailable_binding(binding_id: &str) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: ScalarType::Number,
        issue_code: BINDING_UNAVAILABLE.to_owned(),
        binding_id: Some(binding_id.to_owned()),
        context: None,
    }
}

pub(crate) fn result_for_declared_type(
    result: ScalarEvaluation,
    declared_type: &ScalarType,
    binding_id: &str,
) -> ScalarEvaluation {
    match &result {
        ScalarEvaluation::Error { .. } => result,
        ScalarEvaluation::Ok { r#type, value }
            if scalar_type_assignable(r#type, declared_type)
                && scalar_value_matches_type(declared_type, value) =>
        {
            ScalarEvaluation::Ok {
                r#type: declared_type.clone(),
                value: value.clone(),
            }
        }
        ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
            r#type: declared_type.clone(),
            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
            binding_id: Some(binding_id.to_owned()),
            context: None,
        },
    }
}

fn scalar_type_assignable(actual: &ScalarType, expected: &ScalarType) -> bool {
    if let ScalarType::Optional { value_type } = expected {
        return match actual {
            ScalarType::Optional {
                value_type: actual_value_type,
            } => scalar_type_assignable(actual_value_type, value_type),
            _ => scalar_type_assignable(actual, value_type),
        };
    }
    !matches!(actual, ScalarType::Optional { .. }) && actual == expected
}

fn record_field_result(
    result: ScalarEvaluation,
    field: &ValidatedScalarProgramRecordFieldIdentity,
) -> ScalarEvaluation {
    match result {
        ScalarEvaluation::Ok { r#type, value }
            if r#type == field.r#type && scalar_value_matches_type(&r#type, &value) =>
        {
            ScalarEvaluation::Ok { r#type, value }
        }
        ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
            r#type: field.r#type.clone(),
            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
            binding_id: None,
            context: None,
        },
        error @ ScalarEvaluation::Error { .. } => error,
    }
}

pub(super) fn record_field_path_matches(
    record_statement_id: &str,
    field_index: usize,
    field_path: Option<&[super::program_payload::ValidatedScalarProgramRecordFieldPathEntry]>,
    expected: &ValidatedScalarProgramRecordFieldIdentity,
) -> bool {
    let candidate_path = field_path
        .map(|path| {
            path.iter()
                .map(|entry| (entry.record_statement_id.as_str(), entry.field_index))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![(record_statement_id, field_index)]);
    let expected_path = expected
        .field_path
        .as_deref()
        .map(|path| {
            path.iter()
                .map(|entry| (entry.record_statement_id.as_str(), entry.field_index))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![(expected.record_statement_id.as_str(), expected.field_index)]);
    candidate_path == expected_path
}

fn record_field_matches(
    candidate: &ValidatedScalarProgramRecordField,
    expected: &ValidatedScalarProgramRecordFieldIdentity,
) -> bool {
    record_field_path_matches(
        &candidate.record_statement_id,
        candidate.field_index,
        candidate.field_path.as_deref(),
        expected,
    )
}

fn record_type_identity_matches(
    type_identity: &str,
    field: &ValidatedScalarProgramRecordFieldIdentity,
) -> bool {
    field
        .field_path
        .as_deref()
        .and_then(|path| path.first())
        .map(|entry| entry.record_statement_id.as_str())
        .unwrap_or(field.record_statement_id.as_str())
        == type_identity
}

fn is_within_evaluation_limit(
    program: &ValidatedScalarProgram,
    statement: &ValidatedScalarProgramStatement,
) -> bool {
    !program.evaluation_limit_source_order.is_some_and(|limit| {
        statement.source_order >= limit
            && !program
                .post_stop_binding_ids
                .contains(&statement.binding_id)
    })
}

/// Resolves one binding's value on demand, memoized for the lifetime of one
/// `evaluate_document` call. `program` is borrowed for this resolver's whole
/// lifetime (it is never mutated during evaluation), but `state` is passed
/// per call rather than stored - `state` is still being mutated by the
/// caller's own per-element loop, so this resolver must never hold a live
/// borrow of it across calls.
pub(crate) struct ScalarBindingResolver<'a> {
    program: &'a ValidatedScalarProgram,
    statement_by_binding_id: HashMap<&'a str, &'a ValidatedScalarProgramStatement>,
    cache: RefCell<HashMap<BindingId, ScalarEvaluation>>,
    in_progress: RefCell<HashSet<BindingId>>,
}

pub(super) struct ScalarRecordMapBinderContext {
    pub(super) source_value_id: String,
    pub(super) index: f64,
    pub(super) binder_fields: Vec<ValidatedScalarProgramRecordField>,
    pub(super) seen: HashSet<String>,
}

impl ScalarRecordMapBinderContext {
    pub(super) fn new(
        source_value_id: &str,
        index: f64,
        binder_fields: &[ValidatedScalarProgramRecordField],
        seen: &HashSet<String>,
    ) -> Self {
        Self {
            source_value_id: source_value_id.to_owned(),
            index,
            binder_fields: binder_fields.to_vec(),
            seen: seen.clone(),
        }
    }
}

impl<'a> ScalarBindingResolver<'a> {
    pub(crate) fn new(program: &'a ValidatedScalarProgram) -> Self {
        let mut statement_by_binding_id = HashMap::new();
        for statement in &program.statements {
            if is_within_evaluation_limit(program, statement) {
                statement_by_binding_id.insert(statement.binding_id.as_str(), statement);
            }
        }
        Self {
            program,
            statement_by_binding_id,
            cache: RefCell::new(HashMap::new()),
            in_progress: RefCell::new(HashSet::new()),
        }
    }

    /// Resolves `binding_id` against `state`'s current (possibly still
    /// in-progress) contents, caching the result. Safe to call at any point
    /// during the caller's per-element loop, any number of times, for any
    /// binding - each is only ever actually evaluated once.
    pub(crate) fn resolve(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        if let Some(cached) = self.cache.borrow().get(binding_id) {
            return cached.clone();
        }

        let Some(statement) = self.statement_by_binding_id.get(binding_id).copied() else {
            return unavailable_binding(binding_id);
        };

        if !self.in_progress.borrow_mut().insert(binding_id.to_owned()) {
            // Defense-in-depth only - see module comment. Should be
            // unreachable for any program that passed Task 13's compile-time
            // acyclicity checks.
            return ScalarEvaluation::Error {
                r#type: statement.declared_type.clone(),
                issue_code: BINDING_CYCLE_GUARD.to_owned(),
                binding_id: Some(binding_id.to_owned()),
                context: None,
            };
        }

        let environment = ResolvingEnvironment {
            resolver: self,
            state,
            source_order: statement.source_order as f64,
            local_binding_id: None,
            local_binding: None,
            local_bindings: None,
            record_map_context: None,
        };
        let evaluation = match &statement.initializer {
            Ok(initializer) => result_for_declared_type(
                evaluate_typed_expression(initializer, &environment),
                &statement.declared_type,
                &statement.binding_id,
            ),
            Err(issue_code) => ScalarEvaluation::Error {
                r#type: statement.declared_type.clone(),
                issue_code: issue_code.clone(),
                binding_id: Some(statement.binding_id.clone()),
                context: None,
            },
        };

        self.in_progress.borrow_mut().remove(binding_id);
        self.cache
            .borrow_mut()
            .insert(binding_id.to_owned(), evaluation.clone());
        evaluation
    }

    /// Walks `program.statements` in array order and pulls each value from
    /// the (memoized, so free after the first ask) resolver, producing the
    /// same `computed_scalar_bindings` shape/order the original one-shot
    /// implementation did - independent of whatever order (if any) the
    /// caller's own per-element loop resolved bindings in beforehand.
    pub(crate) fn finalize(&self, state: &EvaluationState) -> Vec<Value> {
        let mut output = Vec::new();
        for statement in &self.program.statements {
            if !is_within_evaluation_limit(self.program, statement) {
                continue;
            }
            let evaluation = self.resolve(&statement.binding_id, state);
            output.push(json!({
                "bindingId": statement.binding_id,
                "evaluation": scalar_evaluation_json(&evaluation),
            }));
        }
        output
    }

    fn resolve_record_field(
        &self,
        collection_value_id: &str,
        index: f64,
        field: &ValidatedScalarProgramRecordFieldIdentity,
        collection_length: Option<f64>,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        self.resolve_record_field_with_seen(
            collection_value_id,
            index,
            field,
            collection_length,
            state,
            &mut HashSet::new(),
        )
    }

    fn resolve_record_field_with_seen(
        &self,
        collection_value_id: &str,
        index: f64,
        field: &ValidatedScalarProgramRecordFieldIdentity,
        collection_length: Option<f64>,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> ScalarEvaluation {
        if !index.is_finite()
            || index.fract() != 0.0
            || index < 0.0
            || collection_length.is_some_and(|length| index >= length)
        {
            return ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-invalid".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        let mut current = collection_value_id;
        loop {
            if !seen.insert(current.to_owned()) {
                return unavailable_binding(current);
            }
            let Some(value) = self
                .program
                .collection_values
                .iter()
                .find(|value| value.value_id == current)
            else {
                return unavailable_binding(current);
            };
            if let ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id,
                field: source_field,
                ..
            } = &value.value
            {
                if !record_field_path_matches(
                    &source_field.record_statement_id,
                    source_field.field_index,
                    source_field.field_path.as_deref(),
                    field,
                ) {
                    return unavailable_binding(current);
                }
                current = source_value_id;
                continue;
            }
            match &value.value {
                ValidatedScalarProgramCollectionValue::Alias(target) => current = target,
                ValidatedScalarProgramCollectionValue::Literal(members) => {
                    let Some(ValidatedScalarProgramCollectionMember::Record {
                        type_identity,
                        fields,
                    }) = members.get(index as usize)
                    else {
                        return unavailable_binding(current);
                    };
                    if !record_type_identity_matches(type_identity, field) {
                        return unavailable_binding(current);
                    }
                    let Some(member_field) = fields
                        .iter()
                        .find(|candidate| record_field_matches(candidate, field))
                    else {
                        return unavailable_binding(current);
                    };
                    let result = result_for_declared_type(
                        self.resolve(&member_field.binding_id, state),
                        &member_field.r#type,
                        &member_field.binding_id,
                    );
                    return record_field_result(result, field);
                }
                ValidatedScalarProgramCollectionValue::RecordMap {
                    source_value_id,
                    binder_fields,
                    fields,
                    source_order,
                    source_type_identity,
                    result_type_identity,
                } => {
                    if !binder_fields.iter().all(|candidate| {
                        let root = candidate
                            .field_path
                            .as_deref()
                            .and_then(|path| path.first())
                            .map(|entry| entry.record_statement_id.as_str())
                            .unwrap_or(candidate.record_statement_id.as_str());
                        root == source_type_identity
                    }) || !fields.iter().all(|candidate| {
                        let root = candidate
                            .field_path
                            .as_deref()
                            .and_then(|path| path.first())
                            .map(|entry| entry.record_statement_id.as_str())
                            .unwrap_or(candidate.record_statement_id.as_str());
                        root == result_type_identity
                    }) || !record_type_identity_matches(result_type_identity, field)
                    {
                        return unavailable_binding(current);
                    }
                    let Some(mapped_field) = fields.iter().find(|candidate| {
                        record_field_path_matches(
                            &candidate.record_statement_id,
                            candidate.field_index,
                            candidate.field_path.as_deref(),
                            field,
                        )
                    }) else {
                        return unavailable_binding(current);
                    };
                    let record_map_context = ScalarRecordMapBinderContext::new(
                        source_value_id,
                        index,
                        binder_fields,
                        seen,
                    );
                    let environment = ResolvingEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order as f64,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
                        record_map_context: Some(&record_map_context),
                    };
                    let result = result_for_declared_type(
                        evaluate_typed_expression(&mapped_field.body, &environment),
                        &mapped_field.r#type,
                        current,
                    );
                    return record_field_result(result, field);
                }
                ValidatedScalarProgramCollectionValue::If {
                    condition,
                    then_value_id,
                    else_value_id,
                    source_order,
                } => {
                    let environment = ResolvingEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
                        record_map_context: None,
                    };
                    current = match evaluate_typed_expression(condition, &environment) {
                        ScalarEvaluation::Ok {
                            value: ScalarValue::Boolean(true),
                            ..
                        } => then_value_id,
                        ScalarEvaluation::Ok {
                            value: ScalarValue::Boolean(false),
                            ..
                        } => else_value_id,
                        ScalarEvaluation::Error { issue_code, .. } => {
                            return ScalarEvaluation::Error {
                                r#type: ScalarType::Number,
                                issue_code,
                                binding_id: None,
                                context: None,
                            };
                        }
                        _ => return unavailable_binding(current),
                    };
                }
                ValidatedScalarProgramCollectionValue::Match {
                    scrutinee,
                    arms,
                    source_order,
                } => {
                    let environment = ResolvingEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
                        record_map_context: None,
                    };
                    let ScalarEvaluation::Ok {
                        value: ScalarValue::Choice { value, .. },
                        ..
                    } = evaluate_typed_expression(scrutinee, &environment)
                    else {
                        return unavailable_binding(current);
                    };
                    let Some((_, selected)) = arms.iter().find(|(label, _)| label == &value) else {
                        return unavailable_binding(current);
                    };
                    current = selected;
                }
                ValidatedScalarProgramCollectionValue::RecordField { .. }
                | ValidatedScalarProgramCollectionValue::Map { .. } => {
                    return unavailable_binding(current);
                }
            }
        }
    }

    pub(crate) fn resolve_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        _target_source_order: f64,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        if !index.is_finite()
            || index.fract() != 0.0
            || index < 0.0
            || collection_length.is_some_and(|length| index >= length)
        {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-invalid".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        let mut current = collection_value_id;
        let mut seen = HashSet::new();
        let member = loop {
            if !seen.insert(current.to_owned()) {
                return ScalarEvaluation::Error {
                    r#type: element_type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                };
            }
            let Some(value) = self
                .program
                .collection_values
                .iter()
                .find(|value| value.value_id == current)
            else {
                return ScalarEvaluation::Error {
                    r#type: element_type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                };
            };
            match &value.value {
                ValidatedScalarProgramCollectionValue::Alias(target) => current = target,
                ValidatedScalarProgramCollectionValue::Literal(members) => {
                    break members.get(index as usize)
                }
                ValidatedScalarProgramCollectionValue::Map {
                    source_value_id,
                    source_element_type,
                    result_element_type,
                    binder_id,
                    body,
                    source_order,
                } => {
                    let source = self.resolve_collection_index(
                        source_value_id,
                        index,
                        source_element_type,
                        None,
                        *source_order as f64,
                        state,
                    );
                    let ScalarEvaluation::Ok { .. } = source else {
                        return source;
                    };
                    let environment = ResolvingEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order as f64,
                        local_binding_id: Some(binder_id.as_str()),
                        local_binding: Some(&source),
                        local_bindings: None,
                        record_map_context: None,
                    };
                    let mapped = evaluate_typed_expression(body, &environment);
                    return match mapped {
                        ScalarEvaluation::Ok { r#type, value }
                            if r#type == *result_element_type
                                && scalar_value_matches_type(&r#type, &value) =>
                        {
                            ScalarEvaluation::Ok { r#type, value }
                        }
                        ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
                            r#type: result_element_type.clone(),
                            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                            binding_id: None,
                            context: None,
                        },
                        error @ ScalarEvaluation::Error { .. } => error,
                    };
                }
                ValidatedScalarProgramCollectionValue::RecordField {
                    source_value_id,
                    field,
                    ..
                } => {
                    return self.resolve_record_field(
                        source_value_id,
                        index,
                        field,
                        collection_length,
                        state,
                    );
                }
                ValidatedScalarProgramCollectionValue::RecordMap { .. } => {
                    return ScalarEvaluation::Error {
                        r#type: element_type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                ValidatedScalarProgramCollectionValue::If {
                    condition,
                    then_value_id,
                    else_value_id,
                    source_order,
                } => {
                    let environment = ResolvingEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
                        record_map_context: None,
                    };
                    let condition = evaluate_typed_expression(condition, &environment);
                    let selected = match condition {
                        ScalarEvaluation::Ok {
                            r#type: ScalarType::Boolean,
                            value: ScalarValue::Boolean(value),
                        } => {
                            if value {
                                then_value_id
                            } else {
                                else_value_id
                            }
                        }
                        ScalarEvaluation::Error { issue_code, .. } => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code,
                                binding_id: None,
                                context: None,
                            };
                        }
                        _ => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                                binding_id: None,
                                context: None,
                            };
                        }
                    };
                    return self.resolve_collection_index(
                        selected,
                        index,
                        element_type,
                        None,
                        *source_order,
                        state,
                    );
                }
                ValidatedScalarProgramCollectionValue::Match {
                    scrutinee,
                    arms,
                    source_order,
                } => {
                    let environment = ResolvingEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
                        record_map_context: None,
                    };
                    let scrutinee = evaluate_typed_expression(scrutinee, &environment);
                    let value = match scrutinee {
                        ScalarEvaluation::Ok {
                            r#type: ScalarType::Choice { .. },
                            value: ScalarValue::Choice { value, .. },
                        } => value,
                        ScalarEvaluation::Error { issue_code, .. } => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code,
                                binding_id: None,
                                context: None,
                            };
                        }
                        _ => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                                binding_id: None,
                                context: None,
                            };
                        }
                    };
                    let Some((_, selected)) = arms.iter().find(|(label, _)| label == &value) else {
                        return ScalarEvaluation::Error {
                            r#type: element_type.clone(),
                            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                            binding_id: None,
                            context: None,
                        };
                    };
                    return self.resolve_collection_index(
                        selected,
                        index,
                        element_type,
                        None,
                        *source_order,
                        state,
                    );
                }
            }
        };
        let Some(member) = member else {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-invalid".to_owned(),
                binding_id: None,
                context: None,
            };
        };
        let result = match member {
            ValidatedScalarProgramCollectionMember::Literal { r#type, value } => {
                ScalarEvaluation::Ok {
                    r#type: r#type.clone(),
                    value: value.clone(),
                }
            }
            ValidatedScalarProgramCollectionMember::Binding { r#type, binding_id } => {
                if r#type != element_type {
                    return ScalarEvaluation::Error {
                        r#type: element_type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                self.resolve(binding_id, state)
            }
            ValidatedScalarProgramCollectionMember::Record { .. } => {
                return ScalarEvaluation::Error {
                    r#type: element_type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                };
            }
        };
        match result {
            ScalarEvaluation::Ok {
                r#type: result_type,
                value,
            } if result_type == *element_type
                && scalar_value_matches_type(&result_type, &value) =>
            {
                ScalarEvaluation::Ok {
                    r#type: result_type,
                    value,
                }
            }
            ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
                binding_id: None,
                context: None,
            },
            error @ ScalarEvaluation::Error { .. } => error,
        }
    }

    pub(crate) fn resolve_collection_length(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> Option<f64> {
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|value| value.value_id == collection_value_id)
        else {
            return lookup_geometry_collection_length(state, self, collection_value_id, seen);
        };
        if !seen.insert(collection_value_id.to_owned()) {
            return None;
        }
        match &value.value {
            ValidatedScalarProgramCollectionValue::Literal(members) => Some(members.len() as f64),
            ValidatedScalarProgramCollectionValue::Alias(target) => {
                self.resolve_collection_length(target, state, seen)
            }
            ValidatedScalarProgramCollectionValue::Map {
                source_value_id, ..
            } => self.resolve_collection_length(source_value_id, state, seen),
            ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id, ..
            } => self.resolve_collection_length(source_value_id, state, seen),
            ValidatedScalarProgramCollectionValue::If {
                condition,
                then_value_id,
                else_value_id,
                source_order,
            } => {
                let environment = ResolvingEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: None,
                    record_map_context: None,
                };
                match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(true),
                        ..
                    } => self.resolve_collection_length(then_value_id, state, seen),
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(false),
                        ..
                    } => self.resolve_collection_length(else_value_id, state, seen),
                    _ => None,
                }
            }
            ValidatedScalarProgramCollectionValue::Match {
                scrutinee,
                arms,
                source_order,
            } => {
                let environment = ResolvingEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: None,
                    record_map_context: None,
                };
                let ScalarEvaluation::Ok {
                    value: ScalarValue::Choice { value, .. },
                    ..
                } = evaluate_typed_expression(scrutinee, &environment)
                else {
                    return None;
                };
                let (_, target) = arms.iter().find(|(label, _)| label == &value)?;
                self.resolve_collection_length(target, state, seen)
            }
        }
    }
}

impl ScalarDocumentBindingResolver for ScalarBindingResolver<'_> {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        self.resolve(binding_id, state)
    }

    fn resolve_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        target_source_order: f64,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        self.resolve_collection_index(
            collection_value_id,
            index,
            element_type,
            collection_length,
            target_source_order,
            state,
        )
    }

    fn resolve_collection_length(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> Option<f64> {
        self.resolve_collection_length(collection_value_id, state, seen)
    }
}

struct ResolvingEnvironment<'a, 'b, 'c> {
    resolver: &'a ScalarBindingResolver<'a>,
    state: &'b EvaluationState,
    source_order: f64,
    local_binding_id: Option<&'c str>,
    local_binding: Option<&'c ScalarEvaluation>,
    local_bindings: Option<&'c HashMap<BindingId, ScalarEvaluation>>,
    record_map_context: Option<&'c ScalarRecordMapBinderContext>,
}

impl ScalarEvaluationEnvironment for ResolvingEnvironment<'_, '_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        if let Some(context) = self.record_map_context {
            if let Some(binder_field) = context
                .binder_fields
                .iter()
                .find(|field| field.binding_id == binding_id)
            {
                let field = ValidatedScalarProgramRecordFieldIdentity {
                    record_statement_id: binder_field.record_statement_id.clone(),
                    field_index: binder_field.field_index,
                    r#type: binder_field.r#type.clone(),
                    field_path: binder_field.field_path.clone(),
                };
                let mut seen = context.seen.clone();
                return self.resolver.resolve_record_field_with_seen(
                    &context.source_value_id,
                    context.index,
                    &field,
                    None,
                    self.state,
                    &mut seen,
                );
            }
        }
        if let Some(local_bindings) = self.local_bindings {
            if let Some(value) = local_bindings.get(binding_id) {
                return value.clone();
            }
        }
        if self.local_binding_id == Some(binding_id) {
            if let Some(value) = self.local_binding {
                return value.clone();
            }
        }
        self.resolver.resolve(binding_id, self.state)
    }
    fn lookup_geometry_property(
        &self,
        element_id: &str,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_property(
            self.state,
            element_id,
            property,
            target_source_order,
            Some(self.source_order),
            property_type,
        )
    }

    fn lookup_geometry_value_property(
        &self,
        occurrence: &super::super::types::GeometryValueOccurrence,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_value_property(
            self.state,
            occurrence,
            point_key,
            property,
            target_source_order,
            Some(self.source_order),
            property_type,
        )
    }

    fn lookup_for_group_geometry_property(
        &self,
        template_element_id: &str,
        index: Option<&super::types::TypedScalarExpression>,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_for_group_geometry_property(
            self.state,
            self.resolver,
            ForGroupGeometryPropertyRequest {
                template_element_id,
                index,
                point_key,
                property,
                target_source_order,
                current_source_order: Some(self.source_order),
                property_type,
            },
        )
    }

    fn lookup_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        target_source_order: f64,
    ) -> ScalarEvaluation {
        if target_source_order >= self.source_order {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        self.resolver.resolve_collection_index(
            collection_value_id,
            index,
            element_type,
            collection_length,
            target_source_order,
            self.state,
        )
    }

    fn lookup_collection_length(&self, collection_value_id: &str) -> Option<f64> {
        self.resolver.resolve_collection_length(
            collection_value_id,
            self.state,
            &mut HashSet::new(),
        )
    }

    fn lookup_geometry_builtin_target(
        &self,
        target: &super::types::ScalarExpressionResolvedGeometryTarget,
    ) -> Result<
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeError,
    > {
        resolve_for_group_geometry_builtin_target(
            self.state,
            self.resolver,
            self.source_order,
            target,
        )
    }
}

fn scalar_type_json(scalar_type: &ScalarType) -> Value {
    match scalar_type {
        ScalarType::Number => json!({ "kind": "number" }),
        ScalarType::String => json!({ "kind": "string" }),
        ScalarType::Boolean => json!({ "kind": "boolean" }),
        ScalarType::Choice { options } => json!({ "kind": "choice", "options": options }),
        ScalarType::Optional { value_type } => {
            json!({ "kind": "optional", "valueType": scalar_type_json(value_type) })
        }
    }
}

fn scalar_value_json(value: &ScalarValue) -> Value {
    match value {
        ScalarValue::Number(value) => json!({ "kind": "number", "value": value }),
        ScalarValue::String(value) => json!({ "kind": "string", "value": value }),
        ScalarValue::Boolean(value) => json!({ "kind": "boolean", "value": value }),
        ScalarValue::Choice { value, options } => {
            json!({ "kind": "choice", "value": value, "options": options })
        }
        ScalarValue::None => json!({ "kind": "none" }),
    }
}

pub(crate) fn scalar_evaluation_json(evaluation: &ScalarEvaluation) -> Value {
    match evaluation {
        ScalarEvaluation::Ok { r#type, value } => json!({
            "status": "ok",
            "type": scalar_type_json(r#type),
            "value": scalar_value_json(value),
        }),
        ScalarEvaluation::Error {
            r#type,
            issue_code,
            binding_id,
            context,
        } => {
            let mut value = json!({
                "status": "error",
                "type": scalar_type_json(r#type),
                "issueCode": issue_code,
            });
            if let Some(binding_id) = binding_id {
                value["bindingId"] = Value::String(binding_id.clone());
            }
            if let Some(context) = context {
                value["context"] = match context {
                    ScalarEvaluationErrorContext::GeometryBuiltinTarget {
                        target_element_id,
                        point_key,
                    } => {
                        let mut context = json!({
                            "kind": "geometryBuiltinTarget",
                            "targetElementId": target_element_id,
                        });
                        if let Some(point_key) = point_key {
                            context["pointKey"] = Value::String(point_key.clone());
                        }
                        context
                    }
                };
            }
            value
        }
    }
}
