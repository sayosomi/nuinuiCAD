//! One-way, in-place runtime walker for Task 32's validated linear versions.
//! It intentionally owns no source parsing, name resolution, or control-flow
//! semantics; non-linear owners are rejected by `mutation_payload`.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::bindings::ScalarDocumentBindingResolver;
use super::bindings::{resolve_external_binding, result_for_declared_type, scalar_evaluation_json};
use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::mutation_payload::{
    InitialState, ValidatedBindingVersionKind, ValidatedBindingVersions,
};
use super::types::{BindingId, ScalarEvaluation, ScalarType};
use crate::evaluation::types::EvaluationState;

const VERSION_UNAVAILABLE: &str = "evaluation-binding-version-unavailable";

pub(crate) struct ScalarMutationResolver<'a> {
    program: &'a ValidatedBindingVersions,
    current: HashMap<BindingId, ScalarEvaluation>,
    output_binding_order: Vec<BindingId>,
    next_version_index: usize,
    history: Vec<Value>,
}

impl<'a> ScalarMutationResolver<'a> {
    pub(crate) fn new(program: &'a ValidatedBindingVersions) -> Self {
        Self {
            program,
            current: HashMap::new(),
            output_binding_order: Vec::new(),
            next_version_index: 0,
            history: Vec::new(),
        }
    }

    /// Evaluates all versions strictly before this source statement. Calling
    /// this repeatedly is monotonic; an already advanced version is never
    /// reconsidered or re-evaluated.
    pub(crate) fn advance_before(&mut self, source_order: usize, state: &EvaluationState) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            if version.source_order >= source_order {
                return;
            }
            self.next_version_index += 1;
            if self.is_before_cutoff(version.source_order) {
                self.execute(version, state);
            }
        }
    }

    /// Terminal pass for document end/@stop. This intentionally continues the
    /// same one-way cursor so declarations/sets after the last geometry
    /// element are still observable, while cutoff versions produce neither
    /// a slot update nor history entry.
    pub(crate) fn finalize(&mut self, state: &EvaluationState) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            self.next_version_index += 1;
            if self.is_before_cutoff(version.source_order) {
                self.execute(version, state);
            }
        }
    }

    pub(crate) fn source_order_for_element(&self, element_id: &str) -> Option<usize> {
        self.program.element_source_orders.get(element_id).copied()
    }

    pub(crate) fn resolve(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        if self.program.binding_ids.contains(binding_id) {
            self.lookup_current(binding_id)
        } else {
            resolve_external_binding(binding_id, state)
        }
    }

    pub(crate) fn computed_bindings(&self) -> Vec<Value> {
        self.output_binding_order
            .iter()
            .filter_map(|binding_id| {
                self.current.get(binding_id).map(|evaluation| {
                    json!({
                        "bindingId": binding_id,
                        "evaluation": scalar_evaluation_json(evaluation),
                    })
                })
            })
            .collect()
    }

    pub(crate) fn history(&self) -> Vec<Value> {
        self.history.clone()
    }

    fn is_before_cutoff(&self, source_order: usize) -> bool {
        !self
            .program
            .evaluation_limit_source_order
            .is_some_and(|limit| source_order >= limit)
    }

    fn execute(
        &mut self,
        version: &super::mutation_payload::ValidatedBindingVersion,
        state: &EvaluationState,
    ) {
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
            ) => self.evaluate(expression, version, state),
            (_, ValidatedBindingVersionKind::Set { expression }) => {
                self.evaluate(expression, version, state)
            }
        };
        if !self.current.contains_key(&version.binding_id) {
            self.output_binding_order.push(version.binding_id.clone());
        }
        self.current
            .insert(version.binding_id.clone(), evaluation.clone());
        self.history.push(json!({
            "versionId": version.version_id,
            "statementId": version.statement_id,
            "bindingId": version.binding_id,
            "status": if matches!(evaluation, ScalarEvaluation::Error { .. }) { "poisoned" } else { "executed" },
            "evaluation": scalar_evaluation_json(&evaluation),
        }));
    }

    fn evaluate(
        &self,
        expression: &super::types::TypedScalarExpression,
        version: &super::mutation_payload::ValidatedBindingVersion,
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

    fn lookup_current(&self, binding_id: &str) -> ScalarEvaluation {
        if let Some(value) = self.current.get(binding_id) {
            return value.clone();
        }
        if self.program.binding_ids.contains(binding_id) {
            return ScalarEvaluation::Error {
                r#type: self
                    .program
                    .declared_types
                    .get(binding_id)
                    .cloned()
                    .unwrap_or(ScalarType::Number),
                issue_code: VERSION_UNAVAILABLE.to_owned(),
                binding_id: Some(binding_id.to_owned()),
            };
        }
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: VERSION_UNAVAILABLE.to_owned(),
            binding_id: Some(binding_id.to_owned()),
        }
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
