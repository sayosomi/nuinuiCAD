//! Task 32/33 in-place mutation cursor. Conditional selection is registered
//! by Task 25's Rust runtime; this module never parses or evaluates a branch.
mod for_group_scheduler;
use super::super::scalar_expression_runtime::{
    lookup_geometry_collection_length, lookup_geometry_property, lookup_geometry_value_property,
};
use super::bindings::ScalarDocumentBindingResolver;
use super::bindings::{result_for_declared_type, scalar_evaluation_json};
use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::geometry_builtin_runtime::resolve_geometry_builtin_target;
use super::mutation_payload::{
    InitialState, ValidatedBindingVersion, ValidatedBindingVersionKind, ValidatedBindingVersions,
};
use super::program_payload::{
    ValidatedScalarProgramCollectionMember, ValidatedScalarProgramCollectionValue,
    ValidatedScalarProgramRecordFieldIdentity,
};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{BindingId, ScalarEvaluation, ScalarType, ScalarValue};
use crate::evaluation::geometry_value_runtime::{
    evaluate_geometry_value_entry, GeometryValueProgramEntry,
};
use crate::evaluation::types::EvaluationState;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(crate) use for_group_scheduler::ForGroupMutationStatement;

const VERSION_UNAVAILABLE: &str = "evaluation-binding-version-unavailable";
const RUNTIME_VALUE_TYPE_MISMATCH: &str = "evaluation-runtime-value-type-mismatch";

struct ScopeFrame {
    scope_id: String,
    exit_source_order: usize,
    locals: HashSet<BindingId>,
}

pub(crate) struct ScalarMutationResolver<'a> {
    program: &'a ValidatedBindingVersions,
    current: HashMap<BindingId, ScalarEvaluation>,
    next_version_index: usize,
    history: Vec<Value>,
    conditional_results: HashMap<String, Option<String>>,
    loop_conditional_results: Vec<HashMap<String, Option<String>>>,
    frames: Vec<ScopeFrame>,
}

impl<'a> ScalarMutationResolver<'a> {
    pub(crate) fn new(program: &'a ValidatedBindingVersions) -> Self {
        Self {
            program,
            current: HashMap::new(),
            next_version_index: 0,
            history: Vec::new(),
            conditional_results: HashMap::new(),
            loop_conditional_results: Vec::new(),
            frames: Vec::new(),
        }
    }
    pub(crate) fn advance_before_with_geometry_values(
        &mut self,
        source_order: usize,
        state: &mut EvaluationState,
        geometry_value_program: &[GeometryValueProgramEntry],
        next_geometry_value_index: &mut usize,
    ) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            if version.source_order >= source_order {
                break;
            }
            self.retire_before(version.source_order);
            while *next_geometry_value_index < geometry_value_program.len()
                && geometry_value_program[*next_geometry_value_index].execution_position
                    <= version.source_order as f64
            {
                let entry = &geometry_value_program[*next_geometry_value_index];
                let resolver: &dyn ScalarDocumentBindingResolver = self;
                if !entry.lazy {
                    evaluate_geometry_value_entry(entry, resolver, state);
                }
                *next_geometry_value_index += 1;
            }
            self.next_version_index += 1;
            if self.is_version_before_cutoff(version) {
                self.execute(version, state);
            }
        }
        self.retire_before(source_order);
    }
    pub(crate) fn finalize(&mut self, state: &EvaluationState) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            self.retire_before(version.source_order);
            self.next_version_index += 1;
            if self.is_version_before_cutoff(version) {
                self.execute(version, state);
            }
        }
        self.retire_before(usize::MAX);
    }
    pub(crate) fn source_order_for_element(&self, element_id: &str) -> Option<usize> {
        self.program.element_source_orders.get(element_id).copied()
    }
    pub(crate) fn register_conditional_result(&mut self, element_id: &str, branch: Option<&str>) {
        let Some(owner_id) = self
            .program
            .conditional_owners_by_element_id
            .get(element_id)
            .cloned()
        else {
            return;
        };
        let result = branch.map(str::to_owned);
        if let Some(results) = self.loop_conditional_results.last_mut() {
            results.insert(owner_id, result);
            return;
        }
        if self.conditional_results.contains_key(&owner_id) {
            return;
        }
        self.conditional_results
            .insert(owner_id.clone(), result.clone());
        let Some(branch) = result else {
            return;
        };
        for version in &self.program.versions {
            let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
                continue;
            };
            for owner in chain {
                if owner.get("kind").and_then(Value::as_str) == Some("conditionalBranch")
                    && owner.get("ownerStatementId").and_then(Value::as_str)
                        == Some(owner_id.as_str())
                    && owner.get("branch").and_then(Value::as_str) == Some(branch.as_str())
                {
                    let scope_id = owner
                        .get("scopeId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    let exit = owner
                        .get("exitSourceOrder")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize;
                    self.frames.push(ScopeFrame {
                        scope_id,
                        exit_source_order: exit,
                        locals: HashSet::new(),
                    });
                    return;
                }
            }
        }
    }
    pub(crate) fn resolve(&self, binding_id: &str, _state: &EvaluationState) -> ScalarEvaluation {
        if self.program.binding_ids.contains(binding_id) {
            self.lookup_current(binding_id)
        } else {
            ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-binding-unavailable".to_owned(),
                binding_id: Some(binding_id.to_owned()),
                context: None,
            }
        }
    }
    pub(crate) fn computed_bindings(&self) -> Vec<Value> {
        self.program.versions.iter().filter(|version| matches!(version.kind, ValidatedBindingVersionKind::Declare { .. }) &&
            version.control.get("ownerChain").and_then(Value::as_array).is_some_and(Vec::is_empty))
            .filter_map(|version| self.current.get(&version.binding_id).map(|evaluation| json!({"bindingId": version.binding_id, "evaluation": scalar_evaluation_json(evaluation)}))).collect()
    }
    pub(crate) fn history(&self) -> Vec<Value> {
        self.history.clone()
    }
    pub(super) fn record_history(&mut self, entry: Value) {
        let Some(version_id) = entry.get("versionId").and_then(Value::as_str) else {
            self.history.push(entry);
            return;
        };
        if let Some(index) = self.history.iter().position(|current| {
            current.get("versionId").and_then(Value::as_str) == Some(version_id)
        }) {
            self.history[index] = entry;
        } else {
            self.history.push(entry);
        }
    }
    pub(super) fn is_before_cutoff(&self, source_order: usize) -> bool {
        !self
            .program
            .evaluation_limit_source_order
            .is_some_and(|limit| source_order >= limit)
    }
    fn is_version_before_cutoff(&self, version: &ValidatedBindingVersion) -> bool {
        !self
            .program
            .evaluation_limit_source_order
            .is_some_and(|limit| {
                version.source_order >= limit
                    && !self
                        .program
                        .post_stop_binding_ids
                        .contains(&version.binding_id)
            })
    }
    fn retire_before(&mut self, source_order: usize) {
        for index in (0..self.frames.len()).rev() {
            if self.frames[index].exit_source_order >= source_order {
                continue;
            }
            for binding_id in self.frames[index].locals.clone() {
                self.current.remove(&binding_id);
            }
            self.frames.remove(index);
        }
    }
    fn inactive_control_status(&self, version: &ValidatedBindingVersion) -> Option<&'static str> {
        let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
            return Some("inactive-control");
        };
        for owner in chain {
            match owner.get("kind").and_then(Value::as_str) {
                Some("forGroup") => return Some("skipped-control"),
                Some("conditionalBranch")
                    if self
                        .conditional_result(
                            owner
                                .get("ownerStatementId")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        )
                        .is_some_and(|result| {
                            result.as_deref() == owner.get("branch").and_then(Value::as_str)
                        }) => {}
                _ => return Some("inactive-control"),
            }
        }
        None
    }
    pub(super) fn push_loop_conditional_results(&mut self) {
        self.loop_conditional_results.push(HashMap::new());
    }
    pub(super) fn reset_loop_conditional_results(&mut self) {
        if let Some(results) = self.loop_conditional_results.last_mut() {
            results.clear();
        }
    }
    pub(super) fn pop_loop_conditional_results(&mut self) {
        self.loop_conditional_results.pop();
    }
    pub(super) fn conditional_result(&self, owner_id: &str) -> Option<&Option<String>> {
        self.loop_conditional_results
            .iter()
            .rev()
            .find_map(|results| results.get(owner_id))
            .or_else(|| self.conditional_results.get(owner_id))
    }
    fn execute(&mut self, version: &ValidatedBindingVersion, state: &EvaluationState) {
        if let Some(status) = self.inactive_control_status(version) {
            self.history.push(json!({"versionId": version.version_id, "statementId": version.statement_id, "bindingId": version.binding_id, "status": status}));
            return;
        }
        let evaluation = match (&version.initial_state, &version.kind) {
            (InitialState::Poisoned, _)
            | (_, ValidatedBindingVersionKind::Declare { initializer: None }) => {
                ScalarEvaluation::Error {
                    r#type: version.declared_type.clone(),
                    issue_code: "poisoned-binding".to_owned(),
                    binding_id: Some(version.binding_id.clone()),
                    context: None,
                }
            }
            (
                _,
                ValidatedBindingVersionKind::Declare {
                    initializer: Some(expression),
                },
            )
            | (_, ValidatedBindingVersionKind::Set { expression }) => {
                self.evaluate(expression, version, state)
            }
        };
        self.current
            .insert(version.binding_id.clone(), evaluation.clone());
        if matches!(version.kind, ValidatedBindingVersionKind::Declare { .. })
            && !version
                .control
                .get("ownerChain")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        {
            if let Some(scope_id) = version
                .control
                .get("ownerChain")
                .and_then(Value::as_array)
                .and_then(|chain| chain.last())
                .and_then(|owner| owner.get("scopeId"))
                .and_then(Value::as_str)
            {
                if let Some(frame) = self
                    .frames
                    .iter_mut()
                    .rev()
                    .find(|frame| frame.scope_id == scope_id)
                {
                    frame.locals.insert(version.binding_id.clone());
                }
            }
        }
        self.history.push(json!({"versionId": version.version_id, "statementId": version.statement_id, "bindingId": version.binding_id, "status": if matches!(evaluation, ScalarEvaluation::Error { .. }) { "poisoned" } else { "executed" }, "evaluation": scalar_evaluation_json(&evaluation)}));
    }
    pub(super) fn evaluate(
        &self,
        expression: &super::types::TypedScalarExpression,
        version: &ValidatedBindingVersion,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        let environment = MutationEnvironment {
            resolver: self,
            state,
            source_order: version.source_order as f64,
            local_binding_id: None,
            local_binding: None,
            local_bindings: None,
        };
        result_for_declared_type(
            evaluate_typed_expression(expression, &environment),
            &version.declared_type,
            &version.binding_id,
        )
    }
    pub(super) fn lookup_current(&self, binding_id: &str) -> ScalarEvaluation {
        self.current
            .get(binding_id)
            .cloned()
            .unwrap_or_else(|| ScalarEvaluation::Error {
                r#type: self
                    .program
                    .declared_types
                    .get(binding_id)
                    .cloned()
                    .unwrap_or(ScalarType::Number),
                issue_code: VERSION_UNAVAILABLE.to_owned(),
                binding_id: Some(binding_id.to_owned()),
                context: None,
            })
    }

    fn resolve_record_field(
        &self,
        collection_value_id: &str,
        index: f64,
        field: &ValidatedScalarProgramRecordFieldIdentity,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> ScalarEvaluation {
        if !seen.insert(collection_value_id.to_owned()) {
            return ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        };
        match &value.value {
            ValidatedScalarProgramCollectionValue::Alias(target) => {
                self.resolve_record_field(target, index, field, state, seen)
            }
            ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id,
                field: source_field,
                ..
            } if source_field.record_statement_id == field.record_statement_id
                && source_field.field_index == field.field_index =>
            {
                self.resolve_record_field(source_value_id, index, field, state, seen)
            }
            ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id,
                binder_fields,
                fields,
                source_order,
                ..
            } => {
                let Some(mapped_field) = fields.iter().find(|candidate| {
                    candidate.record_statement_id == field.record_statement_id
                        && candidate.field_index == field.field_index
                }) else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                let mut local_bindings = HashMap::with_capacity(binder_fields.len());
                for binder_field in binder_fields {
                    let value = self.resolve_record_field(
                        source_value_id,
                        index,
                        &ValidatedScalarProgramRecordFieldIdentity {
                            record_statement_id: binder_field.record_statement_id.clone(),
                            field_index: binder_field.field_index,
                            r#type: binder_field.r#type.clone(),
                        },
                        state,
                        &mut seen.clone(),
                    );
                    if matches!(&value, ScalarEvaluation::Error { .. }) {
                        return value;
                    }
                    local_bindings.insert(binder_field.binding_id.clone(), value);
                }
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order as f64,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(&local_bindings),
                };
                result_for_declared_type(
                    evaluate_typed_expression(&mapped_field.body, &environment),
                    &mapped_field.r#type,
                    collection_value_id,
                )
            }
            ValidatedScalarProgramCollectionValue::Literal(members) => {
                let Some(ValidatedScalarProgramCollectionMember::Record { fields }) =
                    members.get(index as usize)
                else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: "evaluation-collection-index-invalid".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                let Some(member_field) = fields.iter().find(|candidate| {
                    candidate.record_statement_id == field.record_statement_id
                        && candidate.field_index == field.field_index
                }) else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                result_for_declared_type(
                    self.resolve(&member_field.binding_id, state),
                    &field.r#type,
                    &member_field.binding_id,
                )
            }
            _ => ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            },
        }
    }

    fn resolve_collection_index(
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
                    if matches!(source, ScalarEvaluation::Error { .. }) {
                        return source;
                    }
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order as f64,
                        local_binding_id: Some(binder_id.as_str()),
                        local_binding: Some(&source),
                        local_bindings: None,
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
                        state,
                        &mut HashSet::new(),
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
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
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
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: None,
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
                issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                binding_id: None,
                context: None,
            },
            error @ ScalarEvaluation::Error { .. } => error,
        }
    }

    fn resolve_collection_length(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> Option<f64> {
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return lookup_geometry_collection_length(state, self, collection_value_id, seen);
        };
        if !seen.insert(collection_value_id.to_owned()) {
            return None;
        }
        let result = match &value.value {
            ValidatedScalarProgramCollectionValue::Alias(target) => {
                self.resolve_collection_length(target, state, seen)
            }
            ValidatedScalarProgramCollectionValue::Literal(members) => Some(members.len() as f64),
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
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: None,
                };
                match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        r#type: ScalarType::Boolean,
                        value: ScalarValue::Boolean(selected),
                    } => self.resolve_collection_length(
                        if selected {
                            then_value_id
                        } else {
                            else_value_id
                        },
                        state,
                        seen,
                    ),
                    _ => None,
                }
            }
            ValidatedScalarProgramCollectionValue::Match {
                scrutinee,
                arms,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: None,
                };
                let ScalarEvaluation::Ok {
                    r#type: ScalarType::Choice { .. },
                    value:
                        ScalarValue::Choice {
                            value: selected, ..
                        },
                } = evaluate_typed_expression(scrutinee, &environment)
                else {
                    return None;
                };
                let (_, selected_value_id) = arms.iter().find(|(label, _)| label == &selected)?;
                self.resolve_collection_length(selected_value_id, state, seen)
            }
        };
        seen.remove(collection_value_id);
        result
    }
}
struct MutationEnvironment<'a, 'b, 'c> {
    resolver: &'a ScalarMutationResolver<'a>,
    state: &'b EvaluationState,
    source_order: f64,
    local_binding_id: Option<&'c str>,
    local_binding: Option<&'c ScalarEvaluation>,
    local_bindings: Option<&'c HashMap<BindingId, ScalarEvaluation>>,
}
impl ScalarEvaluationEnvironment for MutationEnvironment<'_, '_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
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

    fn lookup_geometry_builtin_target(
        &self,
        target: &super::types::ScalarExpressionResolvedGeometryTarget,
    ) -> Result<
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeError,
    > {
        resolve_geometry_builtin_target(self.state, self.source_order, target)
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
}
impl ScalarDocumentBindingResolver for ScalarMutationResolver<'_> {
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
