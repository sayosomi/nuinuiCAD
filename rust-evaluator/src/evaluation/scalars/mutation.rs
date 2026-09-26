//! Task 32/33 in-place mutation cursor. Conditional selection is registered
//! by Task 25's Rust runtime; this module never parses or evaluates a branch.
mod for_group_scheduler;
use super::super::scalar_expression_runtime::{
    lookup_for_group_geometry_property, lookup_geometry_collection_length,
    lookup_geometry_collection_presence, lookup_geometry_property,
    lookup_geometry_value_binder_property, lookup_geometry_value_property,
    lookup_optional_geometry_property, resolve_for_group_geometry_builtin_target,
    ForGroupGeometryPropertyRequest,
};
use super::bindings::ScalarDocumentBindingResolver;
use super::bindings::{
    record_field_path_matches, result_for_declared_type, result_for_scalar_type,
    scalar_evaluation_json, select_collection_match_arm, ScalarRecordMapBinderContext,
};
use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::mutation_payload::{
    InitialState, ValidatedBindingVersion, ValidatedBindingVersionKind, ValidatedBindingVersions,
};
use super::program_payload::{
    ValidatedScalarProgramCollectionMember, ValidatedScalarProgramCollectionValue,
    ValidatedScalarProgramRecordFieldIdentity,
};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{
    BindingId, ScalarEvaluation, ScalarExpressionResolvedOptionalMemberTarget, ScalarType,
    ScalarValue,
};
use crate::evaluation::geometry_value_runtime::{
    evaluate_geometry_value_entry, GeometryValueProgramEntry,
};
use crate::evaluation::types::EvaluationState;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(crate) use for_group_scheduler::ForGroupExecutionStatement;

const BINDING_UNAVAILABLE: &str = "evaluation-binding-unavailable";
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
    collection_carry_value_ids: HashMap<String, String>,
}

pub(crate) struct GeometryValueReleaseContext<'a> {
    pub(crate) program: &'a [GeometryValueProgramEntry],
    pub(crate) execution_positions: &'a [f64],
    pub(crate) release_allowed: &'a [bool],
    pub(crate) evaluated: &'a mut [bool],
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
            collection_carry_value_ids: HashMap::new(),
        }
    }
    pub(crate) fn advance_before_statement(
        &mut self,
        source_order: usize,
        state: &EvaluationState,
    ) {
        while self.next_version_index < self.program.versions.len() {
            let version_source_order = self.program.versions[self.next_version_index].source_order;
            if version_source_order >= source_order {
                break;
            }
            self.retire_before(version_source_order);
            self.next_version_index += 1;
            let version = &self.program.versions[self.next_version_index - 1];
            self.execute(version, state);
        }
        self.retire_before(source_order);
    }
    pub(crate) fn advance_before_with_geometry_values(
        &mut self,
        source_order: usize,
        geometry_execution_position: f64,
        state: &mut EvaluationState,
        mut geometry_values: GeometryValueReleaseContext<'_>,
    ) {
        while self.next_version_index < self.program.versions.len() {
            let version_source_order = self.program.versions[self.next_version_index].source_order;
            if version_source_order >= source_order {
                break;
            }
            self.retire_before(version_source_order);
            self.evaluate_geometry_values_through(
                geometry_execution_position,
                version_source_order,
                &mut geometry_values,
                state,
            );
            self.next_version_index += 1;
            let version = &self.program.versions[self.next_version_index - 1];
            self.execute(version, state);
        }
        self.retire_before(source_order);
        self.evaluate_geometry_values_through(
            geometry_execution_position,
            source_order,
            &mut geometry_values,
            state,
        );
    }
    fn evaluate_geometry_values_through(
        &self,
        geometry_execution_position: f64,
        source_order: usize,
        geometry_values: &mut GeometryValueReleaseContext<'_>,
        state: &mut EvaluationState,
    ) {
        let resolver: &dyn ScalarDocumentBindingResolver = self;
        let mut entry_indices = (0..geometry_values.program.len()).collect::<Vec<_>>();
        entry_indices.sort_by(|left, right| {
            geometry_values
                .execution_positions
                .get(*left)
                .copied()
                .unwrap_or(geometry_values.program[*left].execution_position)
                .total_cmp(
                    &geometry_values
                        .execution_positions
                        .get(*right)
                        .copied()
                        .unwrap_or(geometry_values.program[*right].execution_position),
                )
                .then_with(|| left.cmp(right))
        });
        for index in entry_indices {
            let entry = &geometry_values.program[index];
            let release_position = geometry_values
                .execution_positions
                .get(index)
                .copied()
                .unwrap_or(entry.execution_position);
            if geometry_values
                .evaluated
                .get(index)
                .copied()
                .unwrap_or(true)
                || !geometry_values
                    .release_allowed
                    .get(index)
                    .copied()
                    .unwrap_or(true)
                || release_position > geometry_execution_position
                || entry.source_execution_position > source_order as f64
            {
                continue;
            }
            if !entry.lazy {
                evaluate_geometry_value_entry(entry, resolver, state);
            }
            if let Some(evaluated) = geometry_values.evaluated.get_mut(index) {
                *evaluated = true;
            }
        }
    }
    pub(crate) fn finalize(&mut self, state: &EvaluationState) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            self.retire_before(version.source_order);
            self.next_version_index += 1;
            self.execute(version, state);
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
        let mut computed = self.program.versions.iter().filter(|version| matches!(version.kind, ValidatedBindingVersionKind::Declare { .. }) &&
            version.control.get("ownerChain").and_then(Value::as_array).is_some_and(Vec::is_empty))
            .filter_map(|version| self.current.get(&version.binding_id).map(|evaluation| json!({"bindingId": version.binding_id, "evaluation": scalar_evaluation_json(evaluation)}))).collect::<Vec<_>>();
        for plan in self.program.immutable_for_groups.values() {
            for carry in &plan.carries {
                if let Some(evaluation) = self.current.get(&carry.binding_id) {
                    computed.push(json!({"bindingId": carry.binding_id, "evaluation": scalar_evaluation_json(evaluation)}));
                }
            }
        }
        computed
    }

    pub(crate) fn is_immutable_carry_binding(&self, binding_id: &str) -> bool {
        self.program.immutable_for_groups.values().any(|plan| {
            plan.carries
                .iter()
                .any(|carry| carry.binding_id == binding_id || carry.next_binding_id == binding_id)
                || plan
                    .geometry_carries
                    .iter()
                    .any(|carry| carry.binding_id == binding_id)
                || plan
                    .collection_carries
                    .iter()
                    .any(|carry| carry.binding_id == binding_id)
                || plan
                    .geometry_collection_carries
                    .iter()
                    .any(|carry| carry.binding_id == binding_id)
        })
    }

    pub(crate) fn resolve_collection_carry_value_id(&self, value_id: &str) -> String {
        let mut current = value_id.to_owned();
        let mut seen = HashSet::new();
        while let Some(next) = self.collection_carry_value_ids.get(&current) {
            if !seen.insert(current.clone()) {
                break;
            }
            current = next.clone();
        }
        current
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
            ) => self.evaluate(expression, version, state),
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
            record_map_context: None,
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
                issue_code: BINDING_UNAVAILABLE.to_owned(),
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
        self.resolve_record_field_with_bindings(
            collection_value_id,
            index,
            field,
            state,
            seen,
            &HashMap::new(),
        )
    }

    fn resolve_record_field_with_bindings(
        &self,
        collection_value_id: &str,
        index: f64,
        field: &ValidatedScalarProgramRecordFieldIdentity,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
    ) -> ScalarEvaluation {
        let redirected = self.resolve_collection_carry_value_id(collection_value_id);
        if redirected != collection_value_id {
            return self.resolve_record_field_with_bindings(
                &redirected,
                index,
                field,
                state,
                seen,
                local_bindings,
            );
        }
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
            ValidatedScalarProgramCollectionValue::Alias(target) => self
                .resolve_record_field_with_bindings(
                    target,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                ),
            ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id,
                field: source_field,
                ..
            } if record_field_path_matches(
                &source_field.record_statement_id,
                source_field.field_index,
                source_field.field_path.as_deref(),
                field,
            ) =>
            {
                self.resolve_record_field_with_bindings(
                    source_value_id,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                )
            }
            ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id,
                binder_fields,
                fields,
                source_order,
                ..
            } => {
                let Some(mapped_field) = fields.iter().find(|candidate| {
                    record_field_path_matches(
                        &candidate.record_statement_id,
                        candidate.field_index,
                        candidate.field_path.as_deref(),
                        field,
                    )
                }) else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                let record_map_context =
                    ScalarRecordMapBinderContext::new(source_value_id, index, binder_fields, seen);
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order as f64,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: Some(&record_map_context),
                };
                result_for_declared_type(
                    evaluate_typed_expression(&mapped_field.body, &environment),
                    &mapped_field.r#type,
                    collection_value_id,
                )
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
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                };
                let selected = match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(true),
                        ..
                    } => then_value_id,
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(false),
                        ..
                    } => else_value_id,
                    error @ ScalarEvaluation::Error { .. } => {
                        return result_for_scalar_type(error, &field.r#type);
                    }
                    _ => {
                        return ScalarEvaluation::Error {
                            r#type: field.r#type.clone(),
                            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                            binding_id: None,
                            context: None,
                        };
                    }
                };
                self.resolve_record_field_with_bindings(
                    selected,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                )
            }
            ValidatedScalarProgramCollectionValue::Coalesce {
                left_value_id,
                right_value_id,
                ..
            } => {
                let left_present = match self.resolve_collection_presence_with_bindings(
                    left_value_id,
                    state,
                    &mut seen.clone(),
                    local_bindings,
                ) {
                    Ok(present) => present,
                    Err(error) => return result_for_scalar_type(error, &field.r#type),
                };
                let selected = match left_present {
                    Some(true) => left_value_id,
                    Some(false) => right_value_id,
                    None => {
                        return ScalarEvaluation::Error {
                            r#type: field.r#type.clone(),
                            issue_code: "evaluation-collection-index-unavailable".to_owned(),
                            binding_id: None,
                            context: None,
                        }
                    }
                };
                self.resolve_record_field_with_bindings(
                    selected,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                )
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
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                };
                let selected = match select_collection_match_arm(
                    scrutinee,
                    evaluate_typed_expression(scrutinee, &environment),
                    arms,
                ) {
                    Ok(selected) => selected,
                    Err(error) => return result_for_scalar_type(error, &field.r#type),
                };
                let mut branch_bindings = local_bindings.clone();
                if let Some((binding_id, value)) = selected.local_binding {
                    branch_bindings.insert(binding_id, value);
                }
                self.resolve_record_field_with_bindings(
                    &selected.arm.value_id,
                    index,
                    field,
                    state,
                    seen,
                    &branch_bindings,
                )
            }
            ValidatedScalarProgramCollectionValue::Literal(members) => {
                let Some(ValidatedScalarProgramCollectionMember::Record { fields, .. }) =
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
                    record_field_path_matches(
                        &candidate.record_statement_id,
                        candidate.field_index,
                        candidate.field_path.as_deref(),
                        field,
                    )
                }) else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                result_for_declared_type(
                    local_bindings
                        .get(&member_field.binding_id)
                        .cloned()
                        .unwrap_or_else(|| self.resolve(&member_field.binding_id, state)),
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

    fn resolve_collection_presence_with_bindings(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
    ) -> Result<Option<bool>, ScalarEvaluation> {
        let redirected = self.resolve_collection_carry_value_id(collection_value_id);
        if redirected != collection_value_id {
            return self.resolve_collection_presence_with_bindings(
                &redirected,
                state,
                seen,
                local_bindings,
            );
        }
        if !seen.insert(collection_value_id.to_owned()) {
            return Ok(None);
        }
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return Ok(lookup_geometry_collection_presence(
                state,
                self,
                collection_value_id,
                &mut HashSet::new(),
            ));
        };
        match &value.value {
            ValidatedScalarProgramCollectionValue::None => Ok(Some(false)),
            ValidatedScalarProgramCollectionValue::Literal(_) => Ok(Some(true)),
            ValidatedScalarProgramCollectionValue::Alias(target) => {
                self.resolve_collection_presence_with_bindings(target, state, seen, local_bindings)
            }
            ValidatedScalarProgramCollectionValue::Map {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id, ..
            } => self.resolve_collection_presence_with_bindings(
                source_value_id,
                state,
                seen,
                local_bindings,
            ),
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
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                };
                match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(value),
                        ..
                    } => self.resolve_collection_presence_with_bindings(
                        if value { then_value_id } else { else_value_id },
                        state,
                        seen,
                        local_bindings,
                    ),
                    error @ ScalarEvaluation::Error { .. } => Err(error),
                    _ => Err(ScalarEvaluation::Error {
                        r#type: ScalarType::Boolean,
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    }),
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
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                };
                let selected = select_collection_match_arm(
                    scrutinee,
                    evaluate_typed_expression(scrutinee, &environment),
                    arms,
                )?;
                let mut branch_bindings = local_bindings.clone();
                if let Some((binding_id, value)) = selected.local_binding {
                    branch_bindings.insert(binding_id, value);
                }
                self.resolve_collection_presence_with_bindings(
                    &selected.arm.value_id,
                    state,
                    seen,
                    &branch_bindings,
                )
            }
            ValidatedScalarProgramCollectionValue::Coalesce {
                left_value_id,
                right_value_id,
                ..
            } => match self.resolve_collection_presence_with_bindings(
                left_value_id,
                state,
                &mut seen.clone(),
                local_bindings,
            )? {
                Some(true) => Ok(Some(true)),
                Some(false) => self.resolve_collection_presence_with_bindings(
                    right_value_id,
                    state,
                    seen,
                    local_bindings,
                ),
                None => Ok(None),
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
        self.resolve_collection_index_with_bindings(
            collection_value_id,
            index,
            element_type,
            collection_length,
            state,
            &HashMap::new(),
        )
    }

    fn resolve_collection_index_with_bindings(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        state: &EvaluationState,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
    ) -> ScalarEvaluation {
        let collection_value_id = self.resolve_collection_carry_value_id(collection_value_id);
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
            let redirected = self.resolve_collection_carry_value_id(&current);
            if redirected != current {
                current = redirected;
                continue;
            }
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
                ValidatedScalarProgramCollectionValue::None => {
                    return ScalarEvaluation::Error {
                        r#type: element_type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                ValidatedScalarProgramCollectionValue::Alias(target) => current = target.clone(),
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
                    let source = self.resolve_collection_index_with_bindings(
                        source_value_id,
                        index,
                        source_element_type,
                        None,
                        state,
                        local_bindings,
                    );
                    if matches!(source, ScalarEvaluation::Error { .. }) {
                        return source;
                    }
                    let mut map_bindings = local_bindings.clone();
                    map_bindings.insert(binder_id.clone(), source.clone());
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order as f64,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: Some(&map_bindings),
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
                    return self.resolve_record_field_with_bindings(
                        source_value_id,
                        index,
                        field,
                        state,
                        &mut HashSet::new(),
                        local_bindings,
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
                        local_bindings: Some(local_bindings),
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
                        error @ ScalarEvaluation::Error { .. } => {
                            return result_for_scalar_type(error, element_type);
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
                    return self.resolve_collection_index_with_bindings(
                        selected,
                        index,
                        element_type,
                        None,
                        state,
                        local_bindings,
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
                        local_bindings: Some(local_bindings),
                        record_map_context: None,
                    };
                    let selected = match select_collection_match_arm(
                        scrutinee,
                        evaluate_typed_expression(scrutinee, &environment),
                        arms,
                    ) {
                        Ok(selected) => selected,
                        Err(error) => return result_for_scalar_type(error, element_type),
                    };
                    let mut branch_bindings = local_bindings.clone();
                    if let Some((binding_id, value)) = selected.local_binding {
                        branch_bindings.insert(binding_id, value);
                    }
                    return self.resolve_collection_index_with_bindings(
                        &selected.arm.value_id,
                        index,
                        element_type,
                        None,
                        state,
                        &branch_bindings,
                    );
                }
                ValidatedScalarProgramCollectionValue::Coalesce {
                    left_value_id,
                    right_value_id,
                    ..
                } => {
                    let left_present = match self.resolve_collection_presence_with_bindings(
                        left_value_id,
                        state,
                        &mut seen.clone(),
                        local_bindings,
                    ) {
                        Ok(present) => present,
                        Err(error) => return result_for_scalar_type(error, element_type),
                    };
                    let selected = match left_present {
                        Some(true) => left_value_id,
                        Some(false) => right_value_id,
                        None => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                                binding_id: None,
                                context: None,
                            };
                        }
                    };
                    return self.resolve_collection_index_with_bindings(
                        selected,
                        index,
                        element_type,
                        None,
                        state,
                        local_bindings,
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
                local_bindings
                    .get(binding_id)
                    .cloned()
                    .unwrap_or_else(|| self.resolve(binding_id, state))
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
        self.resolve_collection_length_with_bindings(
            collection_value_id,
            state,
            seen,
            &HashMap::new(),
        )
        .ok()
        .flatten()
    }

    fn resolve_collection_length_with_bindings(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
    ) -> Result<Option<f64>, ScalarEvaluation> {
        let redirected = self.resolve_collection_carry_value_id(collection_value_id);
        if redirected != collection_value_id {
            return self.resolve_collection_length_with_bindings(
                &redirected,
                state,
                seen,
                local_bindings,
            );
        }
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return Ok(lookup_geometry_collection_length(
                state,
                self,
                collection_value_id,
                seen,
            ));
        };
        if !seen.insert(collection_value_id.to_owned()) {
            return Ok(None);
        }
        let result = match &value.value {
            ValidatedScalarProgramCollectionValue::None => Ok(None),
            ValidatedScalarProgramCollectionValue::Alias(target) => {
                self.resolve_collection_length_with_bindings(target, state, seen, local_bindings)
            }
            ValidatedScalarProgramCollectionValue::Literal(members) => {
                Ok(Some(members.len() as f64))
            }
            ValidatedScalarProgramCollectionValue::Map {
                source_value_id, ..
            } => self.resolve_collection_length_with_bindings(
                source_value_id,
                state,
                seen,
                local_bindings,
            ),
            ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id, ..
            } => self.resolve_collection_length_with_bindings(
                source_value_id,
                state,
                seen,
                local_bindings,
            ),
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
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                };
                match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        r#type: ScalarType::Boolean,
                        value: ScalarValue::Boolean(selected),
                    } => self.resolve_collection_length_with_bindings(
                        if selected {
                            then_value_id
                        } else {
                            else_value_id
                        },
                        state,
                        seen,
                        local_bindings,
                    ),
                    error @ ScalarEvaluation::Error { .. } => Err(error),
                    _ => Err(ScalarEvaluation::Error {
                        r#type: ScalarType::Boolean,
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    }),
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
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                };
                let selected = select_collection_match_arm(
                    scrutinee,
                    evaluate_typed_expression(scrutinee, &environment),
                    arms,
                )
                .map_err(|error| result_for_scalar_type(error, &ScalarType::Number))?;
                let mut branch_bindings = local_bindings.clone();
                if let Some((binding_id, value)) = selected.local_binding {
                    branch_bindings.insert(binding_id, value);
                }
                self.resolve_collection_length_with_bindings(
                    &selected.arm.value_id,
                    state,
                    seen,
                    &branch_bindings,
                )
            }
            ValidatedScalarProgramCollectionValue::Coalesce {
                left_value_id,
                right_value_id,
                ..
            } => {
                let left_present = self.resolve_collection_presence_with_bindings(
                    left_value_id,
                    state,
                    &mut seen.clone(),
                    local_bindings,
                )?;
                match left_present {
                    Some(true) => self.resolve_collection_length_with_bindings(
                        left_value_id,
                        state,
                        seen,
                        local_bindings,
                    ),
                    Some(false) => self.resolve_collection_length_with_bindings(
                        right_value_id,
                        state,
                        seen,
                        local_bindings,
                    ),
                    None => Ok(None),
                }
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
    record_map_context: Option<&'c ScalarRecordMapBinderContext>,
}
impl ScalarEvaluationEnvironment for MutationEnvironment<'_, '_, '_> {
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
                return self.resolver.resolve_record_field(
                    &context.source_value_id,
                    context.index,
                    &field,
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

    fn lookup_geometry_value_binder_property(
        &self,
        binder_id: &str,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_value_binder_property(
            self.state,
            binder_id,
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
        stage_path: Option<&[String]>,
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
                stage_path,
                property,
                target_source_order,
                current_source_order: Some(self.source_order),
                property_type,
            },
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

    fn lookup_optional_member(
        &self,
        target: &ScalarExpressionResolvedOptionalMemberTarget,
        r#type: &ScalarType,
    ) -> ScalarEvaluation {
        match target {
            ScalarExpressionResolvedOptionalMemberTarget::CollectionLength {
                target_source_order,
                ..
            }
            | ScalarExpressionResolvedOptionalMemberTarget::RecordField {
                target_source_order,
                ..
            } => {
                if *target_source_order > self.source_order {
                    return ScalarEvaluation::Error {
                        r#type: r#type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                self.resolver
                    .resolve_optional_collection_member(target, r#type, self.state)
            }
            ScalarExpressionResolvedOptionalMemberTarget::GeometryProperty { .. } => {
                lookup_optional_geometry_property(
                    self.state,
                    self.resolver,
                    target,
                    r#type,
                    Some(self.source_order),
                )
            }
        }
    }
}

#[cfg(test)]
#[path = "mutation_tests.rs"]
mod tests;
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

    fn resolve_optional_collection_member(
        &self,
        target: &ScalarExpressionResolvedOptionalMemberTarget,
        r#type: &ScalarType,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        let none = || ScalarEvaluation::Ok {
            r#type: r#type.clone(),
            value: ScalarValue::None,
        };
        match target {
            ScalarExpressionResolvedOptionalMemberTarget::CollectionLength {
                collection_value_id,
                ..
            } => match self.resolve_collection_presence_with_bindings(
                collection_value_id,
                state,
                &mut HashSet::new(),
                &HashMap::new(),
            ) {
                Ok(Some(false)) => none(),
                Ok(Some(true)) => match self.resolve_collection_length_with_bindings(
                    collection_value_id,
                    state,
                    &mut HashSet::new(),
                    &HashMap::new(),
                ) {
                    Ok(Some(length)) => ScalarEvaluation::Ok {
                        r#type: r#type.clone(),
                        value: ScalarValue::Number(length),
                    },
                    Ok(None) => ScalarEvaluation::Error {
                        r#type: r#type.clone(),
                        issue_code: "evaluation-collection-property-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    },
                    Err(error) => result_for_scalar_type(error, r#type),
                },
                Ok(None) => ScalarEvaluation::Error {
                    r#type: r#type.clone(),
                    issue_code: "evaluation-collection-property-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                },
                Err(error) => result_for_scalar_type(error, r#type),
            },
            ScalarExpressionResolvedOptionalMemberTarget::RecordField {
                collection_value_id,
                collection_length: _,
                field,
                ..
            } => match self.resolve_collection_presence_with_bindings(
                collection_value_id,
                state,
                &mut HashSet::new(),
                &HashMap::new(),
            ) {
                Ok(Some(false)) => none(),
                Ok(Some(true)) => {
                    let field = ValidatedScalarProgramRecordFieldIdentity {
                        record_statement_id: field.record_statement_id.clone(),
                        field_index: field.field_index,
                        r#type: field.r#type.clone(),
                        field_path: (!field.field_path.is_empty()).then(|| {
                            field
                                .field_path
                                .iter()
                                .map(|(statement_id, field_index)| {
                                    super::program_payload::ValidatedScalarProgramRecordFieldPathEntry {
                                        record_statement_id: statement_id.clone(),
                                        field_index: *field_index,
                                    }
                                })
                                .collect()
                        }),
                    };
                    match self.resolve_record_field_with_bindings(
                        collection_value_id,
                        0.0,
                        &field,
                        state,
                        &mut HashSet::new(),
                        &HashMap::new(),
                    ) {
                        ScalarEvaluation::Ok { value, .. }
                            if scalar_value_matches_type(r#type, &value) =>
                        {
                            ScalarEvaluation::Ok {
                                r#type: r#type.clone(),
                                value,
                            }
                        }
                        ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
                            r#type: r#type.clone(),
                            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                            binding_id: None,
                            context: None,
                        },
                        ScalarEvaluation::Error { issue_code, .. } => ScalarEvaluation::Error {
                            r#type: r#type.clone(),
                            issue_code,
                            binding_id: None,
                            context: None,
                        },
                    }
                }
                Ok(None) => ScalarEvaluation::Error {
                    r#type: r#type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                },
                Err(error) => result_for_scalar_type(error, r#type),
            },
            ScalarExpressionResolvedOptionalMemberTarget::GeometryProperty { .. } => {
                ScalarEvaluation::Error {
                    r#type: r#type.clone(),
                    issue_code: "evaluation-optional-member-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                }
            }
        }
    }
}
