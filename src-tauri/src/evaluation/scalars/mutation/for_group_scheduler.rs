//! Task 35's production bridge between the document mutation cursor and
//! Task 34's frame-owning forGroup core. Geometry remains in `evaluation`;
//! this module owns only statement-boundary scalar execution.

use super::*;
use crate::evaluation::scalars::for_group_mutation_core::{
    ForGroupIterationContext, ForGroupMutationEnvironment, ForGroupMutationError,
    ForGroupMutationPlan, ForGroupMutationRunOutcome, LoopRead,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ForGroupMutationStatement {
    Element {
        source_order: usize,
        template_element_id: String,
    },
    Exit {
        source_order: usize,
    },
}

impl ForGroupMutationStatement {
    pub(crate) fn source_order(&self) -> usize {
        match self {
            Self::Element { source_order, .. } | Self::Exit { source_order } => *source_order,
        }
    }
}

impl ScalarMutationResolver<'_> {
    pub(crate) fn has_for_group_owner(&self, element_id: &str) -> bool {
        self.program
            .for_group_owners_by_element_id
            .contains_key(element_id)
    }

    pub(crate) fn for_group_exit_source_order(&self, element_id: &str) -> Option<usize> {
        self.program
            .for_group_owners_by_element_id
            .get(element_id)
            .map(|owner| owner.exit_source_order)
    }

    pub(crate) fn begin_for_group_environment(
        &self,
    ) -> ForGroupMutationEnvironment<ScalarEvaluation> {
        ForGroupMutationEnvironment::new(self.current.clone())
    }

    pub(crate) fn commit_for_group_environment(
        &mut self,
        environment: &ForGroupMutationEnvironment<ScalarEvaluation>,
    ) {
        self.current = environment.final_slots();
    }

    pub(crate) fn consume_for_group_source_range(&mut self, exit_source_order: usize) {
        while self.next_version_index < self.program.versions.len()
            && self.program.versions[self.next_version_index].source_order < exit_source_order
        {
            self.next_version_index += 1;
        }
    }

    pub(crate) fn run_for_group<F>(
        &mut self,
        element_id: &str,
        environment: &mut ForGroupMutationEnvironment<ScalarEvaluation>,
        iteration_values: Vec<f64>,
        statements: Vec<ForGroupMutationStatement>,
        state: &mut EvaluationState,
        mut execute_statement: F,
    ) -> Result<ForGroupMutationRunOutcome, ForGroupMutationError>
    where
        F: FnMut(
            &mut Self,
            &mut ForGroupMutationEnvironment<ScalarEvaluation>,
            ForGroupIterationContext<'_, ForGroupMutationStatement>,
            &mut EvaluationState,
        ) -> Result<ForGroupMutationRunOutcome, ForGroupMutationError>,
    {
        let owner = self
            .program
            .for_group_owners_by_element_id
            .get(element_id)
            .expect("validated forGroup mutation payload must contain the owner")
            .clone();
        let loop_versions = self.loop_versions_for(&owner.owner_statement_id);
        let mut version_index = 0usize;
        let mut active_iteration = None;
        let plan = ForGroupMutationPlan {
            loop_scope_id: owner.scope_id,
            iteration_binding_id: owner.iteration_binding_id,
            iteration_values,
            generated_statements: statements,
        };
        environment.run(&plan, |environment, context| {
            if !self.is_before_cutoff(context.statement.source_order()) {
                return Ok(ForGroupMutationRunOutcome::Stopped);
            }
            if active_iteration != Some(context.iteration_index) {
                active_iteration = Some(context.iteration_index);
                version_index = 0;
            }
            while version_index < loop_versions.len()
                && self.program.versions[loop_versions[version_index]].source_order
                    < context.statement.source_order()
            {
                let version_index_in_program = loop_versions[version_index];
                version_index += 1;
                if !self
                    .is_before_cutoff(self.program.versions[version_index_in_program].source_order)
                {
                    return Ok(ForGroupMutationRunOutcome::Stopped);
                }
                self.execute_for_group_version(version_index_in_program, environment, state)?;
            }
            execute_statement(self, environment, context, state)
        })
    }

    fn loop_versions_for(&self, owner_statement_id: &str) -> Vec<usize> {
        self.program
            .versions
            .iter()
            .enumerate()
            .filter(|(_, version)| {
                let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array)
                else {
                    return false;
                };
                let Some(index) = chain.iter().position(|owner| {
                    owner.get("kind").and_then(Value::as_str) == Some("forGroup")
                        && owner.get("ownerStatementId").and_then(Value::as_str)
                            == Some(owner_statement_id)
                }) else {
                    return false;
                };
                !chain[index + 1..]
                    .iter()
                    .any(|owner| owner.get("kind").and_then(Value::as_str) == Some("forGroup"))
            })
            .map(|(index, _)| index)
            .collect()
    }

    fn execute_for_group_version(
        &mut self,
        version_index: usize,
        environment: &mut ForGroupMutationEnvironment<ScalarEvaluation>,
        state: &EvaluationState,
    ) -> Result<(), ForGroupMutationError> {
        let version = &self.program.versions[version_index];
        if !self.for_group_control_active(version) {
            self.record_history(json!({
                "versionId": version.version_id,
                "statementId": version.statement_id,
                "bindingId": version.binding_id,
                "status": "inactive-control"
            }));
            return Ok(());
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
                self.evaluate_for_group(expression, version, environment, state)
            }
        };
        let version_id = version.version_id.clone();
        let statement_id = version.statement_id.clone();
        let binding_id = version.binding_id.clone();
        let is_declaration = matches!(version.kind, ValidatedBindingVersionKind::Declare { .. });
        if is_declaration {
            environment.declare_local(&binding_id, evaluation.clone())?;
        } else {
            environment.set(&binding_id, evaluation.clone())?;
        }
        self.record_history(json!({
            "versionId": version_id,
            "statementId": statement_id,
            "bindingId": binding_id,
            "status": if matches!(evaluation, ScalarEvaluation::Error { .. }) { "poisoned" } else { "executed" },
            "evaluation": scalar_evaluation_json(&evaluation)
        }));
        Ok(())
    }

    fn for_group_control_active(&self, version: &ValidatedBindingVersion) -> bool {
        let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
            return false;
        };
        chain
            .iter()
            .all(|owner| match owner.get("kind").and_then(Value::as_str) {
                Some("forGroup") => true,
                Some("conditionalBranch") => self
                    .conditional_results
                    .get(
                        owner
                            .get("ownerStatementId")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
                    .is_some_and(|result| {
                        result.as_deref() == owner.get("branch").and_then(Value::as_str)
                    }),
                _ => false,
            })
    }

    fn evaluate_for_group(
        &self,
        expression: &super::super::types::TypedScalarExpression,
        version: &ValidatedBindingVersion,
        environment: &ForGroupMutationEnvironment<ScalarEvaluation>,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        let lookup = ForGroupMutationEvaluationEnvironment {
            resolver: self,
            environment,
            state,
        };
        result_for_declared_type(
            evaluate_typed_expression(expression, &lookup),
            &version.declared_type,
            &version.binding_id,
        )
    }
}

struct ForGroupMutationEvaluationEnvironment<'a, 'b> {
    resolver: &'a ScalarMutationResolver<'a>,
    environment: &'b ForGroupMutationEnvironment<ScalarEvaluation>,
    state: &'b EvaluationState,
}

impl ScalarEvaluationEnvironment for ForGroupMutationEvaluationEnvironment<'_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        match self.environment.read(binding_id) {
            Some(LoopRead::Iteration(value)) => ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: super::super::types::ScalarValue::Number(value),
            },
            Some(LoopRead::Slot(value)) => value,
            None => self.resolver.resolve(binding_id, self.state),
        }
    }
}
