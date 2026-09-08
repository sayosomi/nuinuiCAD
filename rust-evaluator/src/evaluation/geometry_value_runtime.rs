use serde_json::{json, Value};

use super::bezier_math::approximate_cubic_length;
use super::geometry_value_kernels::{
    coordinate_geometry_kernel, direct_arc_geometry_kernel, offset_point_geometry_kernel,
    polyline_geometry_kernel, segment_geometry_kernel, through_arc_geometry_kernel,
    StructuralPoint,
};
use super::offset_paths::{build_offset_line_geometry, is_line_like_geometry};
use super::point_anchor::point_from_geometry;
use super::scalar_expression_runtime::evaluate_document_typed_expression;
use super::scalars::{
    validate_typed_expression_payload, ScalarDocumentBindingResolver, ScalarEvaluation, ScalarType,
    ScalarValue, TypedScalarExpression,
};
use super::types::{
    EvaluationCommandError, EvaluationState, GeometryValueEvaluationError, GeometryValueOccurrence,
};

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
pub(crate) struct GeometryValueBezierIntermediate {
    pub(crate) point: Box<GeometryValuePoint>,
    pub(crate) angle_deg: Box<TypedScalarExpression>,
    pub(crate) incoming_length: Box<TypedScalarExpression>,
    pub(crate) outgoing_length: Box<TypedScalarExpression>,
}

#[derive(Debug)]
pub(crate) enum GeometryValueConstruction {
    Coordinate {
        x: Box<TypedScalarExpression>,
        y: Box<TypedScalarExpression>,
    },
    OffsetPoint {
        from: Box<GeometryValuePoint>,
        dx: Box<TypedScalarExpression>,
        dy: Box<TypedScalarExpression>,
    },
    Segment {
        start: Box<GeometryValuePoint>,
        end: Box<GeometryValuePoint>,
    },
    Arc {
        center: Box<GeometryValuePoint>,
        radius: Box<TypedScalarExpression>,
        start_angle_deg: Box<TypedScalarExpression>,
        end_angle_deg: Box<TypedScalarExpression>,
        direction: Box<TypedScalarExpression>,
    },
    Through {
        point1: Box<GeometryValuePoint>,
        point2: Box<GeometryValuePoint>,
        point3: Box<GeometryValuePoint>,
        start_angle_deg: Box<TypedScalarExpression>,
        end_angle_deg: Box<TypedScalarExpression>,
    },
    Bezier {
        start: Box<GeometryValuePoint>,
        end: Box<GeometryValuePoint>,
        start_angle_deg: Box<TypedScalarExpression>,
        start_length: Box<TypedScalarExpression>,
        end_angle_deg: Box<TypedScalarExpression>,
        end_length: Box<TypedScalarExpression>,
        intermediates: Vec<GeometryValueBezierIntermediate>,
    },
    Polyline {
        points: Vec<GeometryValuePoint>,
        closed: Box<TypedScalarExpression>,
    },
    OffsetPath {
        sources: Vec<super::scalars::ScalarExpressionResolvedGeometryTarget>,
        distance: Box<TypedScalarExpression>,
        side: Box<TypedScalarExpression>,
        closed: Box<TypedScalarExpression>,
        suppress_trim_warnings: Box<TypedScalarExpression>,
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

fn decode_typed_field(
    object: &serde_json::Map<String, Value>,
    name: &str,
    context: &str,
) -> Result<TypedScalarExpression, String> {
    validate_typed_expression_payload(
        object
            .get(name)
            .ok_or_else(|| format!("{context} is missing {name}"))?,
    )
    .map_err(|error| format!("{error:?}"))
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
            "offsetPoint" => GeometryValueConstruction::OffsetPoint {
                from: Box::new(decode_point(construction_object.get("from").ok_or_else(
                    || "geometry value offsetPoint is missing from".to_owned(),
                )?)?),
                dx: Box::new(decode_typed_field(
                    construction_object,
                    "dx",
                    "geometry value offsetPoint",
                )?),
                dy: Box::new(decode_typed_field(
                    construction_object,
                    "dy",
                    "geometry value offsetPoint",
                )?),
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
            "arc" => GeometryValueConstruction::Arc {
                center: Box::new(decode_point(
                    construction_object
                        .get("center")
                        .ok_or_else(|| "geometry value arc is missing center".to_owned())?,
                )?),
                radius: Box::new(
                    validate_typed_expression_payload(
                        construction_object
                            .get("radius")
                            .ok_or_else(|| "geometry value arc is missing radius".to_owned())?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
                start_angle_deg: Box::new(
                    validate_typed_expression_payload(
                        construction_object.get("startAngleDeg").ok_or_else(|| {
                            "geometry value arc is missing startAngleDeg".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
                end_angle_deg: Box::new(
                    validate_typed_expression_payload(
                        construction_object.get("endAngleDeg").ok_or_else(|| {
                            "geometry value arc is missing endAngleDeg".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
                direction: Box::new(
                    validate_typed_expression_payload(
                        construction_object
                            .get("direction")
                            .ok_or_else(|| "geometry value arc is missing direction".to_owned())?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
            },
            "through" => GeometryValueConstruction::Through {
                point1: Box::new(decode_point(
                    construction_object
                        .get("point1")
                        .ok_or_else(|| "geometry value through is missing point1".to_owned())?,
                )?),
                point2: Box::new(decode_point(
                    construction_object
                        .get("point2")
                        .ok_or_else(|| "geometry value through is missing point2".to_owned())?,
                )?),
                point3: Box::new(decode_point(
                    construction_object
                        .get("point3")
                        .ok_or_else(|| "geometry value through is missing point3".to_owned())?,
                )?),
                start_angle_deg: Box::new(
                    validate_typed_expression_payload(
                        construction_object.get("startAngleDeg").ok_or_else(|| {
                            "geometry value through is missing startAngleDeg".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
                end_angle_deg: Box::new(
                    validate_typed_expression_payload(
                        construction_object.get("endAngleDeg").ok_or_else(|| {
                            "geometry value through is missing endAngleDeg".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?,
                ),
            },
            "bezier" => {
                let intermediates = construction_object
                    .get("intermediates")
                    .and_then(Value::as_array)
                    .ok_or_else(|| "geometry value bezier is missing intermediates".to_owned())?
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        let intermediate = object(value, "geometry value bezier intermediate")?;
                        Ok(GeometryValueBezierIntermediate {
                            point: Box::new(decode_point(intermediate.get("point").ok_or_else(
                                || {
                                    format!(
                                    "geometry value bezier intermediate {index} is missing point"
                                )
                                },
                            )?)?),
                            angle_deg: Box::new(decode_typed_field(
                                intermediate,
                                "angleDeg",
                                "geometry value bezier intermediate",
                            )?),
                            incoming_length: Box::new(decode_typed_field(
                                intermediate,
                                "incomingLength",
                                "geometry value bezier intermediate",
                            )?),
                            outgoing_length: Box::new(decode_typed_field(
                                intermediate,
                                "outgoingLength",
                                "geometry value bezier intermediate",
                            )?),
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                GeometryValueConstruction::Bezier {
                    start: Box::new(decode_point(
                        construction_object
                            .get("start")
                            .ok_or_else(|| "geometry value bezier is missing start".to_owned())?,
                    )?),
                    end: Box::new(decode_point(
                        construction_object
                            .get("end")
                            .ok_or_else(|| "geometry value bezier is missing end".to_owned())?,
                    )?),
                    start_angle_deg: Box::new(decode_typed_field(
                        construction_object,
                        "startAngleDeg",
                        "geometry value bezier",
                    )?),
                    start_length: Box::new(decode_typed_field(
                        construction_object,
                        "startLength",
                        "geometry value bezier",
                    )?),
                    end_angle_deg: Box::new(decode_typed_field(
                        construction_object,
                        "endAngleDeg",
                        "geometry value bezier",
                    )?),
                    end_length: Box::new(decode_typed_field(
                        construction_object,
                        "endLength",
                        "geometry value bezier",
                    )?),
                    intermediates,
                }
            }
            "polyline" => GeometryValueConstruction::Polyline {
                points: construction_object
                    .get("points")
                    .and_then(Value::as_array)
                    .ok_or_else(|| "geometry value polyline is missing points".to_owned())?
                    .iter()
                    .map(decode_point)
                    .collect::<Result<Vec<_>, _>>()?,
                closed: Box::new(decode_typed_field(
                    construction_object,
                    "closed",
                    "geometry value polyline",
                )?),
            },
            "offsetPath" => GeometryValueConstruction::OffsetPath {
                sources: construction_object
                    .get("sources")
                    .and_then(Value::as_array)
                    .ok_or_else(|| "geometry value offsetPath is missing sources".to_owned())?
                    .iter()
                    .enumerate()
                    .map(|(index, source)| {
                        let target_payload = source
                            .as_object()
                            .and_then(|object| object.get("target"))
                            .unwrap_or(source);
                        super::scalars::decode_geometry_target_payload(target_payload)
                            .map_err(|error| {
                                format!("geometry value offsetPath source {index}: {error:?}")
                            })?
                            .ok_or_else(|| {
                                format!("geometry value offsetPath source {index} cannot be null")
                            })
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                distance: Box::new(decode_typed_field(
                    construction_object,
                    "distance",
                    "geometry value offsetPath",
                )?),
                side: Box::new(decode_typed_field(
                    construction_object,
                    "side",
                    "geometry value offsetPath",
                )?),
                closed: Box::new(decode_typed_field(
                    construction_object,
                    "closed",
                    "geometry value offsetPath",
                )?),
                suppress_trim_warnings: Box::new(decode_typed_field(
                    construction_object,
                    "suppressTrimWarnings",
                    "geometry value offsetPath",
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

fn boolean_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<bool> {
    match evaluate_document_typed_expression(expression, resolver, state, Some(source_order)) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: ScalarValue::Boolean(value),
        } => Some(value),
        _ => None,
    }
}

fn choice_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<String> {
    match evaluate_document_typed_expression(expression, resolver, state, Some(source_order)) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Choice { .. },
            value: ScalarValue::Choice { value, .. },
        } if value == "counterclockwise" || value == "clockwise" => Some(value),
        _ => None,
    }
}

fn side_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<String> {
    match evaluate_document_typed_expression(expression, resolver, state, Some(source_order)) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Choice { .. },
            value: ScalarValue::Choice { value, .. },
        } if value == "left" || value == "right" => Some(value),
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
                "start" | "end" => {
                    let value =
                        if geometry.get("kind").and_then(Value::as_str) == Some("bezierCurve") {
                            let segments = geometry.get("segments")?.as_array()?;
                            if point_key == "start" {
                                segments.first()?.get("start")?
                            } else {
                                segments.last()?.get("end")?
                            }
                        } else {
                            geometry.get(point_key)?
                        };
                    Some(value)
                }
                .and_then(|value| {
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

fn target_geometry<'a>(
    target: &super::scalars::ScalarExpressionResolvedGeometryTarget,
    state: &'a EvaluationState,
) -> Option<&'a Value> {
    if let Some(occurrence) = &target.geometry_value_occurrence {
        state.computed_geometry_values.get(occurrence)
    } else {
        state.computed_geometry.get(&target.statement_id)
    }
}

fn remove_geometry_identity(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(remove_geometry_identity),
        Value::Object(object) => {
            if object.get("kind").and_then(Value::as_str) == Some("point")
                && object.contains_key("x")
                && object.contains_key("y")
            {
                object.remove("kind");
            }
            object.remove("elementId");
            object.remove("name");
            object.remove("baseLineIds");
            object.values_mut().for_each(remove_geometry_identity);
        }
        _ => {}
    }
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

fn bezier_handle_point(point: (f64, f64), angle_deg: f64, length: f64) -> (f64, f64) {
    let angle_rad = angle_deg.to_radians();
    (
        point.0 + angle_rad.cos() * length,
        point.1 + angle_rad.sin() * length,
    )
}

fn bezier_json(
    start: (f64, f64),
    end: (f64, f64),
    start_angle_deg: f64,
    start_length: f64,
    end_angle_deg: f64,
    end_length: f64,
    intermediates: &[(f64, f64, f64, f64, f64)],
) -> Option<Value> {
    let anchors = std::iter::once(start)
        .chain(
            intermediates
                .iter()
                .map(|intermediate| (intermediate.0, intermediate.1)),
        )
        .chain(std::iter::once(end))
        .collect::<Vec<_>>();
    let outgoing_handles =
        std::iter::once(bezier_handle_point(start, start_angle_deg, start_length))
            .chain(intermediates.iter().map(|intermediate| {
                bezier_handle_point(
                    (intermediate.0, intermediate.1),
                    intermediate.2,
                    intermediate.4,
                )
            }))
            .collect::<Vec<_>>();
    let incoming_handles = intermediates
        .iter()
        .map(|intermediate| {
            bezier_handle_point(
                (intermediate.0, intermediate.1),
                intermediate.2 + 180.0,
                intermediate.3,
            )
        })
        .chain(std::iter::once(bezier_handle_point(
            end,
            end_angle_deg + 180.0,
            end_length,
        )))
        .collect::<Vec<_>>();
    if anchors
        .iter()
        .chain(outgoing_handles.iter())
        .chain(incoming_handles.iter())
        .any(|point| !point.0.is_finite() || !point.1.is_finite())
    {
        return None;
    }
    let segments = anchors
        .windows(2)
        .enumerate()
        .map(|(index, pair)| {
            json!({
                "start": { "x": pair[0].0, "y": pair[0].1 },
                "control1": { "x": outgoing_handles[index].0, "y": outgoing_handles[index].1 },
                "control2": { "x": incoming_handles[index].0, "y": incoming_handles[index].1 },
                "end": { "x": pair[1].0, "y": pair[1].1 }
            })
        })
        .collect::<Vec<_>>();
    let length = segments
        .iter()
        .map(|segment| approximate_cubic_length(segment, 32))
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .sum::<f64>();
    length.is_finite().then(|| {
        json!({
            "kind": "bezierCurve",
            "segments": segments,
            "length": length
        })
    })
}

fn polyline_json(points: &[StructuralPoint], closed: bool) -> Option<Value> {
    let structural = polyline_geometry_kernel(points, closed)?;
    let segments = structural
        .segments
        .iter()
        .map(|segment| {
            json!({
                "start": { "x": segment.start.x, "y": segment.start.y },
                "end": { "x": segment.end.x, "y": segment.end.y },
                "length": segment.length
            })
        })
        .collect::<Vec<_>>();
    Some(json!({
        "kind": "polyline",
        "segments": segments,
        "closed": structural.closed,
        "start": { "x": structural.start.x, "y": structural.start.y },
        "end": { "x": structural.end.x, "y": structural.end.y },
        "length": structural.length,
        "startTangentAngleDeg": structural.start_tangent_angle_deg,
        "endTangentAngleDeg": structural.end_tangent_angle_deg
    }))
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
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let x = number_expression(x, resolver, state, source_order);
            let y = number_expression(y, resolver, state, source_order);
            x.zip(y).map(|(x, y)| {
                let structural = coordinate_geometry_kernel(x, y);
                json!({ "kind": "point", "x": structural.x, "y": structural.y })
            })
        }
        GeometryValueConstruction::OffsetPoint { from, dx, dy } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            evaluate_point(from, resolver, state, source_order)
                .zip(number_expression(dx, resolver, state, source_order))
                .zip(number_expression(dy, resolver, state, source_order))
                .map(|((from, dx), dy)| {
                    let structural = offset_point_geometry_kernel(
                        StructuralPoint {
                            x: from.0,
                            y: from.1,
                        },
                        dx,
                        dy,
                    );
                    json!({ "kind": "point", "x": structural.x, "y": structural.y })
                })
        }
        GeometryValueConstruction::Segment { start, end } => {
            if entry.declared_interface_type != "line" && entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            evaluate_point(start, resolver, state, source_order)
                .zip(evaluate_point(end, resolver, state, source_order))
                .map(|(start, end)| segment_json(start, end))
        }
        GeometryValueConstruction::Arc {
            center,
            radius,
            start_angle_deg,
            end_angle_deg,
            direction,
        } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let center = evaluate_point(center, resolver, state, source_order);
            let radius = number_expression(radius, resolver, state, source_order);
            let start_angle_deg = number_expression(start_angle_deg, resolver, state, source_order);
            let end_angle_deg = number_expression(end_angle_deg, resolver, state, source_order);
            let direction = choice_expression(direction, resolver, state, source_order);
            match (center, radius, start_angle_deg, end_angle_deg, direction) {
                (
                    Some(center),
                    Some(radius),
                    Some(start_angle_deg),
                    Some(end_angle_deg),
                    Some(direction),
                ) => {
                    if radius.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
                        append_geometry_value_error(
                            state,
                            entry,
                            "円弧の半径は0より大きい値で指定してください。",
                        );
                        return;
                    }
                    let structural = direct_arc_geometry_kernel(
                        StructuralPoint {
                            x: center.0,
                            y: center.1,
                        },
                        radius,
                        start_angle_deg,
                        end_angle_deg,
                        &direction,
                    );
                    Some(json!({
                        "kind": "arcLine",
                        "center": { "x": structural.center.x, "y": structural.center.y },
                        "start": { "x": structural.start.x, "y": structural.start.y },
                        "end": { "x": structural.end.x, "y": structural.end.y },
                        "radius": structural.radius,
                        "startAngleDeg": structural.start_angle_deg,
                        "endAngleDeg": structural.end_angle_deg,
                        "startTangentAngleDeg": structural.start_tangent_angle_deg,
                        "endTangentAngleDeg": structural.end_tangent_angle_deg,
                        "sweepAngleDeg": structural.sweep_angle_deg,
                        "length": structural.length
                    }))
                }
                _ => None,
            }
        }
        GeometryValueConstruction::Through {
            point1,
            point2,
            point3,
            start_angle_deg,
            end_angle_deg,
        } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let point1 = evaluate_point(point1, resolver, state, source_order);
            let point2 = evaluate_point(point2, resolver, state, source_order);
            let point3 = evaluate_point(point3, resolver, state, source_order);
            let start_angle_deg = number_expression(start_angle_deg, resolver, state, source_order);
            let end_angle_deg = number_expression(end_angle_deg, resolver, state, source_order);
            match (point1, point2, point3, start_angle_deg, end_angle_deg) {
                (
                    Some(point1),
                    Some(point2),
                    Some(point3),
                    Some(start_angle_deg),
                    Some(end_angle_deg),
                ) => {
                    let structural = through_arc_geometry_kernel(
                        StructuralPoint {
                            x: point1.0,
                            y: point1.1,
                        },
                        StructuralPoint {
                            x: point2.0,
                            y: point2.1,
                        },
                        StructuralPoint {
                            x: point3.0,
                            y: point3.1,
                        },
                        start_angle_deg,
                        end_angle_deg,
                    );
                    let Some(structural) = structural else {
                        append_geometry_value_error(
                            state,
                            entry,
                            "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。",
                        );
                        return;
                    };
                    Some(json!({
                        "kind": "arcLine",
                        "center": { "x": structural.center.x, "y": structural.center.y },
                        "start": { "x": structural.start.x, "y": structural.start.y },
                        "end": { "x": structural.end.x, "y": structural.end.y },
                        "radius": structural.radius,
                        "startAngleDeg": structural.start_angle_deg,
                        "endAngleDeg": structural.end_angle_deg,
                        "startTangentAngleDeg": structural.start_tangent_angle_deg,
                        "endTangentAngleDeg": structural.end_tangent_angle_deg,
                        "sweepAngleDeg": structural.sweep_angle_deg,
                        "length": structural.length
                    }))
                }
                _ => None,
            }
        }
        GeometryValueConstruction::Bezier {
            start,
            end,
            start_angle_deg,
            start_length,
            end_angle_deg,
            end_length,
            intermediates,
        } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let start = evaluate_point(start, resolver, state, source_order);
            let end = evaluate_point(end, resolver, state, source_order);
            let start_angle_deg = number_expression(start_angle_deg, resolver, state, source_order);
            let start_length = number_expression(start_length, resolver, state, source_order);
            let end_angle_deg = number_expression(end_angle_deg, resolver, state, source_order);
            let end_length = number_expression(end_length, resolver, state, source_order);
            let intermediates = intermediates
                .iter()
                .map(|intermediate| {
                    evaluate_point(&intermediate.point, resolver, state, source_order)
                        .zip(number_expression(
                            &intermediate.angle_deg,
                            resolver,
                            state,
                            source_order,
                        ))
                        .zip(number_expression(
                            &intermediate.incoming_length,
                            resolver,
                            state,
                            source_order,
                        ))
                        .zip(number_expression(
                            &intermediate.outgoing_length,
                            resolver,
                            state,
                            source_order,
                        ))
                        .map(|(((point, angle_deg), incoming_length), outgoing_length)| {
                            (
                                point.0,
                                point.1,
                                angle_deg,
                                incoming_length,
                                outgoing_length,
                            )
                        })
                })
                .collect::<Option<Vec<_>>>();
            let Some((
                start,
                end,
                start_angle_deg,
                start_length,
                end_angle_deg,
                end_length,
                intermediates,
            )) = start
                .zip(end)
                .zip(start_angle_deg)
                .zip(start_length)
                .zip(end_angle_deg)
                .zip(end_length)
                .zip(intermediates)
                .map(
                    |(
                        (
                            ((((start, end), start_angle_deg), start_length), end_angle_deg),
                            end_length,
                        ),
                        intermediates,
                    )| {
                        (
                            start,
                            end,
                            start_angle_deg,
                            start_length,
                            end_angle_deg,
                            end_length,
                            intermediates,
                        )
                    },
                )
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            let Some(value) = bezier_json(
                start,
                end,
                start_angle_deg,
                start_length,
                end_angle_deg,
                end_length,
                &intermediates,
            ) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            Some(value)
        }
        GeometryValueConstruction::Polyline { points, closed } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let closed = boolean_expression(closed, resolver, state, source_order);
            let points = points
                .iter()
                .map(|point| evaluate_point(point, resolver, state, source_order))
                .collect::<Option<Vec<_>>>();
            let Some((closed, points)) = closed.zip(points) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Polyline geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            let structural_points = points
                .iter()
                .map(|point| StructuralPoint {
                    x: point.0,
                    y: point.1,
                })
                .collect::<Vec<_>>();
            let Some(value) = polyline_json(&structural_points, closed) else {
                append_geometry_value_error(
                    state,
                    entry,
                    &format!(
                        "Polyline geometry value construction requires at least {} finite points.",
                        if closed { 3 } else { 2 }
                    ),
                );
                return;
            };
            Some(value)
        }
        GeometryValueConstruction::OffsetPath {
            sources,
            distance,
            side,
            closed,
            suppress_trim_warnings,
        } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let distance = number_expression(distance, resolver, state, source_order);
            let side = side_expression(side, resolver, state, source_order);
            let closed = boolean_expression(closed, resolver, state, source_order);
            let suppress_trim_warnings =
                boolean_expression(suppress_trim_warnings, resolver, state, source_order);
            let base_geometries = sources
                .iter()
                .map(|source| target_geometry(source, state).cloned())
                .collect::<Option<Vec<_>>>();
            let Some((distance, side, closed, suppress_trim_warnings, base_geometries)) = distance
                .zip(side)
                .zip(closed)
                .zip(suppress_trim_warnings)
                .zip(base_geometries)
                .map(
                    |((((distance, side), closed), suppress_trim_warnings), base_geometries)| {
                        (
                            distance,
                            side,
                            closed,
                            suppress_trim_warnings,
                            base_geometries,
                        )
                    },
                )
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Offset geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            if base_geometries
                .iter()
                .any(|geometry| !is_line_like_geometry(Some(geometry)))
            {
                append_geometry_value_error(
                    state,
                    entry,
                    "Offset geometry value construction inputs are unavailable or invalid.",
                );
                return;
            }
            let result = build_offset_line_geometry(
                "",
                "geometry value",
                Vec::new(),
                &base_geometries,
                if side == "right" { distance } else { -distance },
                closed,
                suppress_trim_warnings,
            );
            if let Some(error) = result.error {
                append_geometry_value_error(state, entry, &error);
                return;
            }
            result.geometry.map(|mut value| {
                remove_geometry_identity(&mut value);
                value
            })
        }
    };
    if let Some(value) = value {
        state
            .computed_geometry_values
            .insert(entry.occurrence.clone(), value);
    }
}

fn append_geometry_value_error(
    state: &mut EvaluationState,
    entry: &GeometryValueProgramEntry,
    message: &str,
) {
    state
        .geometry_value_errors
        .push(GeometryValueEvaluationError {
            occurrence: entry.occurrence.clone(),
            message: message.to_owned(),
        });
}
