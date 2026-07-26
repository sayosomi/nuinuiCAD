//! Task 32/33 in-place mutation cursor. Conditional selection is registered
//! by Task 25's Rust runtime; this module never parses or evaluates a branch.
mod for_group_scheduler;
use super::bindings::ScalarDocumentBindingResolver;
use super::bindings::{resolve_external_binding, result_for_declared_type, scalar_evaluation_json};
use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::mutation_payload::{
    InitialState, ValidatedBindingVersion, ValidatedBindingVersionKind, ValidatedBindingVersions,
};
use super::types::{BindingId, ScalarEvaluation, ScalarType};
use crate::evaluation::types::EvaluationState;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(crate) use for_group_scheduler::ForGroupMutationStatement;

const VERSION_UNAVAILABLE: &str = "evaluation-binding-version-unavailable";

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
            frames: Vec::new(),
        }
    }
    pub(crate) fn advance_before(&mut self, source_order: usize, state: &EvaluationState) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            if version.source_order >= source_order {
                break;
            }
            self.retire_before(version.source_order);
            self.next_version_index += 1;
            if self.is_before_cutoff(version.source_order) {
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
            if self.is_before_cutoff(version.source_order) {
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
        if self.conditional_results.contains_key(&owner_id) {
            return;
        }
        let result = branch.map(str::to_owned);
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
    pub(crate) fn resolve(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        if self.program.binding_ids.contains(binding_id) {
            self.lookup_current(binding_id)
        } else {
            resolve_external_binding(binding_id, state)
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
    pub(super) fn control_active(&self, version: &ValidatedBindingVersion) -> bool {
        let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
            return false;
        };
        chain.iter().all(|owner| {
            owner.get("kind").and_then(Value::as_str) == Some("conditionalBranch")
                && self
                    .conditional_results
                    .get(
                        owner
                            .get("ownerStatementId")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
                    .is_some_and(|result| {
                        result.as_deref() == owner.get("branch").and_then(Value::as_str)
                    })
        })
    }
    fn execute(&mut self, version: &ValidatedBindingVersion, state: &EvaluationState) {
        if !self.control_active(version) {
            self.history.push(json!({"versionId": version.version_id, "statementId": version.statement_id, "bindingId": version.binding_id, "status": "inactive-control"}));
            return;
        }
        let evaluation = match (&version.initial_state, &version.kind) {
            (InitialState::Poisoned, _)
            | (_, ValidatedBindingVersionKind::Declare { initializer: None }) => {
                ScalarEvaluation::Error {
                    r#type: version.declared_type.clone(),
                    issue_code: "poisoned-binding".to_owned(),
                    binding_id: Some(version.binding_id.clone()),
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
            })
    }
}
struct MutationEnvironment<'a, 'b> {
    resolver: &'a ScalarMutationResolver<'a>,
    state: &'b EvaluationState,
}
impl ScalarEvaluationEnvironment for MutationEnvironment<'_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.resolver.resolve(binding_id, self.state)
    }
}
impl ScalarDocumentBindingResolver for ScalarMutationResolver<'_> {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        self.resolve(binding_id, state)
    }
}
