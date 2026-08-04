use serde_json::Value;
use std::collections::HashMap;

use super::numeric_expression::evaluate_numeric_or_push;
use super::types::EvaluationState;

pub(crate) fn evaluate_local_variables(
    element_index: usize,
    state: &mut EvaluationState,
) -> Option<(HashMap<String, f64>, HashMap<String, String>)> {
    let element = state.elements[element_index].clone();
    let mut local_variable_values = HashMap::new();
    let mut local_variable_names = HashMap::new();

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
