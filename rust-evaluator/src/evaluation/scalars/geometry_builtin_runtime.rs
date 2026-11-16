use super::types::{
    BuiltinArgumentType, BuiltinFunctionName, GeometryInterfaceType,
    ScalarExpressionResolvedGeometryTarget, TypedBuiltinArgument,
};
use crate::evaluation::activity::{effective_activity_by_element_id, ElementActivity};
use crate::evaluation::geometry_value_kernels::{segment_geometry_kernel, StructuralPoint};
use crate::evaluation::point_anchor::{
    point_from_geometry, point_from_value, resolve_derived_point,
};
use crate::evaluation::types::{EvaluationState, GeometryInputTarget, Point};
use serde_json::json;
use serde_json::Value;

#[derive(Debug, Clone)]
pub(crate) enum GeometryBuiltinRuntimeTarget {
    Point(Point),
    Line { start: Point, end: Point },
    GeometryValuePoint { x: f64, y: f64 },
    GeometryValueLine { start: (f64, f64), end: (f64, f64) },
    GeometryValuePath { value: Value },
}

pub(crate) fn geometry_builtin_runtime_target_value(
    target: &GeometryBuiltinRuntimeTarget,
) -> Value {
    match target {
        GeometryBuiltinRuntimeTarget::Point(point) => json!({
            "kind": "point",
            "elementId": point.element_id,
            "name": point.name,
            "x": point.x,
            "y": point.y
        }),
        GeometryBuiltinRuntimeTarget::GeometryValuePoint { x, y } => {
            json!({ "kind": "point", "x": x, "y": y })
        }
        GeometryBuiltinRuntimeTarget::Line { start, end } => {
            line_target_value((start.x, start.y), (end.x, end.y))
        }
        GeometryBuiltinRuntimeTarget::GeometryValueLine { start, end } => {
            line_target_value(*start, *end)
        }
        GeometryBuiltinRuntimeTarget::GeometryValuePath { value } => value.clone(),
    }
}

fn line_target_value(start: (f64, f64), end: (f64, f64)) -> Value {
    let line = segment_geometry_kernel(
        StructuralPoint {
            x: start.0,
            y: start.1,
        },
        StructuralPoint { x: end.0, y: end.1 },
    );
    json!({
        "kind": "line", "start": { "x": start.0, "y": start.1 },
        "end": { "x": end.0, "y": end.1 }, "length": line.length,
        "startAngleDeg": line.start_angle_deg, "endAngleDeg": line.end_angle_deg,
        "startTangentAngleDeg": line.start_tangent_angle_deg,
        "endTangentAngleDeg": line.end_tangent_angle_deg
    })
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
            (Self::GeometryValuePath { value: left }, Self::GeometryValuePath { value: right }) => {
                left == right
            }
            _ => false,
        }
    }
}

/// Selected lowered occurrence, retained until the mutable evaluation owner services it.
#[derive(Debug, Clone)]
pub(crate) struct GeometryMaterializationDemand {
    pub(crate) target: std::sync::Arc<GeometryInputTarget>,
    pub(crate) source_order: f64,
}
impl GeometryMaterializationDemand {
    pub(crate) fn occurrence(&self) -> &crate::evaluation::types::GeometryValueOccurrence {
        let GeometryInputTarget::GeometryValueMap { occurrence, .. } = self.target.as_ref() else {
            unreachable!("only mapped geometry can demand materialization")
        };
        occurrence
    }
}
impl PartialEq for GeometryMaterializationDemand {
    fn eq(&self, other: &Self) -> bool {
        self.occurrence() == other.occurrence() && self.source_order == other.source_order
    }
}

#[derive(Default)]
pub(crate) struct GeometryMaterializationRequests {
    pending: std::cell::RefCell<Option<GeometryMaterializationDemand>>,
    attempted: std::cell::RefCell<
        std::collections::HashSet<crate::evaluation::types::GeometryValueOccurrence>,
    >,
}
impl GeometryMaterializationRequests {
    pub(crate) fn request(&self, demand: GeometryMaterializationDemand) {
        if !self.attempted.borrow().contains(demand.occurrence()) && self.pending.borrow().is_none()
        {
            *self.pending.borrow_mut() = Some(demand);
        }
    }
    pub(crate) fn refresh_frame_occurrence(
        &self,
        occurrence: &crate::evaluation::types::GeometryValueOccurrence,
    ) {
        self.attempted.borrow_mut().remove(occurrence);
    }
    pub(crate) fn is_pending(&self) -> bool {
        self.pending.borrow().is_some()
    }
    pub(crate) fn take(&self) -> Option<GeometryMaterializationDemand> {
        let demand = self.pending.borrow_mut().take()?;
        self.attempted
            .borrow_mut()
            .insert(demand.occurrence().clone());
        Some(demand)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum GeometryBuiltinRuntimeError {
    MaterializationDemand(GeometryMaterializationDemand),
    Unavailable,
    InvalidArgument,
    CollectionIndexInvalid,
    CollectionIndexUnavailable,
    EvaluationIssue(String),
    Disabled(Box<ScalarExpressionResolvedGeometryTarget>),
    ZeroLengthLine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GeometryBuiltinTargetResolutionMode {
    StrictBuiltinArgument,
    ImmutableCarryValue,
}

pub(crate) fn selected_geometry<'a>(
    state: &'a EvaluationState,
    element_id: &str,
    stage_path: Option<&[String]>,
) -> Option<&'a Value> {
    match stage_path {
        None => state.computed_geometry.get(element_id),
        Some(path) if path.is_empty() || (path.len() == 1 && path[0] == "final") => {
            state.computed_geometry.get(element_id)
        }
        Some(path) if path.len() == 1 && path[0] == "base" => {
            state.base_transformation_geometry.get(element_id)
        }
        Some(path) => state.transformation_stage_geometry.get(&format!(
            "{}\u{0}*\u{0}{}",
            element_id,
            path.join(".")
        )),
    }
}

pub(crate) fn resolve_geometry_builtin_target(
    state: &EvaluationState,
    _current_source_order: f64,
    target: &ScalarExpressionResolvedGeometryTarget,
) -> Result<GeometryBuiltinRuntimeTarget, GeometryBuiltinRuntimeError> {
    resolve_geometry_builtin_target_with_mode(
        state,
        _current_source_order,
        target,
        GeometryBuiltinTargetResolutionMode::StrictBuiltinArgument,
    )
}

pub(crate) fn resolve_geometry_carry_target(
    state: &EvaluationState,
    current_source_order: f64,
    target: &ScalarExpressionResolvedGeometryTarget,
) -> Result<GeometryBuiltinRuntimeTarget, GeometryBuiltinRuntimeError> {
    resolve_geometry_builtin_target_with_mode(
        state,
        current_source_order,
        target,
        GeometryBuiltinTargetResolutionMode::ImmutableCarryValue,
    )
}

pub(crate) fn resolve_geometry_builtin_target_with_mode(
    state: &EvaluationState,
    _current_source_order: f64,
    target: &ScalarExpressionResolvedGeometryTarget,
    mode: GeometryBuiltinTargetResolutionMode,
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
        return resolve_geometry_builtin_target_with_mode(
            state,
            _current_source_order,
            &bound,
            mode,
        );
    }
    if target.statement_id.is_empty() {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    }
    if let Some(occurrence) = &target.geometry_value_occurrence {
        let Some(geometry) = state.computed_geometry_values.get(occurrence) else {
            return Err(GeometryBuiltinRuntimeError::Unavailable);
        };
        if let Some(point_key) = target.point_key.as_deref() {
            return resolve_derived_point(geometry, point_key, state)
                .map(|point| GeometryBuiltinRuntimeTarget::GeometryValuePoint {
                    x: point.x,
                    y: point.y,
                })
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
                if mode == GeometryBuiltinTargetResolutionMode::StrictBuiltinArgument
                    && (end.0 - start.0).hypot(end.1 - start.1) <= 1e-9
                {
                    return Err(GeometryBuiltinRuntimeError::ZeroLengthLine);
                }
                Ok(GeometryBuiltinRuntimeTarget::GeometryValueLine { start, end })
            }
            GeometryInterfaceType::Path => Ok(GeometryBuiltinRuntimeTarget::GeometryValuePath {
                value: geometry.clone(),
            }),
        };
    }
    if !state.elements_by_id.contains_key(&target.statement_id) {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    }
    let activities =
        effective_activity_by_element_id(&state.elements, Some(&state.drawing_modifiers));
    if activities
        .get(&target.statement_id)
        .is_some_and(|activity| activity.activity == ElementActivity::Disabled)
    {
        return Err(GeometryBuiltinRuntimeError::Disabled(Box::new(
            target.clone(),
        )));
    }
    let Some(geometry) =
        selected_geometry(state, &target.statement_id, target.stage_path.as_deref())
    else {
        return Err(GeometryBuiltinRuntimeError::Unavailable);
    };

    if let Some(point_key) = target.point_key.as_deref() {
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
            if mode == GeometryBuiltinTargetResolutionMode::StrictBuiltinArgument && length <= 1e-9
            {
                return Err(GeometryBuiltinRuntimeError::ZeroLengthLine);
            }
            Ok(GeometryBuiltinRuntimeTarget::Line { start, end })
        }
        GeometryInterfaceType::Path => Ok(GeometryBuiltinRuntimeTarget::GeometryValuePath {
            value: geometry.clone(),
        }),
    }
}

#[cfg(test)]
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
    validate_geometry_builtin_arguments_with_dynamic_targets(name, arguments, &[], lookup)
}

pub(crate) fn validate_geometry_builtin_arguments_with_dynamic_targets<F>(
    name: BuiltinFunctionName,
    arguments: &[TypedBuiltinArgument],
    dynamic_endpoint_targets: &[Option<GeometryBuiltinRuntimeTarget>],
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
    for (argument_index, (expected, argument)) in signature.iter().zip(arguments).enumerate() {
        let runtime_target = match (expected, argument) {
            (
                BuiltinArgumentType::Geometry(expected_geometry_type),
                TypedBuiltinArgument::GeometryReference {
                    expected_geometry_type: argument_expected_geometry_type,
                    target: Some(target),
                },
            ) => {
                if argument_expected_geometry_type != expected_geometry_type
                    || (target.geometry_type != *expected_geometry_type
                        && !(*expected_geometry_type == GeometryInterfaceType::Path
                            && target.geometry_type == GeometryInterfaceType::Line))
                {
                    return Err(GeometryBuiltinRuntimeError::Unavailable);
                }
                let mut lookup_target = target.clone();
                if *expected_geometry_type == GeometryInterfaceType::Path {
                    lookup_target.geometry_type = GeometryInterfaceType::Path;
                }
                let runtime_target = lookup(&lookup_target)?;
                match (expected_geometry_type, &runtime_target) {
                    (
                        GeometryInterfaceType::Point,
                        GeometryBuiltinRuntimeTarget::Point(_)
                        | GeometryBuiltinRuntimeTarget::GeometryValuePoint { .. },
                    ) => {}
                    (
                        GeometryInterfaceType::Line,
                        GeometryBuiltinRuntimeTarget::Line { start, end },
                    ) => {
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
                    (
                        GeometryInterfaceType::Path,
                        GeometryBuiltinRuntimeTarget::GeometryValuePath { .. }
                        | GeometryBuiltinRuntimeTarget::Line { .. }
                        | GeometryBuiltinRuntimeTarget::GeometryValueLine { .. },
                    ) => {}
                    _ => return Err(GeometryBuiltinRuntimeError::Unavailable),
                }
                runtime_target
            }
            (
                BuiltinArgumentType::GeometryEndpoint,
                TypedBuiltinArgument::GeometryEndpoint {
                    target: Some(target),
                    ..
                },
            ) => {
                if target.geometry_type != GeometryInterfaceType::Path || target.point_key.is_some()
                {
                    return Err(GeometryBuiltinRuntimeError::Unavailable);
                }
                match lookup(target)? {
                    GeometryBuiltinRuntimeTarget::GeometryValuePath { value } => {
                        GeometryBuiltinRuntimeTarget::GeometryValuePath { value }
                    }
                    _ => return Err(GeometryBuiltinRuntimeError::Unavailable),
                }
            }
            (
                expected,
                TypedBuiltinArgument::GeometryCollectionArgument {
                    expected_geometry_type,
                    endpoint_key,
                    ..
                },
            ) => {
                match (expected, endpoint_key) {
                    (BuiltinArgumentType::Geometry(t), None) if t == expected_geometry_type => {}
                    (BuiltinArgumentType::GeometryEndpoint, Some(_))
                        if *expected_geometry_type == GeometryInterfaceType::Path => {}
                    _ => return Err(GeometryBuiltinRuntimeError::InvalidArgument),
                }
                let value = dynamic_endpoint_targets
                    .get(argument_index)
                    .and_then(Option::as_ref)
                    .ok_or(GeometryBuiltinRuntimeError::CollectionIndexUnavailable)?
                    .clone();
                match (expected_geometry_type, &value) {
                    (
                        GeometryInterfaceType::Point,
                        GeometryBuiltinRuntimeTarget::Point(_)
                        | GeometryBuiltinRuntimeTarget::GeometryValuePoint { .. },
                    ) => {}
                    (
                        GeometryInterfaceType::Path,
                        GeometryBuiltinRuntimeTarget::GeometryValuePath { .. }
                        | GeometryBuiltinRuntimeTarget::Line { .. }
                        | GeometryBuiltinRuntimeTarget::GeometryValueLine { .. },
                    ) => {}
                    (
                        GeometryInterfaceType::Line,
                        GeometryBuiltinRuntimeTarget::Line { start, end },
                    ) if (end.x - start.x).hypot(end.y - start.y) > 1e-9 => {}
                    (
                        GeometryInterfaceType::Line,
                        GeometryBuiltinRuntimeTarget::GeometryValueLine { start, end },
                    ) if (end.0 - start.0).hypot(end.1 - start.1) > 1e-9 => {}
                    (GeometryInterfaceType::Line, _) => {
                        return Err(GeometryBuiltinRuntimeError::ZeroLengthLine)
                    }
                    _ => return Err(GeometryBuiltinRuntimeError::Unavailable),
                }
                value
            }
            _ => return Err(GeometryBuiltinRuntimeError::InvalidArgument),
        };
        runtime_targets.push(runtime_target);
    }
    Ok(runtime_targets)
}
