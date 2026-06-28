#[cfg(test)]
mod bezier_curve_tests;
mod bezier_evaluator;
mod bezier_path;
mod errors;
mod groups;
mod intersection_point_evaluator;
#[cfg(test)]
mod intersection_point_tests;
mod line_division_point_evaluator;
mod line_evaluators;
mod line_intersections;
mod line_path;
mod line_tangent_offset_point_evaluator;
#[cfg(test)]
mod line_tangent_offset_point_tests;
mod local_variables;
mod math;
mod numeric_expression;
mod offset_bezier;
mod offset_joins;
mod offset_line_evaluator;
#[cfg(test)]
mod offset_line_tests;
mod offset_paths;
mod offset_source_segments;
mod offset_types;
mod point_anchor;
mod point_evaluators;
mod split_line_evaluator;
#[cfg(test)]
mod split_line_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod three_point_arc_line_tests;
mod types;
mod variable_evaluator;

use std::collections::{HashMap, HashSet};

use bezier_evaluator::evaluate_bezier_curve;
use groups::{effective_element_ids, group_state_by_element_id};
use intersection_point_evaluator::evaluate_intersection_point;
use line_division_point_evaluator::evaluate_line_division_point;
use line_evaluators::{evaluate_arc_line, evaluate_line, evaluate_three_point_arc_line};
use line_tangent_offset_point_evaluator::evaluate_line_tangent_offset_point;
use local_variables::evaluate_local_variables;
use offset_line_evaluator::evaluate_offset_line;
use point_evaluators::{
    evaluate_division_point, evaluate_free_point, evaluate_offset_point,
    evaluate_polar_offset_point,
};
use split_line_evaluator::evaluate_split_line;
use types::{element_id, element_type, ElementId, EvaluationState};
pub use types::{EvaluationInput, EvaluationPayload};
use variable_evaluator::evaluate_variable_element;

#[tauri::command]
pub fn evaluate_document(input: EvaluationInput) -> EvaluationPayload {
    evaluate_document_input(input)
}

fn evaluate_document_input(input: EvaluationInput) -> EvaluationPayload {
    let evaluation_limit_index = input
        .evaluation_limit_index
        .unwrap_or(input.elements.len())
        .min(input.elements.len());
    let evaluated_elements = input.elements[..evaluation_limit_index].to_vec();
    let evaluated_ids: HashSet<ElementId> =
        evaluated_elements.iter().filter_map(element_id).collect();
    let group_states = group_state_by_element_id(&input.elements);
    let effective_visible_element_ids = effective_element_ids(&input.elements, &group_states, true)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<Vec<_>>();
    let effective_enabled_ids = effective_element_ids(&input.elements, &group_states, false)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<HashSet<_>>();
    let effective_enabled_element_ids = input
        .elements
        .iter()
        .filter_map(element_id)
        .filter(|id| effective_enabled_ids.contains(id) && evaluated_ids.contains(id))
        .collect::<Vec<_>>();

    let mut state = EvaluationState {
        elements_by_id: input
            .elements
            .iter()
            .enumerate()
            .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
            .collect(),
        elements: input.elements,
        group_states,
        computed_geometry: HashMap::new(),
        computed_geometry_order: Vec::new(),
        computed_variables: HashMap::new(),
        computed_variable_order: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    for index in 0..evaluation_limit_index {
        let element = state.elements[index].clone();
        let id = match element_id(&element) {
            Some(id) => id,
            None => continue,
        };
        if element_type(&element) == Some("group") || !effective_enabled_ids.contains(&id) {
            continue;
        }

        let Some(local_variables) = evaluate_local_variables(index, &mut state) else {
            continue;
        };

        match element_type(&element) {
            Some("variable") => evaluate_variable_element(&element, &local_variables, &mut state),
            Some("freePoint") => evaluate_free_point(&element, &local_variables, &mut state),
            Some("offsetPoint") => evaluate_offset_point(&element, &local_variables, &mut state),
            Some("polarOffsetPoint") => {
                evaluate_polar_offset_point(&element, &local_variables, &mut state)
            }
            Some("divisionPoint") => {
                evaluate_division_point(&element, &local_variables, &mut state)
            }
            Some("lineDivisionPoint") => {
                evaluate_line_division_point(&element, &local_variables, &mut state)
            }
            Some("lineTangentOffsetPoint") => {
                evaluate_line_tangent_offset_point(&element, &local_variables, &mut state)
            }
            Some("intersectionPoint") => {
                evaluate_intersection_point(&element, &local_variables, &mut state)
            }
            Some("line") => evaluate_line(&element, &local_variables, &mut state),
            Some("arcLine") => evaluate_arc_line(&element, &local_variables, &mut state),
            Some("threePointArcLine") => {
                evaluate_three_point_arc_line(&element, &local_variables, &mut state)
            }
            Some("bezierCurve") => evaluate_bezier_curve(&element, &local_variables, &mut state),
            Some("offsetLine") => evaluate_offset_line(&element, &local_variables, &mut state),
            Some("splitLine") => evaluate_split_line(&element, &local_variables, &mut state),
            _ => {}
        }
    }

    EvaluationPayload {
        computed_geometry: state
            .computed_geometry_order
            .iter()
            .filter_map(|id| state.computed_geometry.get(id).cloned())
            .collect(),
        computed_variables: state
            .computed_variable_order
            .iter()
            .filter_map(|id| state.computed_variables.get(id).cloned())
            .collect(),
        errors: state.errors,
        warnings: state.warnings,
        evaluated_element_ids: evaluated_elements.iter().filter_map(element_id).collect(),
        evaluation_limit_index,
        effective_visible_element_ids,
        effective_enabled_element_ids,
    }
}
