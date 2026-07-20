use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::types::{bool_field, element_id, element_type, parent_group_id, ElementId};

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

pub(crate) fn activity_from_legacy_flags(element: &Value) -> ElementActivity {
    if !bool_field(element, "enabled", true) {
        ElementActivity::Disabled
    } else if !bool_field(element, "visible", true) {
        ElementActivity::Hidden
    } else {
        ElementActivity::Visible
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
        Some("group" | "conditionalGroup" | "forGroup")
    )
}

pub(crate) fn effective_activity_by_element_id(
    elements: &[Value],
) -> HashMap<ElementId, EffectiveElementActivity> {
    let by_id = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    let mut cache = HashMap::new();

    for index in 0..elements.len() {
        resolve_activity(index, elements, &by_id, &mut cache, &mut HashSet::new());
    }
    cache
}

fn resolve_activity(
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
        .map(|parent_index| resolve_activity(parent_index, elements, by_id, cache, visiting));
    let own_activity = activity_from_legacy_flags(element);
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
