use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::activity::{
    activity_allows_drawing, activity_allows_evaluation, EffectiveElementActivity,
};
use super::types::{
    element_id, element_type, parent_group_id, ElementId, EvaluationState, GroupState,
};

pub(crate) fn group_state_by_element_id(
    elements: &[Value],
    activities: &HashMap<ElementId, EffectiveElementActivity>,
) -> HashMap<ElementId, GroupState> {
    let types_by_id = elements
        .iter()
        .filter_map(|element| element_id(element).map(|id| (id, element_type(element))))
        .collect::<HashMap<_, _>>();
    elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            let activity = activities.get(&id)?;
            let disabled_by_group_id = activity
                .disabled_by_element_id
                .as_ref()
                .filter(|source_id| {
                    matches!(
                        types_by_id.get(*source_id).copied().flatten(),
                        Some("group" | "conditionalGroup" | "forGroup" | "moduleInstance")
                    )
                })
                .cloned();
            Some((
                id,
                GroupState {
                    disabled_by_group_id,
                },
            ))
        })
        .collect()
}

/// Walks `element`'s `parentGroupId` chain, collecting every forGroup-typed
/// ancestor id. Mirrors `inactive_conditional_group_id`'s walk in mod.rs;
/// sized for a single per-element check (path_reverse_evaluator.rs), not a
/// whole-document precompute like `group_state_by_element_id`.
pub(crate) fn for_group_ancestor_ids(
    state: &EvaluationState,
    element: &Value,
) -> HashSet<ElementId> {
    let mut ancestors = HashSet::new();
    let mut visited = HashSet::<ElementId>::new();
    let mut parent_id = parent_group_id(element);
    while let Some(current_parent_id) = parent_id {
        if !visited.insert(current_parent_id.clone()) {
            break;
        }
        let Some(parent_index) = state.elements_by_id.get(&current_parent_id).copied() else {
            break;
        };
        let Some(parent) = state.elements.get(parent_index) else {
            break;
        };
        if element_type(parent) == Some("forGroup") {
            ancestors.insert(current_parent_id.clone());
        }
        parent_id = parent_group_id(parent);
    }
    ancestors
}

pub(crate) fn effective_element_ids(
    elements: &[Value],
    activities: &HashMap<ElementId, EffectiveElementActivity>,
    draw: bool,
) -> Vec<ElementId> {
    elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            let activity = activities.get(&id)?.activity;
            (if draw {
                activity_allows_drawing(activity)
            } else {
                activity_allows_evaluation(activity)
            })
            .then_some(id)
        })
        .collect()
}
