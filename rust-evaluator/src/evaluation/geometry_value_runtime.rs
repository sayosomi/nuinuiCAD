use serde_json::{json, Value};

use super::geometry_value_kernels::{segment_geometry_kernel, StructuralPoint};
use super::point_anchor::point_from_geometry;
use super::scalar_expression_runtime::evaluate_document_typed_expression;
use super::scalars::{
    validate_typed_expression_payload, ScalarDocumentBindingResolver, ScalarEvaluation, ScalarType,
    ScalarValue, TypedScalarExpression,
};
use super::types::{EvaluationCommandError, EvaluationState, GeometryValueOccurrence};

pub(crate) struct EmptyBindingResolver;

impl ScalarDocumentBindingResolver for EmptyBindingResolver {
    fn resolve_binding(&self, binding_id: &str, _state: &EvaluationState) -> ScalarEvaluation {
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-binding-unavailable".to_owned(),
            binding_id: Some(binding_id.to_owned()),
            context: None,
        }
    }
}

#[derive(Debug)]
pub(crate) enum GeometryValuePoint {
    Coordinate {
        x: Box<TypedScalarExpression>,
        y: Box<TypedScalarExpression>,
    },
    Target(super::scalars::ScalarExpressionResolvedGeometryTarget),
}

#[derive(Debug)]
pub(crate) enum GeometryValueConstruction {
    Coordinate {
        x: Box<TypedScalarExpression>,
        y: Box<TypedScalarExpression>,
    },
    Segment {
        start: Box<GeometryValuePoint>,
        end: Box<GeometryValuePoint>,
    },
}

#[derive(Debug)]
pub(crate) struct GeometryValueProgramEntry {
    pub(crate) source_statement_id: String,
    pub(crate) source_statement_index: usize,
    pub(crate) declared_interface_type: String,
    pub(crate) occurrence: GeometryValueOccurrence,
    pub(crate) execution_position: f64,
    pub(crate) construction: GeometryValueConstruction,
}

pub(crate) fn decode_geometry_value_program(
    payload: Option<&Value>,
) -> Result<Vec<GeometryValueProgramEntry>, EvaluationCommandError> {
    let Some(payload) = payload else {
        return Ok(Vec::new());
    };
    let Some(entries) = payload.as_array() else {
        return Err(invalid_payload("geometryValueProgram must be an array"));
    };
    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            decode_entry(entry).map_err(|error| {
                invalid_payload(&format!("geometryValueProgram entry {index}: {error}"))
            })
        })
        .collect()
}

fn invalid_payload(message: &str) -> EvaluationCommandError {
    EvaluationCommandError {
        code: "geometry-value-program-invalid".to_owned(),
        message: message.to_owned(),
    }
}

fn object<'a>(
    value: &'a Value,
    context: &str,
) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{context} must be an object"))
}

fn string_field(
    object: &serde_json::Map<String, Value>,
    name: &str,
    context: &str,
) -> Result<String, String> {
    object
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{context}.{name} must be a non-empty string"))
}

fn occurrence(value: &Value, context: &str) -> Result<GeometryValueOccurrence, String> {
    let object = object(value, context)?;
    let instance_path = object
        .get("instancePath")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{context}.instancePath must be an array"))?
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| format!("{context}.instancePath must contain non-empty strings"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GeometryValueOccurrence {
        source_statement_id: string_field(object, "sourceStatementId", context)?,
        instance_path,
    })
}

fn decode_point(value: &Value) -> Result<GeometryValuePoint, String> {
    let object = object(value, "geometry value point")?;
    match string_field(object, "kind", "geometry value point")?.as_str() {
        "coordinate" => Ok(GeometryValuePoint::Coordinate {
            x: Box::new(
                validate_typed_expression_payload(
                    object
                        .get("x")
                        .ok_or_else(|| "geometry value coordinate is missing x".to_owned())?,
                )
                .map_err(|error| format!("{error:?}"))?,
            ),
            y: Box::new(
                validate_typed_expression_payload(
                    object
                        .get("y")
                        .ok_or_else(|| "geometry value coordinate is missing y".to_owned())?,
                )
                .map_err(|error| format!("{error:?}"))?,
            ),
        }),
        "target" => Ok(GeometryValuePoint::Target(
            super::scalars::decode_geometry_target_payload(
                object
                    .get("target")
                    .ok_or_else(|| "geometry value target is missing target".to_owned())?,
            )
            .map_err(|error| format!("{error:?}"))?
            .ok_or_else(|| "geometry value target cannot be null".to_owned())?,
        )),
        kind => Err(format!("unsupported geometry value point kind {kind}")),
    }
}

fn decode_entry(value: &Value) -> Result<GeometryValueProgramEntry, String> {
    let entry_object = object(value, "geometry value program entry")?;
    let source_statement_id = string_field(
        entry_object,
        "sourceStatementId",
        "geometry value program entry",
    )?;
    let source_statement_index = entry_object
        .get("sourceStatementIndex")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| {
            "geometry value program entry sourceStatementIndex must be a non-negative integer"
                .to_owned()
        })?;
    let declared_interface_type = string_field(
        entry_object,
        "declaredInterfaceType",
        "geometry value program entry",
    )?;
    if !matches!(declared_interface_type.as_str(), "point" | "line" | "path") {
        return Err("geometry value program entry declaredInterfaceType is unsupported".to_owned());
    }
    let execution_position = entry_object
        .get("executionPosition")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| {
            "geometry value program entry executionPosition must be finite".to_owned()
        })?;
    let occurrence = occurrence(
        entry_object
            .get("occurrence")
            .ok_or_else(|| "geometry value program entry is missing occurrence".to_owned())?,
        "geometry value program entry occurrence",
    )?;
    if occurrence.source_statement_id != source_statement_id {
        return Err(
            "geometry value program entry occurrence must use its sourceStatementId".to_owned(),
        );
    }
    let construction_object = object(
        entry_object
            .get("construction")
            .ok_or_else(|| "geometry value program entry is missing construction".to_owned())?,
        "geometry value construction",
    )?;
    let construction =
        match string_field(construction_object, "kind", "geometry value construction")?.as_str() {
            "coordinate" => GeometryValueConstruction::Coordinate {
                x: Box::new(
                    validate_typed_expression_payload(
                        construction_object
                            .get("x")
                            .ok_or_else(|| "geometry value coordinate is missing x".to_owned())?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
                y: Box::new(
                    validate_typed_expression_payload(
                        construction_object
                            .get("y")
                            .ok_or_else(|| "geometry value coordinate is missing y".to_owned())?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
            },
            "segment" => GeometryValueConstruction::Segment {
                start: Box::new(decode_point(
                    construction_object
                        .get("start")
                        .ok_or_else(|| "geometry value segment is missing start".to_owned())?,
                )?),
                end: Box::new(decode_point(
                    construction_object
                        .get("end")
                        .ok_or_else(|| "geometry value segment is missing end".to_owned())?,
                )?),
            },
            kind => {
                return Err(format!(
                    "unsupported geometry value construction kind {kind}"
                ))
            }
        };
    Ok(GeometryValueProgramEntry {
        source_statement_id,
        source_statement_index,
        declared_interface_type,
        occurrence,
        execution_position,
        construction,
    })
}

fn point_json(x: f64, y: f64) -> Value {
    json!({ "kind": "point", "x": x, "y": y })
}

fn segment_json(start: (f64, f64), end: (f64, f64)) -> Value {
    let structural = segment_geometry_kernel(
        StructuralPoint {
            x: start.0,
            y: start.1,
        },
        StructuralPoint { x: end.0, y: end.1 },
    );
    json!({
        "kind": "line",
        "start": {"x": structural.start.x, "y": structural.start.y},
        "end": {"x": structural.end.x, "y": structural.end.y},
        "length": structural.length,
        "startAngleDeg": structural.start_angle_deg,
        "endAngleDeg": structural.end_angle_deg,
        "startTangentAngleDeg": structural.start_tangent_angle_deg,
        "endTangentAngleDeg": structural.end_tangent_angle_deg
    })
}

fn number_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<f64> {
    match evaluate_document_typed_expression(expression, resolver, state, Some(source_order)) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(value),
        } => Some(value),
        _ => None,
    }
}

fn target_point(
    target: &super::scalars::ScalarExpressionResolvedGeometryTarget,
    state: &EvaluationState,
) -> Option<(f64, f64)> {
    if let Some(occurrence) = &target.geometry_value_occurrence {
        let geometry = state.computed_geometry_values.get(occurrence)?;
        if let Some(point_key) = target.point_key.as_deref() {
            return match point_key {
                "start" | "end" => geometry.get(point_key).and_then(|value| {
                    value
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(value.get("y").and_then(Value::as_f64))
                }),
                _ => None,
            };
        }
        return geometry
            .get("x")
            .and_then(Value::as_f64)
            .zip(geometry.get("y").and_then(Value::as_f64));
    }
    let geometry = state.computed_geometry.get(&target.statement_id)?;
    if let Some(point_key) = target.point_key.as_deref() {
        return super::point_anchor::resolve_derived_point(geometry, point_key, state)
            .map(|point| (point.x, point.y));
    }
    point_from_geometry(geometry).map(|point| (point.x, point.y))
}

fn evaluate_point(
    point: &GeometryValuePoint,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<(f64, f64)> {
    match point {
        GeometryValuePoint::Coordinate { x, y } => Some((
            number_expression(x, resolver, state, source_order)?,
            number_expression(y, resolver, state, source_order)?,
        )),
        GeometryValuePoint::Target(target) => target_point(target, state),
    }
}

pub(crate) fn evaluate_geometry_value_entry(
    entry: &GeometryValueProgramEntry,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &mut EvaluationState,
) {
    if entry.source_statement_id != entry.occurrence.source_statement_id {
        return;
    }
    let source_order = entry.execution_position;
    let value = match &entry.construction {
        GeometryValueConstruction::Coordinate { x, y } => {
            if entry.declared_interface_type != "point" {
                return;
            }
            let x = number_expression(x, resolver, state, source_order);
            let y = number_expression(y, resolver, state, source_order);
            x.zip(y).map(|(x, y)| point_json(x, y))
        }
        GeometryValueConstruction::Segment { start, end } => {
            if entry.declared_interface_type != "line" && entry.declared_interface_type != "path" {
                return;
            }
            evaluate_point(start, resolver, state, source_order)
                .zip(evaluate_point(end, resolver, state, source_order))
                .map(|(start, end)| segment_json(start, end))
        }
    };
    if let Some(value) = value {
        state
            .computed_geometry_values
            .insert(entry.occurrence.clone(), value);
    }
}
