//! Recursive expansion runtime for the generic (non-mutation-owned) forGroup
//! iteration path. Mirrors `ForGroupMutationRuntime`'s shape - same owned
//! template-id filtering, same explicit ancestor-iteration-variable
//! threading - but carries no scheduler/resolver/environment dependency:
//! iteration is a plain nested loop, not scheduler-driven statement replay,
//! so there is no `Result<Outcome, Error>` to propagate and no per-iteration
//! loop-scoped binding resolver to derive; `active_scalar_binding_resolver`
//! is the same plain, already-resolved resolver the generic top-level loop
//! uses for every other binding lookup.

use super::*;
use crate::evaluation::for_group::{
    expand_for_group_iteration_from_template, for_group_loop_values, for_group_owned_template_ids,
    iteration_local_variables,
};

pub(super) struct GenericForGroupRuntime<'a> {
    original_elements: &'a [Value],
    base_effective_enabled_ids: &'a HashSet<ElementId>,
    entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedPropertyBinding>>,
    numeric_entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedNumericBinding>>,
    show_generated_by_element_id: &'a HashMap<ElementId, ValidatedPropertyBinding>,
    condition_by_element_id: &'a HashMap<ElementId, TypedScalarExpression>,
    text_templates_by_element_id: &'a HashMap<ElementId, ValidatedTextTemplate>,
    active_scalar_binding_resolver: Option<&'a dyn ScalarDocumentBindingResolver>,
    effective_visible_element_ids: &'a mut Vec<ElementId>,
    effective_enabled_ids: &'a mut HashSet<ElementId>,
    effective_enabled_order: &'a mut Vec<ElementId>,
    conditional_group_states: &'a mut HashMap<ElementId, Option<&'static str>>,
    condition_inactive_ids: &'a mut HashSet<ElementId>,
    for_group_generated_rows: &'a mut Vec<types::ForGroupGeneratedRow>,
    for_group_effective_show_generated_ids: &'a mut Vec<ElementId>,
}

impl<'a> GenericForGroupRuntime<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        original_elements: &'a [Value],
        base_effective_enabled_ids: &'a HashSet<ElementId>,
        entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedPropertyBinding>>,
        numeric_entries_by_element_id: &'a HashMap<ElementId, Vec<ValidatedNumericBinding>>,
        show_generated_by_element_id: &'a HashMap<ElementId, ValidatedPropertyBinding>,
        condition_by_element_id: &'a HashMap<ElementId, TypedScalarExpression>,
        text_templates_by_element_id: &'a HashMap<ElementId, ValidatedTextTemplate>,
        active_scalar_binding_resolver: Option<&'a dyn ScalarDocumentBindingResolver>,
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
            active_scalar_binding_resolver,
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
        template_for_group: &Value,
        instance_for_group: &Value,
        start: f64,
        count: usize,
        step: f64,
        effective_show_generated: bool,
        ancestor_iteration_variables: &[Value],
        ancestor_element_id_map: &HashMap<ElementId, ElementId>,
        state: &mut EvaluationState,
    ) {
        let template_for_group_id = element_id(template_for_group)
            .expect("forGroup template must have a validated element id");
        let owned_template_ids: HashSet<ElementId> =
            for_group_owned_template_ids(self.original_elements, &template_for_group_id)
                .into_iter()
                .collect();
        let instance_is_visible = element_id(instance_for_group)
            .is_some_and(|id| self.effective_visible_element_ids.contains(&id));

        for iteration_index in 0..count {
            let variable_value = start + iteration_index as f64 * step;
            let (generated, rows, iteration_variable) = expand_for_group_iteration_from_template(
                self.original_elements,
                instance_for_group,
                Some(&template_for_group_id),
                iteration_index,
                variable_value,
                ancestor_element_id_map,
            );
            for row in rows
                .into_iter()
                .filter(|row| owned_template_ids.contains(&row.template_element_id))
            {
                self.for_group_generated_rows.push(row);
            }
            let mut child_ancestor_iteration_variables = ancestor_iteration_variables.to_vec();
            child_ancestor_iteration_variables.push(iteration_variable);
            let mut child_ancestor_element_id_map = ancestor_element_id_map.clone();
            for (generated_element, template_id) in &generated {
                if owned_template_ids.contains(template_id) {
                    if let Some(generated_id) = element_id(generated_element) {
                        child_ancestor_element_id_map.insert(template_id.clone(), generated_id);
                    }
                }
            }
            for (generated_element, template_id) in generated {
                if !owned_template_ids.contains(&template_id) {
                    continue;
                }
                self.run_generated_element(
                    generated_element,
                    template_id,
                    effective_show_generated,
                    instance_is_visible,
                    &child_ancestor_iteration_variables,
                    &child_ancestor_element_id_map,
                    state,
                );
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run_generated_element(
        &mut self,
        mut generated_element: Value,
        template_id: ElementId,
        effective_show_generated: bool,
        instance_is_visible: bool,
        ancestor_iteration_variables: &[Value],
        ancestor_element_id_map: &HashMap<ElementId, ElementId>,
        state: &mut EvaluationState,
    ) {
        let Some(generated_id) = element_id(&generated_element) else {
            return;
        };
        if effective_show_generated
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
            return;
        }
        if !self.base_effective_enabled_ids.contains(&template_id) {
            return;
        }
        if self.effective_enabled_ids.insert(generated_id.clone()) {
            self.effective_enabled_order.push(generated_id.clone());
        }
        if let Some(entries) = self.numeric_entries_by_element_id.get(&template_id) {
            let resolver = self
                .active_scalar_binding_resolver
                .expect("scalar_binding_resolver must exist when numeric bindings exist");
            match apply_numeric_bindings(&generated_element, Some(entries), resolver, None, state) {
                Ok(materialized) => generated_element = materialized,
                Err(error) => {
                    state.errors.push(error);
                    return;
                }
            }
        }
        let generated_index = state.elements_by_id[&generated_id];
        state.elements[generated_index] = generated_element.clone();
        let local_variables = iteration_local_variables(ancestor_iteration_variables);

        if element_type(&generated_element) == Some("forGroup") {
            let nested_template = self
                .original_elements
                .iter()
                .find(|element| element_id(element).as_deref() == Some(template_id.as_str()))
                .expect("generated forGroup must retain its source template");
            let Some((nested_start, nested_count, nested_step)) =
                for_group_loop_values(&generated_element, &local_variables, state)
            else {
                return;
            };
            let nested_effective_show_generated =
                self.record_effective_show_generated(&generated_element, &template_id, state);
            self.run(
                nested_template,
                &generated_element,
                nested_start,
                nested_count,
                nested_step,
                nested_effective_show_generated,
                ancestor_iteration_variables,
                ancestor_element_id_map,
                state,
            );
            return;
        }

        // Bound properties live on the template statement/element, not on a
        // forGroup-generated clone's own synthetic id - look up by
        // template_id, so every iteration sees the same resolved value
        // uniformly (boolean/choice bindings never vary per iteration; that
        // is loop-mutation territory, out of scope here).
        match self.entries_by_element_id.get(&template_id) {
            Some(entries) if !entries.is_empty() => {
                let resolver = self
                    .active_scalar_binding_resolver
                    .expect("scalar_binding_resolver must exist when property bindings exist");
                match apply_property_bindings(&generated_element, Some(entries), resolver, state) {
                    Ok(materialized_element) => evaluate_element_by_type(
                        generated_id,
                        materialized_element,
                        local_variables,
                        self.conditional_group_states,
                        ConditionalGroupContext {
                            lookup_id: &template_id,
                            by_element_id: self.condition_by_element_id,
                            scalar_binding_resolver: self.active_scalar_binding_resolver,
                        },
                        TextTemplateContext {
                            lookup_id: &template_id,
                            by_element_id: self.text_templates_by_element_id,
                            scalar_binding_resolver: self.active_scalar_binding_resolver,
                        },
                        state,
                    ),
                    Err(error) => state.errors.push(error),
                }
            }
            _ => evaluate_element_by_type(
                generated_id,
                generated_element,
                local_variables,
                self.conditional_group_states,
                ConditionalGroupContext {
                    lookup_id: &template_id,
                    by_element_id: self.condition_by_element_id,
                    scalar_binding_resolver: self.active_scalar_binding_resolver,
                },
                TextTemplateContext {
                    lookup_id: &template_id,
                    by_element_id: self.text_templates_by_element_id,
                    scalar_binding_resolver: self.active_scalar_binding_resolver,
                },
                state,
            ),
        }
    }

    fn record_effective_show_generated(
        &mut self,
        instance_for_group: &Value,
        template_for_group_id: &str,
        state: &EvaluationState,
    ) -> bool {
        let literal = instance_for_group
            .get("showGenerated")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let effective = match self.show_generated_by_element_id.get(template_for_group_id) {
            Some(entry) => {
                let resolver = self.active_scalar_binding_resolver.expect(
                    "scalar_binding_resolver must exist when control_boolean_bindings exist",
                );
                resolve_for_group_effective_show_generated(Some(entry), literal, resolver, state)
            }
            None => literal,
        };
        if effective {
            if let Some(id) = element_id(instance_for_group) {
                self.for_group_effective_show_generated_ids.push(id);
            }
        }
        effective
    }
}
