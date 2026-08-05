use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::numeric_expression::evaluate_numeric_or_push;
use super::types::{
    element_display_name, element_id, element_name, element_type,
    element_type_without_own_drawable_geometry, DependencyError, ElementId, EvaluationState,
    ForGroupGeneratedRow,
};

/// Reads and validates a forGroup element's start/count/step. Shared by the
/// mutation-scheduler and generic forGroup runtimes - this has no
/// resolver/environment dependency, so the same validation applies
/// uniformly regardless of which runtime is driving the loop.
pub(crate) fn for_group_loop_values(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) -> Option<(f64, usize, f64)> {
    let start = evaluate_numeric_or_push(
        element.get("start").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    );
    let count = evaluate_numeric_or_push(
        element.get("count").unwrap_or(&Value::Null),
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
    let (start, count, step) = start.zip(count).zip(step).map(|((a, b), c)| (a, b, c))?;
    if !count.is_finite() || count < 0.0 || count.fract() != 0.0 || count > 1000.0 {
        state.errors.push(DependencyError {
            element_id: element_id(element).unwrap_or_default(),
            element_name: element_name(element),
            missing_dependency_id: element_id(element).unwrap_or_default(),
            missing_dependency_name: Some(element_name(element)),
            message: format!(
                "{} の回数は0以上の整数にしてください。",
                element_name(element)
            ),
        });
        return None;
    }
    Some((start, count as usize, step))
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
/// `ancestor_iteration_variables` carries only the iteration bindings owned by
/// enclosing forGroup loops (lowest precedence first) - never an ancestor
/// forGroup opener's own other local variables, which must not leak into a
/// nested loop's body.
pub(crate) fn expand_for_group_iteration_from_template(
    elements: &[Value],
    for_group: &Value,
    template_for_group_id: Option<&str>,
    iteration_index: usize,
    variable_value: f64,
    ancestor_iteration_variables: &[Value],
) -> (Vec<(Value, ElementId)>, Vec<ForGroupGeneratedRow>, Value) {
    let Some(for_group_id) = element_id(for_group) else {
        return (Vec::new(), Vec::new(), Value::Null);
    };
    let Some(template_for_group_id) = template_for_group_id else {
        return (Vec::new(), Vec::new(), Value::Null);
    };
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
            let mut variables: Vec<Value> = ancestor_iteration_variables.to_vec();
            variables.push(iteration_variable.clone());
            if let Some(own_variables) = object
                .remove("numericVariables")
                .and_then(|value| value.as_array().cloned())
            {
                variables.extend(own_variables);
            }
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
                element_name: element_display_name(&element),
                element_type: element_type(&element).unwrap_or_default().to_owned(),
            });
        }
        generated.push((element, template_id));
    }

    (generated, rows, iteration_variable)
}
