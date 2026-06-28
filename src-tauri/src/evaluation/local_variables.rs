use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::numeric_expression::evaluate_numeric_or_push;
use super::types::{
    element_id, element_name, element_type, parent_group_id, ElementId, EvaluationState,
};

pub(crate) fn evaluate_local_variables(
    element_index: usize,
    state: &mut EvaluationState,
) -> Option<(HashMap<String, f64>, HashMap<String, String>)> {
    let element = state.elements[element_index].clone();
    let mut local_variable_values = HashMap::new();
    let mut local_variable_names = HashMap::new();

    for index in (0..element_index).rev() {
        let candidate = &state.elements[index];
        if element_type(candidate) != Some("variable")
            || !variable_is_in_scope(candidate, &element, state)
        {
            continue;
        }
        let Some(candidate_id) = element_id(candidate) else {
            continue;
        };
        let Some(computed) = state.computed_variables.get(&candidate_id) else {
            continue;
        };
        let Some(value) = computed.get("value").and_then(Value::as_f64) else {
            continue;
        };
        let candidate_name = element_name(candidate);
        local_variable_values
            .entry(candidate_id.clone())
            .or_insert(value);
        local_variable_values
            .entry(candidate_name.clone())
            .or_insert(value);
        local_variable_names
            .entry(candidate_id)
            .or_insert(candidate_name.clone());
        local_variable_names
            .entry(candidate_name.clone())
            .or_insert(candidate_name);
    }

    if let Some(variables) = element.get("numericVariables").and_then(Value::as_array) {
        for variable in variables {
            let Some(variable_id) = variable.get("id").and_then(Value::as_str) else {
                continue;
            };
            let variable_name = variable
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(variable_id)
                .to_owned();
            local_variable_names.insert(variable_id.to_owned(), variable_name.clone());
            local_variable_names.insert(variable_name.clone(), variable_name.clone());
            let value = evaluate_numeric_or_push(
                variable.get("value").unwrap_or(&Value::Null),
                state,
                &element,
                &local_variable_values,
                &local_variable_names,
            )?;
            local_variable_values.insert(variable_id.to_owned(), value);
            local_variable_values.insert(variable_name, value);
        }
    }

    Some((local_variable_values, local_variable_names))
}

fn ancestor_group_ids(element: &Value, state: &EvaluationState) -> Vec<ElementId> {
    let mut ids = Vec::new();
    let mut visited = HashSet::new();
    let mut parent_id = parent_group_id(element);

    while let Some(id) = parent_id {
        if !visited.insert(id.clone()) {
            break;
        }
        ids.push(id.clone());
        parent_id = state
            .elements_by_id
            .get(&id)
            .and_then(|index| state.elements.get(*index))
            .and_then(parent_group_id);
    }

    ids
}

fn variable_is_in_scope(variable: &Value, consumer: &Value, state: &EvaluationState) -> bool {
    if variable.get("scope").and_then(Value::as_str) == Some("global") {
        return true;
    }
    match parent_group_id(variable) {
        None => parent_group_id(consumer).is_none(),
        Some(parent_id) => {
            parent_group_id(consumer).as_deref() == Some(parent_id.as_str())
                || ancestor_group_ids(consumer, state).contains(&parent_id)
        }
    }
}
