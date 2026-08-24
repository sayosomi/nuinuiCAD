use serde_json::{json, Value};

use super::bezier_path::approximate_segment_length;
use super::math::arc_tangent_angles;
use super::offset_types::{
    angle_of_point, line_length, normalize_degrees, offset_line_endpoint_measurements, value_point,
    OffsetPoint, OffsetSegment, EPSILON,
};

pub(crate) enum LineTransform {
    Move {
        translation: OffsetPoint,
        mirror_x: bool,
        center: OffsetPoint,
        scale: f64,
        cos: f64,
        sin: f64,
    },
    Reflect {
        axis_point1: OffsetPoint,
        axis_point2: OffsetPoint,
    },
}

impl LineTransform {
    pub(crate) fn move_between(
        start_point: OffsetPoint,
        end_point: OffsetPoint,
        angle_deg: f64,
        mirror_x: bool,
        scale: f64,
    ) -> Self {
        let angle_rad = angle_deg.to_radians();
        Self::Move {
            translation: OffsetPoint {
                x: end_point.x - start_point.x,
                y: end_point.y - start_point.y,
            },
            mirror_x,
            center: end_point,
            scale,
            cos: angle_rad.cos(),
            sin: angle_rad.sin(),
        }
    }

    pub(crate) fn reflect(axis_point1: OffsetPoint, axis_point2: OffsetPoint) -> Option<Self> {
        (line_length(axis_point1, axis_point2) > EPSILON).then_some(Self::Reflect {
            axis_point1,
            axis_point2,
        })
    }

    pub(crate) fn reverse_orientation(&self) -> bool {
        match self {
            Self::Move { mirror_x, .. } => *mirror_x,
            Self::Reflect { .. } => true,
        }
    }

    pub(crate) fn apply(&self, point: OffsetPoint) -> Option<OffsetPoint> {
        match self {
            Self::Move {
                translation,
                mirror_x,
                center,
                scale,
                cos,
                sin,
            } => {
                let moved = OffsetPoint {
                    x: point.x + translation.x,
                    y: point.y + translation.y,
                };
                let mirrored = if *mirror_x {
                    OffsetPoint {
                        x: 2.0 * center.x - moved.x,
                        y: moved.y,
                    }
                } else {
                    moved
                };
                let dx = mirrored.x - center.x;
                let dy = mirrored.y - center.y;
                let scaled_dx = dx * scale;
                let scaled_dy = dy * scale;
                Some(OffsetPoint {
                    x: center.x + scaled_dx * cos - scaled_dy * sin,
                    y: center.y + scaled_dx * sin + scaled_dy * cos,
                })
            }
            Self::Reflect {
                axis_point1,
                axis_point2,
            } => {
                let axis = OffsetPoint {
                    x: axis_point2.x - axis_point1.x,
                    y: axis_point2.y - axis_point1.y,
                };
                let axis_length_squared = axis.x * axis.x + axis.y * axis.y;
                if axis_length_squared <= EPSILON {
                    return None;
                }
                let relative = OffsetPoint {
                    x: point.x - axis_point1.x,
                    y: point.y - axis_point1.y,
                };
                let projection_scale =
                    (relative.x * axis.x + relative.y * axis.y) / axis_length_squared;
                let projection = OffsetPoint {
                    x: axis.x * projection_scale,
                    y: axis.y * projection_scale,
                };
                Some(OffsetPoint {
                    x: axis_point1.x + 2.0 * projection.x - relative.x,
                    y: axis_point1.y + 2.0 * projection.y - relative.y,
                })
            }
        }
    }
}

fn transform_point_value(point: &Value, transform: &LineTransform) -> Option<Value> {
    let transformed = transform.apply(value_point(point)?)?;
    let mut next = point.clone();
    next["x"] = json!(transformed.x);
    next["y"] = json!(transformed.y);
    Some(next)
}

fn angle_from_to(start: OffsetPoint, end: OffsetPoint) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    (length > EPSILON).then(|| normalize_degrees(dy.atan2(dx).to_degrees()))
}

fn point_angle_deg(start: OffsetPoint, end: OffsetPoint) -> f64 {
    angle_from_to(start, end).unwrap_or(0.0)
}

fn transform_line_geometry(line: &Value, transform: &LineTransform) -> Option<Value> {
    let start = transform_point_value(line.get("start")?, transform)?;
    let end = transform_point_value(line.get("end")?, transform)?;
    let start_point = value_point(&start)?;
    let end_point = value_point(&end)?;
    let length = line_length(start_point, end_point);
    if length <= EPSILON {
        return None;
    }
    let start_angle = angle_from_to(start_point, end_point)?;
    let end_angle = angle_from_to(end_point, start_point)?;
    let mut next = line.clone();
    next["start"] = start;
    next["end"] = end;
    next["length"] = json!(length);
    next["startAngleDeg"] = json!(start_angle);
    next["endAngleDeg"] = json!(end_angle);
    next["startTangentAngleDeg"] = json!(start_angle);
    next["endTangentAngleDeg"] = json!(end_angle);
    Some(next)
}

fn transform_arc_geometry(arc: &Value, transform: &LineTransform) -> Option<Value> {
    let center = transform_point_value(arc.get("center")?, transform)?;
    let start = transform_point_value(arc.get("start")?, transform)?;
    let end = transform_point_value(arc.get("end")?, transform)?;
    let center_point = value_point(&center)?;
    let start_point = value_point(&start)?;
    let end_point = value_point(&end)?;
    let radius = line_length(center_point, start_point);
    if radius <= EPSILON {
        return None;
    }
    let start_angle_deg = angle_of_point(center_point, start_point);
    let end_angle_deg = angle_of_point(center_point, end_point);
    let source_sweep = arc.get("sweepAngleDeg").and_then(Value::as_f64)?;
    let sweep_angle_deg = if transform.reverse_orientation() {
        -source_sweep
    } else {
        source_sweep
    };
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let mut next = arc.clone();
    next["center"] = center;
    next["start"] = start;
    next["end"] = end;
    next["radius"] = json!(radius);
    next["startAngleDeg"] = json!(start_angle_deg);
    next["endAngleDeg"] = json!(end_angle_deg);
    next["startTangentAngleDeg"] = json!(start_tangent_angle_deg);
    next["endTangentAngleDeg"] = json!(end_tangent_angle_deg);
    next["sweepAngleDeg"] = json!(sweep_angle_deg);
    next["length"] = json!(radius * sweep_angle_deg.to_radians().abs());
    Some(next)
}

fn transform_bezier_geometry(curve: &Value, transform: &LineTransform) -> Option<Value> {
    let source_segments = curve.get("segments")?.as_array()?;
    let segments = source_segments
        .iter()
        .map(|segment| {
            let mut next = segment.clone();
            next["start"] = transform_point_value(segment.get("start")?, transform)?;
            next["control1"] = transform
                .apply(value_point(segment.get("control1")?)?)
                .map(|point| {
                    json!({
                        "x": point.x,
                        "y": point.y
                    })
                })?;
            next["control2"] = transform
                .apply(value_point(segment.get("control2")?)?)
                .map(|point| {
                    json!({
                        "x": point.x,
                        "y": point.y
                    })
                })?;
            next["end"] = transform_point_value(segment.get("end")?, transform)?;
            Some(next)
        })
        .collect::<Option<Vec<_>>>()?;
    if segments.len() != source_segments.len() || segments.is_empty() {
        return None;
    }
    let length = segments
        .iter()
        .filter_map(|segment| approximate_segment_length(segment, 32))
        .sum::<f64>();
    if length <= EPSILON {
        return None;
    }
    let first = segments.first()?;
    let last = segments.last()?;
    let first_start = value_point(first.get("start")?)?;
    let first_control1 = value_point(first.get("control1")?)?;
    let last_end = value_point(last.get("end")?)?;
    let last_control2 = value_point(last.get("control2")?)?;
    let start_angle = point_angle_deg(first_start, first_control1);
    let end_angle = point_angle_deg(last_end, last_control2);
    let mut next = curve.clone();
    next["segments"] = json!(segments);
    next["length"] = json!(length);
    next["startHandleAngleDeg"] = json!(start_angle);
    next["startHandleLength"] = json!(line_length(first_start, first_control1));
    next["endHandleAngleDeg"] = json!(normalize_degrees(end_angle - 180.0));
    next["endHandleLength"] = json!(line_length(last_end, last_control2));
    next["startTangentAngleDeg"] = json!(start_angle);
    next["endTangentAngleDeg"] = json!(end_angle);
    Some(next)
}

fn transform_offset_segment(
    segment: &Value,
    transform: &LineTransform,
) -> Option<(Value, OffsetSegment)> {
    match segment.get("kind")?.as_str()? {
        "line" => {
            let start = transform_point_value(segment.get("start")?, transform)?;
            let end = transform_point_value(segment.get("end")?, transform)?;
            let start_point = value_point(&start)?;
            let end_point = value_point(&end)?;
            let length = line_length(start_point, end_point);
            if length <= EPSILON {
                return None;
            }
            let mut next = segment.clone();
            next["start"] = start;
            next["end"] = end;
            next["length"] = json!(length);
            Some((
                next,
                OffsetSegment::Line {
                    start: start_point,
                    end: end_point,
                    length,
                },
            ))
        }
        "bezier" => {
            let start = transform_point_value(segment.get("start")?, transform)?;
            let end = transform_point_value(segment.get("end")?, transform)?;
            let control1 = transform.apply(value_point(segment.get("control1")?)?)?;
            let control2 = transform.apply(value_point(segment.get("control2")?)?)?;
            let mut next = segment.clone();
            next["start"] = start;
            next["control1"] = json!({ "x": control1.x, "y": control1.y });
            next["control2"] = json!({ "x": control2.x, "y": control2.y });
            next["end"] = end;
            let length = approximate_segment_length(&next, 32)?;
            if length <= EPSILON {
                return None;
            }
            next["length"] = json!(length);
            let start_point = value_point(next.get("start")?)?;
            let end_point = value_point(next.get("end")?)?;
            Some((
                next,
                OffsetSegment::Bezier {
                    start: start_point,
                    control1,
                    control2,
                    end: end_point,
                    length,
                },
            ))
        }
        "arc" => {
            let center = transform_point_value(segment.get("center")?, transform)?;
            let start = transform_point_value(segment.get("start")?, transform)?;
            let end = transform_point_value(segment.get("end")?, transform)?;
            let center_point = value_point(&center)?;
            let start_point = value_point(&start)?;
            let end_point = value_point(&end)?;
            let radius = line_length(center_point, start_point);
            if radius <= EPSILON {
                return None;
            }
            let start_angle_deg = angle_of_point(center_point, start_point);
            let source_sweep = segment.get("sweepAngleDeg")?.as_f64()?;
            let sweep_angle_deg = if transform.reverse_orientation() {
                -source_sweep
            } else {
                source_sweep
            };
            let length = radius * sweep_angle_deg.to_radians().abs();
            let mut next = segment.clone();
            next["center"] = center;
            next["start"] = start;
            next["end"] = end;
            next["radius"] = json!(radius);
            next["startAngleDeg"] = json!(start_angle_deg);
            next["sweepAngleDeg"] = json!(sweep_angle_deg);
            next["length"] = json!(length);
            Some((
                next,
                OffsetSegment::Arc {
                    center: center_point,
                    start: start_point,
                    end: end_point,
                    radius,
                    start_angle_deg,
                    sweep_angle_deg,
                    length,
                },
            ))
        }
        _ => None,
    }
}

fn transform_offset_geometry(line: &Value, transform: &LineTransform) -> Option<Value> {
    let source_segments = line.get("segments")?.as_array()?;
    let transformed = source_segments
        .iter()
        .map(|segment| transform_offset_segment(segment, transform))
        .collect::<Option<Vec<_>>>()?;
    if transformed.len() != source_segments.len() || transformed.is_empty() {
        return None;
    }
    let (segment_values, segments): (Vec<_>, Vec<_>) = transformed.into_iter().unzip();
    let (_, _, start_tangent_angle_deg, end_tangent_angle_deg) =
        offset_line_endpoint_measurements(&segments);
    let length = segments
        .iter()
        .map(|segment| match segment {
            OffsetSegment::Line { length, .. }
            | OffsetSegment::Bezier { length, .. }
            | OffsetSegment::Arc { length, .. } => *length,
        })
        .sum::<f64>();
    let mut next = line.clone();
    next["segments"] = json!(segment_values);
    next["start"] = next
        .get("segments")
        .and_then(Value::as_array)?
        .first()?
        .get("start")?
        .clone();
    next["end"] = next
        .get("segments")
        .and_then(Value::as_array)?
        .last()?
        .get("end")?
        .clone();
    next["length"] = json!(length);
    next["startTangentAngleDeg"] = start_tangent_angle_deg;
    next["endTangentAngleDeg"] = end_tangent_angle_deg;
    Some(next)
}

fn transform_polyline_geometry(line: &Value, transform: &LineTransform) -> Option<Value> {
    let source_segments = line.get("segments")?.as_array()?;
    if source_segments.is_empty() {
        return None;
    }
    let segments = source_segments
        .iter()
        .map(|segment| {
            let start = transform_point_value(segment.get("start")?, transform)?;
            let end = transform_point_value(segment.get("end")?, transform)?;
            let start_point = value_point(&start)?;
            let end_point = value_point(&end)?;
            Some(json!({
                "kind": "line",
                "start": start,
                "end": end,
                "length": line_length(start_point, end_point)
            }))
        })
        .collect::<Option<Vec<_>>>()?;
    let first = segments.first()?.get("start")?.clone();
    let last = segments.last()?.get("end")?.clone();
    let first_nonzero = segments
        .iter()
        .find(|segment| segment.get("length").and_then(Value::as_f64).unwrap_or(0.0) > EPSILON);
    let last_nonzero = segments
        .iter()
        .rev()
        .find(|segment| segment.get("length").and_then(Value::as_f64).unwrap_or(0.0) > EPSILON);
    let start_tangent = first_nonzero
        .and_then(|segment| {
            Some(angle_from_to(
                value_point(segment.get("start")?)?,
                value_point(segment.get("end")?)?,
            ))
        })
        .flatten();
    let end_tangent = last_nonzero
        .and_then(|segment| {
            Some(angle_from_to(
                value_point(segment.get("end")?)?,
                value_point(segment.get("start")?)?,
            ))
        })
        .flatten();
    let length = segments
        .iter()
        .filter_map(|segment| segment.get("length").and_then(Value::as_f64))
        .sum::<f64>();
    let mut next = line.clone();
    next["segments"] = json!(segments);
    next["start"] = first.clone();
    next["end"] = if line.get("closed").and_then(Value::as_bool).unwrap_or(false) {
        first
    } else {
        last
    };
    next["length"] = json!(length);
    next["startTangentAngleDeg"] = json!(start_tangent);
    next["endTangentAngleDeg"] = json!(end_tangent);
    Some(next)
}

pub(crate) fn transform_line_like_geometry(
    geometry: &Value,
    transform: &LineTransform,
) -> Option<Value> {
    match geometry.get("kind")?.as_str()? {
        "line" => transform_line_geometry(geometry, transform),
        "arcLine" => transform_arc_geometry(geometry, transform),
        "bezierCurve" => transform_bezier_geometry(geometry, transform),
        "offsetLine" => transform_offset_geometry(geometry, transform),
        "polyline" => transform_polyline_geometry(geometry, transform),
        _ => None,
    }
}
