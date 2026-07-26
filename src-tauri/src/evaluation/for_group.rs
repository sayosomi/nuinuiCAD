use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::types::{element_id, element_name, element_type, ElementId, ForGroupGeneratedRow};

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

/// Source-order template statements owned by a single mutation scheduler.
/// Descendants of a nested forGroup belong to that nested invocation instead.
pub(crate) fn for_group_mutation_template_ids(
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

pub(crate) fn expand_for_group_iteration(
    elements: &[Value],
    for_group: &Value,
    iteration_index: usize,
    variable_value: f64,
) -> (Vec<(Value, ElementId)>, Vec<ForGroupGeneratedRow>) {
    expand_for_group_iteration_from_template(
        elements,
        for_group,
        element_id(for_group).as_deref(),
        iteration_index,
        variable_value,
    )
}

/// `for_group` may be a generated nested instance, while its body still comes
/// from the original template statement identified by `template_for_group_id`.
pub(crate) fn expand_for_group_iteration_from_template(
    elements: &[Value],
    for_group: &Value,
    template_for_group_id: Option<&str>,
    iteration_index: usize,
    variable_value: f64,
) -> (Vec<(Value, ElementId)>, Vec<ForGroupGeneratedRow>) {
    let Some(for_group_id) = element_id(for_group) else {
        return (Vec::new(), Vec::new());
    };
    let Some(template_for_group_id) = template_for_group_id else {
        return (Vec::new(), Vec::new());
    };
    let variable_name = for_group
        .get("variableName")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("i")
        .to_owned();
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
        remap_json_ids(&mut element, &id_map);
        if let Some(object) = element.as_object_mut() {
            object.insert("id".to_owned(), Value::String(generated_id.clone()));
            object.insert(
                "name".to_owned(),
                Value::String(format!(
                    "[{}] {}",
                    iteration_label(&variable_name, variable_value),
                    element_name(&template)
                )),
            );
            let iteration_variable = json!({
                "id": format!("{for_group_id}:iteration"),
                "name": variable_name,
                "value": variable_value
            });
            let mut variables = object
                .remove("numericVariables")
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default();
            variables.insert(0, iteration_variable);
            object.insert("numericVariables".to_owned(), Value::Array(variables));
        }
        if !matches!(
            element_type(&element),
            Some("group" | "conditionalGroup" | "forGroup")
        ) {
            rows.push(ForGroupGeneratedRow {
                for_group_id: for_group_id.clone(),
                template_element_id: template_id.clone(),
                generated_element_id: generated_id.clone(),
                iteration_index,
                variable_name: variable_name.clone(),
                variable_value,
                element_name: element_name(&element),
                element_type: element_type(&element).unwrap_or_default().to_owned(),
            });
        }
        generated.push((element, template_id));
    }

    (generated, rows)
}
