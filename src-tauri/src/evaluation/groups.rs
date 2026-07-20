use serde_json::Value;
use std::collections::HashMap;

use super::activity::{
    activity_allows_drawing, activity_allows_evaluation, EffectiveElementActivity,
};
use super::types::{element_id, element_type, ElementId, GroupState};

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
                        Some("group" | "conditionalGroup" | "forGroup")
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
