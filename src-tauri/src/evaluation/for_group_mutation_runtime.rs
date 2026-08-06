//! Generated-element runtime for Task 35 mutation-owned forGroups.
//! Scheduler frame lifetime stays in `scalars::mutation`; this adapter owns
//! geometry lifecycle, nested template expansion, and iteration-local control
//! registration.

use super::*;
use crate::evaluation::for_group::{
    expand_for_group_iteration_from_template, for_group_loop_values, for_group_owned_template_ids,
};
use crate::evaluation::scalars::{ForGroupMutationEnvironment, ForGroupMutationError};

pub(super) struct ForGroupMutationRuntime<'a> {
    original_elements: &'a [Value],
    base_effective_enabled_ids: &'a HashSet<ElementId>,
    entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedPropertyBinding>>,
    numeric_entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedNumericBinding>>,
    show_generated_by_element_id: &'a HashMap<ElementId, ValidatedPropertyBinding>,
    condition_by_element_id: &'a HashMap<ElementId, TypedScalarExpression>,
    text_templates_by_element_id: &'a HashMap<ElementId, ValidatedTextTemplate>,
    effective_visible_element_ids: &'a mut Vec<ElementId>,
    effective_enabled_ids: &'a mut HashSet<ElementId>,
    effective_enabled_order: &'a mut Vec<ElementId>,
    conditional_group_states: &'a mut HashMap<ElementId, Option<&'static str>>,
    condition_inactive_ids: &'a mut HashSet<ElementId>,
    for_group_generated_rows: &'a mut Vec<types::ForGroupGeneratedRow>,
    for_group_effective_show_generated_ids: &'a mut Vec<ElementId>,
}

impl<'a> ForGroupMutationRuntime<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        original_elements: &'a [Value],
        base_effective_enabled_ids: &'a HashSet<ElementId>,
        entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedPropertyBinding>>,
        numeric_entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedNumericBinding>>,
        show_generated_by_element_id: &'a HashMap<ElementId, ValidatedPropertyBinding>,
        condition_by_element_id: &'a HashMap<ElementId, TypedScalarExpression>,
        text_templates_by_element_id: &'a HashMap<ElementId, ValidatedTextTemplate>,
        effective_visible_element_ids: &'a mut Vec<ElementId>,
        effective_enabled_ids: &'a mut HashSet<ElementId>,
        effective_enabled_order: &'a mut Vec<ElementId>,
        conditional_group_states: &'a mut HashMap<ElementId, Option<&'static str>>,
        condition_inactive_ids: &'a mut HashSet<ElementId>,
        for_group_generated_rows: &'a mut Vec<types::ForGroupGeneratedRow>,
        for_group_effective_show_generated_ids: &'a mut Vec<ElementId>,
    ) -> Self {
        Self {
            original_elements,
            base_effective_enabled_ids,
            entries_by_element_id,
            numeric_entries_by_element_id,
            show_generated_by_element_id,
            condition_by_element_id,
            text_templates_by_element_id,
            effective_visible_element_ids,
            effective_enabled_ids,
            effective_enabled_order,
            conditional_group_states,
            condition_inactive_ids,
            for_group_generated_rows,
            for_group_effective_show_generated_ids,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn run(
        &mut self,
        resolver: &mut ScalarMutationResolver<'_>,
        environment: &mut ForGroupMutationEnvironment<scalars::ScalarEvaluation>,
        template_for_group: &Value,
        instance_for_group: &Value,
        start: f64,
        count: usize,
        step: f64,
        show_generated: bool,
        ancestor_iteration_variables: &[Value],
        ancestor_element_id_map: &HashMap<ElementId, ElementId>,
        state: &mut EvaluationState,
    ) -> Result<ForGroupMutationRunOutcome, ForGroupMutationError> {
        let template_for_group_id = element_id(template_for_group)
            .expect("forGroup template must have a validated element id");
        let owned_template_ids_vec =
            for_group_owned_template_ids(self.original_elements, &template_for_group_id);
        let owned_template_ids: HashSet<ElementId> =
            owned_template_ids_vec.iter().cloned().collect();
        let statements = owned_template_ids_vec
            .into_iter()
            .filter_map(|template_element_id| {
                resolver
                    .source_order_for_element(&template_element_id)
                    .map(|source_order| ForGroupMutationStatement::Element {
                        source_order,
                        template_element_id,
                    })
            })
            .chain(
                resolver
                    .for_group_exit_source_order(&template_for_group_id)
                    .map(|source_order| ForGroupMutationStatement::Exit { source_order }),
            )
            .collect::<Vec<_>>();
        let mut expanded_iteration = None;
        let mut generated = Vec::new();
        let mut rows = Vec::new();
        let mut current_iteration_variable = Value::Null;
        let mut current_child_ancestor_element_id_map = ancestor_element_id_map.clone();
        let instance_is_visible = element_id(instance_for_group)
            .is_some_and(|id| self.effective_visible_element_ids.contains(&id));
        resolver.run_for_group(
            &template_for_group_id,
            environment,
            (0..count)
                .map(|iteration_index| start + iteration_index as f64 * step)
                .collect(),
            statements,
            state,
            |resolver, environment, context, state| {
                let ForGroupMutationStatement::Element {
                    template_element_id,
                    ..
                } = context.statement
                else {
                    return Ok(ForGroupMutationRunOutcome::Completed);
                };
                if expanded_iteration != Some(context.iteration_index) {
                    expanded_iteration = Some(context.iteration_index);
                    let expanded = expand_for_group_iteration_from_template(
                        self.original_elements,
                        instance_for_group,
                        Some(&template_for_group_id),
                        context.iteration_index,
                        context.iteration_value,
                        ancestor_iteration_variables,
                        ancestor_element_id_map,
                    );
                    generated = expanded.0;
                    rows = expanded.1;
                    current_iteration_variable = expanded.2;
                    current_child_ancestor_element_id_map = ancestor_element_id_map.clone();
                    for (generated_element, template_id) in &generated {
                        if owned_template_ids.contains(template_id) {
                            if let Some(generated_id) = element_id(generated_element) {
                                current_child_ancestor_element_id_map
                                    .insert(template_id.clone(), generated_id);
                            }
                        }
                    }
                }
                self.run_generated_statement(
                    resolver,
                    environment,
                    template_element_id,
                    &generated,
                    &rows,
                    show_generated,
                    instance_is_visible,
                    ancestor_iteration_variables,
                    &current_child_ancestor_element_id_map,
                    &current_iteration_variable,
                    state,
                )
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn run_generated_statement(
        &mut self,
        resolver: &mut ScalarMutationResolver<'_>,
        environment: &mut ForGroupMutationEnvironment<scalars::ScalarEvaluation>,
        template_element_id: &str,
        generated: &[(Value, ElementId)],
        rows: &[types::ForGroupGeneratedRow],
        show_generated: bool,
        instance_is_visible: bool,
        ancestor_iteration_variables: &[Value],
        ancestor_element_id_map: &HashMap<ElementId, ElementId>,
        current_iteration_variable: &Value,
        state: &mut EvaluationState,
    ) -> Result<ForGroupMutationRunOutcome, ForGroupMutationError> {
        let Some((mut generated_element, template_id)) = generated
            .iter()
            .find(|(_, candidate)| candidate == template_element_id)
            .cloned()
        else {
            return Ok(ForGroupMutationRunOutcome::Completed);
        };
        if let Some(row) = rows
            .iter()
            .find(|row| row.template_element_id == template_id)
            .cloned()
        {
            self.for_group_generated_rows.push(row);
        }
        let Some(generated_id) = element_id(&generated_element) else {
            return Ok(ForGroupMutationRunOutcome::Completed);
        };
        if show_generated
            && instance_is_visible
            && self.effective_visible_element_ids.contains(&template_id)
        {
            self.effective_visible_element_ids
                .push(generated_id.clone());
        }
        state
            .elements_by_id
            .insert(generated_id.clone(), state.elements.len());
        state.elements.push(generated_element.clone());
        if let Some(condition_group_id) =
            inactive_conditional_group_id(&generated_element, state, self.conditional_group_states)
        {
            self.condition_inactive_ids.insert(generated_id.clone());
            state
                .group_states
                .entry(generated_id)
                .or_default()
                .disabled_by_group_id = Some(condition_group_id);
            return Ok(ForGroupMutationRunOutcome::Completed);
        }
        if !self.base_effective_enabled_ids.contains(&template_id) {
            return Ok(ForGroupMutationRunOutcome::Completed);
        }
        if self.effective_enabled_ids.insert(generated_id.clone()) {
            self.effective_enabled_order.push(generated_id.clone());
        }
        let loop_binding_resolver = resolver.for_group_binding_resolver(environment);
        if let Some(entries) = self.numeric_entries_by_element_id.get(&template_id) {
            match apply_numeric_bindings(
                &generated_element,
                Some(entries),
                &loop_binding_resolver,
                state,
            ) {
                Ok(materialized) => generated_element = materialized,
                Err(error) => {
                    state.errors.push(error);
                    return Ok(ForGroupMutationRunOutcome::Completed);
                }
            }
        }
        let generated_index = state.elements_by_id[&generated_id];
        state.elements[generated_index] = generated_element.clone();
        let Some(local_variables) = evaluate_local_variables(generated_index, state) else {
            return Ok(ForGroupMutationRunOutcome::Completed);
        };

        if element_type(&generated_element) == Some("forGroup") {
            let template_for_group = self
                .original_elements
                .iter()
                .find(|element| element_id(element).as_deref() == Some(template_id.as_str()))
                .expect("generated forGroup must retain its source template");
            let Some((start, count, step)) =
                for_group_loop_values(&generated_element, &local_variables, state)
            else {
                return Ok(ForGroupMutationRunOutcome::Completed);
            };
            let nested_show_generated = self.record_effective_show_generated(
                &generated_element,
                &template_id,
                resolver,
                environment,
                state,
            );
            let mut child_ancestor_iteration_variables = ancestor_iteration_variables.to_vec();
            child_ancestor_iteration_variables.push(current_iteration_variable.clone());
            return self.run(
                resolver,
                environment,
                template_for_group,
                &generated_element,
                start,
                count,
                step,
                nested_show_generated,
                &child_ancestor_iteration_variables,
                ancestor_element_id_map,
                state,
            );
        }

        match self.entries_by_element_id.get(&template_id) {
            Some(entries) if !entries.is_empty() => match apply_property_bindings(
                &generated_element,
                Some(entries),
                &loop_binding_resolver,
                state,
            ) {
                Ok(materialized_element) => self.evaluate_generated_element(
                    resolver,
                    environment,
                    generated_id,
                    materialized_element,
                    template_id,
                    local_variables,
                    state,
                ),
                Err(error) => {
                    state.errors.push(error);
                    Ok(ForGroupMutationRunOutcome::Completed)
                }
            },
            _ => self.evaluate_generated_element(
                resolver,
                environment,
                generated_id,
                generated_element,
                template_id,
                local_variables,
                state,
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn evaluate_generated_element(
        &mut self,
        resolver: &mut ScalarMutationResolver<'_>,
        environment: &ForGroupMutationEnvironment<scalars::ScalarEvaluation>,
        generated_id: ElementId,
        generated_element: Value,
        template_id: ElementId,
        local_variables: (HashMap<String, f64>, HashMap<String, String>),
        state: &mut EvaluationState,
    ) -> Result<ForGroupMutationRunOutcome, ForGroupMutationError> {
        let loop_binding_resolver = resolver.for_group_binding_resolver(environment);
        let is_conditional = element_type(&generated_element) == Some("conditionalGroup");
        evaluate_element_by_type(
            generated_id.clone(),
            generated_element,
            local_variables,
            self.conditional_group_states,
            ConditionalGroupContext {
                lookup_id: &template_id,
                by_element_id: self.condition_by_element_id,
                scalar_binding_resolver: Some(&loop_binding_resolver),
            },
            TextTemplateContext {
                lookup_id: &template_id,
                by_element_id: self.text_templates_by_element_id,
                scalar_binding_resolver: Some(&loop_binding_resolver),
            },
            state,
        );
        if is_conditional {
            let branch = self
                .conditional_group_states
                .get(&generated_id)
                .copied()
                .flatten();
            resolver.register_conditional_result(&template_id, branch);
        }
        Ok(ForGroupMutationRunOutcome::Completed)
    }

    fn record_effective_show_generated(
        &mut self,
        instance_for_group: &Value,
        template_for_group_id: &str,
        resolver: &ScalarMutationResolver<'_>,
        environment: &ForGroupMutationEnvironment<scalars::ScalarEvaluation>,
        state: &EvaluationState,
    ) -> bool {
        let literal = instance_for_group
            .get("showGenerated")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let loop_binding_resolver = resolver.for_group_binding_resolver(environment);
        let effective = self
            .show_generated_by_element_id
            .get(template_for_group_id)
            .map(|entry| {
                resolve_for_group_effective_show_generated(
                    Some(entry),
                    literal,
                    &loop_binding_resolver,
                    state,
                )
            })
            .unwrap_or(literal);
        if effective {
            if let Some(id) = element_id(instance_for_group) {
                self.for_group_effective_show_generated_ids.push(id);
            }
        }
        effective
    }
}
