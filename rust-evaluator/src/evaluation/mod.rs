mod activity;
#[cfg(test)]
mod activity_tests;
#[cfg(test)]
mod bezier_curve_tests;
mod bezier_evaluator;
mod bezier_feature_point_evaluator;
mod bezier_math;
#[cfg(test)]
mod bezier_math_tests;
mod bezier_path;
mod common_tangent_evaluator;
#[cfg(test)]
mod common_tangent_evaluator_tests;
mod control_boolean_runtime;
#[cfg(test)]
mod control_boolean_runtime_tests;
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
mod for_group_ancestor_reference;
#[cfg(test)]
mod for_group_ancestor_reference_tests;
mod for_group_generic_runtime;
#[cfg(test)]
mod for_group_generic_runtime_tests;
mod for_group_mutation_runtime;
#[cfg(test)]
mod for_group_tests;
mod geometry_value_kernels;
mod geometry_value_runtime;
#[cfg(test)]
mod geometry_value_runtime_tests;
mod groups;
mod image_evaluator;
#[cfg(test)]
mod image_evaluator_tests;
#[cfg(test)]
mod incomplete_numeric_expression_tests;
mod intersection_point_evaluator;
#[cfg(test)]
mod intersection_point_tests;
mod joined_path_evaluator;
#[cfg(test)]
mod joined_path_tests;
mod line_copy_geometry;
mod line_copy_move_evaluator;
#[cfg(test)]
mod line_copy_move_tests;
mod line_division_point_evaluator;
#[cfg(test)]
mod line_evaluator_tests;
mod line_evaluators;
mod line_geometry_input;
mod line_intersections;
mod line_path;
mod line_tangent_offset_point_evaluator;
#[cfg(test)]
mod line_tangent_offset_point_tests;
mod line_transform;
#[cfg(test)]
mod linear_mutation_integration_tests;
mod math;
mod numeric_binding_runtime;
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
mod path_reverse_evaluator;
#[cfg(test)]
mod path_reverse_evaluator_tests;
mod path_reverse_geometry;
#[cfg(test)]
mod performance_test_support;
#[cfg(test)]
mod performance_tests;
mod point_anchor;
mod point_evaluators;
#[cfg(test)]
mod polyline_tests;
mod property_binding_runtime;
#[cfg(test)]
mod property_binding_runtime_tests;
#[cfg(test)]
mod pure_typed_production_performance_tests;
#[cfg(test)]
mod scalar_expression_payload_compat_tests;
mod scalar_expression_runtime;
#[cfg(test)]
mod scalar_program_integration_tests;
#[cfg(test)]
mod scalar_program_performance_tests;
mod scalars;
mod split_line_evaluator;
#[cfg(test)]
mod split_line_tests;
mod text_evaluator;
#[cfg(test)]
mod text_evaluator_tests;
mod text_template_runtime;
#[cfg(test)]
mod text_template_runtime_tests;
#[cfg(test)]
mod three_point_arc_line_tests;
mod types;

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use activity::{
    effective_activity_by_runtime, effective_drawing_modifier_resolution_by_runtime,
    effective_drawing_modifier_runtime_by_element_id_with_profile,
    effective_drawing_modifier_stroke_by_runtime,
};
use bezier_evaluator::evaluate_bezier_curve;
use bezier_feature_point_evaluator::{evaluate_bezier_bulge_point, evaluate_bezier_extreme_point};
use common_tangent_evaluator::evaluate_common_tangent_line;
use control_boolean_runtime::{
    resolve_conditional_group_condition, resolve_for_group_effective_show_generated,
};
use corner_radius_evaluator::evaluate_corner_radius_arc_line;
use edge_extend_evaluator::{evaluate_edge, evaluate_extend_trim};
use errors::geometry_error;
use for_group::{
    for_group_loop_values, for_group_template_descendant_ids, iteration_local_variables,
};
use for_group_generic_runtime::GenericForGroupRuntime;
use for_group_mutation_runtime::ForGroupMutationRuntime;
use groups::{effective_element_ids, group_state_by_element_id};
use image_evaluator::evaluate_image;
use intersection_point_evaluator::evaluate_intersection_point;
use joined_path_evaluator::evaluate_joined_path;
use line_copy_move_evaluator::{
    evaluate_copy_line, evaluate_move, evaluate_symmetric_copy_line, evaluate_symmetric_move,
};
use line_division_point_evaluator::evaluate_line_division_point;
use line_evaluators::{
    evaluate_angle_length_line, evaluate_arc_line, evaluate_line, evaluate_polyline,
    evaluate_three_point_arc_line,
};
use line_geometry_input::{
    decode_geometry_collection_nodes, decode_geometry_input_targets,
    materialize_geometry_input_targets, materialize_geometry_input_targets_for_runtime,
    GeometryInputTargets,
};
use line_intersections::is_self_intersecting_closed_path;
use line_tangent_offset_point_evaluator::evaluate_line_tangent_offset_point;
use numeric_binding_runtime::{
    apply_numeric_bindings, validate_numeric_bindings_payload, ValidatedNumericBinding,
};
use numeric_expression::evaluate_numeric_or_push;
use offset_line_evaluator::evaluate_offset_line;
use path_reverse_evaluator::evaluate_path_reverse;
use point_evaluators::{
    evaluate_division_point, evaluate_free_point, evaluate_offset_point,
    evaluate_polar_offset_point,
};
use property_binding_runtime::{apply_gate_bindings, apply_property_bindings};
use scalars::{
    validate_binding_versions_payload, validate_condition_expressions_payload,
    validate_control_boolean_bindings_payload, validate_property_bindings_payload,
    validate_scalar_program_payload, validate_text_property_bindings_payload,
    validate_text_templates_payload, validate_typed_expression_payload, ForGroupMutationRunOutcome,
    ForGroupMutationStatement, ScalarBindingResolver, ScalarDocumentBindingResolver,
    ScalarMutationResolver, TypedScalarExpression, ValidatedBindingVersions,
    ValidatedConditionExpression, ValidatedPropertyBinding, ValidatedScalarProgram,
    ValidatedTextTemplate,
};
use split_line_evaluator::evaluate_split_line;
use text_evaluator::{evaluate_text, TextTemplateContext};
use types::{
    element_id, element_type, DependencyError, EffectiveDrawingModifierStroke, ElementId,
    EvaluationState, EvaluationWarning, GeometryMutationExecution,
};
pub use types::{EvaluationCommandError, EvaluationInput, EvaluationPayload};

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
    binding_versions: Option<&ValidatedBindingVersions>,
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
        .unwrap_or_else(|| {
            binding_versions
                .map(|versions| versions.binding_ids.iter().map(String::as_str).collect())
                .unwrap_or_default()
        });
    validate_property_bindings_payload(payload, &element_type_by_id, &valid_binding_ids)
        .map(Some)
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })
}

fn decode_numeric_bindings(
    input: &EvaluationInput,
    scalar_program: Option<&ValidatedScalarProgram>,
    binding_versions: Option<&ValidatedBindingVersions>,
) -> Result<Option<Vec<ValidatedNumericBinding>>, EvaluationCommandError> {
    let Some(payload) = input
        .scalar_expression_payload
        .as_ref()
        .and_then(|value| value.get("numericBindings"))
    else {
        return Ok(None);
    };
    let elements_by_id: HashMap<&str, &Value> = input
        .elements
        .iter()
        .filter_map(|element| Some((element.get("id")?.as_str()?, element)))
        .collect();
    let valid_binding_ids: HashSet<&str> = scalar_program
        .map(|program| {
            program
                .statements
                .iter()
                .map(|statement| statement.binding_id.as_str())
                .collect()
        })
        .unwrap_or_else(|| {
            binding_versions
                .map(|versions| versions.binding_ids.iter().map(String::as_str).collect())
                .unwrap_or_default()
        });
    validate_numeric_bindings_payload(payload, &elements_by_id, &valid_binding_ids)
        .map(Some)
        .map_err(|message| EvaluationCommandError {
            code: "numeric-binding-payload-invalid".to_owned(),
            message,
        })
}

/// Same validation order/fail-closed contract as `decode_property_bindings`,
/// for Task 25's `forGroup.showGenerated` bindings.
fn decode_control_boolean_bindings(
    input: &EvaluationInput,
    scalar_program: Option<&ValidatedScalarProgram>,
    binding_versions: Option<&ValidatedBindingVersions>,
) -> Result<Option<Vec<ValidatedPropertyBinding>>, EvaluationCommandError> {
    let Some(payload) = input.control_boolean_bindings.as_ref() else {
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
        .unwrap_or_else(|| {
            binding_versions
                .map(|versions| versions.binding_ids.iter().map(String::as_str).collect())
                .unwrap_or_default()
        });
    validate_control_boolean_bindings_payload(payload, &element_type_by_id, &valid_binding_ids)
        .map(Some)
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })
}

/// Decodes+validates `input.condition_expressions` against `input.elements`'
/// actual types (each entry's owner must be a `conditionalGroup`). Unlike
/// the two binding decoders above, this has no `scalar_program`-derived
/// `valid_binding_ids` gate: a condition expression's references are
/// resolved through the same `ScalarBindingResolver` as everything else,
/// but the expression itself is a self-contained AST already validated
/// structurally by `validate_typed_expression_payload` - no separate
/// bindingId allowlist to check it against here.
fn decode_condition_expressions(
    input: &EvaluationInput,
) -> Result<Option<Vec<ValidatedConditionExpression>>, EvaluationCommandError> {
    let Some(payload) = input.condition_expressions.as_ref() else {
        return Ok(None);
    };
    let element_type_by_id: HashMap<&str, &str> = input
        .elements
        .iter()
        .filter_map(|element| Some((element.get("id")?.as_str()?, element.get("type")?.as_str()?)))
        .collect();
    validate_condition_expressions_payload(payload, &element_type_by_id)
        .map(Some)
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })
}

fn decoded_binding_ids<'a>(
    scalar_program: Option<&'a ValidatedScalarProgram>,
    binding_versions: Option<&'a ValidatedBindingVersions>,
) -> HashSet<&'a str> {
    scalar_program
        .map(|program| {
            program
                .statements
                .iter()
                .map(|statement| statement.binding_id.as_str())
                .collect()
        })
        .unwrap_or_else(|| {
            binding_versions
                .map(|versions| versions.binding_ids.iter().map(String::as_str).collect())
                .unwrap_or_default()
        })
}

fn text_element_types(input: &EvaluationInput) -> HashMap<&str, &str> {
    input
        .elements
        .iter()
        .filter_map(|element| Some((element.get("id")?.as_str()?, element.get("type")?.as_str()?)))
        .collect()
}

fn decode_text_templates(
    input: &EvaluationInput,
    scalar_program: Option<&ValidatedScalarProgram>,
    binding_versions: Option<&ValidatedBindingVersions>,
) -> Result<Option<Vec<ValidatedTextTemplate>>, EvaluationCommandError> {
    let Some(payload) = input.text_templates.as_ref() else {
        return Ok(None);
    };
    validate_text_templates_payload(
        payload,
        &text_element_types(input),
        scalar_program.is_some() || binding_versions.is_some(),
    )
    .map(Some)
    .map_err(|error| EvaluationCommandError {
        code: error.code.as_str().to_owned(),
        message: error.message,
    })
}

fn decode_text_property_bindings(
    input: &EvaluationInput,
    scalar_program: Option<&ValidatedScalarProgram>,
    binding_versions: Option<&ValidatedBindingVersions>,
) -> Result<Option<Vec<ValidatedPropertyBinding>>, EvaluationCommandError> {
    let Some(payload) = input.text_property_bindings.as_ref() else {
        return Ok(None);
    };
    let valid_binding_ids = decoded_binding_ids(scalar_program, binding_versions);
    validate_text_property_bindings_payload(payload, &text_element_types(input), &valid_binding_ids)
        .map(Some)
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })
}

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
    let binding_versions = input
        .binding_versions
        .as_ref()
        .map(|payload| validate_binding_versions_payload(payload, &input.elements))
        .transpose()
        .map_err(|error| EvaluationCommandError {
            code: error.code.as_str().to_owned(),
            message: error.message,
        })?;
    if scalar_program.is_some() && binding_versions.is_some() {
        return Err(EvaluationCommandError {
            code: "scalar-payload-invalid-field-type".to_owned(),
            message: "scalarProgram and bindingVersions are mutually exclusive".to_owned(),
        });
    }
    let property_bindings =
        decode_property_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())?;
    let numeric_bindings =
        decode_numeric_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())?;
    let control_boolean_bindings = decode_control_boolean_bindings(
        &input,
        scalar_program.as_ref(),
        binding_versions.as_ref(),
    )?;
    let condition_expressions = decode_condition_expressions(&input)?;
    let text_templates =
        decode_text_templates(&input, scalar_program.as_ref(), binding_versions.as_ref())?;
    let text_property_bindings =
        decode_text_property_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())?;
    let geometry_value_program = geometry_value_runtime::decode_geometry_value_program(
        input.geometry_value_program.as_ref(),
    )?;
    let geometry_input_targets =
        decode_geometry_input_targets(input.geometry_input_targets.as_ref())?;
    let geometry_collection_nodes =
        decode_geometry_collection_nodes(input.geometry_collection_nodes.as_ref())?;
    Ok(evaluate_document_input_with_scalar_program(
        input,
        DecodedScalarPayloads {
            scalar_program,
            binding_versions,
            property_bindings,
            numeric_bindings,
            control_boolean_bindings,
            condition_expressions,
            text_templates,
            text_property_bindings,
            geometry_value_program,
            geometry_input_targets,
            geometry_collection_nodes,
        },
    ))
}

struct DecodedScalarPayloads {
    scalar_program: Option<ValidatedScalarProgram>,
    binding_versions: Option<ValidatedBindingVersions>,
    property_bindings: Option<Vec<ValidatedPropertyBinding>>,
    numeric_bindings: Option<Vec<ValidatedNumericBinding>>,
    control_boolean_bindings: Option<Vec<ValidatedPropertyBinding>>,
    condition_expressions: Option<Vec<ValidatedConditionExpression>>,
    text_templates: Option<Vec<ValidatedTextTemplate>>,
    text_property_bindings: Option<Vec<ValidatedPropertyBinding>>,
    geometry_value_program: Vec<geometry_value_runtime::GeometryValueProgramEntry>,
    geometry_input_targets: GeometryInputTargets,
    geometry_collection_nodes: HashMap<String, types::GeometryInputCollectionNode>,
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

/// Bundles Task 25's typed-condition lookup inputs into one argument so
/// `evaluate_element_by_type` doesn't grow an unbounded parameter list -
/// `lookup_id` is the caller's own id for a top-level `conditionalGroup`, or
/// its template id for a generated clone (mirroring the property-binding
/// `template_id` lookup two scopes up), so a `conditionalGroup` written
/// inside a `forGroup` template resolves the same active branch on every
/// iteration.
struct ConditionalGroupContext<'a> {
    lookup_id: &'a ElementId,
    by_element_id: &'a HashMap<ElementId, TypedScalarExpression>,
    scalar_binding_resolver: Option<&'a dyn ScalarDocumentBindingResolver>,
}

fn geometry_mutation_target_ids(element: &Value) -> Vec<ElementId> {
    let endpoint_line_id = |key: &str| {
        element
            .get(key)
            .and_then(|endpoint| endpoint.get("lineId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    };
    let mut target_ids = match element_type(element) {
        Some("edge") => [endpoint_line_id("endpoint1"), endpoint_line_id("endpoint2")]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>(),
        Some("extendTrim") => endpoint_line_id("endpoint").into_iter().collect(),
        Some("pathReverse") => element
            .get("targetLineId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .into_iter()
            .collect(),
        Some("move" | "symmetricMove") => element
            .get("baseLineIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect(),
        _ => Vec::new(),
    };
    let mut seen = HashSet::new();
    target_ids.retain(|target_id| seen.insert(target_id.clone()));
    target_ids
}

fn evaluate_element_by_type(
    id: ElementId,
    element: Value,
    local_variables: (HashMap<String, f64>, HashMap<String, String>),
    conditional_group_states: &mut HashMap<ElementId, Option<&'static str>>,
    condition_context: ConditionalGroupContext,
    text_context: TextTemplateContext,
    state: &mut EvaluationState,
) {
    let capture_id = id.clone();
    let mutation_target_ids = geometry_mutation_target_ids(&element);
    let error_count_before_element_evaluation = state.errors.len();
    match element_type(&element) {
        Some("conditionalGroup") => {
            let active_branch = match condition_context
                .by_element_id
                .get(condition_context.lookup_id)
            {
                Some(expression) => {
                    let resolver = condition_context.scalar_binding_resolver.expect(
                        "scalar_binding_resolver must exist when condition_expressions exist",
                    );
                    let (active_branch, trace) =
                        resolve_conditional_group_condition(expression, resolver, state);
                    state.condition_evaluation_traces.push(serde_json::json!({
                        "elementId": id.clone(),
                        "trace": trace,
                    }));
                    active_branch
                }
                None => {
                    let condition = element.get("condition").unwrap_or(&Value::Null).clone();
                    evaluate_numeric_or_push(
                        &condition,
                        state,
                        &element,
                        &local_variables.0,
                        &local_variables.1,
                    )
                    .map(|value| if value == 0.0 { "else" } else { "then" })
                }
            };
            conditional_group_states.insert(id.clone(), active_branch);
        }
        Some("group" | "forGroup" | "moduleInstance") => {}
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
        Some("bezierExtremePoint") => {
            evaluate_bezier_extreme_point(&element, &local_variables, state)
        }
        Some("bezierBulgePoint") => evaluate_bezier_bulge_point(&element, &local_variables, state),
        Some("intersectionPoint") => evaluate_intersection_point(&element, &local_variables, state),
        Some("line") => evaluate_line(&element, &local_variables, state),
        Some("polyline") => evaluate_polyline(&element, &local_variables, state),
        Some("angleLengthLine") => evaluate_angle_length_line(&element, &local_variables, state),
        Some("commonTangentLine") => evaluate_common_tangent_line(&element, state),
        Some("arcLine") => evaluate_arc_line(&element, &local_variables, state),
        Some("threePointArcLine") => {
            evaluate_three_point_arc_line(&element, &local_variables, state)
        }
        Some("cornerRadiusArcLine") => {
            evaluate_corner_radius_arc_line(&element, &local_variables, state)
        }
        Some("bezierCurve") => evaluate_bezier_curve(&element, &local_variables, state),
        Some("offsetLine") => evaluate_offset_line(&element, &local_variables, state),
        Some("joinedPath") => evaluate_joined_path(&element, state),
        Some("splitLine") => evaluate_split_line(&element, &local_variables, state),
        Some("edge") => evaluate_edge(&element, &local_variables, state),
        Some("extendTrim") => evaluate_extend_trim(&element, &local_variables, state),
        Some("copyLine") => evaluate_copy_line(&element, &local_variables, state),
        Some("symmetricCopyLine") => {
            evaluate_symmetric_copy_line(&element, &local_variables, state)
        }
        Some("move") => evaluate_move(&element, &local_variables, state),
        Some("symmetricMove") => evaluate_symmetric_move(&element, &local_variables, state),
        Some("pathReverse") => evaluate_path_reverse(&element, state),
        Some("image") => evaluate_image(&element, &local_variables, state),
        Some("text") => evaluate_text(&element, &local_variables, text_context, state),
        _ => {}
    }
    if !mutation_target_ids.is_empty()
        && state.errors.len() == error_count_before_element_evaluation
    {
        state
            .geometry_mutation_executions
            .push(GeometryMutationExecution {
                mutation_element_id: capture_id.clone(),
                target_element_ids: mutation_target_ids,
            });
    }
    if !state.pre_mutation_geometry.contains_key(&capture_id) {
        if let Some(geometry) = state.computed_geometry.get(&capture_id) {
            state
                .pre_mutation_geometry
                .insert(capture_id, geometry.clone());
        }
    }
    if !state.base_transformation_geometry.contains_key(&id) {
        if let Some(geometry) = state.computed_geometry.get(&id) {
            state
                .base_transformation_geometry
                .insert(id, geometry.clone());
        }
    }
}

#[derive(Clone)]
struct RuntimeTransformationTarget {
    source: String,
    owner_id: ElementId,
    runtime_owner_id: ElementId,
    stage_path: Vec<String>,
    endpoint_key: Option<String>,
}

fn transformation_stage_key(runtime_owner_id: &str, stage_path: &[String]) -> String {
    format!("{}\u{0}*\u{0}{}", runtime_owner_id, stage_path.join("."))
}

fn transformation_recipe_error(
    recipe: &Value,
    target: Option<&RuntimeTransformationTarget>,
    state: &mut EvaluationState,
    message: impl Into<String>,
) {
    let recipe_id = recipe
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("transformation")
        .to_owned();
    state.errors.push(DependencyError {
        element_id: recipe_id,
        element_name: recipe
            .get("construction")
            .and_then(Value::as_str)
            .unwrap_or("transformation")
            .to_owned(),
        missing_dependency_id: target
            .map(|target| target.owner_id.clone())
            .unwrap_or_default(),
        missing_dependency_name: target.map(|target| target.source.clone()),
        message: message.into(),
    });
}

fn has_for_group_ancestor(owner_id: &str, state: &EvaluationState) -> bool {
    let mut parent_id = state
        .elements_by_id
        .get(owner_id)
        .and_then(|index| state.elements.get(*index))
        .and_then(types::parent_group_id);
    let mut visited = HashSet::new();
    while let Some(current_id) = parent_id {
        if !visited.insert(current_id.clone()) {
            return false;
        }
        let Some(parent) = state
            .elements_by_id
            .get(&current_id)
            .and_then(|index| state.elements.get(*index))
        else {
            return false;
        };
        if element_type(parent) == Some("forGroup") {
            return true;
        }
        parent_id = types::parent_group_id(parent);
    }
    false
}

fn runtime_transformation_targets(
    recipe: &Value,
    source_target: &Value,
    state: &mut EvaluationState,
) -> Vec<RuntimeTransformationTarget> {
    let Some(owner_id) = source_target.get("ownerId").and_then(Value::as_str) else {
        return Vec::new();
    };
    let target = RuntimeTransformationTarget {
        source: source_target
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or(owner_id)
            .to_owned(),
        owner_id: owner_id.to_owned(),
        runtime_owner_id: owner_id.to_owned(),
        stage_path: source_target
            .get("stagePath")
            .and_then(Value::as_array)
            .map(|path| {
                path.iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        endpoint_key: source_target
            .get("endpointKey")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    };
    let rows = state
        .for_group_generated_rows
        .iter()
        .filter(|row| row.template_element_id == target.owner_id)
        .collect::<Vec<_>>();
    if let Some(index_text) = source_target.get("occurrenceIndex").and_then(Value::as_str) {
        let index = index_text.parse::<usize>().ok();
        let Some(row) = index.and_then(|index| rows.get(index)) else {
            transformation_recipe_error(
                recipe,
                Some(&target),
                state,
                format!(
                    "generated occurrence「{}」はこの評価位置では利用できません。",
                    target.source
                ),
            );
            return Vec::new();
        };
        return vec![RuntimeTransformationTarget {
            runtime_owner_id: row.generated_element_id.clone(),
            ..target
        }];
    }
    if has_for_group_ancestor(&target.owner_id, state) {
        return rows
            .into_iter()
            .map(|row| RuntimeTransformationTarget {
                runtime_owner_id: row.generated_element_id.clone(),
                ..target.clone()
            })
            .collect();
    }
    vec![target]
}

fn transformation_synthetic_element(
    recipe: &Value,
    targets: &[RuntimeTransformationTarget],
) -> Option<Value> {
    let operation = recipe.get("operation")?;
    let construction = recipe.get("construction")?.as_str()?;
    let base = json!({
        "id": recipe.get("id")?,
        "name": construction,
        "activity": "visible"
    });
    Some(match construction {
        "edge" => json!({
            "id": base["id"], "name": base["name"], "activity": "visible", "type": "edge",
            "endpoint1": {"lineId": targets.first()?.runtime_owner_id, "endpointKey": targets.first()?.endpoint_key.as_ref()?},
            "endpoint2": {"lineId": targets.get(1)?.runtime_owner_id, "endpointKey": targets.get(1)?.endpoint_key.as_ref()?},
            "intersectionIndex": operation.get("intersectionIndex")?
        }),
        "extend" => json!({
            "id": base["id"], "name": base["name"], "activity": "visible", "type": "extendTrim",
            "endpoint": {"lineId": targets.first()?.runtime_owner_id, "endpointKey": targets.first()?.endpoint_key.as_ref()?},
            "point": operation.get("point")?
        }),
        "move" => json!({
            "id": base["id"], "name": base["name"], "activity": "visible", "type": "move",
            "startPoint": operation.get("startPoint")?, "endPoint": operation.get("endPoint")?,
            "scale": operation.get("scale")?, "angleDeg": operation.get("angleDeg")?,
            "mirrorX": operation.get("mirrorX")?,
            "baseLineIds": targets.iter().map(|target| target.runtime_owner_id.clone()).collect::<Vec<_>>()
        }),
        "mirrorMove" => json!({
            "id": base["id"], "name": base["name"], "activity": "visible", "type": "symmetricMove",
            "axisPoint1": operation.get("axisPoint1")?, "axisPoint2": operation.get("axisPoint2")?,
            "baseLineIds": targets.iter().map(|target| target.runtime_owner_id.clone()).collect::<Vec<_>>()
        }),
        "reverse" => json!({
            "id": base["id"], "name": base["name"], "activity": "visible", "type": "pathReverse",
            "targetLineId": targets.first()?.runtime_owner_id
        }),
        _ => return None,
    })
}

fn execute_transformation_invocation(
    recipe: &Value,
    targets: &[RuntimeTransformationTarget],
    state: &mut EvaluationState,
) {
    if targets.is_empty() {
        return;
    }
    let mut inputs = HashMap::<ElementId, Value>::new();
    for target in targets {
        let input = if target.stage_path.is_empty() {
            state
                .computed_geometry
                .get(&target.runtime_owner_id)
                .cloned()
        } else if target.stage_path == ["base".to_owned()] {
            state
                .base_transformation_geometry
                .get(&target.runtime_owner_id)
                .cloned()
        } else {
            state
                .transformation_stage_geometry
                .get(&transformation_stage_key(
                    &target.runtime_owner_id,
                    &target.stage_path,
                ))
                .cloned()
        };
        let Some(input) = input else {
            transformation_recipe_error(
                recipe,
                Some(target),
                state,
                format!(
                    "transformation target「{}」の stage geometry は利用できません。",
                    target.source
                ),
            );
            return;
        };
        inputs.insert(target.runtime_owner_id.clone(), input);
    }
    let original = targets
        .iter()
        .map(|target| {
            (
                target.runtime_owner_id.clone(),
                state
                    .computed_geometry
                    .get(&target.runtime_owner_id)
                    .cloned(),
            )
        })
        .collect::<HashMap<_, _>>();
    for (id, input) in inputs {
        state.computed_geometry.insert(id, input);
    }
    let Some(synthetic) = transformation_synthetic_element(recipe, targets) else {
        return;
    };
    let error_count_before = state.errors.len();
    if recipe
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        let local_variables = (HashMap::new(), HashMap::new());
        match recipe.get("construction").and_then(Value::as_str) {
            Some("edge") => evaluate_edge(&synthetic, &local_variables, state),
            Some("extend") => evaluate_extend_trim(&synthetic, &local_variables, state),
            Some("move") => evaluate_move(&synthetic, &local_variables, state),
            Some("mirrorMove") => evaluate_symmetric_move(&synthetic, &local_variables, state),
            Some("reverse") => evaluate_path_reverse(&synthetic, state),
            _ => {}
        }
    }
    if state.errors.len() != error_count_before {
        for (id, previous) in original {
            if let Some(previous) = previous {
                state.computed_geometry.insert(id, previous);
            } else {
                state.computed_geometry.remove(&id);
            }
        }
        return;
    }
    let stage_name = recipe.get("stageName").and_then(Value::as_str);
    for target in targets {
        let Some(output) = state
            .computed_geometry
            .get(&target.runtime_owner_id)
            .cloned()
        else {
            continue;
        };
        if let Some(stage_name) = stage_name {
            let mut path = target.stage_path.clone();
            path.push(stage_name.to_owned());
            state.transformation_stage_geometry.insert(
                transformation_stage_key(&target.runtime_owner_id, &path),
                output.clone(),
            );
            path.push("final".to_owned());
            state.transformation_stage_geometry.insert(
                transformation_stage_key(&target.runtime_owner_id, &path),
                output,
            );
        } else if !target.stage_path.is_empty() {
            let mut path = target.stage_path.clone();
            path.push("final".to_owned());
            state.transformation_stage_geometry.insert(
                transformation_stage_key(&target.runtime_owner_id, &path),
                output,
            );
        }
    }
    for target in targets {
        if !target.stage_path.is_empty() {
            if let Some(previous) = original
                .get(&target.runtime_owner_id)
                .and_then(Clone::clone)
            {
                state
                    .computed_geometry
                    .insert(target.runtime_owner_id.clone(), previous);
            }
        }
    }
}

fn execute_transformation_recipes_through(
    recipes: &[Value],
    next_recipe_index: &mut usize,
    source_order: f64,
    state: &mut EvaluationState,
) {
    while *next_recipe_index < recipes.len() {
        let recipe = &recipes[*next_recipe_index];
        let recipe_order = recipe
            .get("runtimeSourceOrder")
            .and_then(Value::as_f64)
            .or_else(|| {
                recipe
                    .get("sourceStatementIndex")
                    .and_then(Value::as_u64)
                    .map(|value| value as f64)
            })
            .unwrap_or(f64::MAX);
        if recipe_order > source_order {
            break;
        }
        let targets = recipe
            .get("targets")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|target| runtime_transformation_targets(recipe, target, state))
            .collect::<Vec<_>>();
        if !targets.iter().any(Vec::is_empty) {
            if recipe.get("construction").and_then(Value::as_str) == Some("edge")
                && targets.iter().any(|targets| targets.len() > 1)
            {
                let count = targets.iter().map(Vec::len).max().unwrap_or(0);
                for index in 0..count {
                    let pair = targets
                        .iter()
                        .map(|targets| {
                            targets
                                .get(index)
                                .or_else(|| (targets.len() == 1).then(|| &targets[0]))
                                .cloned()
                        })
                        .collect::<Option<Vec<_>>>();
                    if let Some(pair) = pair {
                        execute_transformation_invocation(recipe, &pair, state);
                    }
                }
            } else {
                execute_transformation_invocation(
                    recipe,
                    &targets.into_iter().flatten().collect::<Vec<_>>(),
                    state,
                );
            }
        }
        *next_recipe_index += 1;
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
    let binding_versions = input
        .binding_versions
        .as_ref()
        .map(|payload| validate_binding_versions_payload(payload, &input.elements))
        .transpose()
        .expect("evaluation test input binding_versions must be valid");
    let property_bindings =
        decode_property_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())
            .expect("evaluation test input property_bindings must be valid");
    let numeric_bindings =
        decode_numeric_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())
            .expect("evaluation test input numeric_bindings must be valid");
    let control_boolean_bindings =
        decode_control_boolean_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())
            .expect("evaluation test input control_boolean_bindings must be valid");
    let condition_expressions = decode_condition_expressions(&input)
        .expect("evaluation test input condition_expressions must be valid");
    let text_templates =
        decode_text_templates(&input, scalar_program.as_ref(), binding_versions.as_ref())
            .expect("evaluation test input text_templates must be valid");
    let text_property_bindings =
        decode_text_property_bindings(&input, scalar_program.as_ref(), binding_versions.as_ref())
            .expect("evaluation test input text_property_bindings must be valid");
    let geometry_value_program = geometry_value_runtime::decode_geometry_value_program(
        input.geometry_value_program.as_ref(),
    )
    .expect("evaluation test input geometry_value_program must be valid");
    let geometry_input_targets =
        decode_geometry_input_targets(input.geometry_input_targets.as_ref())
            .expect("evaluation test input geometry_input_targets must be valid");
    let geometry_collection_nodes =
        decode_geometry_collection_nodes(input.geometry_collection_nodes.as_ref())
            .expect("evaluation test input geometry_collection_nodes must be valid");
    evaluate_document_input_with_scalar_program(
        input,
        DecodedScalarPayloads {
            scalar_program,
            binding_versions,
            property_bindings,
            numeric_bindings,
            control_boolean_bindings,
            condition_expressions,
            text_templates,
            text_property_bindings,
            geometry_value_program,
            geometry_input_targets,
            geometry_collection_nodes,
        },
    )
}

fn evaluate_document_input_with_scalar_program(
    input: EvaluationInput,
    decoded: DecodedScalarPayloads,
) -> EvaluationPayload {
    let DecodedScalarPayloads {
        scalar_program,
        binding_versions,
        property_bindings,
        numeric_bindings,
        control_boolean_bindings,
        condition_expressions,
        text_templates,
        text_property_bindings,
        geometry_value_program,
        geometry_input_targets,
        geometry_collection_nodes,
    } = decoded;
    let mut geometry_value_program = geometry_value_program;
    geometry_value_program.sort_by(|left, right| {
        left.execution_position
            .total_cmp(&right.execution_position)
            .then(
                left.source_statement_index
                    .cmp(&right.source_statement_index),
            )
    });
    let evaluation_limit_index = input
        .evaluation_limit_index
        .unwrap_or(input.elements.len())
        .min(input.elements.len());
    let drawing_modifiers = input
        .drawing_modifiers
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let evaluated_elements = input.elements[..evaluation_limit_index].to_vec();
    let mut transformation_recipes = input
        .transformation_recipes
        .clone()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    transformation_recipes.sort_by(|left, right| {
        let order = |recipe: &Value| {
            recipe
                .get("runtimeSourceOrder")
                .and_then(Value::as_f64)
                .or_else(|| {
                    recipe
                        .get("sourceStatementIndex")
                        .and_then(Value::as_u64)
                        .map(|value| value as f64)
                })
                .unwrap_or(f64::MAX)
        };
        order(left).total_cmp(&order(right)).then_with(|| {
            left.get("sourceStatementIndex")
                .and_then(Value::as_u64)
                .unwrap_or(usize::MAX as u64)
                .cmp(
                    &right
                        .get("sourceStatementIndex")
                        .and_then(Value::as_u64)
                        .unwrap_or(usize::MAX as u64),
                )
        })
    });
    let source_statement_indices = input
        .source_statement_indices
        .as_ref()
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    Some((
                        entry.get("elementId")?.as_str()?.to_owned(),
                        entry.get("statementIndex")?.as_u64()? as usize,
                    ))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let instance_snapshots = input
        .module_materialization
        .as_ref()
        .map(|materialization| materialization.instances.clone())
        .unwrap_or_default();
    let evaluated_ids: HashSet<ElementId> =
        evaluated_elements.iter().filter_map(element_id).collect();
    let mut source_effective_drawing_modifier_runtime =
        effective_drawing_modifier_runtime_by_element_id_with_profile(
            &input.elements,
            Some(&drawing_modifiers),
            input.selected_drawing_profile_id.as_deref(),
        );
    let activities = effective_activity_by_runtime(&source_effective_drawing_modifier_runtime);
    let group_states = group_state_by_element_id(&input.elements, &activities);
    let mut state = EvaluationState {
        elements_by_id: input
            .elements
            .iter()
            .enumerate()
            .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
            .collect(),
        elements: input.elements,
        group_states,
        drawing_modifiers,
        selected_drawing_profile_id: input.selected_drawing_profile_id.clone(),
        computed_geometry: HashMap::new(),
        base_transformation_geometry: HashMap::new(),
        transformation_stage_geometry: HashMap::new(),
        computed_geometry_values: HashMap::new(),
        geometry_input_targets,
        geometry_collection_nodes,
        geometry_value_binders: HashMap::new(),
        for_group_generated_rows: Vec::new(),
        for_group_expected_occurrence_count_by_template_id: HashMap::new(),
        computed_geometry_order: Vec::new(),
        pre_mutation_geometry: HashMap::new(),
        geometry_mutation_executions: Vec::new(),
        condition_evaluation_traces: Vec::new(),
        instance_base_geometry: HashMap::new(),
        errors: Vec::new(),
        geometry_value_errors: Vec::new(),
        warnings: Vec::new(),
    };
    let mut conditional_group_states = HashMap::<ElementId, Option<&'static str>>::new();
    let mut condition_inactive_ids = HashSet::<ElementId>::new();
    let mut effective_enabled_ids = HashSet::<ElementId>::new();
    let mut effective_enabled_order = Vec::<ElementId>::new();
    let template_descendant_ids = for_group_template_descendant_ids(&state.elements);
    let mut for_group_effective_show_generated_ids = Vec::<ElementId>::new();
    let capture_completed_instances = |completed_index: usize, state: &mut EvaluationState| {
        for snapshot in instance_snapshots
            .iter()
            .filter(|snapshot| snapshot.end_runtime_index == completed_index)
        {
            let geometry = snapshot
                .descendant_ids
                .iter()
                .filter_map(|id| state.computed_geometry.get(id).cloned())
                .collect::<Vec<_>>();
            state
                .instance_base_geometry
                .insert(snapshot.instance_id.clone(), geometry);
        }
    };

    // Built whenever a scalar_program is present, independent of whether any
    // property bindings exist - computed_scalar_bindings is Task 21's own
    // contract and must not depend on Task 23's property wiring. One
    // resolver instance is reused for both materialization below and the
    // final computed_scalar_bindings output, so no binding is ever
    // evaluated more than once.
    let scalar_binding_resolver = scalar_program.as_ref().map(ScalarBindingResolver::new);
    let mut scalar_mutation_resolver = binding_versions.as_ref().map(ScalarMutationResolver::new);
    let entries_by_element_id: HashMap<ElementId, Vec<ValidatedPropertyBinding>> =
        property_bindings
            .into_iter()
            .flatten()
            .chain(text_property_bindings.into_iter().flatten())
            .fold(HashMap::new(), |mut map, entry| {
                map.entry(entry.element_id.clone()).or_default().push(entry);
                map
            });
    let numeric_entries_by_element_id: HashMap<ElementId, Vec<ValidatedNumericBinding>> =
        numeric_bindings
            .into_iter()
            .flatten()
            .fold(HashMap::new(), |mut map, entry| {
                map.entry(entry.element_id.clone()).or_default().push(entry);
                map
            });
    let show_generated_by_element_id: HashMap<ElementId, ValidatedPropertyBinding> =
        control_boolean_bindings
            .into_iter()
            .flatten()
            .map(|entry| (entry.element_id.clone(), entry))
            .collect();
    let condition_by_element_id: HashMap<ElementId, TypedScalarExpression> = condition_expressions
        .into_iter()
        .flatten()
        .map(|entry| (entry.element_id, entry.expression))
        .collect();
    let text_templates_by_element_id: HashMap<ElementId, ValidatedTextTemplate> = text_templates
        .into_iter()
        .flatten()
        .map(|template| (template.element_id.clone(), template))
        .collect();

    // Direct enabled/visible bindings are a separate first pass. Only these
    // two gate inputs may be resolved here; construction properties and
    // control inputs remain deferred until the normal document-order loop.
    if let Some(gate_resolver) = scalar_mutation_resolver
        .as_ref()
        .map(|resolver| resolver as &dyn ScalarDocumentBindingResolver)
        .or_else(|| {
            scalar_binding_resolver
                .as_ref()
                .map(|resolver| resolver as &dyn ScalarDocumentBindingResolver)
        })
    {
        for index in 0..evaluation_limit_index {
            let Some(id) = element_id(&state.elements[index]) else {
                continue;
            };
            let source_order = source_statement_indices.get(&id).copied();
            match apply_gate_bindings(
                &state.elements[index],
                entries_by_element_id.get(&id),
                gate_resolver,
                &state,
                source_order,
            ) {
                Ok(gated) => state.elements[index] = gated,
                Err(_) => {
                    if let Some(object) = state.elements[index].as_object_mut() {
                        object.insert("enabled".to_owned(), Value::Bool(false));
                    }
                }
            }
        }
    }

    // Rebuild direct/ancestor activity after the gate pass. This keeps the
    // production Rust path aligned with the TypeScript reference evaluator.
    source_effective_drawing_modifier_runtime =
        effective_drawing_modifier_runtime_by_element_id_with_profile(
            &state.elements,
            Some(&state.drawing_modifiers),
            state.selected_drawing_profile_id.as_deref(),
        );
    let gated_activities =
        effective_activity_by_runtime(&source_effective_drawing_modifier_runtime);
    state.group_states = group_state_by_element_id(&state.elements, &gated_activities);
    let mut effective_visible_element_ids =
        effective_element_ids(&state.elements, &gated_activities, true)
            .into_iter()
            .filter(|id| evaluated_ids.contains(id))
            .collect();
    let mut base_effective_enabled_ids: HashSet<ElementId> =
        effective_element_ids(&state.elements, &gated_activities, false)
            .into_iter()
            .filter(|id| evaluated_ids.contains(id))
            .collect();
    base_effective_enabled_ids.extend(
        input
            .allow_disabled_element_ids
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|id| evaluated_ids.contains(*id))
            .cloned(),
    );
    let original_elements = state.elements.clone();
    let source_effective_drawing_modifier_strokes =
        effective_drawing_modifier_stroke_by_runtime(&source_effective_drawing_modifier_runtime);
    let source_effective_drawing_modifier_resolutions =
        effective_drawing_modifier_resolution_by_runtime(
            &source_effective_drawing_modifier_runtime,
        );

    let mut next_geometry_value_index = 0usize;
    let mut next_transformation_recipe_index = 0usize;
    let empty_geometry_value_resolver = geometry_value_runtime::EmptyBindingResolver;

    'elements: for index in 0..evaluation_limit_index {
        if index > 0 {
            capture_completed_instances(index - 1, &mut state);
        }
        let mut element = state.elements[index].clone();
        let id = match element_id(&element) {
            Some(id) => id,
            None => continue,
        };
        let current_source_order = scalar_mutation_resolver.as_ref().map(|resolver| {
            resolver
                .source_order_for_element(&id)
                .expect("validated mutation payload must contain every element source order")
        });
        if let Some(source_order) = current_source_order {
            scalar_mutation_resolver
                .as_mut()
                .expect("source order requires a scalar mutation resolver")
                .advance_before_with_geometry_values(
                    source_order,
                    &mut state,
                    &geometry_value_program,
                    &mut next_geometry_value_index,
                );
        }
        let active_scalar_binding_resolver: Option<&dyn ScalarDocumentBindingResolver> =
            scalar_mutation_resolver
                .as_ref()
                .map(|resolver| resolver as &dyn ScalarDocumentBindingResolver)
                .or_else(|| {
                    scalar_binding_resolver
                        .as_ref()
                        .map(|resolver| resolver as &dyn ScalarDocumentBindingResolver)
                });
        let current_execution_position = current_source_order
            .map(|source_order| source_order as f64)
            .unwrap_or(source_statement_indices.get(&id).copied().unwrap_or(index) as f64);
        while next_geometry_value_index < geometry_value_program.len()
            && geometry_value_program[next_geometry_value_index].execution_position
                <= current_execution_position
        {
            if !geometry_value_program[next_geometry_value_index].lazy {
                let resolver =
                    active_scalar_binding_resolver.unwrap_or(&empty_geometry_value_resolver);
                geometry_value_runtime::evaluate_geometry_value_entry(
                    &geometry_value_program[next_geometry_value_index],
                    resolver,
                    &mut state,
                );
            }
            next_geometry_value_index += 1;
        }
        execute_transformation_recipes_through(
            &transformation_recipes,
            &mut next_transformation_recipe_index,
            current_execution_position - 0.5,
            &mut state,
        );
        if template_descendant_ids.contains(&id) {
            execute_transformation_recipes_through(
                &transformation_recipes,
                &mut next_transformation_recipe_index,
                current_execution_position,
                &mut state,
            );
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
            execute_transformation_recipes_through(
                &transformation_recipes,
                &mut next_transformation_recipe_index,
                current_execution_position,
                &mut state,
            );
            continue;
        }
        if !base_effective_enabled_ids.contains(&id) {
            execute_transformation_recipes_through(
                &transformation_recipes,
                &mut next_transformation_recipe_index,
                current_execution_position,
                &mut state,
            );
            continue;
        }
        if effective_enabled_ids.insert(id.clone()) {
            effective_enabled_order.push(id.clone());
        }

        if let Some(entries) = numeric_entries_by_element_id.get(&id) {
            let resolver = active_scalar_binding_resolver
                .expect("scalar_binding_resolver must exist when numeric bindings exist");
            match apply_numeric_bindings(
                &element,
                Some(entries),
                resolver,
                current_source_order,
                &state,
            ) {
                Ok(materialized) => {
                    element = materialized;
                    state.elements[index] = element.clone();
                }
                Err(error) => {
                    state.errors.push(error);
                    execute_transformation_recipes_through(
                        &transformation_recipes,
                        &mut next_transformation_recipe_index,
                        current_execution_position,
                        &mut state,
                    );
                    continue;
                }
            }
        }

        let local_variables = iteration_local_variables(&[]);

        // Task 33 records Task 25's single Rust-side decision immediately
        // after evaluating this opener. The mutation cursor never receives a
        // TS selection and never re-evaluates the condition itself.
        if element_type(&element) == Some("conditionalGroup") {
            let active_branch = match condition_by_element_id.get(&id) {
                Some(expression) => {
                    let resolver = active_scalar_binding_resolver.expect(
                        "scalar_binding_resolver must exist when condition_expressions exist",
                    );
                    {
                        let (active_branch, trace) =
                            resolve_conditional_group_condition(expression, resolver, &state);
                        state.condition_evaluation_traces.push(serde_json::json!({
                            "elementId": id.clone(),
                            "trace": trace,
                        }));
                        active_branch
                    }
                }
                None => evaluate_numeric_or_push(
                    element.get("condition").unwrap_or(&Value::Null),
                    &mut state,
                    &element,
                    &local_variables.0,
                    &local_variables.1,
                )
                .map(|value| if value == 0.0 { "else" } else { "then" }),
            };
            conditional_group_states.insert(id.clone(), active_branch);
            if let Some(resolver) = scalar_mutation_resolver.as_mut() {
                resolver.register_conditional_result(&id, active_branch);
            }
            execute_transformation_recipes_through(
                &transformation_recipes,
                &mut next_transformation_recipe_index,
                current_execution_position,
                &mut state,
            );
            continue;
        }

        if element_type(&element) == Some("forGroup") {
            let Some(iteration_values) =
                for_group_loop_values(&element, &local_variables, &mut state)
            else {
                execute_transformation_recipes_through(
                    &transformation_recipes,
                    &mut next_transformation_recipe_index,
                    current_execution_position,
                    &mut state,
                );
                continue;
            };

            // Evaluated once per forGroup entry, alongside min/max/step -
            // never re-evaluated per iteration. Presentation-only: never
            // gates or alters the iteration loop below.
            let literal_show_generated = element
                .get("showGenerated")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let effective_show_generated = match show_generated_by_element_id.get(&id) {
                Some(entry) => {
                    let resolver = active_scalar_binding_resolver.expect(
                        "scalar_binding_resolver must exist when control_boolean_bindings exist",
                    );
                    resolve_for_group_effective_show_generated(
                        Some(entry),
                        literal_show_generated,
                        resolver,
                        &state,
                    )
                }
                None => literal_show_generated,
            };
            if effective_show_generated {
                for_group_effective_show_generated_ids.push(id.clone());
            }

            if scalar_mutation_resolver
                .as_ref()
                .is_some_and(|resolver| resolver.has_for_group_owner(&id))
            {
                let resolver = scalar_mutation_resolver
                    .as_mut()
                    .expect("forGroup owner requires a mutation resolver");
                let exit_source_order = resolver
                    .for_group_exit_source_order(&id)
                    .expect("validated forGroup owner must have an exit source order");
                // Skip the loop's static range before running generated
                // statements. This advances only the ordinary cursor; all
                // evaluation and history remain scheduler-owned.
                let owner_statement_id = resolver
                    .for_group_owner_statement_id(&id)
                    .expect("validated forGroup owner must have an owner statement id")
                    .to_owned();
                resolver.consume_for_group_source_range(&owner_statement_id, exit_source_order);
                let mut environment = resolver.begin_for_group_environment();
                let mut runtime = ForGroupMutationRuntime::new(
                    &original_elements,
                    &base_effective_enabled_ids,
                    &entries_by_element_id,
                    &numeric_entries_by_element_id,
                    &show_generated_by_element_id,
                    &condition_by_element_id,
                    &text_templates_by_element_id,
                    &mut effective_visible_element_ids,
                    &mut effective_enabled_ids,
                    &mut effective_enabled_order,
                    &mut conditional_group_states,
                    &mut condition_inactive_ids,
                    &mut for_group_effective_show_generated_ids,
                );
                let outcome = runtime
                    .run(
                        resolver,
                        &mut environment,
                        &element,
                        &element,
                        &iteration_values,
                        effective_show_generated,
                        &[],
                        &HashMap::new(),
                        &[],
                        &mut state,
                    )
                    .expect("validated forGroup scheduler must not mutate an iteration binding");
                resolver.commit_for_group_environment(&environment);
                if outcome == ForGroupMutationRunOutcome::Stopped {
                    break 'elements;
                }
                execute_transformation_recipes_through(
                    &transformation_recipes,
                    &mut next_transformation_recipe_index,
                    current_execution_position,
                    &mut state,
                );
                continue;
            }

            let mut generic_runtime = GenericForGroupRuntime::new(
                &original_elements,
                &base_effective_enabled_ids,
                &entries_by_element_id,
                &numeric_entries_by_element_id,
                &show_generated_by_element_id,
                &condition_by_element_id,
                &text_templates_by_element_id,
                active_scalar_binding_resolver,
                &mut effective_visible_element_ids,
                &mut effective_enabled_ids,
                &mut effective_enabled_order,
                &mut conditional_group_states,
                &mut condition_inactive_ids,
                &mut for_group_effective_show_generated_ids,
            );
            generic_runtime.run(
                &element,
                &element,
                &iteration_values,
                effective_show_generated,
                &[],
                &HashMap::new(),
                &[],
                &mut state,
            );
            execute_transformation_recipes_through(
                &transformation_recipes,
                &mut next_transformation_recipe_index,
                current_execution_position,
                &mut state,
            );
            continue;
        }

        match entries_by_element_id.get(&id) {
            Some(entries) if !entries.is_empty() => {
                let resolver = active_scalar_binding_resolver
                    .expect("scalar_binding_resolver must exist when property bindings exist");
                match apply_property_bindings(
                    &element,
                    Some(entries),
                    resolver,
                    &state,
                    current_source_order,
                ) {
                    Ok(materialized_element) => {
                        let mut materialized_element = materialized_element;
                        if let Err(issue_code) = materialize_geometry_input_targets(
                            &mut state,
                            &mut materialized_element,
                            &id,
                            active_scalar_binding_resolver,
                            Some(current_execution_position),
                        ) {
                            let element_name = materialized_element
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or(&id);
                            state.errors.push(geometry_error(
                                &materialized_element,
                                format!(
                                    "{element_name} の geometry collection index を評価できません。({issue_code})"
                                ),
                            ));
                            execute_transformation_recipes_through(
                                &transformation_recipes,
                                &mut next_transformation_recipe_index,
                                current_execution_position,
                                &mut state,
                            );
                            continue;
                        }
                        state.elements[index] = materialized_element.clone();
                        evaluate_element_by_type(
                            id.clone(),
                            materialized_element,
                            local_variables,
                            &mut conditional_group_states,
                            ConditionalGroupContext {
                                lookup_id: &id,
                                by_element_id: &condition_by_element_id,
                                scalar_binding_resolver: active_scalar_binding_resolver,
                            },
                            TextTemplateContext {
                                lookup_id: &id,
                                by_element_id: &text_templates_by_element_id,
                                scalar_binding_resolver: active_scalar_binding_resolver,
                            },
                            &mut state,
                        )
                    }
                    Err(error) => state.errors.push(error),
                }
            }
            _ => {
                if let Err(issue_code) = materialize_geometry_input_targets(
                    &mut state,
                    &mut element,
                    &id,
                    active_scalar_binding_resolver,
                    Some(current_execution_position),
                ) {
                    let element_name = element.get("name").and_then(Value::as_str).unwrap_or(&id);
                    state.errors.push(geometry_error(
                        &element,
                        format!(
                            "{element_name} の geometry collection index を評価できません。({issue_code})"
                        ),
                    ));
                    execute_transformation_recipes_through(
                        &transformation_recipes,
                        &mut next_transformation_recipe_index,
                        current_execution_position,
                        &mut state,
                    );
                    continue;
                }
                state.elements[index] = element.clone();
                evaluate_element_by_type(
                    id.clone(),
                    element,
                    local_variables,
                    &mut conditional_group_states,
                    ConditionalGroupContext {
                        lookup_id: &id,
                        by_element_id: &condition_by_element_id,
                        scalar_binding_resolver: active_scalar_binding_resolver,
                    },
                    TextTemplateContext {
                        lookup_id: &id,
                        by_element_id: &text_templates_by_element_id,
                        scalar_binding_resolver: active_scalar_binding_resolver,
                    },
                    &mut state,
                )
            }
        }
        execute_transformation_recipes_through(
            &transformation_recipes,
            &mut next_transformation_recipe_index,
            current_execution_position,
            &mut state,
        );
    }
    execute_transformation_recipes_through(
        &transformation_recipes,
        &mut next_transformation_recipe_index,
        f64::INFINITY,
        &mut state,
    );
    while next_geometry_value_index < geometry_value_program.len() {
        if let Some(resolver) = scalar_mutation_resolver.as_mut() {
            let source_order = geometry_value_program[next_geometry_value_index]
                .execution_position
                .ceil() as usize;
            resolver.advance_before_with_geometry_values(
                source_order,
                &mut state,
                &geometry_value_program,
                &mut next_geometry_value_index,
            );
            if next_geometry_value_index >= geometry_value_program.len() {
                break;
            }
        }
        let remaining_geometry_value_resolver = scalar_mutation_resolver
            .as_ref()
            .map(|resolver| resolver as &dyn ScalarDocumentBindingResolver)
            .or_else(|| {
                scalar_binding_resolver
                    .as_ref()
                    .map(|resolver| resolver as &dyn ScalarDocumentBindingResolver)
            })
            .unwrap_or(&empty_geometry_value_resolver);
        if !geometry_value_program[next_geometry_value_index].lazy {
            geometry_value_runtime::evaluate_geometry_value_entry(
                &geometry_value_program[next_geometry_value_index],
                remaining_geometry_value_resolver,
                &mut state,
            );
        }
        next_geometry_value_index += 1;
    }
    if evaluation_limit_index > 0 {
        capture_completed_instances(evaluation_limit_index - 1, &mut state);
    }

    let (computed_scalar_bindings, computed_scalar_binding_versions) =
        if let Some(resolver) = scalar_mutation_resolver.as_mut() {
            resolver.finalize(&state);
            (Some(resolver.computed_bindings()), Some(resolver.history()))
        } else {
            (
                scalar_binding_resolver
                    .as_ref()
                    .map(|resolver| resolver.finalize(&state)),
                None,
            )
        };

    let mut effective_drawing_modifier_strokes = original_elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            let stroke = source_effective_drawing_modifier_strokes.get(&id)?.clone();
            Some(EffectiveDrawingModifierStroke {
                element_id: id,
                stroke,
            })
        })
        .collect::<Vec<_>>();
    let mut effective_drawing_modifier_resolutions = original_elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            let resolution = source_effective_drawing_modifier_resolutions
                .get(&id)?
                .clone();
            Some(serde_json::json!({
                "elementId": id,
                "resolution": resolution,
            }))
        })
        .collect::<Vec<_>>();
    // Generated ids are runtime identities. Their modifier semantics belong
    // to the source template, so use the structured evaluator relationship
    // instead of inferring a template from the generated id string.
    for row in &state.for_group_generated_rows {
        if let Some(stroke) = source_effective_drawing_modifier_strokes
            .get(&row.template_element_id)
            .cloned()
        {
            effective_drawing_modifier_strokes.push(EffectiveDrawingModifierStroke {
                element_id: row.generated_element_id.clone(),
                stroke,
            });
        }
        if let Some(resolution) = source_effective_drawing_modifier_resolutions
            .get(&row.template_element_id)
            .cloned()
        {
            effective_drawing_modifier_resolutions.push(serde_json::json!({
                "elementId": row.generated_element_id,
                "resolution": resolution,
            }));
        }
    }

    // Self-intersection suppresses only fill presentation. Keep the geometry
    // and stroke intact, while using the evaluator's existing warning channel
    // so host adapters can surface the contract-required warning later.
    let generated_source_by_id = state
        .for_group_generated_rows
        .iter()
        .map(|row| {
            (
                row.generated_element_id.clone(),
                row.template_element_id.clone(),
            )
        })
        .collect::<HashMap<_, _>>();
    let fill_warnings = state
        .computed_geometry_order
        .iter()
        .filter_map(|id| {
            let geometry = state.computed_geometry.get(id)?;
            let source_id = generated_source_by_id.get(id).unwrap_or(id);
            let resolution = source_effective_drawing_modifier_resolutions.get(source_id)?;
            let active_fill = resolution
                .get("fill")
                .and_then(|property| property.get("value"))
                .and_then(Value::as_object)
                .and_then(|fill| fill.get("kind"))
                .and_then(Value::as_str)
                .is_some_and(|kind| kind != "none");
            if !active_fill || !is_self_intersecting_closed_path(geometry) {
                return None;
            }
            Some(EvaluationWarning {
                element_id: id.clone(),
                element_name: geometry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                message: format!(
                    "{} の塗りつぶしは自己交差する閉じたパスでは表示されません。",
                    geometry
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                ),
            })
        })
        .collect::<Vec<_>>();
    state.warnings.extend(fill_warnings);

    let mut transformation_stage_geometry = state
        .transformation_stage_geometry
        .iter()
        .map(|(key, geometry)| json!({ "key": key, "geometry": geometry }))
        .collect::<Vec<_>>();
    transformation_stage_geometry.sort_by(|left, right| {
        left.get("key")
            .and_then(Value::as_str)
            .cmp(&right.get("key").and_then(Value::as_str))
    });

    EvaluationPayload {
        computed_geometry: state
            .computed_geometry_order
            .iter()
            .filter_map(|id| state.computed_geometry.get(id).cloned())
            .collect(),
        transformation_stage_geometry,
        computed_geometry_values: geometry_value_program
            .iter()
            .filter_map(|entry| {
                state
                    .computed_geometry_values
                    .get(&entry.occurrence)
                    .map(|value| {
                        serde_json::json!({
                            "occurrence": {
                                "sourceStatementId": entry.occurrence.source_statement_id,
                                "instancePath": entry.occurrence.instance_path,
                            },
                            "value": value,
                        })
                    })
            })
            .collect(),
        pre_mutation_geometry: state
            .computed_geometry_order
            .iter()
            .filter_map(|id| state.pre_mutation_geometry.get(id).cloned())
            .collect(),
        geometry_mutation_executions: state.geometry_mutation_executions,
        instance_base_geometry: instance_snapshots
            .iter()
            .filter_map(|snapshot| {
                state.instance_base_geometry.get(&snapshot.instance_id).map(|geometry| {
                    serde_json::json!({ "instanceId": snapshot.instance_id, "geometry": geometry })
                })
            })
            .collect(),
        errors: state.errors,
        geometry_value_errors: state.geometry_value_errors,
        warnings: state.warnings,
        evaluated_element_ids: evaluated_elements.iter().filter_map(element_id).collect(),
        evaluation_limit_index,
        effective_visible_element_ids: effective_visible_element_ids.into_iter().collect(),
        effective_enabled_element_ids: effective_enabled_order,
        effective_drawing_modifier_strokes,
        effective_drawing_modifier_resolutions,
        condition_inactive_element_ids: state
            .elements
            .iter()
            .filter_map(element_id)
            .filter(|id| condition_inactive_ids.contains(id))
            .collect(),
        condition_evaluation_traces: state.condition_evaluation_traces,
        for_group_generated_rows: state.for_group_generated_rows,
        for_group_effective_show_generated_ids,
        computed_scalar_bindings,
        computed_scalar_binding_versions,
    }
}
