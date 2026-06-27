use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::types::{bool_field, element_id, element_type, parent_group_id, ElementId, GroupState};

pub(crate) fn group_state_by_element_id(elements: &[Value]) -> HashMap<ElementId, GroupState> {
    let by_id = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    let mut cache = HashMap::new();

    for index in 0..elements.len() {
        state_for_group(index, elements, &by_id, &mut cache, &mut HashSet::new());
    }

    cache
}

fn state_for_group(
    index: usize,
    elements: &[Value],
    by_id: &HashMap<ElementId, usize>,
    cache: &mut HashMap<ElementId, GroupState>,
    visiting: &mut HashSet<ElementId>,
) -> GroupState {
    let element = &elements[index];
    let Some(id) = element_id(element) else {
        return GroupState::default();
    };
    if let Some(cached) = cache.get(&id) {
        return cached.clone();
    }
    if !visiting.insert(id.clone()) {
        return GroupState::default();
    }

    let state = parent_group_id(element)
        .and_then(|parent_id| {
            let parent_index = by_id.get(&parent_id).copied()?;
            Some((parent_id, parent_index))
        })
        .and_then(|(parent_id, parent_index)| {
            let parent = &elements[parent_index];
            (element_type(parent) == Some("group")).then_some((parent_id, parent_index))
        })
        .map(|(parent_id, parent_index)| {
            let parent = &elements[parent_index];
            let parent_state = state_for_group(parent_index, elements, by_id, cache, visiting);
            GroupState {
                hidden_by_group_id: parent_state.hidden_by_group_id.or_else(|| {
                    (!bool_field(parent, "visible", true)).then_some(parent_id.clone())
                }),
                disabled_by_group_id: parent_state
                    .disabled_by_group_id
                    .or_else(|| (!bool_field(parent, "enabled", true)).then_some(parent_id)),
            }
        })
        .unwrap_or_default();

    visiting.remove(&id);
    cache.insert(id, state.clone());
    state
}

pub(crate) fn effective_element_ids(
    elements: &[Value],
    group_states: &HashMap<ElementId, GroupState>,
    visible: bool,
) -> Vec<ElementId> {
    elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            let own_flag = bool_field(element, if visible { "visible" } else { "enabled" }, true);
            let blocked_by_group = group_states
                .get(&id)
                .and_then(|state| {
                    if visible {
                        state.hidden_by_group_id.as_ref()
                    } else {
                        state.disabled_by_group_id.as_ref()
                    }
                })
                .is_some();
            (own_flag && !blocked_by_group).then_some(id)
        })
        .collect()
}
