use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::types::{element_id, element_type, parent_group_id, ElementId};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ElementActivity {
    Visible,
    Hidden,
    Disabled,
}

#[derive(Clone, Debug)]
pub(crate) struct EffectiveElementActivity {
    pub(crate) activity: ElementActivity,
    pub(crate) hidden_by_element_id: Option<ElementId>,
    pub(crate) disabled_by_element_id: Option<ElementId>,
}

impl Default for EffectiveElementActivity {
    fn default() -> Self {
        Self {
            activity: ElementActivity::Visible,
            hidden_by_element_id: None,
            disabled_by_element_id: None,
        }
    }
}

pub(crate) fn activity_from_element(element: &Value) -> ElementActivity {
    match element.get("activity").and_then(Value::as_str) {
        Some("hidden") => ElementActivity::Hidden,
        Some("disabled") => ElementActivity::Disabled,
        _ => ElementActivity::Visible,
    }
}

pub(crate) fn activity_allows_evaluation(activity: ElementActivity) -> bool {
    activity != ElementActivity::Disabled
}

pub(crate) fn activity_allows_drawing(activity: ElementActivity) -> bool {
    activity == ElementActivity::Visible
}

fn is_activity_container(element: &Value) -> bool {
    matches!(
        element_type(element),
        Some("group" | "conditionalGroup" | "forGroup" | "moduleInstance")
    )
}

fn drawing_modifier_states(drawing_modifiers: Option<&Value>) -> HashMap<String, ElementActivity> {
    let Some(modifiers) = drawing_modifiers.and_then(Value::as_array) else {
        return HashMap::new();
    };
    modifiers
        .iter()
        .filter_map(|modifier| {
            let name = modifier.get("name")?.as_str()?.to_owned();
            let state = match modifier.get("state").and_then(Value::as_str) {
                Some("hidden") => ElementActivity::Hidden,
                Some("disabled") => ElementActivity::Disabled,
                Some("visible") => ElementActivity::Visible,
                _ => return None,
            };
            Some((name, state))
        })
        .collect()
}

fn drawing_modifier_strokes(drawing_modifiers: Option<&Value>) -> HashMap<String, Value> {
    let Some(modifiers) = drawing_modifiers.and_then(Value::as_array) else {
        return HashMap::new();
    };
    modifiers
        .iter()
        .filter_map(|modifier| {
            let name = modifier.get("name")?.as_str()?.to_owned();
            let stroke = modifier.get("stroke")?.clone();
            Some((name, stroke))
        })
        .collect()
}

fn modifier_owner_indices(
    index: usize,
    elements: &[Value],
    by_id: &HashMap<ElementId, usize>,
) -> Vec<usize> {
    let Some(element_id) = element_id(&elements[index]) else {
        return vec![index];
    };
    let mut owners = vec![index];
    let mut visited = HashSet::from([element_id]);
    let mut parent_id = parent_group_id(&elements[index]);

    while let Some(current_parent_id) = parent_id {
        if !visited.insert(current_parent_id.clone()) {
            break;
        }
        let Some(parent_index) = by_id.get(&current_parent_id).copied() else {
            break;
        };
        if !is_activity_container(&elements[parent_index]) {
            break;
        }
        owners.push(parent_index);
        parent_id = parent_group_id(&elements[parent_index]);
    }
    owners.reverse();
    owners
}

pub(crate) fn effective_drawing_modifier_stroke_by_element_id(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
) -> HashMap<ElementId, Value> {
    let by_id = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    let modifier_strokes = drawing_modifier_strokes(drawing_modifiers);
    let mut effective = HashMap::new();

    for (index, element) in elements.iter().enumerate() {
        let Some(id) = element_id(element) else {
            continue;
        };
        let mut winning_stroke = None;
        for owner_index in modifier_owner_indices(index, elements, &by_id) {
            let Some(modifier_names) = elements[owner_index]
                .get("modifierNames")
                .and_then(Value::as_array)
            else {
                continue;
            };
            for modifier_name in modifier_names.iter().filter_map(Value::as_str) {
                if let Some(stroke) = modifier_strokes.get(modifier_name) {
                    winning_stroke = Some(stroke.clone());
                }
            }
        }
        if let Some(stroke) = winning_stroke {
            effective.insert(id, stroke);
        }
    }
    effective
}

pub(crate) fn effective_activity_by_element_id(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
) -> HashMap<ElementId, EffectiveElementActivity> {
    let by_id = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    let modifier_states = drawing_modifier_states(drawing_modifiers);
    let mut direct_cache = HashMap::new();
    let mut cache = HashMap::new();

    for index in 0..elements.len() {
        let direct_activity = resolve_direct_activity(
            index,
            elements,
            &by_id,
            &mut direct_cache,
            &mut HashSet::new(),
        );
        let resolved = if direct_activity.activity != ElementActivity::Visible {
            direct_activity
        } else if let Some((activity, owner_id)) =
            modifier_activity_for(index, elements, &by_id, &modifier_states)
        {
            match activity {
                ElementActivity::Disabled => EffectiveElementActivity {
                    activity,
                    hidden_by_element_id: None,
                    disabled_by_element_id: Some(owner_id),
                },
                ElementActivity::Hidden => EffectiveElementActivity {
                    activity,
                    hidden_by_element_id: Some(owner_id),
                    disabled_by_element_id: None,
                },
                ElementActivity::Visible => EffectiveElementActivity::default(),
            }
        } else {
            direct_activity
        };
        if let Some(id) = element_id(&elements[index]) {
            cache.insert(id, resolved);
        }
    }
    cache
}

fn resolve_direct_activity(
    index: usize,
    elements: &[Value],
    by_id: &HashMap<ElementId, usize>,
    cache: &mut HashMap<ElementId, EffectiveElementActivity>,
    visiting: &mut HashSet<ElementId>,
) -> EffectiveElementActivity {
    let element = &elements[index];
    let Some(id) = element_id(element) else {
        return EffectiveElementActivity::default();
    };
    if let Some(cached) = cache.get(&id) {
        return cached.clone();
    }
    if !visiting.insert(id.clone()) {
        return EffectiveElementActivity::default();
    }

    let parent_activity = parent_group_id(element)
        .and_then(|parent_id| by_id.get(&parent_id).copied())
        .filter(|parent_index| is_activity_container(&elements[*parent_index]))
        .map(|parent_index| {
            resolve_direct_activity(parent_index, elements, by_id, cache, visiting)
        });
    let own_activity = activity_from_element(element);
    let resolved = match parent_activity {
        Some(parent) if parent.activity == ElementActivity::Disabled => EffectiveElementActivity {
            activity: ElementActivity::Disabled,
            hidden_by_element_id: None,
            disabled_by_element_id: parent.disabled_by_element_id,
        },
        _ if own_activity == ElementActivity::Disabled => EffectiveElementActivity {
            activity: ElementActivity::Disabled,
            hidden_by_element_id: None,
            disabled_by_element_id: Some(id.clone()),
        },
        Some(parent) if parent.activity == ElementActivity::Hidden => EffectiveElementActivity {
            activity: ElementActivity::Hidden,
            hidden_by_element_id: parent.hidden_by_element_id,
            disabled_by_element_id: None,
        },
        _ if own_activity == ElementActivity::Hidden => EffectiveElementActivity {
            activity: ElementActivity::Hidden,
            hidden_by_element_id: Some(id.clone()),
            disabled_by_element_id: None,
        },
        _ => EffectiveElementActivity::default(),
    };

    visiting.remove(&id);
    cache.insert(id, resolved.clone());
    resolved
}

fn modifier_activity_for(
    index: usize,
    elements: &[Value],
    by_id: &HashMap<ElementId, usize>,
    modifier_states: &HashMap<String, ElementActivity>,
) -> Option<(ElementActivity, ElementId)> {
    let mut winning = None;
    for owner_index in modifier_owner_indices(index, elements, by_id) {
        let owner = &elements[owner_index];
        let owner_id = super::types::element_id(owner)?;
        let Some(modifier_names) = owner.get("modifierNames").and_then(Value::as_array) else {
            continue;
        };
        for modifier_name in modifier_names.iter().filter_map(Value::as_str) {
            if let Some(activity) = modifier_states.get(modifier_name) {
                winning = Some((*activity, owner_id.clone()));
            }
        }
    }
    winning
}
