use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::for_group_ancestor_reference::{
    remap_ancestor_element_references, remap_current_invocation_numeric_references,
};
use super::numeric_expression::evaluate_numeric_or_push;
use super::types::{
    element_display_name, element_id, element_name, element_type,
    element_type_without_own_drawable_geometry, DependencyError, ElementId, EvaluationState,
    ForGroupGeneratedOccurrenceStep, ForGroupGeneratedRow,
};

/// Materializes only the runtime bindings owned by enclosing/current
/// forGroup iterations. Element-owned numeric variable declarations are not
/// part of the persisted or generated element JSON.
pub(crate) fn iteration_local_variables(
    iteration_variables: &[Value],
) -> (HashMap<String, f64>, HashMap<String, String>) {
    let mut values = HashMap::new();
    let mut names = HashMap::new();
    for variable in iteration_variables {
        let Some(id) = variable.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(name) = variable.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(value) = variable.get("value").and_then(Value::as_f64) else {
            continue;
        };
        names.insert(id.to_owned(), name.to_owned());
        values.insert(id.to_owned(), value);
        names.insert(name.to_owned(), name.to_owned());
        values.insert(name.to_owned(), value);
    }
    (values, names)
}

/// Reads and validates a forGroup element's min/max/step. Shared by the
/// mutation-scheduler and generic forGroup runtimes - this has no
/// resolver/environment dependency, so the same validation applies
/// uniformly regardless of which runtime is driving the loop.
pub(crate) fn for_group_loop_values(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) -> Option<Vec<f64>> {
    let min = evaluate_numeric_or_push(
        element.get("min").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    );
    let max = evaluate_numeric_or_push(
        element.get("max").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    );
    let step = evaluate_numeric_or_push(
        element.get("step").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    );
    let (min, max, step) = min.zip(max).zip(step).map(|((a, b), c)| (a, b, c))?;
    let error = |message: String, state: &mut EvaluationState| {
        state.errors.push(DependencyError {
            element_id: element_id(element).unwrap_or_default(),
            element_name: element_name(element),
            missing_dependency_id: element_id(element).unwrap_or_default(),
            missing_dependency_name: Some(element_name(element)),
            message,
        });
    };
    if !min.is_finite() {
        error(
            format!(
                "{} の min は有限の値にしてください。",
                element_name(element)
            ),
            state,
        );
        return None;
    }
    if !max.is_finite() {
        error(
            format!(
                "{} の max は有限の値にしてください。",
                element_name(element)
            ),
            state,
        );
        return None;
    }
    if !step.is_finite() {
        error(
            format!(
                "{} の step は有限の値にしてください。",
                element_name(element)
            ),
            state,
        );
        return None;
    }
    if min > max {
        error(
            format!(
                "{} の min は max 以下にしてください。",
                element_name(element)
            ),
            state,
        );
        return None;
    }
    if step <= 0.0 {
        error(
            format!(
                "{} の step は0より大きい値にしてください。",
                element_name(element)
            ),
            state,
        );
        return None;
    }
    let mut values = Vec::new();
    for iteration_index in 0..=1000 {
        let value = min + iteration_index as f64 * step;
        if !matches!(
            value.partial_cmp(&max),
            Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
        ) {
            return Some(values);
        }
        values.push(value);
        if values.len() > 1000 {
            error(
                format!(
                    "{} の範囲は1000回以下にしてください。",
                    element_name(element)
                ),
                state,
            );
            return None;
        }
    }
    Some(values)
}

fn generated_for_element_id(
    for_group_id: &str,
    template_element_id: &str,
    iteration_index: usize,
) -> ElementId {
    format!("{template_element_id}@{for_group_id}:{iteration_index}")
}

fn descendant_ids_for_group(elements: &[Value], group_id: &str) -> Vec<ElementId> {
    let mut descendants = Vec::new();
    let mut stack = elements
        .iter()
        .filter(|element| element.get("parentGroupId").and_then(Value::as_str) == Some(group_id))
        .filter_map(element_id)
        .collect::<Vec<_>>();
    while let Some(id) = stack.pop() {
        descendants.push(id.clone());
        for child_id in elements
            .iter()
            .filter(|element| {
                element.get("parentGroupId").and_then(Value::as_str) == Some(id.as_str())
            })
            .filter_map(element_id)
        {
            stack.push(child_id);
        }
    }
    let order = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    descendants.sort_by_key(|id| order.get(id).copied().unwrap_or_default());
    descendants
}

pub(crate) fn for_group_template_descendant_ids(elements: &[Value]) -> HashSet<ElementId> {
    let mut ids = HashSet::new();
    for element in elements {
        if element_type(element) != Some("forGroup") {
            continue;
        }
        if let Some(group_id) = element_id(element) {
            for descendant_id in descendant_ids_for_group(elements, &group_id) {
                ids.insert(descendant_id);
            }
        }
    }
    ids
}

/// Source-order template statement ids owned directly by one forGroup entry
/// (used by both the mutation-scheduler runtime and the generic
/// per-iteration path). Descendants of a nested forGroup belong to that
/// nested invocation instead.
pub(crate) fn for_group_owned_template_ids(
    elements: &[Value],
    for_group_id: &str,
) -> Vec<ElementId> {
    descendant_ids_for_group(elements, for_group_id)
        .into_iter()
        .filter(|template_id| {
            let mut parent_id = elements
                .iter()
                .find(|element| element_id(element).as_deref() == Some(template_id.as_str()))
                .and_then(|element| element.get("parentGroupId"))
                .and_then(Value::as_str);
            while let Some(id) = parent_id {
                if id == for_group_id {
                    return true;
                }
                if elements
                    .iter()
                    .find(|element| element_id(element).as_deref() == Some(id))
                    .is_some_and(|element| element_type(element) == Some("forGroup"))
                {
                    return false;
                }
                parent_id = elements
                    .iter()
                    .find(|element| element_id(element).as_deref() == Some(id))
                    .and_then(|element| element.get("parentGroupId"))
                    .and_then(Value::as_str);
            }
            true
        })
        .collect()
}

fn remap_json_ids(value: &mut Value, id_map: &HashMap<ElementId, ElementId>) {
    match value {
        Value::String(text) => {
            if let Some(mapped) = id_map.get(text) {
                *text = mapped.clone();
            }
        }
        Value::Array(items) => {
            for item in items {
                remap_json_ids(item, id_map);
            }
        }
        Value::Object(map) => {
            for nested in map.values_mut() {
                remap_json_ids(nested, id_map);
            }
        }
        _ => {}
    }
}

fn iteration_label(variable_name: &str, variable_value: f64) -> String {
    if variable_value.fract() == 0.0 {
        format!("{variable_name}={variable_value:.0}")
    } else {
        format!("{variable_name}={variable_value:.7}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

/// `for_group` may be a generated nested instance, while its body still comes
/// from the original template statement identified by `template_for_group_id`.
/// `ancestor_element_id_map` carries template-id ->
/// generated-id pairs owned by enclosing forGroup invocations, so a nested
/// body can reference geometry generated by an outer loop - see
/// `for_group_ancestor_reference.rs` for why this is applied through a
/// field-specific remap rather than folded into `remap_json_ids` below.
type ForGroupExpansionResult = (
    Vec<(Value, ElementId)>,
    Vec<ForGroupGeneratedRow>,
    Value,
    Vec<ForGroupGeneratedOccurrenceStep>,
);

pub(crate) fn expand_for_group_iteration_from_template(
    elements: &[Value],
    for_group: &Value,
    template_for_group_id: Option<&str>,
    iteration_index: usize,
    variable_value: f64,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
    ancestor_occurrence_path: &[ForGroupGeneratedOccurrenceStep],
) -> ForGroupExpansionResult {
    let Some(for_group_id) = element_id(for_group) else {
        return (
            Vec::new(),
            Vec::new(),
            Value::Null,
            ancestor_occurrence_path.to_vec(),
        );
    };
    let Some(template_for_group_id) = template_for_group_id else {
        return (
            Vec::new(),
            Vec::new(),
            Value::Null,
            ancestor_occurrence_path.to_vec(),
        );
    };
    let mut occurrence_path = ancestor_occurrence_path.to_vec();
    occurrence_path.push(ForGroupGeneratedOccurrenceStep {
        template_for_group_id: template_for_group_id.to_owned(),
        iteration_index,
    });
    let variable_name = for_group
        .get("variableName")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("i")
        .to_owned();
    let iteration_variable = json!({
        "id": format!("{for_group_id}:iteration"),
        "name": variable_name,
        "value": variable_value
    });
    let template_ids = descendant_ids_for_group(elements, template_for_group_id);
    let template_elements = elements
        .iter()
        .filter(|element| element_id(element).is_some_and(|id| template_ids.contains(&id)))
        .cloned()
        .collect::<Vec<_>>();
    let id_map = template_elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            Some((
                id.clone(),
                generated_for_element_id(&for_group_id, &id, iteration_index),
            ))
        })
        .collect::<HashMap<_, _>>();
    let mut generated = Vec::new();
    let mut rows = Vec::new();

    for template in template_elements {
        let Some(template_id) = element_id(&template) else {
            continue;
        };
        let Some(generated_id) = id_map.get(&template_id).cloned() else {
            continue;
        };
        let mut element = template.clone();
        // Descendant-to-descendant parents (e.g. a conditionalGroup nested
        // inside the forGroup body) are covered by this id_map remap.
        remap_json_ids(&mut element, &id_map);
        if let Some(object) = element.as_object_mut() {
            object.insert("id".to_owned(), Value::String(generated_id.clone()));
            let generated_name =
                if element_type_without_own_drawable_geometry(element_type(&template)) {
                    String::new()
                } else {
                    format!(
                        "[{}] {}",
                        iteration_label(&variable_name, variable_value),
                        element_name(&template)
                    )
                };
            object.insert("name".to_owned(), Value::String(generated_name));
            // A direct child's parentGroupId equals the template forGroup's
            // own id, which is never a member of id_map (only its
            // descendants are) - remap it explicitly to this call's runtime
            // instance id. Fixed up as its own field rather than added to
            // id_map/remap_json_ids, which would blindly rewrite every
            // matching string anywhere in the JSON tree, not just this
            // field.
            if object.get("parentGroupId").and_then(Value::as_str) == Some(template_for_group_id) {
                object.insert(
                    "parentGroupId".to_owned(),
                    Value::String(for_group_id.clone()),
                );
            }
        }
        // remap_json_ids above only rewrites a JSON string that exactly
        // equals an id_map key, which misses numeric-expression fields
        // (the id sits inside a larger string like "<id>.x + 10") - extend
        // coverage to those before also applying the ancestor map.
        remap_current_invocation_numeric_references(&mut element, &id_map);
        remap_ancestor_element_references(&mut element, ancestor_element_id_map);
        if !matches!(
            element_type(&element),
            Some("group" | "conditionalGroup" | "forGroup")
        ) {
            rows.push(ForGroupGeneratedRow {
                for_group_id: for_group_id.clone(),
                template_element_id: template_id.clone(),
                generated_element_id: generated_id.clone(),
                iteration_index,
                occurrence_path: occurrence_path.clone(),
                variable_name: variable_name.clone(),
                variable_value,
                element_name: element_display_name(&element),
                element_type: element_type(&element).unwrap_or_default().to_owned(),
            });
        }
        generated.push((element, template_id));
    }

    (generated, rows, iteration_variable, occurrence_path)
}

#[cfg(test)]
mod tests {
    use super::for_group_loop_values;
    use crate::evaluation::types::EvaluationState;
    use serde_json::{json, Value};
    use std::collections::HashMap;

    fn state_for(element: Value) -> EvaluationState {
        let id = element["id"].as_str().unwrap().to_owned();
        EvaluationState {
            geometry_input_targets: HashMap::new(),
            geometry_value_binders: HashMap::new(),
            elements: vec![element],
            elements_by_id: HashMap::from([(id, 0)]),
            drawing_modifiers: json!([]),
            selected_drawing_profile_id: None,
            group_states: HashMap::new(),
            computed_geometry: HashMap::new(),
            computed_geometry_values: HashMap::new(),
            computed_geometry_order: Vec::new(),
            pre_mutation_geometry: HashMap::new(),
            geometry_mutation_executions: Vec::new(),
            condition_evaluation_traces: Vec::new(),
            instance_base_geometry: HashMap::new(),
            errors: Vec::new(),
            geometry_value_errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn range_element(min: f64, max: f64, step: f64) -> Value {
        json!({
            "id": "loop",
            "name": "loop",
            "type": "forGroup",
            "activity": "visible",
            "variableName": "i",
            "min": min,
            "max": max,
            "step": step,
            "showGenerated": false
        })
    }

    #[test]
    fn generates_exact_min_max_step_values_without_clamping() {
        let element = range_element(0.0, 10.0, 3.0);
        let mut state = state_for(element.clone());
        let values = for_group_loop_values(&element, &(HashMap::new(), HashMap::new()), &mut state)
            .expect("valid range");
        assert_eq!(values, vec![0.0, 3.0, 6.0, 9.0]);
    }

    #[test]
    fn rejects_invalid_ranges_and_enforces_the_iteration_limit() {
        for (min, max, step, expected_message) in [
            (6.0, 5.0, 1.0, "min は max 以下"),
            (0.0, 1.0, 0.0, "step は0より大きい"),
        ] {
            let element = range_element(min, max, step);
            let mut state = state_for(element.clone());
            assert!(
                for_group_loop_values(&element, &(HashMap::new(), HashMap::new()), &mut state)
                    .is_none()
            );
            assert_eq!(state.errors.len(), 1);
            assert!(state.errors[0].message.contains(expected_message));
        }

        let element = range_element(0.0, 1000.0, 1.0);
        let mut state = state_for(element.clone());
        assert!(
            for_group_loop_values(&element, &(HashMap::new(), HashMap::new()), &mut state)
                .is_none()
        );
        assert_eq!(state.errors.len(), 1);
        assert!(state.errors[0].message.contains("1000回以下"));
    }
}
