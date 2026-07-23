mod activity;
#[cfg(test)]
mod activity_tests;
#[cfg(test)]
mod bezier_curve_tests;
mod bezier_evaluator;
mod bezier_math;
mod bezier_path;
mod corner_radius_evaluator;
mod corner_radius_path;
#[cfg(test)]
mod corner_radius_tests;
mod corner_radius_trim;
mod division_placement;
mod edge_extend_evaluator;
#[cfg(test)]
mod edge_extend_test_support;
#[cfg(test)]
mod edge_tests;
mod endpoint_move;
mod errors;
#[cfg(test)]
mod extend_trim_tests;
mod for_group;
mod groups;
mod image_evaluator;
mod intersection_point_evaluator;
#[cfg(test)]
mod intersection_point_tests;
mod line_copy_geometry;
mod line_copy_move_evaluator;
#[cfg(test)]
mod line_copy_move_tests;
mod line_division_point_evaluator;
mod line_evaluators;
mod line_intersections;
mod line_path;
mod line_tangent_offset_point_evaluator;
#[cfg(test)]
mod line_tangent_offset_point_tests;
mod line_transform;
mod local_variables;
mod math;
mod numeric_expression;
mod offset_bezier;
mod offset_joins;
mod offset_line_evaluator;
#[cfg(test)]
mod offset_line_tests;
mod offset_paths;
mod offset_projection;
mod offset_source_segments;
mod offset_types;
#[cfg(test)]
mod performance_tests;
mod point_anchor;
mod point_evaluators;
mod property_binding_runtime;
#[cfg(test)]
mod property_binding_runtime_tests;
#[cfg(test)]
mod scalar_expression_payload_compat_tests;
#[cfg(test)]
mod scalar_program_integration_tests;
#[cfg(test)]
mod scalar_program_performance_tests;
mod scalars;
mod split_line_evaluator;
#[cfg(test)]
mod split_line_tests;
#[cfg(test)]
mod tests;
mod text_evaluator;
#[cfg(test)]
mod three_point_arc_line_tests;
#[cfg(test)]
mod typed_variables_performance_tests;
mod types;
mod variable_evaluator;

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use activity::effective_activity_by_element_id;
use bezier_evaluator::evaluate_bezier_curve;
use corner_radius_evaluator::evaluate_corner_radius_arc_line;
use edge_extend_evaluator::{evaluate_edge, evaluate_extend_trim};
use for_group::{expand_for_group_iteration, for_group_template_descendant_ids};
use groups::{effective_element_ids, group_state_by_element_id};
use image_evaluator::evaluate_image;
use intersection_point_evaluator::evaluate_intersection_point;
use line_copy_move_evaluator::{
    evaluate_copy_line, evaluate_move, evaluate_symmetric_copy_line, evaluate_symmetric_move,
};
use line_division_point_evaluator::evaluate_line_division_point;
use line_evaluators::{
    evaluate_angle_length_line, evaluate_arc_line, evaluate_line, evaluate_three_point_arc_line,
};
use line_tangent_offset_point_evaluator::evaluate_line_tangent_offset_point;
use local_variables::evaluate_local_variables;
use numeric_expression::evaluate_numeric_or_push;
use offset_line_evaluator::evaluate_offset_line;
use point_evaluators::{
    evaluate_division_point, evaluate_free_point, evaluate_offset_point,
    evaluate_polar_offset_point,
};
use property_binding_runtime::apply_property_bindings;
use scalars::{
    validate_property_bindings_payload, validate_scalar_program_payload,
    validate_typed_expression_payload, ScalarBindingResolver, ValidatedPropertyBinding,
    ValidatedScalarProgram,
};
use split_line_evaluator::evaluate_split_line;
use text_evaluator::evaluate_text;
use types::{element_id, element_name, element_type, ElementId, EvaluationState};
pub use types::{EvaluationCommandError, EvaluationInput, EvaluationPayload};
use variable_evaluator::evaluate_variable_element;

/// Decodes+validates `input.property_bindings` against the already-decoded
/// `scalar_program`'s own statement binding ids and `input.elements`' actual
/// types. Validation order matters: `scalar_program` must be decoded first,
/// since an absent/empty `valid_binding_ids` set (no scalar program at all)
/// is exactly what makes every property-binding entry fail closed here,
/// rather than silently falling back to literal values (see
/// `property_binding_payload.rs`'s own doc comment).
fn decode_property_bindings(
    input: &EvaluationInput,
    scalar_program: Option<&ValidatedScalarProgram>,
) -> Result<Option<Vec<ValidatedPropertyBinding>>, EvaluationCommandError> {
    let Some(payload) = input.property_bindings.as_ref() else {
        return Ok(None);
    };
    let element_type_by_id: HashMap<&str, &str> = input
        .elements
        .iter()
        .filter_map(|element| Some((element.get("id")?.as_str()?, element.get("type")?.as_str()?)))
        .collect();
    let valid_binding_ids: HashSet<&str> = scalar_program
        .map(|program| {
            program
                .statements
                .iter()
                .map(|statement| statement.binding_id.as_str())
                .collect()
        })
        .unwrap_or_default();
    validate_property_bindings_payload(payload, &element_type_by_id, &valid_binding_ids)
        .map(Some)
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })
}

#[tauri::command]
pub fn evaluate_document(
    input: EvaluationInput,
) -> Result<EvaluationPayload, EvaluationCommandError> {
    if let Some(payload) = input.scalar_expression_payload.as_ref() {
        let _ = validate_typed_expression_payload(payload);
    }
    let scalar_program = input
        .scalar_program
        .as_ref()
        .map(validate_scalar_program_payload)
        .transpose()
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })?;
    let property_bindings = decode_property_bindings(&input, scalar_program.as_ref())?;
    Ok(evaluate_document_input_with_scalar_program(
        input,
        scalar_program,
        property_bindings,
    ))
}

fn inactive_conditional_group_id(
    element: &Value,
    state: &EvaluationState,
    conditional_group_states: &HashMap<ElementId, Option<&'static str>>,
) -> Option<ElementId> {
    let mut child = element;
    let mut parent_id = child
        .get("parentGroupId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let mut visited = HashSet::<ElementId>::new();
    while let Some(current_parent_id) = parent_id {
        if !visited.insert(current_parent_id.clone()) {
            return None;
        }
        let parent_index = state.elements_by_id.get(&current_parent_id).copied()?;
        let parent = state.elements.get(parent_index)?;
        if element_type(parent) == Some("conditionalGroup") {
            let active_branch = conditional_group_states
                .get(&current_parent_id)
                .copied()
                .flatten();
            let branch = child
                .get("conditionalBranch")
                .and_then(Value::as_str)
                .unwrap_or("then");
            if active_branch != Some(branch) {
                return Some(current_parent_id);
            }
        }
        child = parent;
        parent_id = child
            .get("parentGroupId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }
    None
}

fn evaluate_element_by_type(
    id: ElementId,
    element: Value,
    local_variables: (HashMap<String, f64>, HashMap<String, String>),
    conditional_group_states: &mut HashMap<ElementId, Option<&'static str>>,
    state: &mut EvaluationState,
) {
    match element_type(&element) {
        Some("conditionalGroup") => {
            let condition = element.get("condition").unwrap_or(&Value::Null).clone();
            let active_branch = evaluate_numeric_or_push(
                &condition,
                state,
                &element,
                &local_variables.0,
                &local_variables.1,
            )
            .map(|value| if value == 0.0 { "else" } else { "then" });
            conditional_group_states.insert(id, active_branch);
        }
        Some("group" | "forGroup") => {}
        Some("variable") => evaluate_variable_element(&element, &local_variables, state),
        Some("freePoint") => evaluate_free_point(&element, &local_variables, state),
        Some("offsetPoint") => evaluate_offset_point(&element, &local_variables, state),
        Some("polarOffsetPoint") => evaluate_polar_offset_point(&element, &local_variables, state),
        Some("divisionPoint") => evaluate_division_point(&element, &local_variables, state),
        Some("lineDivisionPoint") => {
            evaluate_line_division_point(&element, &local_variables, state)
        }
        Some("lineTangentOffsetPoint") => {
            evaluate_line_tangent_offset_point(&element, &local_variables, state)
        }
        Some("intersectionPoint") => evaluate_intersection_point(&element, &local_variables, state),
        Some("line") => evaluate_line(&element, &local_variables, state),
        Some("angleLengthLine") => evaluate_angle_length_line(&element, &local_variables, state),
        Some("arcLine") => evaluate_arc_line(&element, &local_variables, state),
        Some("threePointArcLine") => {
            evaluate_three_point_arc_line(&element, &local_variables, state)
        }
        Some("cornerRadiusArcLine") => {
            evaluate_corner_radius_arc_line(&element, &local_variables, state)
        }
        Some("bezierCurve") => evaluate_bezier_curve(&element, &local_variables, state),
        Some("offsetLine") => evaluate_offset_line(&element, &local_variables, state),
        Some("splitLine") => evaluate_split_line(&element, &local_variables, state),
        Some("edge") => evaluate_edge(&element, &local_variables, state),
        Some("extendTrim") => evaluate_extend_trim(&element, &local_variables, state),
        Some("copyLine") => evaluate_copy_line(&element, &local_variables, state),
        Some("symmetricCopyLine") => {
            evaluate_symmetric_copy_line(&element, &local_variables, state)
        }
        Some("move") => evaluate_move(&element, &local_variables, state),
        Some("symmetricMove") => evaluate_symmetric_move(&element, &local_variables, state),
        Some("image") => evaluate_image(&element, &local_variables, state),
        Some("text") => evaluate_text(&element, &local_variables, state),
        _ => {}
    }
}

#[cfg(test)]
fn evaluate_document_input(input: EvaluationInput) -> EvaluationPayload {
    // Task 17 shadow validator: when a typed-expression payload is present,
    // defensively validate it. The result is intentionally discarded -
    // Task 21 connects it to real evaluation. No caller populates this
    // field today, so this branch never runs in current production use.
    if let Some(payload) = input.scalar_expression_payload.as_ref() {
        let _ = validate_typed_expression_payload(payload);
    }
    let scalar_program = input
        .scalar_program
        .as_ref()
        .map(validate_scalar_program_payload)
        .transpose()
        .expect("evaluation test input scalar_program must be valid");
    let property_bindings = decode_property_bindings(&input, scalar_program.as_ref())
        .expect("evaluation test input property_bindings must be valid");
    evaluate_document_input_with_scalar_program(input, scalar_program, property_bindings)
}

fn evaluate_document_input_with_scalar_program(
    input: EvaluationInput,
    scalar_program: Option<ValidatedScalarProgram>,
    property_bindings: Option<Vec<ValidatedPropertyBinding>>,
) -> EvaluationPayload {
    let evaluation_limit_index = input
        .evaluation_limit_index
        .unwrap_or(input.elements.len())
        .min(input.elements.len());
    let evaluated_elements = input.elements[..evaluation_limit_index].to_vec();
    let evaluated_ids: HashSet<ElementId> =
        evaluated_elements.iter().filter_map(element_id).collect();
    let activities = effective_activity_by_element_id(&input.elements);
    let group_states = group_state_by_element_id(&input.elements, &activities);
    let mut effective_visible_element_ids =
        effective_element_ids(&input.elements, &activities, true)
            .into_iter()
            .filter(|id| evaluated_ids.contains(id))
            .collect::<Vec<_>>();
    let base_effective_enabled_ids = effective_element_ids(&input.elements, &activities, false)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<HashSet<_>>();

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
    let mut conditional_group_states = HashMap::<ElementId, Option<&'static str>>::new();
    let mut condition_inactive_ids = HashSet::<ElementId>::new();
    let mut effective_enabled_ids = HashSet::<ElementId>::new();
    let template_descendant_ids = for_group_template_descendant_ids(&state.elements);
    let original_elements = state.elements.clone();
    let mut for_group_generated_rows = Vec::new();

    // Built whenever a scalar_program is present, independent of whether
    // any property bindings exist - computed_scalar_bindings is Task 21's
    // own contract and must not depend on Task 23's property wiring. One
    // resolver instance is reused for both materialization below and the
    // final computed_scalar_bindings output, so no binding is ever
    // evaluated more than once.
    let scalar_binding_resolver = scalar_program.as_ref().map(ScalarBindingResolver::new);
    let entries_by_element_id: HashMap<ElementId, Vec<ValidatedPropertyBinding>> =
        property_bindings
            .into_iter()
            .flatten()
            .fold(HashMap::new(), |mut map, entry| {
                map.entry(entry.element_id.clone()).or_default().push(entry);
                map
            });

    for index in 0..evaluation_limit_index {
        let element = state.elements[index].clone();
        let id = match element_id(&element) {
            Some(id) => id,
            None => continue,
        };
        if template_descendant_ids.contains(&id) {
            continue;
        }
        if let Some(condition_group_id) =
            inactive_conditional_group_id(&element, &state, &conditional_group_states)
        {
            condition_inactive_ids.insert(id.clone());
            state
                .group_states
                .entry(id)
                .or_default()
                .disabled_by_group_id = Some(condition_group_id);
            continue;
        }
        if !base_effective_enabled_ids.contains(&id) {
            continue;
        }
        effective_enabled_ids.insert(id.clone());

        let Some(local_variables) = evaluate_local_variables(index, &mut state) else {
            continue;
        };

        if element_type(&element) == Some("forGroup") {
            let start = evaluate_numeric_or_push(
                element.get("start").unwrap_or(&Value::Null),
                &mut state,
                &element,
                &local_variables.0,
                &local_variables.1,
            );
            let count = evaluate_numeric_or_push(
                element.get("count").unwrap_or(&Value::Null),
                &mut state,
                &element,
                &local_variables.0,
                &local_variables.1,
            );
            let step = evaluate_numeric_or_push(
                element.get("step").unwrap_or(&Value::Null),
                &mut state,
                &element,
                &local_variables.0,
                &local_variables.1,
            );
            let Some((start, count, step)) =
                start.zip(count).zip(step).map(|((a, b), c)| (a, b, c))
            else {
                continue;
            };
            if !count.is_finite() || count < 0.0 || count.fract() != 0.0 || count > 1000.0 {
                state.errors.push(types::DependencyError {
                    element_id: id.clone(),
                    element_name: element_name(&element),
                    missing_dependency_id: id.clone(),
                    missing_dependency_name: Some(element_name(&element)),
                    message: format!(
                        "{} の回数は0以上の整数にしてください。",
                        element_name(&element)
                    ),
                });
                continue;
            }
            for iteration_index in 0..(count as usize) {
                let variable_value = start + iteration_index as f64 * step;
                let (generated, rows) = expand_for_group_iteration(
                    &original_elements,
                    &element,
                    iteration_index,
                    variable_value,
                );
                for_group_generated_rows.extend(rows);
                for (generated_element, template_id) in generated {
                    let Some(generated_id) = element_id(&generated_element) else {
                        continue;
                    };
                    if effective_visible_element_ids.contains(&template_id) {
                        effective_visible_element_ids.push(generated_id.clone());
                    }
                    state
                        .elements_by_id
                        .insert(generated_id.clone(), state.elements.len());
                    state.elements.push(generated_element.clone());
                    if let Some(condition_group_id) = inactive_conditional_group_id(
                        &generated_element,
                        &state,
                        &conditional_group_states,
                    ) {
                        condition_inactive_ids.insert(generated_id.clone());
                        state
                            .group_states
                            .entry(generated_id)
                            .or_default()
                            .disabled_by_group_id = Some(condition_group_id);
                        continue;
                    }
                    if !base_effective_enabled_ids.contains(&template_id) {
                        continue;
                    }
                    effective_enabled_ids.insert(generated_id.clone());
                    let generated_index = state.elements_by_id[&generated_id];
                    let Some(generated_local_variables) =
                        evaluate_local_variables(generated_index, &mut state)
                    else {
                        continue;
                    };
                    // Bound properties live on the template statement/element,
                    // not on a forGroup-generated clone's own synthetic id -
                    // look up by template_id, so every iteration sees the
                    // same resolved value uniformly (boolean/choice bindings
                    // never vary per iteration; that is loop-mutation
                    // territory, out of scope here).
                    match entries_by_element_id.get(&template_id) {
                        Some(entries) if !entries.is_empty() => {
                            let resolver = scalar_binding_resolver.as_ref().expect(
                                "scalar_binding_resolver must exist when property bindings exist",
                            );
                            match apply_property_bindings(
                                &generated_element,
                                Some(entries),
                                resolver,
                                &state,
                            ) {
                                Ok(materialized_element) => evaluate_element_by_type(
                                    generated_id,
                                    materialized_element,
                                    generated_local_variables,
                                    &mut conditional_group_states,
                                    &mut state,
                                ),
                                Err(error) => state.errors.push(error),
                            }
                        }
                        _ => evaluate_element_by_type(
                            generated_id,
                            generated_element,
                            generated_local_variables,
                            &mut conditional_group_states,
                            &mut state,
                        ),
                    }
                }
            }
            continue;
        }

        match entries_by_element_id.get(&id) {
            Some(entries) if !entries.is_empty() => {
                let resolver = scalar_binding_resolver
                    .as_ref()
                    .expect("scalar_binding_resolver must exist when property bindings exist");
                match apply_property_bindings(&element, Some(entries), resolver, &state) {
                    Ok(materialized_element) => evaluate_element_by_type(
                        id,
                        materialized_element,
                        local_variables,
                        &mut conditional_group_states,
                        &mut state,
                    ),
                    Err(error) => state.errors.push(error),
                }
            }
            _ => evaluate_element_by_type(
                id,
                element,
                local_variables,
                &mut conditional_group_states,
                &mut state,
            ),
        }
    }

    let computed_scalar_bindings = scalar_binding_resolver
        .as_ref()
        .map(|resolver| resolver.finalize(&state));

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
        effective_visible_element_ids: effective_visible_element_ids.into_iter().collect(),
        effective_enabled_element_ids: state
            .elements
            .iter()
            .filter_map(element_id)
            .filter(|id| effective_enabled_ids.contains(id))
            .collect(),
        condition_inactive_element_ids: state
            .elements
            .iter()
            .filter_map(element_id)
            .filter(|id| condition_inactive_ids.contains(id))
            .collect(),
        for_group_generated_rows,
        computed_scalar_bindings,
    }
}
