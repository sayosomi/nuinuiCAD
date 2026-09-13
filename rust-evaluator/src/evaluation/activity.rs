use std::collections::{HashMap, HashSet};

use serde::Serialize;
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedProfileDeltaIdentity {
    profile_id: String,
    profile_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DrawingModifierPropertyWinner {
    owner_element_id: ElementId,
    modifier_name: String,
    selected_profile_delta: Option<SelectedProfileDeltaIdentity>,
}

#[derive(Clone, Debug)]
struct ModifierPropertyContribution {
    value: Value,
    selected_profile_delta: Option<SelectedProfileDeltaIdentity>,
}

#[derive(Clone, Debug, Default)]
struct DrawingModifierContribution {
    visible: Option<ModifierPropertyContribution>,
    width_px: Option<ModifierPropertyContribution>,
    line_type: Option<ModifierPropertyContribution>,
    color: Option<ModifierPropertyContribution>,
    fill: Option<ModifierPropertyContribution>,
    fill_opacity: Option<ModifierPropertyContribution>,
}

#[derive(Clone, Debug)]
pub(crate) struct EffectiveDrawingModifierRuntime {
    pub(crate) resolution: Value,
    pub(crate) activity: EffectiveElementActivity,
    pub(crate) has_modifier: bool,
    pub(crate) stroke: Value,
}

pub(crate) fn activity_from_element(element: &Value) -> ElementActivity {
    if element.get("enabled").and_then(Value::as_bool) == Some(false) {
        return ElementActivity::Disabled;
    }
    if element.get("visible").and_then(Value::as_bool) == Some(false) {
        return ElementActivity::Hidden;
    }
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

fn property_contribution(
    modifier: &Value,
    delta: Option<&Value>,
    delta_identity: Option<&SelectedProfileDeltaIdentity>,
    key: &str,
) -> Option<ModifierPropertyContribution> {
    if let Some(value) = delta.and_then(|candidate| candidate.get(key)) {
        return Some(ModifierPropertyContribution {
            value: value.clone(),
            selected_profile_delta: delta_identity.cloned(),
        });
    }
    modifier
        .get(key)
        .cloned()
        .map(|value| ModifierPropertyContribution {
            value,
            selected_profile_delta: None,
        })
}

fn drawing_modifier_contributions(
    drawing_modifiers: Option<&Value>,
    selected_profile_id: Option<&str>,
) -> HashMap<String, DrawingModifierContribution> {
    let Some(modifiers) = drawing_modifiers.and_then(Value::as_array) else {
        return HashMap::new();
    };
    modifiers
        .iter()
        .filter_map(|modifier| {
            let name = modifier.get("name")?.as_str()?.to_owned();
            let delta = selected_profile_id.and_then(|profile_id| {
                modifier
                    .get("profileDeltas")
                    .and_then(Value::as_array)
                    .and_then(|deltas| {
                        deltas.iter().find(|candidate| {
                            candidate.get("profileId").and_then(Value::as_str) == Some(profile_id)
                        })
                    })
            });
            let delta_identity = delta.and_then(|candidate| {
                Some(SelectedProfileDeltaIdentity {
                    profile_id: candidate.get("profileId")?.as_str()?.to_owned(),
                    profile_name: candidate.get("profileName")?.as_str()?.to_owned(),
                })
            });
            Some((
                name,
                DrawingModifierContribution {
                    visible: property_contribution(
                        modifier,
                        delta,
                        delta_identity.as_ref(),
                        "visible",
                    ),
                    width_px: property_contribution(
                        modifier,
                        delta,
                        delta_identity.as_ref(),
                        "widthPx",
                    ),
                    line_type: property_contribution(
                        modifier,
                        delta,
                        delta_identity.as_ref(),
                        "lineType",
                    ),
                    color: property_contribution(modifier, delta, delta_identity.as_ref(), "color"),
                    fill: property_contribution(modifier, delta, delta_identity.as_ref(), "fill"),
                    fill_opacity: property_contribution(
                        modifier,
                        delta,
                        delta_identity.as_ref(),
                        "fillOpacity",
                    ),
                },
            ))
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

fn winner_for(
    owner_element_id: &str,
    modifier_name: &str,
    contribution: &ModifierPropertyContribution,
) -> DrawingModifierPropertyWinner {
    DrawingModifierPropertyWinner {
        owner_element_id: owner_element_id.to_owned(),
        modifier_name: modifier_name.to_owned(),
        selected_profile_delta: contribution.selected_profile_delta.clone(),
    }
}

pub(crate) fn effective_drawing_modifier_runtime_by_element_id_with_profile(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
    selected_profile_id: Option<&str>,
) -> HashMap<ElementId, EffectiveDrawingModifierRuntime> {
    let by_id = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    let modifier_contributions =
        drawing_modifier_contributions(drawing_modifiers, selected_profile_id);
    let mut direct_cache = HashMap::new();
    let mut runtime = HashMap::new();

    for (index, element) in elements.iter().enumerate() {
        let Some(id) = element_id(element) else {
            continue;
        };
        let mut has_modifier = false;
        let mut style_visible = true;
        let mut visible_winner: Option<DrawingModifierPropertyWinner> = None;
        let mut width = Value::from(1.0);
        let mut width_winner: Option<DrawingModifierPropertyWinner> = None;
        let mut style = Value::from("solid");
        let mut style_winner: Option<DrawingModifierPropertyWinner> = None;
        let mut color = serde_json::json!({ "kind": "themeRole", "role": "foreground" });
        let mut color_winner: Option<DrawingModifierPropertyWinner> = None;
        let mut fill = Value::Null;
        let mut fill_winner: Option<DrawingModifierPropertyWinner> = None;
        let mut fill_opacity = Value::from(1.0);
        let mut fill_opacity_winner: Option<DrawingModifierPropertyWinner> = None;

        for owner_index in modifier_owner_indices(index, elements, &by_id) {
            let owner = &elements[owner_index];
            let Some(owner_id) = element_id(owner) else {
                continue;
            };
            let Some(modifier_names) = owner.get("modifierNames").and_then(Value::as_array) else {
                continue;
            };
            for modifier_name in modifier_names.iter().filter_map(Value::as_str) {
                let Some(contribution) = modifier_contributions.get(modifier_name) else {
                    continue;
                };
                has_modifier = true;
                if let Some(property) = contribution.visible.as_ref() {
                    if let Some(value) = property.value.as_bool() {
                        style_visible = value;
                        visible_winner = Some(winner_for(&owner_id, modifier_name, property));
                    }
                }
                if let Some(property) = contribution.width_px.as_ref() {
                    width = property.value.clone();
                    width_winner = Some(winner_for(&owner_id, modifier_name, property));
                }
                if let Some(property) = contribution.line_type.as_ref() {
                    style = property.value.clone();
                    style_winner = Some(winner_for(&owner_id, modifier_name, property));
                }
                if let Some(property) = contribution.color.as_ref() {
                    color = property.value.clone();
                    color_winner = Some(winner_for(&owner_id, modifier_name, property));
                }
                if let Some(property) = contribution.fill.as_ref() {
                    fill = property.value.clone();
                    fill_winner = Some(winner_for(&owner_id, modifier_name, property));
                }
                if let Some(property) = contribution.fill_opacity.as_ref() {
                    fill_opacity = property.value.clone();
                    fill_opacity_winner = Some(winner_for(&owner_id, modifier_name, property));
                }
            }
        }

        let direct_activity = resolve_direct_activity(
            index,
            elements,
            &by_id,
            &mut direct_cache,
            &mut HashSet::new(),
        );
        let style_can_win_visibility = direct_activity.activity == ElementActivity::Visible;
        let effective_visible = style_can_win_visibility && style_visible;
        let activity = if !style_can_win_visibility {
            direct_activity
        } else if effective_visible {
            EffectiveElementActivity::default()
        } else {
            EffectiveElementActivity {
                activity: ElementActivity::Hidden,
                hidden_by_element_id: visible_winner
                    .as_ref()
                    .map(|winner| winner.owner_element_id.clone()),
                disabled_by_element_id: None,
            }
        };
        let final_visible_winner = if style_can_win_visibility {
            visible_winner
        } else {
            None
        };
        let stroke = serde_json::json!({
            "widthPx": width.clone(),
            "style": style.clone(),
            "color": color.clone(),
        });
        let resolution = serde_json::json!({
            "visible": {
                "value": effective_visible,
                "winner": final_visible_winner,
            },
            "widthPx": {
                "value": width,
                "winner": width_winner,
            },
            "lineType": {
                "value": style,
                "winner": style_winner,
            },
            "color": {
                "value": color,
                "winner": color_winner,
            },
            "fill": {
                "value": fill,
                "winner": fill_winner,
            },
            "fillOpacity": {
                "value": fill_opacity,
                "winner": fill_opacity_winner,
            },
        });
        runtime.insert(
            id,
            EffectiveDrawingModifierRuntime {
                resolution,
                activity,
                has_modifier,
                stroke,
            },
        );
    }
    runtime
}

pub(crate) fn effective_activity_by_runtime(
    runtime: &HashMap<ElementId, EffectiveDrawingModifierRuntime>,
) -> HashMap<ElementId, EffectiveElementActivity> {
    runtime
        .iter()
        .map(|(id, resolved)| (id.clone(), resolved.activity.clone()))
        .collect()
}

pub(crate) fn effective_drawing_modifier_stroke_by_runtime(
    runtime: &HashMap<ElementId, EffectiveDrawingModifierRuntime>,
) -> HashMap<ElementId, Value> {
    runtime
        .iter()
        .filter(|(_, resolved)| resolved.has_modifier)
        .map(|(id, resolved)| (id.clone(), resolved.stroke.clone()))
        .collect()
}

pub(crate) fn effective_drawing_modifier_resolution_by_runtime(
    runtime: &HashMap<ElementId, EffectiveDrawingModifierRuntime>,
) -> HashMap<ElementId, Value> {
    runtime
        .iter()
        .map(|(id, resolved)| (id.clone(), resolved.resolution.clone()))
        .collect()
}

#[cfg(test)]
pub(crate) fn effective_drawing_modifier_stroke_by_element_id(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
) -> HashMap<ElementId, Value> {
    effective_drawing_modifier_stroke_by_element_id_with_profile(elements, drawing_modifiers, None)
}

#[cfg(test)]
pub(crate) fn effective_drawing_modifier_stroke_by_element_id_with_profile(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
    selected_profile_id: Option<&str>,
) -> HashMap<ElementId, Value> {
    let runtime = effective_drawing_modifier_runtime_by_element_id_with_profile(
        elements,
        drawing_modifiers,
        selected_profile_id,
    );
    effective_drawing_modifier_stroke_by_runtime(&runtime)
}

#[cfg(test)]
pub(crate) fn effective_activity_by_element_id(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
) -> HashMap<ElementId, EffectiveElementActivity> {
    effective_activity_by_element_id_with_profile(elements, drawing_modifiers, None)
}

pub(crate) fn effective_activity_by_element_id_with_profile(
    elements: &[Value],
    drawing_modifiers: Option<&Value>,
    selected_profile_id: Option<&str>,
) -> HashMap<ElementId, EffectiveElementActivity> {
    let runtime = effective_drawing_modifier_runtime_by_element_id_with_profile(
        elements,
        drawing_modifiers,
        selected_profile_id,
    );
    effective_activity_by_runtime(&runtime)
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

#[cfg(test)]
mod provenance_tests {
    use super::*;

    #[test]
    fn tracks_property_specific_winners_and_selected_profile_delta() {
        let elements = vec![serde_json::json!({
            "id": "line",
            "type": "line",
            "enabled": true,
            "visible": true,
            "modifierNames": ["seam"]
        })];
        let modifiers = serde_json::json!([{
            "name": "seam",
            "widthPx": 2.0,
            "lineType": "dashed",
            "profileDeltas": [{
                "profileId": "profile-print",
                "profileName": "print",
                "widthPx": 5.0
            }]
        }]);
        let runtime = effective_drawing_modifier_runtime_by_element_id_with_profile(
            &elements,
            Some(&modifiers),
            Some("profile-print"),
        );
        let resolution = &runtime["line"].resolution;

        assert_eq!(resolution["widthPx"]["value"], Value::from(5.0));
        assert_eq!(
            resolution["widthPx"]["winner"]["selectedProfileDelta"]["profileId"],
            Value::from("profile-print")
        );
        assert_eq!(resolution["lineType"]["value"], Value::from("dashed"));
        assert!(resolution["lineType"]["winner"]["selectedProfileDelta"].is_null());
    }

    #[test]
    fn resolves_fill_and_opacity_independently_with_explicit_no_fill() {
        let elements = vec![
            serde_json::json!({
                "id": "group",
                "type": "group",
                "activity": "visible",
                "modifierNames": ["base"]
            }),
            serde_json::json!({
                "id": "path",
                "type": "polyline",
                "activity": "visible",
                "parentGroupId": "group",
                "modifierNames": ["clear"]
            }),
        ];
        let modifiers = serde_json::json!([
            {
                "name": "base",
                "fill": { "kind": "fixed", "hex": "#112233" },
                "fillOpacity": 0.25,
                "profileDeltas": [{
                    "profileId": "print",
                    "profileName": "Print",
                    "fillOpacity": 0.75
                }]
            },
            { "name": "clear", "fill": { "kind": "none" } }
        ]);

        let common = effective_drawing_modifier_runtime_by_element_id_with_profile(
            &elements,
            Some(&modifiers),
            None,
        );
        let common_resolution = &common["path"].resolution;
        assert_eq!(
            common_resolution["fill"]["value"],
            serde_json::json!({ "kind": "none" })
        );
        assert_eq!(
            common_resolution["fill"]["winner"]["ownerElementId"],
            Value::from("path")
        );
        assert_eq!(common_resolution["fillOpacity"]["value"], Value::from(0.25));
        assert_eq!(
            common_resolution["fillOpacity"]["winner"]["ownerElementId"],
            Value::from("group")
        );

        let selected = effective_drawing_modifier_runtime_by_element_id_with_profile(
            &elements,
            Some(&modifiers),
            Some("print"),
        );
        let selected_resolution = &selected["path"].resolution;
        assert_eq!(
            selected_resolution["fill"]["value"],
            serde_json::json!({ "kind": "none" })
        );
        assert_eq!(
            selected_resolution["fillOpacity"]["value"],
            Value::from(0.75)
        );
        assert_eq!(
            selected_resolution["fillOpacity"]["winner"]["selectedProfileDelta"]["profileId"],
            Value::from("print")
        );
    }

    #[test]
    fn direct_activity_hard_gate_has_no_modifier_state_winner() {
        let elements = vec![
            serde_json::json!({
                "id": "group",
                "type": "group",
                "enabled": true,
                "visible": false
            }),
            serde_json::json!({
                "id": "line",
                "type": "line",
                "activity": "visible",
                "parentGroupId": "group",
                "modifierNames": ["off"]
            }),
        ];
        let modifiers = serde_json::json!([{ "name": "off", "visible": false }]);
        let runtime = effective_drawing_modifier_runtime_by_element_id_with_profile(
            &elements,
            Some(&modifiers),
            None,
        );
        let line = &runtime["line"];

        assert_eq!(line.activity.activity, ElementActivity::Hidden);
        assert_eq!(line.activity.hidden_by_element_id.as_deref(), Some("group"));
        assert_eq!(line.resolution["visible"]["value"], Value::from(false));
        assert!(line.resolution["visible"]["winner"].is_null());
    }

    #[test]
    fn group_boundary_and_default_winners_are_structured() {
        let elements = vec![
            serde_json::json!({
                "id": "group",
                "type": "group",
                "activity": "visible",
                "modifierNames": ["groupStyle"]
            }),
            serde_json::json!({
                "id": "line",
                "type": "line",
                "activity": "visible",
                "parentGroupId": "group"
            }),
            serde_json::json!({
                "id": "plain",
                "type": "line",
                "activity": "visible"
            }),
        ];
        let modifiers = serde_json::json!([{ "name": "groupStyle", "widthPx": 3.0 }]);
        let runtime = effective_drawing_modifier_runtime_by_element_id_with_profile(
            &elements,
            Some(&modifiers),
            None,
        );

        assert_eq!(
            runtime["group"].resolution["widthPx"]["winner"]["ownerElementId"],
            Value::from("group")
        );
        assert_eq!(
            runtime["line"].resolution["widthPx"]["winner"]["ownerElementId"],
            Value::from("group")
        );
        assert_eq!(
            runtime["plain"].resolution["widthPx"]["value"],
            Value::from(1.0)
        );
        assert!(runtime["plain"].resolution["widthPx"]["winner"].is_null());
    }
}
