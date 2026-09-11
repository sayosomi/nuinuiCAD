use super::types::{
    BuiltinArgumentType, BuiltinFunctionName, GeometryInterfaceType,
    ScalarExpressionResolvedGeometryTarget, TypedBuiltinArgument,
};
use crate::evaluation::activity::{effective_activity_by_element_id_with_profile, ElementActivity};
use crate::evaluation::point_anchor::{
    point_from_geometry, point_from_value, resolve_derived_point,
};
use crate::evaluation::types::{EvaluationState, GeometryInputTarget, Point};
use serde_json::Value;

#[derive(Debug, Clone)]
pub(crate) enum GeometryBuiltinRuntimeTarget {
    Point(Point),
    Line { start: Point, end: Point },
    GeometryValuePoint { x: f64, y: f64 },
    GeometryValueLine { start: (f64, f64), end: (f64, f64) },
}

impl PartialEq for GeometryBuiltinRuntimeTarget {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Point(left), Self::Point(right)) => {
                left.element_id == right.element_id
                    && left.name == right.name
                    && left.x == right.x
                    && left.y == right.y
            }
            (
                Self::Line {
                    start: left_start,
                    end: left_end,
                },
                Self::Line {
                    start: right_start,
                    end: right_end,
                },
            ) => {
                left_start.element_id == right_start.element_id
                    && left_start.name == right_start.name
                    && left_start.x == right_start.x
                    && left_start.y == right_start.y
                    && left_end.element_id == right_end.element_id
                    && left_end.name == right_end.name
                    && left_end.x == right_end.x
                    && left_end.y == right_end.y
            }
            (
                Self::GeometryValuePoint {
                    x: left_x,
                    y: left_y,
                },
                Self::GeometryValuePoint {
                    x: right_x,
                    y: right_y,
                },
            ) => left_x == right_x && left_y == right_y,
            (
                Self::GeometryValueLine {
                    start: left_start,
                    end: left_end,
                },
                Self::GeometryValueLine {
                    start: right_start,
                    end: right_end,
                },
            ) => left_start == right_start && left_end == right_end,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum GeometryBuiltinRuntimeError {
    Unavailable,
    InvalidArgument,
    CollectionIndexInvalid,
    CollectionIndexUnavailable,
    EvaluationIssue(String),
    Disabled(Box<ScalarExpressionResolvedGeometryTarget>),
    ZeroLengthLine,
}

pub(crate) fn resolve_geometry_builtin_target(
    state: &EvaluationState,
    current_source_order: f64,
    target: &ScalarExpressionResolvedGeometryTarget,
) -> Result<GeometryBuiltinRuntimeTarget, GeometryBuiltinRuntimeError> {
    if let Some(binder_id) = &target.geometry_value_binder_id {
        let Some(source) = state.geometry_value_binders.get(binder_id) else {
            return Err(GeometryBuiltinRuntimeError::Unavailable);
        };
        if let GeometryInputTarget::Coordinate { anchor } = source {
            let Some((x, y)) = anchor
                .get("x")
                .and_then(Value::as_f64)
                .zip(anchor.get("y").and_then(Value::as_f64))
            else {
                return Err(GeometryBuiltinRuntimeError::Unavailable);
            };
            return if target.geometry_type == GeometryInterfaceType::Point {
                Ok(GeometryBuiltinRuntimeTarget::GeometryValuePoint { x, y })
            } else {
                Err(GeometryBuiltinRuntimeError::Unavailable)
            };
        }
        let mut bound = target.clone();
        bound.geometry_value_binder_id = None;
        match source {
            GeometryInputTarget::Drawable { element_id, .. } => {
                bound.statement_id = element_id.clone();
                bound.statement_index = -1.0;
                bound.geometry_value_occurrence = None;
            }
            GeometryInputTarget::GeometryValue { occurrence, .. } => {
                bound.statement_id = occurrence.source_statement_id.clone();
                bound.statement_index = -1.0;
                bound.geometry_value_occurrence = Some(occurrence.clone());
            }
            GeometryInputTarget::GeometryValueMap { .. }
            | GeometryInputTarget::CollectionValue { .. }
            | GeometryInputTarget::CollectionIndex { .. }
            | GeometryInputTarget::ForGroupOccurrence { .. } => {
                return Err(GeometryBuiltinRuntimeError::Unavailable)
            }
            GeometryInputTarget::Coordinate { .. } => unreachable!(),
        }
        return resolve_geometry_builtin_target(state, current_source_order, &bound);
    }
    if target.statement_id.is_empty() {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    }
    if let Some(occurrence) = &target.geometry_value_occurrence {
        let Some(geometry) = state.computed_geometry_values.get(occurrence) else {
            return Err(GeometryBuiltinRuntimeError::Unavailable);
        };
        if let Some(point_key) = target.point_key.as_deref() {
            let point = match point_key {
                "start" => geometry.get("start").and_then(|value| {
                    value
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(value.get("y").and_then(Value::as_f64))
                }),
                "end" => geometry.get("end").and_then(|value| {
                    value
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(value.get("y").and_then(Value::as_f64))
                }),
                _ => None,
            };
            return point
                .map(|(x, y)| GeometryBuiltinRuntimeTarget::GeometryValuePoint { x, y })
                .ok_or(GeometryBuiltinRuntimeError::Unavailable);
        }
        return match target.geometry_type {
            GeometryInterfaceType::Point => geometry
                .get("x")
                .and_then(Value::as_f64)
                .zip(geometry.get("y").and_then(Value::as_f64))
                .map(|(x, y)| GeometryBuiltinRuntimeTarget::GeometryValuePoint { x, y })
                .ok_or(GeometryBuiltinRuntimeError::Unavailable),
            GeometryInterfaceType::Line => {
                let start = geometry.get("start").and_then(|value| {
                    value
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(value.get("y").and_then(Value::as_f64))
                });
                let end = geometry.get("end").and_then(|value| {
                    value
                        .get("x")
                        .and_then(Value::as_f64)
                        .zip(value.get("y").and_then(Value::as_f64))
                });
                let (Some(start), Some(end)) = (start, end) else {
                    return Err(GeometryBuiltinRuntimeError::Unavailable);
                };
                if (end.0 - start.0).hypot(end.1 - start.1) <= 1e-9 {
                    return Err(GeometryBuiltinRuntimeError::ZeroLengthLine);
                }
                Ok(GeometryBuiltinRuntimeTarget::GeometryValueLine { start, end })
            }
            GeometryInterfaceType::Path => Err(GeometryBuiltinRuntimeError::Unavailable),
        };
    }
    if target.statement_index >= current_source_order {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    }
    if !state.elements_by_id.contains_key(&target.statement_id) {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    }
    let activities = effective_activity_by_element_id_with_profile(
        &state.elements,
        Some(&state.drawing_modifiers),
        state.selected_drawing_profile_id.as_deref(),
    );
    if activities
        .get(&target.statement_id)
        .is_some_and(|activity| activity.activity == ElementActivity::Disabled)
    {
        return Err(GeometryBuiltinRuntimeError::Disabled(Box::new(
            target.clone(),
        )));
    }
    let Some(geometry) = state.computed_geometry.get(&target.statement_id) else {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    };

    if let Some(point_key) = target.point_key.as_deref() {
        if target.geometry_type != GeometryInterfaceType::Point {
            return Err(GeometryBuiltinRuntimeError::Unavailable);
        }
        return resolve_derived_point(geometry, point_key, state)
            .map(GeometryBuiltinRuntimeTarget::Point)
            .ok_or(GeometryBuiltinRuntimeError::Unavailable);
    }

    match target.geometry_type {
        GeometryInterfaceType::Point => {
            if geometry.get("kind").and_then(Value::as_str) != Some("point") {
                return Err(GeometryBuiltinRuntimeError::Unavailable);
            }
            point_from_geometry(geometry)
                .map(GeometryBuiltinRuntimeTarget::Point)
                .ok_or(GeometryBuiltinRuntimeError::Unavailable)
        }
        GeometryInterfaceType::Line => {
            if geometry.get("kind").and_then(Value::as_str) != Some("line") {
                return Err(GeometryBuiltinRuntimeError::Unavailable);
            }
            let start = geometry
                .get("start")
                .and_then(point_from_value)
                .ok_or(GeometryBuiltinRuntimeError::Unavailable)?;
            let end = geometry
                .get("end")
                .and_then(point_from_value)
                .ok_or(GeometryBuiltinRuntimeError::Unavailable)?;
            let dx = end.x - start.x;
            let dy = end.y - start.y;
            let length = dx.hypot(dy);
            if length <= 1e-9 {
                return Err(GeometryBuiltinRuntimeError::ZeroLengthLine);
            }
            Ok(GeometryBuiltinRuntimeTarget::Line { start, end })
        }
        GeometryInterfaceType::Path => Err(GeometryBuiltinRuntimeError::Unavailable),
    }
}

pub(crate) fn validate_geometry_builtin_arguments<F>(
    name: BuiltinFunctionName,
    arguments: &[TypedBuiltinArgument],
    lookup: F,
) -> Result<Vec<GeometryBuiltinRuntimeTarget>, GeometryBuiltinRuntimeError>
where
    F: Fn(
        &ScalarExpressionResolvedGeometryTarget,
    ) -> Result<GeometryBuiltinRuntimeTarget, GeometryBuiltinRuntimeError>,
{
    if !name.is_geometry() {
        return Err(GeometryBuiltinRuntimeError::InvalidArgument);
    }
    let signatures = name.argument_signatures();
    let signature = signatures
        .iter()
        .find(|signature| signature.len() == arguments.len())
        .copied()
        .ok_or(GeometryBuiltinRuntimeError::InvalidArgument)?;

    let mut runtime_targets = Vec::with_capacity(arguments.len());
    for (expected, argument) in signature.iter().zip(arguments) {
        let BuiltinArgumentType::Geometry(expected_geometry_type) = expected else {
            return Err(GeometryBuiltinRuntimeError::InvalidArgument);
        };
        let TypedBuiltinArgument::GeometryReference {
            expected_geometry_type: argument_expected_geometry_type,
            target: Some(target),
        } = argument
        else {
            return Err(GeometryBuiltinRuntimeError::InvalidArgument);
        };
        if argument_expected_geometry_type != expected_geometry_type
            || target.geometry_type != *expected_geometry_type
        {
            return Err(GeometryBuiltinRuntimeError::Unavailable);
        }
        let runtime_target = lookup(target)?;
        match (expected_geometry_type, &runtime_target) {
            (
                GeometryInterfaceType::Point,
                GeometryBuiltinRuntimeTarget::Point(_)
                | GeometryBuiltinRuntimeTarget::GeometryValuePoint { .. },
            ) => {}
            (GeometryInterfaceType::Line, GeometryBuiltinRuntimeTarget::Line { start, end }) => {
                let dx = end.x - start.x;
                let dy = end.y - start.y;
                if dx.hypot(dy) <= 1e-9 {
                    return Err(GeometryBuiltinRuntimeError::ZeroLengthLine);
                }
            }
            (
                GeometryInterfaceType::Line,
                GeometryBuiltinRuntimeTarget::GeometryValueLine { start, end },
            ) => {
                if (end.0 - start.0).hypot(end.1 - start.1) <= 1e-9 {
                    return Err(GeometryBuiltinRuntimeError::ZeroLengthLine);
                }
            }
            _ => return Err(GeometryBuiltinRuntimeError::Unavailable),
        }
        runtime_targets.push(runtime_target);
    }
    Ok(runtime_targets)
}
