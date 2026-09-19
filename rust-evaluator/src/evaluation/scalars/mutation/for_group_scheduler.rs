//! Task 35's production bridge between the document mutation cursor and
//! Task 34's frame-owning forGroup core. Geometry remains in `evaluation`;
//! this module owns only statement-boundary scalar execution.

use super::super::bindings::ScalarDocumentBindingResolver;
use super::*;
use crate::evaluation::scalar_expression_runtime::{
    lookup_for_group_geometry_property, lookup_geometry_property,
    lookup_geometry_value_binder_property, lookup_geometry_value_property,
    resolve_for_group_geometry_builtin_target, ForGroupGeometryPropertyRequest,
};
use crate::evaluation::scalars::for_group_execution_core::{
    ForGroupExecutionEnvironment, ForGroupExecutionError, ForGroupExecutionPlan,
    ForGroupExecutionRunOutcome, ForGroupIterationContext, LoopRead,
};
use crate::evaluation::scalars::geometry_builtin_runtime::{
    geometry_builtin_runtime_target_value, resolve_geometry_builtin_target,
};
use crate::evaluation::scalars::mutation_payload::{
    ValidatedImmutableGeometryCarry, ValidatedImmutableGeometryCollectionSource,
};
use crate::evaluation::types::{
    GeometryInputCollectionNode, GeometryInputTarget, GeometryValueOccurrence,
};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ForGroupExecutionStatement {
    Element {
        source_order: usize,
        template_element_id: String,
    },
    Exit {
        source_order: usize,
    },
}

impl ForGroupExecutionStatement {
    pub(crate) fn source_order(&self) -> usize {
        match self {
            Self::Element { source_order, .. } | Self::Exit { source_order } => *source_order,
        }
    }
}

impl ScalarMutationResolver<'_> {
    pub(crate) fn for_group_binding_resolver<'resolver, 'environment>(
        &'resolver self,
        environment: &'environment ForGroupExecutionEnvironment<ScalarEvaluation>,
    ) -> ForGroupExecutionBindingResolver<'resolver, 'resolver, 'environment> {
        ForGroupExecutionBindingResolver {
            resolver: self,
            environment,
        }
    }
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

    pub(crate) fn for_group_owner_statement_id(&self, element_id: &str) -> Option<&str> {
        self.program
            .for_group_owners_by_element_id
            .get(element_id)
            .map(|owner| owner.owner_statement_id.as_str())
    }

    pub(crate) fn begin_for_group_environment(
        &self,
    ) -> ForGroupExecutionEnvironment<ScalarEvaluation> {
        ForGroupExecutionEnvironment::new(self.current.clone())
    }

    pub(crate) fn commit_for_group_environment(
        &mut self,
        environment: &ForGroupExecutionEnvironment<ScalarEvaluation>,
    ) {
        self.current = environment.final_values();
    }

    fn immutable_carries_for(
        &self,
        owner_statement_id: &str,
    ) -> &[super::super::mutation_payload::ValidatedImmutableForGroupCarry] {
        self.program
            .immutable_for_groups
            .get(owner_statement_id)
            .map_or(&[], |plan| {
                debug_assert_eq!(plan.owner_statement_id, owner_statement_id);
                plan.carries.as_slice()
            })
    }

    fn geometry_collection_source_node(
        &self,
        source: &ValidatedImmutableGeometryCollectionSource,
        nodes: &HashMap<String, GeometryInputCollectionNode>,
    ) -> Option<GeometryInputCollectionNode> {
        match source {
            ValidatedImmutableGeometryCollectionSource::Value(value_id) => {
                nodes.get(value_id).and_then(clone_geometry_collection_node)
            }
            ValidatedImmutableGeometryCollectionSource::Node(node) => {
                clone_geometry_collection_node(node)
            }
        }
    }

    fn install_geometry_carry(
        &self,
        state: &mut EvaluationState,
        carry: &ValidatedImmutableGeometryCarry,
        value: &super::super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
    ) {
        self.install_geometry_carry_value(state, &carry.binding_id, &carry.initializer, value);
    }

    fn install_geometry_carry_value(
        &self,
        state: &mut EvaluationState,
        binding_id: &str,
        target: &super::super::types::ScalarExpressionResolvedGeometryTarget,
        value: &super::super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
    ) {
        let occurrence = GeometryValueOccurrence {
            source_statement_id: binding_id.to_owned(),
            instance_path: Vec::new(),
            mapped_member_index: None,
        };
        state.computed_geometry_values.insert(
            occurrence.clone(),
            geometry_builtin_runtime_target_value(value),
        );
        state.geometry_value_binders.insert(
            binding_id.to_owned(),
            GeometryInputTarget::GeometryValue {
                occurrence,
                geometry_type: geometry_type_name(&target.geometry_type),
                point_key: None,
            },
        );
    }

    fn seed_for_group_carries(
        &mut self,
        owner_statement_id: &str,
        environment: &mut ForGroupExecutionEnvironment<ScalarEvaluation>,
        state: &mut EvaluationState,
        current_source_order: f64,
    ) -> Result<(), ForGroupExecutionError> {
        for carry in self.immutable_carries_for(owner_statement_id) {
            let initial = self.evaluate_for_group(
                &carry.initializer,
                &carry.declared_type,
                &carry.binding_id,
                0,
                environment,
                state,
            );
            environment.seed(&carry.binding_id, initial)?;
        }
        let plan = self.program.immutable_for_groups.get(owner_statement_id);
        if let Some(plan) = plan {
            for carry in &plan.collection_carries {
                self.collection_carry_value_ids.insert(
                    carry.collection_value_id.clone(),
                    carry.initializer_value_id.clone(),
                );
            }
            let resolver = self.for_group_binding_resolver(environment);
            for carry in &plan.geometry_carries {
                if let Ok(value) = resolve_for_group_geometry_builtin_target(
                    state,
                    &resolver,
                    current_source_order,
                    &carry.initializer,
                ) {
                    self.install_geometry_carry(state, carry, &value);
                }
            }
            for carry in &plan.geometry_collection_carries {
                if let Some(node) = self.geometry_collection_source_node(
                    &carry.initializer,
                    &state.geometry_collection_nodes,
                ) {
                    state
                        .geometry_collection_nodes
                        .insert(carry.collection_value_id.clone(), node);
                }
            }
        }
        Ok(())
    }

    fn commit_for_group_carries(
        &mut self,
        owner_statement_id: &str,
        environment: &mut ForGroupExecutionEnvironment<ScalarEvaluation>,
        state: &mut EvaluationState,
    ) -> Result<(), ForGroupExecutionError> {
        let carries = self.immutable_carries_for(owner_statement_id);
        let mut next_values = Vec::with_capacity(carries.len());
        for carry in carries {
            let next = self.evaluate_for_group(
                &carry.next_expression,
                &carry.declared_type,
                &carry.next_binding_id,
                carry.next_source_order,
                environment,
                state,
            );
            next_values.push((carry.binding_id.clone(), next));
        }
        for (binding_id, value) in next_values {
            environment.commit(&binding_id, value)?;
        }
        let Some(plan) = self.program.immutable_for_groups.get(owner_statement_id) else {
            return Ok(());
        };
        let collection_snapshot = self.collection_carry_value_ids.clone();
        let collection_next_values = plan
            .collection_carries
            .iter()
            .map(|carry| {
                (
                    carry.collection_value_id.clone(),
                    resolve_collection_carry_snapshot(
                        &carry.next_value_id,
                        &collection_snapshot,
                        &self.program.collection_values,
                    ),
                )
            })
            .collect::<Vec<_>>();
        for (value_id, next) in collection_next_values {
            self.collection_carry_value_ids.insert(value_id, next);
        }

        let resolver = self.for_group_binding_resolver(environment);
        let geometry_next_values = plan
            .geometry_carries
            .iter()
            .filter_map(|carry| {
                let template_element_id = carry
                    .next
                    .for_group_template_element_id
                    .as_deref()
                    .or_else(|| {
                        state
                            .for_group_generated_rows
                            .iter()
                            .any(|row| row.template_element_id == carry.next.statement_id)
                            .then_some(carry.next.statement_id.as_str())
                    });
                let resolved = if let Some(template_element_id) = template_element_id {
                    let row = state
                        .for_group_generated_rows
                        .iter()
                        .rev()
                        .find(|row| row.template_element_id == template_element_id);
                    if let Some(row) = row {
                        let mut target = carry.next.clone();
                        target.statement_id = row.generated_element_id.clone();
                        target.statement_index = -1.0;
                        target.for_group_template_element_id = None;
                        target.for_group_target_source_order = None;
                        target.for_group_index = None;
                        resolve_geometry_builtin_target(state, f64::INFINITY, &target)
                    } else {
                        Err(super::super::geometry_builtin_runtime::GeometryBuiltinRuntimeError::CollectionIndexUnavailable)
                    }
                } else {
                    resolve_for_group_geometry_builtin_target(
                        state,
                        &resolver,
                        f64::INFINITY,
                        &carry.next,
                    )
                };
                resolved.ok().map(|value| (carry.binding_id.clone(), value, carry))
            })
            .collect::<Vec<_>>();
        for (binding_id, value, carry) in geometry_next_values {
            self.install_geometry_carry_value(state, &binding_id, &carry.next, &value);
        }
        let geometry_collection_next_values = plan
            .geometry_collection_carries
            .iter()
            .filter_map(|carry| {
                self.geometry_collection_source_node(&carry.next, &state.geometry_collection_nodes)
                    .map(|node| (carry.collection_value_id.clone(), node))
            })
            .collect::<Vec<_>>();
        for (value_id, node) in geometry_collection_next_values {
            state.geometry_collection_nodes.insert(value_id, node);
        }
        Ok(())
    }

    pub(crate) fn consume_for_group_source_range(
        &mut self,
        owner_statement_id: &str,
        exit_source_order: usize,
    ) {
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            let belongs_to_owner = version
                .control
                .get("ownerChain")
                .and_then(Value::as_array)
                .is_some_and(|chain| {
                    chain.iter().any(|owner| {
                        owner.get("kind").and_then(Value::as_str) == Some("forGroup")
                            && owner.get("ownerStatementId").and_then(Value::as_str)
                                == Some(owner_statement_id)
                    })
                });
            if version.source_order >= exit_source_order && !belongs_to_owner {
                break;
            }
            self.next_version_index += 1;
        }
    }

    pub(crate) fn run_for_group<F>(
        &mut self,
        element_id: &str,
        environment: &mut ForGroupExecutionEnvironment<ScalarEvaluation>,
        iteration_values: Vec<f64>,
        statements: Vec<ForGroupExecutionStatement>,
        state: &mut EvaluationState,
        mut execute_statement: F,
    ) -> Result<ForGroupExecutionRunOutcome, ForGroupExecutionError>
    where
        F: FnMut(
            &mut Self,
            &mut ForGroupExecutionEnvironment<ScalarEvaluation>,
            ForGroupIterationContext<'_, ForGroupExecutionStatement>,
            &mut EvaluationState,
        ) -> Result<ForGroupExecutionRunOutcome, ForGroupExecutionError>,
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
        let plan = ForGroupExecutionPlan {
            loop_scope_id: owner.scope_id,
            iteration_binding_id: owner.iteration_binding_id,
            iteration_values,
            generated_statements: statements,
        };
        let loop_source_order = self
            .source_order_for_element(element_id)
            .unwrap_or_default() as f64;
        self.seed_for_group_carries(
            &owner.owner_statement_id,
            environment,
            state,
            loop_source_order,
        )?;
        self.push_loop_conditional_results();
        let outcome = environment.run(&plan, |environment, context| {
            if active_iteration != Some(context.iteration_index) {
                active_iteration = Some(context.iteration_index);
                version_index = 0;
                self.reset_loop_conditional_results();
            }
            while version_index < loop_versions.len()
                && self.program.versions[loop_versions[version_index]].source_order
                    < context.statement.source_order()
            {
                let version_index_in_program = loop_versions[version_index];
                version_index += 1;
                if self
                    .is_before_cutoff(self.program.versions[version_index_in_program].source_order)
                {
                    self.execute_for_group_version(version_index_in_program, environment, state)?;
                }
            }
            if !self.is_before_cutoff(context.statement.source_order()) {
                return Ok(ForGroupExecutionRunOutcome::Stopped);
            }
            if matches!(context.statement, ForGroupExecutionStatement::Exit { .. }) {
                self.commit_for_group_carries(&owner.owner_statement_id, environment, state)?;
            }
            execute_statement(self, environment, context, state)
        });
        self.pop_loop_conditional_results();
        outcome
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
                !self.is_immutable_carry_binding(&version.binding_id)
                    && !chain[index + 1..]
                        .iter()
                        .any(|owner| owner.get("kind").and_then(Value::as_str) == Some("forGroup"))
            })
            .map(|(index, _)| index)
            .collect()
    }

    fn execute_for_group_version(
        &mut self,
        version_index: usize,
        environment: &mut ForGroupExecutionEnvironment<ScalarEvaluation>,
        state: &EvaluationState,
    ) -> Result<(), ForGroupExecutionError> {
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
                    context: None,
                }
            }
            (
                _,
                ValidatedBindingVersionKind::Declare {
                    initializer: Some(expression),
                },
            ) => self.evaluate_for_group(
                expression,
                &version.declared_type,
                &version.binding_id,
                version.source_order,
                environment,
                state,
            ),
        };
        let version_id = version.version_id.clone();
        let statement_id = version.statement_id.clone();
        let binding_id = version.binding_id.clone();
        environment.declare_local(&binding_id, evaluation.clone())?;
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
                    .conditional_result(
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
        declared_type: &ScalarType,
        binding_id: &str,
        source_order: usize,
        environment: &ForGroupExecutionEnvironment<ScalarEvaluation>,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        let lookup = ForGroupExecutionEvaluationEnvironment {
            resolver: self,
            environment,
            state,
            source_order,
        };
        result_for_declared_type(
            evaluate_typed_expression(expression, &lookup),
            declared_type,
            binding_id,
        )
    }
}

fn resolve_collection_carry_snapshot(
    value_id: &str,
    redirects: &HashMap<String, String>,
    collection_values: &[super::super::program_payload::ValidatedScalarProgramCollection],
) -> String {
    let mut current = value_id.to_owned();
    let mut seen = HashMap::new();
    loop {
        if seen.insert(current.clone(), ()).is_some() {
            break;
        }
        if let Some(next) = redirects.get(&current) {
            current = next.clone();
            continue;
        }
        let Some(value) = collection_values
            .iter()
            .find(|value| value.value_id == current)
        else {
            break;
        };
        let super::super::program_payload::ValidatedScalarProgramCollectionValue::Alias(target) =
            &value.value
        else {
            break;
        };
        current = target.clone();
    }
    current
}

fn geometry_type_name(geometry_type: &super::super::types::GeometryInterfaceType) -> String {
    match geometry_type {
        super::super::types::GeometryInterfaceType::Point => "point",
        super::super::types::GeometryInterfaceType::Line => "line",
        super::super::types::GeometryInterfaceType::Path => "path",
    }
    .to_owned()
}

fn clone_geometry_collection_node(
    node: &GeometryInputCollectionNode,
) -> Option<GeometryInputCollectionNode> {
    match node {
        GeometryInputCollectionNode::None => Some(GeometryInputCollectionNode::None),
        GeometryInputCollectionNode::Leaf { targets } => Some(GeometryInputCollectionNode::Leaf {
            targets: targets
                .iter()
                .map(clone_geometry_input_target)
                .collect::<Option<Vec<_>>>()?,
        }),
        GeometryInputCollectionNode::If { .. }
        | GeometryInputCollectionNode::Match { .. }
        | GeometryInputCollectionNode::Coalesce { .. } => None,
    }
}

fn clone_geometry_input_target(target: &GeometryInputTarget) -> Option<GeometryInputTarget> {
    match target {
        GeometryInputTarget::Drawable {
            element_id,
            geometry_type,
            point_key,
        } => Some(GeometryInputTarget::Drawable {
            element_id: element_id.clone(),
            geometry_type: geometry_type.clone(),
            point_key: point_key.clone(),
        }),
        GeometryInputTarget::GeometryValue {
            occurrence,
            geometry_type,
            point_key,
        } => Some(GeometryInputTarget::GeometryValue {
            occurrence: occurrence.clone(),
            geometry_type: geometry_type.clone(),
            point_key: point_key.clone(),
        }),
        GeometryInputTarget::Coordinate { anchor } => Some(GeometryInputTarget::Coordinate {
            anchor: anchor.clone(),
        }),
        GeometryInputTarget::ForGroupOccurrence { .. }
        | GeometryInputTarget::GeometryValueMap { .. }
        | GeometryInputTarget::CollectionValue { .. }
        | GeometryInputTarget::CollectionIndex { .. } => None,
    }
}

pub(crate) struct ForGroupExecutionBindingResolver<'resolver, 'program, 'environment> {
    resolver: &'resolver ScalarMutationResolver<'program>,
    environment: &'environment ForGroupExecutionEnvironment<ScalarEvaluation>,
}

impl ScalarDocumentBindingResolver for ForGroupExecutionBindingResolver<'_, '_, '_> {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        match self.environment.read(binding_id) {
            Some(LoopRead::Iteration(value)) => ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: super::super::types::ScalarValue::Number(value),
            },
            Some(LoopRead::Slot(value)) => value,
            None => self.resolver.resolve(binding_id, state),
        }
    }
}

struct ForGroupExecutionEvaluationEnvironment<'a, 'b> {
    resolver: &'a ScalarMutationResolver<'a>,
    environment: &'b ForGroupExecutionEnvironment<ScalarEvaluation>,
    state: &'b EvaluationState,
    source_order: usize,
}

impl ScalarEvaluationEnvironment for ForGroupExecutionEvaluationEnvironment<'_, '_> {
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
            Some(self.source_order as f64),
            property_type,
        )
    }

    fn lookup_geometry_value_property(
        &self,
        occurrence: &GeometryValueOccurrence,
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
            Some(self.source_order as f64),
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
            Some(self.source_order as f64),
            property_type,
        )
    }

    fn lookup_for_group_geometry_property(
        &self,
        template_element_id: &str,
        index: Option<&super::super::types::TypedScalarExpression>,
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
                current_source_order: Some(self.source_order as f64),
                property_type,
            },
        )
    }

    fn lookup_geometry_builtin_target(
        &self,
        target: &super::super::types::ScalarExpressionResolvedGeometryTarget,
    ) -> Result<
        super::super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
        super::super::geometry_builtin_runtime::GeometryBuiltinRuntimeError,
    > {
        resolve_for_group_geometry_builtin_target(
            self.state,
            self.resolver,
            self.source_order as f64,
            target,
        )
    }
}
