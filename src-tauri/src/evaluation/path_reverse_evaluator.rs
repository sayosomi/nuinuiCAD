use serde_json::Value;

use super::errors::{dependency_error, for_group_ancestor_error, geometry_error};
use super::groups::for_group_ancestor_ids;
use super::path_reverse_geometry::reverse_line_like_geometry;
use super::types::{element_display_name, EvaluationState};

/// Reverses the target line's already-computed geometry in place. Unlike
/// every other evaluator in this module, this never inserts computed
/// geometry under its own element id (see the TypeScript
/// elementTypesWithoutOwnDrawableGeometry set) - the target keeps its own
/// id, and every statement after this one in document order observes the
/// reversed traversal.
pub(crate) fn evaluate_path_reverse(element: &Value, state: &mut EvaluationState) {
    let Some(target_line_id) = element.get("targetLineId").and_then(Value::as_str) else {
        return;
    };

    if let Some(target_index) = state.elements_by_id.get(target_line_id).copied() {
        let target = state.elements[target_index].clone();
        let reverse_ancestors = for_group_ancestor_ids(state, element);
        let target_ancestors = for_group_ancestor_ids(state, &target);
        if reverse_ancestors
            .iter()
            .any(|id| !target_ancestors.contains(id))
        {
            state
                .errors
                .push(for_group_ancestor_error(element, &target));
            return;
        }
    }

    let Some(current) = state.computed_geometry.get(target_line_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, target_line_id));
        return;
    };
    match reverse_line_like_geometry(&current) {
        Some(reversed) => {
            state
                .computed_geometry
                .insert(target_line_id.to_owned(), reversed);
        }
        None => {
            let target_name = state
                .elements_by_id
                .get(target_line_id)
                .and_then(|index| state.elements.get(*index))
                .map(element_display_name)
                .unwrap_or_else(|| target_line_id.to_owned());
            state.errors.push(geometry_error(
                element,
                format!(
                    "{} の対象「{target_name}」は線または曲線ではないため反転できません。",
                    element_display_name(element)
                ),
            ));
        }
    }
}
