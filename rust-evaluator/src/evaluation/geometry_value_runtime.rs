use serde_json::{json, Value};

use super::bezier_feature_point_evaluator::{bezier_bulge_point_at, bezier_extreme_point_at};
use super::bezier_math::{approximate_cubic_length, Point};
use super::division_placement::DivisionPlacementKind;
use super::geometry_value_kernels::{
    common_tangent_geometry_kernel, coordinate_geometry_kernel, direct_arc_geometry_kernel,
    division_point_geometry_kernel, offset_point_geometry_kernel, polar_line_geometry_kernel,
    polar_point_geometry_kernel, polyline_geometry_kernel, segment_geometry_kernel,
    through_arc_geometry_kernel, StructuralPoint,
};
use super::line_copy_geometry::copied_offset_line_geometry_value;
use super::line_intersections::find_line_intersections;
use super::line_path::{geometry_length, point_at_distance_from_endpoint};
use super::line_tangent_offset_point_evaluator::tangent_offset_point_geometry_kernel;
use super::line_transform::LineTransform;
use super::offset_paths::{build_offset_line_geometry, is_line_like_geometry};
use super::offset_source_segments::{
    connect_source_segment_groups, source_end, source_segments_for_geometry, source_start,
};
use super::offset_types::{
    line_length, offset_line_endpoint_measurements_from_values, SourceSegment, EPSILON,
};
use super::point_anchor::point_from_geometry;
use super::scalar_expression_runtime::evaluate_document_typed_expression;
use super::scalars::{
    degrees_to_radians, normalize_degrees_360, validate_typed_expression_payload,
    ScalarDocumentBindingResolver, ScalarEvaluation, ScalarType, ScalarValue,
    TypedScalarExpression,
};
use super::types::{
    EvaluationCommandError, EvaluationState, GeometryInputTarget, GeometryValueEvaluationError,
    GeometryValueOccurrence,
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
pub(crate) enum GeometryValuePlacement {
    Distance(Box<TypedScalarExpression>),
    Ratio(Box<TypedScalarExpression>),
}

#[derive(Debug)]
pub(crate) struct GeometryValueBezierIntermediate {
    pub(crate) point: Box<GeometryValuePoint>,
    pub(crate) angle_deg: Box<TypedScalarExpression>,
    pub(crate) incoming_length: Box<TypedScalarExpression>,
    pub(crate) outgoing_length: Box<TypedScalarExpression>,
}

#[derive(Debug)]
pub(crate) struct GeometryValueMatchArm {
    pub(crate) label: String,
    pub(crate) expression: Box<GeometryValueConstruction>,
}

#[derive(Debug)]
pub(crate) enum GeometryValueConstruction {
    Reference {
        target: super::scalars::ScalarExpressionResolvedGeometryTarget,
    },
    If {
        condition: Box<TypedScalarExpression>,
        then_branch: Box<GeometryValueConstruction>,
        else_branch: Box<GeometryValueConstruction>,
    },
    Match {
        scrutinee: Box<TypedScalarExpression>,
        arms: Vec<GeometryValueMatchArm>,
    },
    Coordinate {
        x: Box<TypedScalarExpression>,
        y: Box<TypedScalarExpression>,
    },
    OffsetPoint {
        from: Box<GeometryValuePoint>,
        dx: Box<TypedScalarExpression>,
        dy: Box<TypedScalarExpression>,
    },
    PolarPoint {
        from: Box<GeometryValuePoint>,
        angle_deg: Box<TypedScalarExpression>,
        distance: Box<TypedScalarExpression>,
    },
    Between {
        start: Box<GeometryValuePoint>,
        end: Box<GeometryValuePoint>,
        placement: GeometryValuePlacement,
    },
    OnLine {
        line: super::scalars::ScalarExpressionResolvedGeometryTarget,
        endpoint_key: String,
        placement: GeometryValuePlacement,
    },
    Intersection {
        line1: super::scalars::ScalarExpressionResolvedGeometryTarget,
        line2: super::scalars::ScalarExpressionResolvedGeometryTarget,
        index: Box<TypedScalarExpression>,
        extensions: Box<TypedScalarExpression>,
    },
    CommonTangent {
        first: super::scalars::ScalarExpressionResolvedGeometryTarget,
        second: super::scalars::ScalarExpressionResolvedGeometryTarget,
        tangent_kind: Box<TypedScalarExpression>,
        side: Box<TypedScalarExpression>,
    },
    TangentOffset {
        line: super::scalars::ScalarExpressionResolvedGeometryTarget,
        base: Box<GeometryValuePoint>,
        angle_deg: Option<Box<TypedScalarExpression>>,
        curve_side: Option<Box<TypedScalarExpression>>,
        distance: Box<TypedScalarExpression>,
    },
    BezierExtremePoint {
        source: super::scalars::ScalarExpressionResolvedGeometryTarget,
        segment_index: Box<TypedScalarExpression>,
        direction: Box<TypedScalarExpression>,
    },
    BezierBulgePoint {
        source: super::scalars::ScalarExpressionResolvedGeometryTarget,
        segment_index: Box<TypedScalarExpression>,
    },
    Segment {
        start: Box<GeometryValuePoint>,
        end: Box<GeometryValuePoint>,
    },
    PolarLine {
        start: Box<GeometryValuePoint>,
        angle_deg: Box<TypedScalarExpression>,
        length: Box<TypedScalarExpression>,
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
    JoinedPath {
        paths: Vec<super::scalars::ScalarExpressionResolvedGeometryTarget>,
        closed: Box<TypedScalarExpression>,
    },
    TransformCopy {
        start_point: Box<GeometryValuePoint>,
        end_point: Box<GeometryValuePoint>,
        scale: Box<TypedScalarExpression>,
        angle_deg: Box<TypedScalarExpression>,
        mirror_x: Box<TypedScalarExpression>,
        base_lines: Vec<super::scalars::ScalarExpressionResolvedGeometryTarget>,
    },
    MirrorCopy {
        axis1: Box<GeometryValuePoint>,
        axis2: Box<GeometryValuePoint>,
        base_lines: Vec<super::scalars::ScalarExpressionResolvedGeometryTarget>,
    },
}

#[derive(Debug)]
pub(crate) struct GeometryValueProgramEntry {
    pub(crate) source_statement_id: String,
    pub(crate) source_statement_index: usize,
    pub(crate) declared_interface_type: String,
    pub(crate) occurrence: GeometryValueOccurrence,
    pub(crate) execution_position: f64,
    pub(crate) lazy: bool,
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
    let mapped_member_index = object
        .get("mappedMemberIndex")
        .and_then(Value::as_u64)
        .map(|value| {
            usize::try_from(value).map_err(|_| format!("{context}.mappedMemberIndex is too large"))
        })
        .transpose()?;
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
        mapped_member_index,
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

fn decode_nested_construction(value: &Value) -> Result<GeometryValueConstruction, String> {
    let wrapped = json!({
        "sourceStatementId": "nested-geometry-value",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "point",
        "occurrence": { "sourceStatementId": "nested-geometry-value", "instancePath": [] },
        "executionPosition": 0.0,
        "construction": value
    });
    decode_entry(&wrapped).map(|entry| entry.construction)
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

fn decode_optional_typed_field(
    object: &serde_json::Map<String, Value>,
    name: &str,
    _context: &str,
) -> Result<Option<TypedScalarExpression>, String> {
    let Some(value) = object.get(name) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    validate_typed_expression_payload(value)
        .map(Some)
        .map_err(|error| format!("{error:?}"))
}

fn decode_target_list(
    construction_object: &serde_json::Map<String, Value>,
    name: &str,
    context: &str,
) -> Result<Vec<super::scalars::ScalarExpressionResolvedGeometryTarget>, String> {
    construction_object
        .get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{context} is missing {name}"))?
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let target_payload = source
                .as_object()
                .and_then(|object| object.get("target"))
                .unwrap_or(source);
            super::scalars::decode_geometry_target_payload(target_payload)
                .map_err(|error| format!("{context} {name} source {index}: {error:?}"))?
                .ok_or_else(|| format!("{context} {name} source {index} cannot be null"))
        })
        .collect()
}

fn decode_placement(
    construction_object: &serde_json::Map<String, Value>,
    context: &str,
) -> Result<GeometryValuePlacement, String> {
    let placement = object(
        construction_object
            .get("placement")
            .ok_or_else(|| format!("{context} is missing placement"))?,
        context,
    )?;
    let kind = string_field(placement, "kind", &format!("{context} placement"))?;
    let value = Box::new(decode_typed_field(
        placement,
        "value",
        &format!("{context} placement"),
    )?);
    match kind.as_str() {
        "distance" => Ok(GeometryValuePlacement::Distance(value)),
        "ratio" => Ok(GeometryValuePlacement::Ratio(value)),
        _ => Err(format!("{context} placement kind {kind} is unsupported")),
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
    let lazy = entry_object
        .get("lazy")
        .and_then(Value::as_bool)
        .unwrap_or(false);
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
            "reference" => GeometryValueConstruction::Reference {
                target: super::scalars::decode_geometry_target_payload(
                    construction_object
                        .get("target")
                        .ok_or_else(|| "geometry value reference is missing target".to_owned())?,
                )
                .map_err(|error| format!("{error:?}"))?
                .ok_or_else(|| "geometry value reference target cannot be null".to_owned())?,
            },
            "if" => GeometryValueConstruction::If {
                condition: Box::new(decode_typed_field(
                    construction_object,
                    "condition",
                    "geometry value if",
                )?),
                then_branch: Box::new(decode_nested_construction(
                    construction_object
                        .get("thenBranch")
                        .ok_or_else(|| "geometry value if is missing thenBranch".to_owned())?,
                )?),
                else_branch: Box::new(decode_nested_construction(
                    construction_object
                        .get("elseBranch")
                        .ok_or_else(|| "geometry value if is missing elseBranch".to_owned())?,
                )?),
            },
            "match" => {
                let arms = construction_object
                    .get("arms")
                    .and_then(Value::as_array)
                    .ok_or_else(|| "geometry value match is missing arms".to_owned())?
                    .iter()
                    .enumerate()
                    .map(|(index, arm)| {
                        let arm_object = object(arm, "geometry value match arm")?;
                        let label = string_field(
                            arm_object,
                            "label",
                            &format!("geometry value match arm {index}"),
                        )?;
                        let expression = decode_nested_construction(
                            arm_object.get("expression").ok_or_else(|| {
                                format!("geometry value match arm {index} is missing expression")
                            })?,
                        )?;
                        Ok(GeometryValueMatchArm {
                            label,
                            expression: Box::new(expression),
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                GeometryValueConstruction::Match {
                    scrutinee: Box::new(decode_typed_field(
                        construction_object,
                        "scrutinee",
                        "geometry value match",
                    )?),
                    arms,
                }
            }
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
            "polarPoint" => GeometryValueConstruction::PolarPoint {
                from: Box::new(decode_point(construction_object.get("from").ok_or_else(
                    || "geometry value polarPoint is missing from".to_owned(),
                )?)?),
                angle_deg: Box::new(decode_typed_field(
                    construction_object,
                    "angleDeg",
                    "geometry value polarPoint",
                )?),
                distance: Box::new(decode_typed_field(
                    construction_object,
                    "distance",
                    "geometry value polarPoint",
                )?),
            },
            "between" => GeometryValueConstruction::Between {
                start: Box::new(decode_point(
                    construction_object
                        .get("start")
                        .ok_or_else(|| "geometry value between is missing start".to_owned())?,
                )?),
                end: Box::new(decode_point(
                    construction_object
                        .get("end")
                        .ok_or_else(|| "geometry value between is missing end".to_owned())?,
                )?),
                placement: decode_placement(construction_object, "geometry value between")?,
            },
            "onLine" => {
                let endpoint_key =
                    string_field(construction_object, "endpointKey", "geometry value onLine")?;
                if endpoint_key != "start" && endpoint_key != "end" {
                    return Err("geometry value onLine endpointKey must be start or end".to_owned());
                }
                let line_object = object(
                    construction_object
                        .get("line")
                        .ok_or_else(|| "geometry value onLine is missing line".to_owned())?,
                    "geometry value onLine line",
                )?;
                if string_field(line_object, "kind", "geometry value onLine line")? != "target" {
                    return Err("geometry value onLine line must be a target".to_owned());
                }
                GeometryValueConstruction::OnLine {
                    line: super::scalars::decode_geometry_target_payload(
                        line_object.get("target").ok_or_else(|| {
                            "geometry value onLine line is missing target".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?
                    .ok_or_else(|| "geometry value onLine line cannot be null".to_owned())?,
                    endpoint_key,
                    placement: decode_placement(construction_object, "geometry value onLine")?,
                }
            }
            "intersection" => GeometryValueConstruction::Intersection {
                line1: super::scalars::decode_geometry_target_payload(
                    construction_object
                        .get("line1")
                        .and_then(|value| value.get("target"))
                        .ok_or_else(|| {
                            "geometry value intersection is missing line1 target".to_owned()
                        })?,
                )
                .map_err(|error| format!("{error:?}"))?
                .ok_or_else(|| "geometry value intersection line1 cannot be null".to_owned())?,
                line2: super::scalars::decode_geometry_target_payload(
                    construction_object
                        .get("line2")
                        .and_then(|value| value.get("target"))
                        .ok_or_else(|| {
                            "geometry value intersection is missing line2 target".to_owned()
                        })?,
                )
                .map_err(|error| format!("{error:?}"))?
                .ok_or_else(|| "geometry value intersection line2 cannot be null".to_owned())?,
                index: Box::new(decode_typed_field(
                    construction_object,
                    "index",
                    "geometry value intersection",
                )?),
                extensions: Box::new(decode_typed_field(
                    construction_object,
                    "extensions",
                    "geometry value intersection",
                )?),
            },
            "commonTangent" => {
                let target = |name: &str| -> Result<
                    super::scalars::ScalarExpressionResolvedGeometryTarget,
                    String,
                > {
                    let target_object = object(
                        construction_object.get(name).ok_or_else(|| {
                            format!("geometry value commonTangent is missing {name}")
                        })?,
                        &format!("geometry value commonTangent {name}"),
                    )?;
                    if string_field(
                        target_object,
                        "kind",
                        &format!("geometry value commonTangent {name}"),
                    )? != "target"
                    {
                        return Err(format!(
                            "geometry value commonTangent {name} must be a target"
                        ));
                    }
                    super::scalars::decode_geometry_target_payload(
                        target_object.get("target").ok_or_else(|| {
                            format!("geometry value commonTangent {name} is missing target")
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?
                    .ok_or_else(|| format!("geometry value commonTangent {name} cannot be null"))
                };
                GeometryValueConstruction::CommonTangent {
                    first: target("first")?,
                    second: target("second")?,
                    tangent_kind: Box::new(decode_typed_field(
                        construction_object,
                        "tangentKind",
                        "geometry value commonTangent",
                    )?),
                    side: Box::new(decode_typed_field(
                        construction_object,
                        "side",
                        "geometry value commonTangent",
                    )?),
                }
            }
            "tangentOffset" => {
                let line_object = object(
                    construction_object
                        .get("line")
                        .ok_or_else(|| "geometry value tangentOffset is missing line".to_owned())?,
                    "geometry value tangentOffset line",
                )?;
                if string_field(line_object, "kind", "geometry value tangentOffset line")?
                    != "target"
                {
                    return Err("geometry value tangentOffset line must be a target".to_owned());
                }
                GeometryValueConstruction::TangentOffset {
                    line: super::scalars::decode_geometry_target_payload(
                        line_object.get("target").ok_or_else(|| {
                            "geometry value tangentOffset line is missing target".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?
                    .ok_or_else(|| "geometry value tangentOffset line cannot be null".to_owned())?,
                    base: Box::new(decode_point(construction_object.get("base").ok_or_else(
                        || "geometry value tangentOffset is missing base".to_owned(),
                    )?)?),
                    angle_deg: decode_optional_typed_field(
                        construction_object,
                        "angleDeg",
                        "geometry value tangentOffset",
                    )?
                    .map(Box::new),
                    curve_side: decode_optional_typed_field(
                        construction_object,
                        "curveSide",
                        "geometry value tangentOffset",
                    )?
                    .map(Box::new),
                    distance: Box::new(decode_typed_field(
                        construction_object,
                        "distance",
                        "geometry value tangentOffset",
                    )?),
                }
            }
            "bezierExtremePoint" => {
                let source_object = object(
                    construction_object.get("source").ok_or_else(|| {
                        "geometry value bezierExtremePoint is missing source".to_owned()
                    })?,
                    "geometry value bezierExtremePoint source",
                )?;
                if string_field(
                    source_object,
                    "kind",
                    "geometry value bezierExtremePoint source",
                )? != "target"
                {
                    return Err(
                        "geometry value bezierExtremePoint source must be a target".to_owned()
                    );
                }
                GeometryValueConstruction::BezierExtremePoint {
                    source: super::scalars::decode_geometry_target_payload(
                        source_object.get("target").ok_or_else(|| {
                            "geometry value bezierExtremePoint source is missing target".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?
                    .ok_or_else(|| {
                        "geometry value bezierExtremePoint source cannot be null".to_owned()
                    })?,
                    segment_index: Box::new(decode_typed_field(
                        construction_object,
                        "segmentIndex",
                        "geometry value bezierExtremePoint",
                    )?),
                    direction: Box::new(decode_typed_field(
                        construction_object,
                        "direction",
                        "geometry value bezierExtremePoint",
                    )?),
                }
            }
            "bezierBulgePoint" => {
                let source_object = object(
                    construction_object.get("source").ok_or_else(|| {
                        "geometry value bezierBulgePoint is missing source".to_owned()
                    })?,
                    "geometry value bezierBulgePoint source",
                )?;
                if string_field(
                    source_object,
                    "kind",
                    "geometry value bezierBulgePoint source",
                )? != "target"
                {
                    return Err(
                        "geometry value bezierBulgePoint source must be a target".to_owned()
                    );
                }
                GeometryValueConstruction::BezierBulgePoint {
                    source: super::scalars::decode_geometry_target_payload(
                        source_object.get("target").ok_or_else(|| {
                            "geometry value bezierBulgePoint source is missing target".to_owned()
                        })?,
                    )
                    .map_err(|error| format!("{error:?}"))?
                    .ok_or_else(|| {
                        "geometry value bezierBulgePoint source cannot be null".to_owned()
                    })?,
                    segment_index: Box::new(decode_typed_field(
                        construction_object,
                        "segmentIndex",
                        "geometry value bezierBulgePoint",
                    )?),
                }
            }
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
            "polarLine" => GeometryValueConstruction::PolarLine {
                start: Box::new(decode_point(construction_object.get("start").ok_or_else(
                    || "geometry value polarLine is missing start".to_owned(),
                )?)?),
                angle_deg: Box::new(decode_typed_field(
                    construction_object,
                    "angleDeg",
                    "geometry value polarLine",
                )?),
                length: Box::new(decode_typed_field(
                    construction_object,
                    "length",
                    "geometry value polarLine",
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
            "transformCopy" => GeometryValueConstruction::TransformCopy {
                start_point: Box::new(decode_point(
                    construction_object.get("startPoint").ok_or_else(|| {
                        "geometry value transformCopy is missing startPoint".to_owned()
                    })?,
                )?),
                end_point: Box::new(decode_point(
                    construction_object.get("endPoint").ok_or_else(|| {
                        "geometry value transformCopy is missing endPoint".to_owned()
                    })?,
                )?),
                scale: Box::new(decode_typed_field(
                    construction_object,
                    "scale",
                    "geometry value transformCopy",
                )?),
                angle_deg: Box::new(decode_typed_field(
                    construction_object,
                    "angleDeg",
                    "geometry value transformCopy",
                )?),
                mirror_x: Box::new(decode_typed_field(
                    construction_object,
                    "mirrorX",
                    "geometry value transformCopy",
                )?),
                base_lines: decode_target_list(
                    construction_object,
                    "baseLines",
                    "geometry value transformCopy",
                )?,
            },
            "mirrorCopy" => GeometryValueConstruction::MirrorCopy {
                axis1: Box::new(decode_point(construction_object.get("axis1").ok_or_else(
                    || "geometry value mirrorCopy is missing axis1".to_owned(),
                )?)?),
                axis2: Box::new(decode_point(construction_object.get("axis2").ok_or_else(
                    || "geometry value mirrorCopy is missing axis2".to_owned(),
                )?)?),
                base_lines: decode_target_list(
                    construction_object,
                    "baseLines",
                    "geometry value mirrorCopy",
                )?,
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
            "joinedPath" => GeometryValueConstruction::JoinedPath {
                paths: decode_target_list(
                    construction_object,
                    "paths",
                    "geometry value joinedPath",
                )?,
                closed: Box::new(decode_typed_field(
                    construction_object,
                    "closed",
                    "geometry value joinedPath",
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
        lazy,
        construction,
    })
}

pub(crate) fn decode_geometry_value_node(
    value: &Value,
) -> Result<GeometryValueConstruction, String> {
    decode_nested_construction(value)
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

fn tangent_kind_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<String> {
    match evaluate_document_typed_expression(expression, resolver, state, Some(source_order)) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Choice { .. },
            value: ScalarValue::Choice { value, .. },
        } if value == "external" || value == "internal" => Some(value),
        _ => None,
    }
}

fn curve_side_expression(
    expression: &TypedScalarExpression,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<String> {
    match evaluate_document_typed_expression(expression, resolver, state, Some(source_order)) {
        ScalarEvaluation::Ok {
            r#type: ScalarType::Choice { .. },
            value: ScalarValue::Choice { value, .. },
        } if value == "convex" || value == "concave" => Some(value),
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
    if let Some(binder_id) = &target.geometry_value_binder_id {
        let source = state.geometry_value_binders.get(binder_id)?;
        return point_from_input_target(source, state, target.point_key.as_deref());
    }
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

fn point_from_input_target(
    target: &GeometryInputTarget,
    state: &EvaluationState,
    point_key: Option<&str>,
) -> Option<(f64, f64)> {
    match target {
        GeometryInputTarget::Coordinate { anchor } => anchor
            .get("x")
            .and_then(Value::as_f64)
            .zip(anchor.get("y").and_then(Value::as_f64)),
        GeometryInputTarget::Drawable { element_id, .. } => {
            let geometry = state.computed_geometry.get(element_id)?;
            point_key
                .and_then(|key| super::point_anchor::resolve_derived_point(geometry, key, state))
                .map(|point| (point.x, point.y))
                .or_else(|| point_from_geometry(geometry).map(|point| (point.x, point.y)))
        }
        GeometryInputTarget::GeometryValue { occurrence, .. } => {
            let geometry = state.computed_geometry_values.get(occurrence)?;
            point_key
                .and_then(|key| geometry.get(key))
                .and_then(|value| {
                    value
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(value.get("y").and_then(Value::as_f64))
                })
                .or_else(|| {
                    geometry
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(geometry.get("y").and_then(Value::as_f64))
                })
        }
        GeometryInputTarget::GeometryValueMap { .. }
        | GeometryInputTarget::CollectionValue { .. }
        | GeometryInputTarget::CollectionIndex { .. } => None,
    }
}

fn target_geometry<'a>(
    target: &super::scalars::ScalarExpressionResolvedGeometryTarget,
    state: &'a EvaluationState,
) -> Option<&'a Value> {
    if let Some(binder_id) = &target.geometry_value_binder_id {
        let source = state.geometry_value_binders.get(binder_id)?;
        return match source {
            GeometryInputTarget::Drawable { element_id, .. } => {
                state.computed_geometry.get(element_id)
            }
            GeometryInputTarget::GeometryValue { occurrence, .. } => {
                state.computed_geometry_values.get(occurrence)
            }
            GeometryInputTarget::Coordinate { .. }
            | GeometryInputTarget::CollectionValue { .. }
            | GeometryInputTarget::GeometryValueMap { .. }
            | GeometryInputTarget::CollectionIndex { .. } => state.computed_geometry.get(binder_id),
        };
    }
    if let Some(occurrence) = &target.geometry_value_occurrence {
        state.computed_geometry_values.get(occurrence)
    } else {
        state.computed_geometry.get(&target.statement_id)
    }
}

fn copy_source_segments(
    sources: &[super::scalars::ScalarExpressionResolvedGeometryTarget],
    state: &EvaluationState,
) -> Result<Vec<SourceSegment>, &'static str> {
    if sources.is_empty() {
        return Err("inputs are unavailable, non-line-like, or contain no segments");
    }
    let mut groups = Vec::with_capacity(sources.len());
    for source in sources {
        let Some(geometry) = target_geometry(source, state) else {
            return Err("inputs are unavailable, non-line-like, or contain no segments");
        };
        if !is_line_like_geometry(Some(geometry)) {
            return Err("inputs are unavailable, non-line-like, or contain no segments");
        }
        let segments = source_segments_for_geometry(geometry);
        if segments.is_empty() {
            return Err("inputs are unavailable, non-line-like, or contain no segments");
        }
        groups.push(segments);
    }
    let connected = connect_source_segment_groups(&groups, false);
    (!connected.is_empty())
        .then_some(connected)
        .ok_or("baseLines are not continuous in the specified order")
}

fn same_geometry_source(
    left: &super::scalars::ScalarExpressionResolvedGeometryTarget,
    right: &super::scalars::ScalarExpressionResolvedGeometryTarget,
) -> bool {
    match (
        left.geometry_value_occurrence.as_ref(),
        right.geometry_value_occurrence.as_ref(),
    ) {
        (Some(left), Some(right)) => left == right,
        (None, None) => left.statement_id == right.statement_id,
        _ => false,
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

fn evaluate_geometry_placement(
    placement: &GeometryValuePlacement,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
    source_order: f64,
) -> Option<(DivisionPlacementKind, f64)> {
    match placement {
        GeometryValuePlacement::Distance(value) => Some((
            DivisionPlacementKind::Distance,
            number_expression(value, resolver, state, source_order)?,
        )),
        GeometryValuePlacement::Ratio(value) => Some((
            DivisionPlacementKind::Ratio,
            number_expression(value, resolver, state, source_order)?,
        )),
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

fn reverse_source_segment(segment: &SourceSegment) -> SourceSegment {
    match segment {
        SourceSegment::Line { start, end } => SourceSegment::Line {
            start: *end,
            end: *start,
        },
        SourceSegment::Bezier {
            start,
            control1,
            control2,
            end,
        } => SourceSegment::Bezier {
            start: *end,
            control1: *control2,
            control2: *control1,
            end: *start,
        },
        SourceSegment::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
        } => SourceSegment::Arc {
            center: *center,
            radius: *radius,
            start_angle_deg: *start_angle_deg + *sweep_angle_deg,
            sweep_angle_deg: -*sweep_angle_deg,
        },
    }
}

fn joined_path_segment_value(segment: &SourceSegment) -> Option<Value> {
    match segment {
        SourceSegment::Line { start, end } => Some(json!({
            "kind": "line",
            "start": { "x": start.x, "y": start.y },
            "end": { "x": end.x, "y": end.y },
            "length": line_length(*start, *end)
        })),
        SourceSegment::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            let base = json!({
                "kind": "bezier",
                "start": { "x": start.x, "y": start.y },
                "control1": { "x": control1.x, "y": control1.y },
                "control2": { "x": control2.x, "y": control2.y },
                "end": { "x": end.x, "y": end.y }
            });
            Some(json!({
                "kind": "bezier",
                "start": base.get("start")?,
                "control1": base.get("control1")?,
                "control2": base.get("control2")?,
                "end": base.get("end")?,
                "length": approximate_cubic_length(&base, 32)?
            }))
        }
        SourceSegment::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
        } => {
            let start = source_start(segment);
            let end = source_end(segment);
            Some(json!({
                "kind": "arc",
                "center": { "x": center.x, "y": center.y },
                "start": { "x": start.x, "y": start.y },
                "end": { "x": end.x, "y": end.y },
                "radius": radius,
                "startAngleDeg": start_angle_deg,
                "sweepAngleDeg": sweep_angle_deg,
                "length": radius * sweep_angle_deg.to_radians().abs()
            }))
        }
    }
}

fn joined_path_json(geometries: &[Value], closed: bool) -> Result<Value, String> {
    if geometries.is_empty() {
        return Err("join geometry value construction requires at least one path.".to_owned());
    }
    let mut oriented = Vec::<SourceSegment>::new();
    for geometry in geometries {
        if !is_line_like_geometry(Some(geometry)) {
            return Err(
                "join geometry value construction inputs are unavailable or invalid.".to_owned(),
            );
        }
        let segments = source_segments_for_geometry(geometry);
        let Some(first) = segments.first() else {
            return Err(
                "join geometry value construction contains an empty or unsupported path."
                    .to_owned(),
            );
        };
        let Some(last) = segments.last() else {
            return Err(
                "join geometry value construction contains a path without endpoints.".to_owned(),
            );
        };
        if let Some(previous_end) = oriented.last().map(source_end) {
            let authored_start = source_start(first);
            let authored_end = source_end(last);
            if line_length(previous_end, authored_start) <= EPSILON {
                oriented.extend(segments);
            } else if line_length(previous_end, authored_end) <= EPSILON {
                oriented.extend(segments.iter().rev().map(reverse_source_segment));
            } else {
                return Err("join geometry value construction paths are not continuous in the specified order.".to_owned());
            }
        } else {
            oriented.extend(segments);
        }
    }
    let Some(first_segment) = oriented.first() else {
        return Err("join geometry value construction produced no segments.".to_owned());
    };
    let Some(last_segment) = oriented.last() else {
        return Err("join geometry value construction produced no segments.".to_owned());
    };
    if closed && line_length(source_end(last_segment), source_start(first_segment)) > EPSILON {
        return Err("join geometry value construction is closed but the final path does not connect to the first path.".to_owned());
    }
    let segments = oriented
        .iter()
        .map(joined_path_segment_value)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| {
            "join geometry value construction produced invalid primitive geometry.".to_owned()
        })?;
    let (_, _, start_tangent, end_tangent) =
        offset_line_endpoint_measurements_from_values(&segments);
    let length = segments
        .iter()
        .filter_map(|segment| segment.get("length").and_then(Value::as_f64))
        .sum::<f64>();
    Ok(json!({
        "kind": "joinedPath",
        "start": segments.first().and_then(|segment| segment.get("start")).cloned().unwrap_or(Value::Null),
        "end": segments.last().and_then(|segment| segment.get("end")).cloned().unwrap_or(Value::Null),
        "segments": segments,
        "closed": closed,
        "length": length,
        "startTangentAngleDeg": start_tangent,
        "endTangentAngleDeg": end_tangent
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
    evaluate_geometry_value_node(&entry.construction, entry, resolver, state, source_order);
}

fn evaluate_geometry_value_node(
    construction: &GeometryValueConstruction,
    entry: &GeometryValueProgramEntry,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &mut EvaluationState,
    source_order: f64,
) {
    match construction {
        GeometryValueConstruction::Reference { target } => {
            let Some(geometry) = target_geometry(target, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value reference is unavailable at runtime.",
                );
                return;
            };
            let mut value = geometry.clone();
            remove_geometry_identity(&mut value);
            if matches!(
                target.geometry_type,
                super::scalars::GeometryInterfaceType::Point
            ) {
                if let Value::Object(object) = &mut value {
                    if object.contains_key("x") && object.contains_key("y") {
                        object.insert("kind".to_owned(), Value::String("point".to_owned()));
                    }
                }
            }
            state
                .computed_geometry_values
                .insert(entry.occurrence.clone(), value);
        }
        GeometryValueConstruction::If {
            condition,
            then_branch,
            else_branch,
        } => {
            let Some(condition) = boolean_expression(condition, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value if condition is unavailable or not boolean.",
                );
                return;
            };
            evaluate_geometry_value_node(
                if condition { then_branch } else { else_branch },
                entry,
                resolver,
                state,
                source_order,
            );
        }
        GeometryValueConstruction::Match { scrutinee, arms } => {
            let label = match evaluate_document_typed_expression(
                scrutinee,
                resolver,
                state,
                Some(source_order),
            ) {
                ScalarEvaluation::Ok {
                    r#type: ScalarType::Choice { .. },
                    value: ScalarValue::Choice { value, .. },
                } => Some(value),
                _ => None,
            };
            let Some(label) = label else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value match scrutinee is unavailable or has no matching case.",
                );
                return;
            };
            let Some(arm) = arms.iter().find(|arm| arm.label == label) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value match scrutinee is unavailable or has no matching case.",
                );
                return;
            };
            evaluate_geometry_value_node(&arm.expression, entry, resolver, state, source_order);
        }
        _ => evaluate_geometry_value_leaf(construction, entry, resolver, state, source_order),
    }
}

fn evaluate_geometry_value_leaf(
    construction: &GeometryValueConstruction,
    entry: &GeometryValueProgramEntry,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &mut EvaluationState,
    source_order: f64,
) {
    let value = match construction {
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
        GeometryValueConstruction::PolarPoint {
            from,
            angle_deg,
            distance,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            evaluate_point(from, resolver, state, source_order)
                .zip(number_expression(angle_deg, resolver, state, source_order))
                .zip(number_expression(distance, resolver, state, source_order))
                .map(|(((x, y), angle_deg), distance)| {
                    let structural =
                        polar_point_geometry_kernel(StructuralPoint { x, y }, angle_deg, distance);
                    json!({ "kind": "point", "x": structural.x, "y": structural.y })
                })
        }
        GeometryValueConstruction::Between {
            start,
            end,
            placement,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let start = evaluate_point(start, resolver, state, source_order);
            let end = evaluate_point(end, resolver, state, source_order);
            let placement = evaluate_geometry_placement(placement, resolver, state, source_order);
            match (start, end, placement) {
                (Some(start), Some(end), Some((kind, value))) => {
                    let structural = division_point_geometry_kernel(
                        StructuralPoint {
                            x: start.0,
                            y: start.1,
                        },
                        StructuralPoint { x: end.0, y: end.1 },
                        kind,
                        value,
                    );
                    let Some(structural) = structural else {
                        append_geometry_value_error(
                            state,
                            entry,
                            "between construction cannot determine a distance direction because its endpoints coincide.",
                        );
                        return;
                    };
                    Some(json!({
                        "kind": "point",
                        "x": structural.x,
                        "y": structural.y
                    }))
                }
                _ => None,
            }
        }
        GeometryValueConstruction::OnLine {
            line,
            endpoint_key,
            placement,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(geometry) = target_geometry(line, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry.",
                );
                return;
            };
            if !is_line_like_geometry(Some(geometry)) {
                append_geometry_value_error(
                    state,
                    entry,
                    "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry.",
                );
                return;
            }
            let Some((kind, value)) =
                evaluate_geometry_placement(placement, resolver, state, source_order)
            else {
                return;
            };
            let path_distance = match kind {
                DivisionPlacementKind::Distance => value,
                DivisionPlacementKind::Ratio => {
                    let Some(length) = geometry_length(geometry) else {
                        append_geometry_value_error(
                            state,
                            entry,
                            "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry.",
                        );
                        return;
                    };
                    length * value
                }
            };
            let Some((x, y)) =
                point_at_distance_from_endpoint(geometry, endpoint_key, path_distance)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry.",
                );
                return;
            };
            Some(json!({ "kind": "point", "x": x, "y": y }))
        }
        GeometryValueConstruction::Intersection {
            line1,
            line2,
            index,
            extensions,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            if same_geometry_source(line1, line2) {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value cannot intersect the same source geometry twice.",
                );
                return;
            }
            let Some(geometry1) = target_geometry(line1, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value inputs are unavailable or invalid.",
                );
                return;
            };
            let Some(geometry2) = target_geometry(line2, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value inputs are unavailable or invalid.",
                );
                return;
            };
            if !is_line_like_geometry(Some(geometry1)) || !is_line_like_geometry(Some(geometry2)) {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value inputs are unavailable or invalid.",
                );
                return;
            }
            let Some(index) = number_expression(index, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value index must be a finite non-negative integer.",
                );
                return;
            };
            if !index.is_finite() || index.fract() != 0.0 || index < 0.0 {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value index must be a finite non-negative integer.",
                );
                return;
            }
            let Some(extensions) = boolean_expression(extensions, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value extensions must be boolean.",
                );
                return;
            };
            let Some(result) = find_line_intersections(geometry1, geometry2, extensions) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "intersection geometry value inputs are unavailable or invalid.",
                );
                return;
            };
            if let Some(error) = result.error {
                append_geometry_value_error(state, entry, &error);
                return;
            }
            let Some(intersection) = result.intersections.get(index as usize) else {
                let message = if result.intersections.is_empty() {
                    "intersection geometry value could not find an intersection between the referenced geometry inputs. Check line1, line2, or extensions.".to_owned()
                } else {
                    format!(
                        "intersection geometry value index {} is unavailable. There are {} intersections.",
                        index,
                        result.intersections.len()
                    )
                };
                append_geometry_value_error(state, entry, &message);
                return;
            };
            Some(json!({ "kind": "point", "x": intersection.x, "y": intersection.y }))
        }
        GeometryValueConstruction::CommonTangent {
            first,
            second,
            tangent_kind,
            side,
        } => {
            if entry.declared_interface_type != "line" && entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let first_geometry = target_geometry(first, state).cloned();
            let second_geometry = target_geometry(second, state).cloned();
            if first_geometry
                .as_ref()
                .and_then(|geometry| geometry.get("kind"))
                .and_then(Value::as_str)
                != Some("arcLine")
            {
                append_geometry_value_error(
                    state,
                    entry,
                    "first に円弧が指定されていません。共通接線には円弧を指定してください。",
                );
            }
            if second_geometry
                .as_ref()
                .and_then(|geometry| geometry.get("kind"))
                .and_then(Value::as_str)
                != Some("arcLine")
            {
                append_geometry_value_error(
                    state,
                    entry,
                    "second に円弧が指定されていません。共通接線には円弧を指定してください。",
                );
            }
            if first_geometry
                .as_ref()
                .and_then(|geometry| geometry.get("kind"))
                .and_then(Value::as_str)
                != Some("arcLine")
                || second_geometry
                    .as_ref()
                    .and_then(|geometry| geometry.get("kind"))
                    .and_then(Value::as_str)
                    != Some("arcLine")
            {
                return;
            }
            let first_geometry = first_geometry.expect("arcLine checked above");
            let second_geometry = second_geometry.expect("arcLine checked above");
            let first_center = StructuralPoint {
                x: first_geometry["center"]["x"].as_f64().unwrap_or(f64::NAN),
                y: first_geometry["center"]["y"].as_f64().unwrap_or(f64::NAN),
            };
            let second_center = StructuralPoint {
                x: second_geometry["center"]["x"].as_f64().unwrap_or(f64::NAN),
                y: second_geometry["center"]["y"].as_f64().unwrap_or(f64::NAN),
            };
            let first_radius = first_geometry
                .get("radius")
                .and_then(Value::as_f64)
                .unwrap_or(f64::NAN);
            let second_radius = second_geometry
                .get("radius")
                .and_then(Value::as_f64)
                .unwrap_or(f64::NAN);
            let Some(tangent_kind) =
                tangent_kind_expression(tangent_kind, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "commonTangent geometry value kind must be external or internal.",
                );
                return;
            };
            let Some(side) = side_expression(side, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "commonTangent geometry value side must be left or right.",
                );
                return;
            };
            let structural = match common_tangent_geometry_kernel(
                first_center,
                first_radius,
                second_center,
                second_radius,
                &tangent_kind,
                &side,
            ) {
                Ok(value) => value,
                Err(messages) => {
                    for message in messages {
                        append_geometry_value_error(state, entry, &message);
                    }
                    return;
                }
            };
            Some(json!({
                "kind": "line",
                "start": { "x": structural.start.x, "y": structural.start.y },
                "end": { "x": structural.end.x, "y": structural.end.y },
                "length": structural.length,
                "startAngleDeg": structural.start_angle_deg,
                "endAngleDeg": structural.end_angle_deg,
                "startTangentAngleDeg": structural.start_tangent_angle_deg,
                "endTangentAngleDeg": structural.end_tangent_angle_deg
            }))
        }
        GeometryValueConstruction::TangentOffset {
            line,
            base,
            angle_deg,
            curve_side,
            distance,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(geometry) = target_geometry(line, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "tangentOffset geometry value inputs are unavailable or invalid.",
                );
                return;
            };
            if !is_line_like_geometry(Some(geometry)) {
                append_geometry_value_error(
                    state,
                    entry,
                    "tangentOffset geometry value inputs are unavailable or invalid.",
                );
                return;
            }
            let Some(base) = evaluate_point(base, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "tangentOffset geometry value inputs are unavailable or invalid.",
                );
                return;
            };
            let Some(distance) = number_expression(distance, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "tangentOffset geometry value inputs are unavailable or invalid.",
                );
                return;
            };
            let curve_side = if let Some(expression) = curve_side {
                let Some(curve_side) =
                    curve_side_expression(expression, resolver, state, source_order)
                else {
                    append_geometry_value_error(
                        state,
                        entry,
                        "tangentOffset geometry value curveSide must be convex or concave.",
                    );
                    return;
                };
                Some(curve_side)
            } else {
                None
            };
            let angle_deg = if curve_side.is_none() {
                match angle_deg {
                    Some(expression) => {
                        let Some(angle_deg) =
                            number_expression(expression, resolver, state, source_order)
                        else {
                            append_geometry_value_error(
                                state,
                                entry,
                                "tangentOffset geometry value angle must be a finite number.",
                            );
                            return;
                        };
                        Some(angle_deg)
                    }
                    None => Some(0.0),
                }
            } else {
                None
            };
            let result = tangent_offset_point_geometry_kernel(
                geometry,
                Point {
                    x: base.0,
                    y: base.1,
                },
                curve_side.as_deref(),
                angle_deg,
                distance,
            );
            let point = match result {
                Ok(point) => point,
                Err(error) => {
                    append_geometry_value_error(
                        state,
                        entry,
                        &format!("tangentOffset geometry value {error}"),
                    );
                    return;
                }
            };
            Some(json!({ "kind": "point", "x": point.x, "y": point.y }))
        }
        GeometryValueConstruction::BezierExtremePoint {
            source,
            segment_index,
            direction,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(geometry) = target_geometry(source, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            };
            if geometry.get("kind").and_then(Value::as_str) != Some("bezierCurve") {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            }
            let Some(segments) = geometry.get("segments").and_then(Value::as_array) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            };
            let Some(segment_index) =
                number_expression(segment_index, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierExtremePoint segmentIndex must be a finite number.",
                );
                return;
            };
            if !segment_index.is_finite() {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierExtremePoint segmentIndex must be a finite number.",
                );
                return;
            }
            if segment_index.fract() != 0.0 || segment_index < 0.0 {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierExtremePoint segmentIndex must be a non-negative integer.",
                );
                return;
            }
            if segment_index >= segments.len() as f64 {
                append_geometry_value_error(
                    state,
                    entry,
                    &format!(
                        "bezierExtremePoint segmentIndex {} is outside the source Bezier segment range ({} segments).",
                        segment_index,
                        segments.len()
                    ),
                );
                return;
            }
            let Some(direction_deg) = number_expression(direction, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierExtremePoint direction must be a finite number.",
                );
                return;
            };
            if !direction_deg.is_finite() {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierExtremePoint direction must be a finite number.",
                );
                return;
            }
            let direction_rad = degrees_to_radians(normalize_degrees_360(direction_deg));
            let direction = Point {
                x: direction_rad.cos(),
                y: direction_rad.sin(),
            };
            let Some(point) = bezier_extreme_point_at(&segments[segment_index as usize], direction)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            };
            Some(json!({ "kind": "point", "x": point.x, "y": point.y }))
        }
        GeometryValueConstruction::BezierBulgePoint {
            source,
            segment_index,
        } => {
            if entry.declared_interface_type != "point" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(geometry) = target_geometry(source, state) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            };
            if geometry.get("kind").and_then(Value::as_str) != Some("bezierCurve") {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            }
            let Some(segments) = geometry.get("segments").and_then(Value::as_array) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Bezier feature-point construction requires a computed Bezier curve source.",
                );
                return;
            };
            let Some(segment_index) =
                number_expression(segment_index, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierBulgePoint segmentIndex must be a finite number.",
                );
                return;
            };
            if !segment_index.is_finite() {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierBulgePoint segmentIndex must be a finite number.",
                );
                return;
            }
            if segment_index.fract() != 0.0 || segment_index < 0.0 {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierBulgePoint segmentIndex must be a non-negative integer.",
                );
                return;
            }
            if segment_index >= segments.len() as f64 {
                append_geometry_value_error(
                    state,
                    entry,
                    &format!(
                        "bezierBulgePoint segmentIndex {} is outside the source Bezier segment range ({} segments).",
                        segment_index,
                        segments.len()
                    ),
                );
                return;
            }
            let Some(point) = bezier_bulge_point_at(&segments[segment_index as usize]) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "bezierBulgePoint selected segment has coincident endpoints, so its bulge chord is undefined.",
                );
                return;
            };
            Some(json!({ "kind": "point", "x": point.x, "y": point.y }))
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
        GeometryValueConstruction::PolarLine {
            start,
            angle_deg,
            length,
        } => {
            if entry.declared_interface_type != "line" && entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            evaluate_point(start, resolver, state, source_order)
                .zip(number_expression(angle_deg, resolver, state, source_order))
                .zip(number_expression(length, resolver, state, source_order))
                .map(|(((x, y), angle_deg), length)| {
                    let structural =
                        polar_line_geometry_kernel(StructuralPoint { x, y }, angle_deg, length);
                    json!({
                        "kind": "line",
                        "start": { "x": structural.start.x, "y": structural.start.y },
                        "end": { "x": structural.end.x, "y": structural.end.y },
                        "length": structural.length,
                        "startAngleDeg": structural.start_angle_deg,
                        "endAngleDeg": structural.end_angle_deg,
                        "startTangentAngleDeg": structural.start_tangent_angle_deg,
                        "endTangentAngleDeg": structural.end_tangent_angle_deg
                    })
                })
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
        GeometryValueConstruction::JoinedPath { paths, closed } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(closed) = boolean_expression(closed, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Join geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            let Some(geometries) = paths
                .iter()
                .map(|path| target_geometry(path, state).cloned())
                .collect::<Option<Vec<_>>>()
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "Join geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            let value = match joined_path_json(&geometries, closed) {
                Ok(value) => value,
                Err(error) => {
                    append_geometry_value_error(state, entry, &error);
                    return;
                }
            };
            Some(value)
        }
        GeometryValueConstruction::TransformCopy {
            start_point,
            end_point,
            scale,
            angle_deg,
            mirror_x,
            base_lines,
        } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(start_point) = evaluate_point(start_point, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            let Some(end_point) = evaluate_point(end_point, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction inputs are unavailable or invalid.",
                );
                return;
            };
            let Some(scale) = number_expression(scale, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction scale must be a finite positive number.",
                );
                return;
            };
            if !scale.is_finite() || scale <= 0.0 {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction scale must be a finite positive number.",
                );
                return;
            }
            let Some(angle_deg) = number_expression(angle_deg, resolver, state, source_order)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction angleDeg must be a finite number.",
                );
                return;
            };
            let Some(mirror_x) = boolean_expression(mirror_x, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction mirrorX must be boolean.",
                );
                return;
            };
            let source_segments = match copy_source_segments(base_lines, state) {
                Ok(segments) => segments,
                Err(reason) => {
                    let message = if reason.contains("continuous") {
                        "transformCopy geometry value construction baseLines are not continuous in the specified order."
                    } else {
                        "transformCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
                    };
                    append_geometry_value_error(state, entry, message);
                    return;
                }
            };
            let transform = LineTransform::move_between(
                super::offset_types::OffsetPoint {
                    x: start_point.0,
                    y: start_point.1,
                },
                super::offset_types::OffsetPoint {
                    x: end_point.0,
                    y: end_point.1,
                },
                angle_deg,
                mirror_x,
                scale,
            );
            let Some(value) = copied_offset_line_geometry_value(&source_segments, &transform)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "transformCopy geometry value construction produced no transformed segments.",
                );
                return;
            };
            Some(value)
        }
        GeometryValueConstruction::MirrorCopy {
            axis1,
            axis2,
            base_lines,
        } => {
            if entry.declared_interface_type != "path" {
                append_geometry_value_error(
                    state,
                    entry,
                    "Geometry value construction is incompatible with its declared interface type.",
                );
                return;
            }
            let Some(axis1) = evaluate_point(axis1, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "mirrorCopy geometry value construction axis points are unavailable or invalid.",
                );
                return;
            };
            let Some(axis2) = evaluate_point(axis2, resolver, state, source_order) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "mirrorCopy geometry value construction axis points are unavailable or invalid.",
                );
                return;
            };
            let axis1 = super::offset_types::OffsetPoint {
                x: axis1.0,
                y: axis1.1,
            };
            let axis2 = super::offset_types::OffsetPoint {
                x: axis2.0,
                y: axis2.1,
            };
            if line_length(axis1, axis2) <= EPSILON {
                append_geometry_value_error(
                    state,
                    entry,
                    "mirrorCopy geometry value construction requires two distinct axis points.",
                );
                return;
            }
            let source_segments = match copy_source_segments(base_lines, state) {
                Ok(segments) => segments,
                Err(reason) => {
                    let message = if reason.contains("continuous") {
                        "mirrorCopy geometry value construction baseLines are not continuous in the specified order."
                    } else {
                        "mirrorCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
                    };
                    append_geometry_value_error(state, entry, message);
                    return;
                }
            };
            let Some(transform) = LineTransform::reflect(axis1, axis2) else {
                append_geometry_value_error(
                    state,
                    entry,
                    "mirrorCopy geometry value construction requires two distinct axis points.",
                );
                return;
            };
            let Some(value) = copied_offset_line_geometry_value(&source_segments, &transform)
            else {
                append_geometry_value_error(
                    state,
                    entry,
                    "mirrorCopy geometry value construction produced no transformed segments.",
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
        _ => None,
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
