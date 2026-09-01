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
mod groups;
mod image_evaluator;
#[cfg(test)]
mod image_evaluator_tests;
#[cfg(test)]
mod incomplete_numeric_expression_tests;
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
mod text_template_runtime;
#[cfg(test)]
mod text_template_runtime_tests;
#[cfg(test)]
mod three_point_arc_line_tests;
mod types;

use std::collections::{HashMap, HashSet};

use serde_json::Value;

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
use for_group::{for_group_template_descendant_ids, iteration_local_variables};
use for_group_generic_runtime::GenericForGroupRuntime;
use for_group_mutation_runtime::ForGroupMutationRuntime;
use groups::{effective_element_ids, group_state_by_element_id};
use image_evaluator::evaluate_image;
use intersection_point_evaluator::evaluate_intersection_point;
use line_copy_move_evaluator::{
    evaluate_copy_line, evaluate_move, evaluate_symmetric_copy_line, evaluate_symmetric_move,
};
use line_division_point_evaluator::evaluate_line_division_point;
use line_evaluators::{
    evaluate_angle_length_line, evaluate_arc_line, evaluate_line, evaluate_polyline,
    evaluate_three_point_arc_line,
};
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
use property_binding_runtime::apply_property_bindings;
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
    element_id, element_name, element_type, EffectiveDrawingModifierStroke, ElementId,
    EvaluationState, GeometryMutationExecution,
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
            conditional_group_states.insert(id, active_branch);
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
    } = decoded;
    let evaluation_limit_index = input
        .evaluation_limit_index
        .unwrap_or(input.elements.len())
        .min(input.elements.len());
    let drawing_modifiers = input
        .drawing_modifiers
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let evaluated_elements = input.elements[..evaluation_limit_index].to_vec();
    let instance_snapshots = input
        .module_materialization
        .as_ref()
        .map(|materialization| materialization.instances.clone())
        .unwrap_or_default();
    let evaluated_ids: HashSet<ElementId> =
        evaluated_elements.iter().filter_map(element_id).collect();
    let source_effective_drawing_modifier_runtime =
        effective_drawing_modifier_runtime_by_element_id_with_profile(
            &input.elements,
            Some(&drawing_modifiers),
            input.selected_drawing_profile_id.as_deref(),
        );
    let activities = effective_activity_by_runtime(&source_effective_drawing_modifier_runtime);
    let group_states = group_state_by_element_id(&input.elements, &activities);
    let mut effective_visible_element_ids =
        effective_element_ids(&input.elements, &activities, true)
            .into_iter()
            .filter(|id| evaluated_ids.contains(id))
            .collect::<Vec<_>>();
    let mut base_effective_enabled_ids = effective_element_ids(&input.elements, &activities, false)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<HashSet<_>>();
    base_effective_enabled_ids.extend(
        input
            .allow_disabled_element_ids
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|id| evaluated_ids.contains(*id))
            .cloned(),
    );

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
        computed_geometry_order: Vec::new(),
        pre_mutation_geometry: HashMap::new(),
        geometry_mutation_executions: Vec::new(),
        condition_evaluation_traces: Vec::new(),
        instance_base_geometry: HashMap::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    };
    let mut conditional_group_states = HashMap::<ElementId, Option<&'static str>>::new();
    let mut condition_inactive_ids = HashSet::<ElementId>::new();
    let mut effective_enabled_ids = HashSet::<ElementId>::new();
    let mut effective_enabled_order = Vec::<ElementId>::new();
    let template_descendant_ids = for_group_template_descendant_ids(&state.elements);
    let original_elements = state.elements.clone();
    let source_effective_drawing_modifier_strokes =
        effective_drawing_modifier_stroke_by_runtime(&source_effective_drawing_modifier_runtime);
    let source_effective_drawing_modifier_resolutions =
        effective_drawing_modifier_resolution_by_runtime(
            &source_effective_drawing_modifier_runtime,
        );
    let mut for_group_generated_rows = Vec::new();
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
                .advance_before(source_order, &state);
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
            continue;
        }

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

            // Evaluated once per forGroup entry, alongside start/count/step -
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
                    &mut for_group_generated_rows,
                    &mut for_group_effective_show_generated_ids,
                );
                let outcome = runtime
                    .run(
                        resolver,
                        &mut environment,
                        &element,
                        &element,
                        start,
                        count as usize,
                        step,
                        effective_show_generated,
                        &[],
                        &HashMap::new(),
                        &mut state,
                    )
                    .expect("validated forGroup scheduler must not mutate an iteration binding");
                resolver.commit_for_group_environment(&environment);
                if outcome == ForGroupMutationRunOutcome::Stopped {
                    break 'elements;
                }
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
                &mut for_group_generated_rows,
                &mut for_group_effective_show_generated_ids,
            );
            generic_runtime.run(
                &element,
                &element,
                start,
                count as usize,
                step,
                effective_show_generated,
                &[],
                &HashMap::new(),
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
            _ => evaluate_element_by_type(
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
            ),
        }
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
    for row in &for_group_generated_rows {
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

    EvaluationPayload {
        computed_geometry: state
            .computed_geometry_order
            .iter()
            .filter_map(|id| state.computed_geometry.get(id).cloned())
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
        for_group_generated_rows,
        for_group_effective_show_generated_ids,
        computed_scalar_bindings,
        computed_scalar_binding_versions,
    }
}
