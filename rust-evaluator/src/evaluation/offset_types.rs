use serde_json::{json, Value};

pub(crate) const EPSILON: f64 = 1e-9;

#[derive(Clone, Copy, Debug)]
pub(crate) struct OffsetPoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[derive(Clone, Debug)]
pub(crate) enum SourceSegment {
    Line {
        start: OffsetPoint,
        end: OffsetPoint,
    },
    Bezier {
        start: OffsetPoint,
        control1: OffsetPoint,
        control2: OffsetPoint,
        end: OffsetPoint,
    },
    Arc {
        center: OffsetPoint,
        radius: f64,
        start_angle_deg: f64,
        sweep_angle_deg: f64,
    },
}

#[derive(Clone, Debug)]
pub(crate) enum OffsetSegment {
    Line {
        start: OffsetPoint,
        end: OffsetPoint,
        length: f64,
    },
    Bezier {
        start: OffsetPoint,
        control1: OffsetPoint,
        control2: OffsetPoint,
        end: OffsetPoint,
        length: f64,
    },
    Arc {
        center: OffsetPoint,
        start: OffsetPoint,
        end: OffsetPoint,
        radius: f64,
        start_angle_deg: f64,
        sweep_angle_deg: f64,
        length: f64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum JoinMode {
    Miter,
    Smooth,
    None,
}

#[derive(Clone, Debug)]
pub(crate) struct RawOffsetSegment {
    pub(crate) segment: OffsetSegment,
    pub(crate) join_with_previous: JoinMode,
    pub(crate) source: SourceSegment,
}

#[derive(Clone, Debug)]
pub(crate) struct OffsetBuildResult {
    pub(crate) geometry: Option<Value>,
    pub(crate) error: Option<String>,
    pub(crate) warnings: Vec<String>,
}

pub(crate) fn value_point(value: &Value) -> Option<OffsetPoint> {
    Some(OffsetPoint {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

pub(crate) fn computed_point(element_id: String, name: String, point: OffsetPoint) -> Value {
    json!({
        "kind": "point",
        "elementId": element_id,
        "name": name,
        "x": point.x,
        "y": point.y
    })
}

pub(crate) fn line_length(start: OffsetPoint, end: OffsetPoint) -> f64 {
    (end.x - start.x).hypot(end.y - start.y)
}

pub(crate) fn normalize_degrees(degrees: f64) -> f64 {
    let normalized = degrees.rem_euclid(360.0);
    if normalized.abs() < EPSILON || (360.0 - normalized).abs() < EPSILON {
        0.0
    } else {
        normalized
    }
}

pub(crate) fn positive_sweep_degrees(start_angle_deg: f64, end_angle_deg: f64) -> f64 {
    normalize_degrees(end_angle_deg - start_angle_deg)
}

pub(crate) fn arc_point(center: OffsetPoint, radius: f64, angle_deg: f64) -> OffsetPoint {
    let angle_rad = angle_deg.to_radians();
    OffsetPoint {
        x: center.x + angle_rad.cos() * radius,
        y: center.y + angle_rad.sin() * radius,
    }
}

pub(crate) fn angle_of_point(center: OffsetPoint, point: OffsetPoint) -> f64 {
    normalize_degrees((point.y - center.y).atan2(point.x - center.x).to_degrees())
}

pub(crate) fn segment_start(segment: &OffsetSegment) -> OffsetPoint {
    match segment {
        OffsetSegment::Line { start, .. }
        | OffsetSegment::Bezier { start, .. }
        | OffsetSegment::Arc { start, .. } => *start,
    }
}

pub(crate) fn segment_end(segment: &OffsetSegment) -> OffsetPoint {
    match segment {
        OffsetSegment::Line { end, .. }
        | OffsetSegment::Bezier { end, .. }
        | OffsetSegment::Arc { end, .. } => *end,
    }
}

fn angle_from_to(start: OffsetPoint, end: OffsetPoint) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    (length > EPSILON).then(|| normalize_degrees(dy.atan2(dx).to_degrees()))
}

fn bezier_segment_start_forward_angle(
    start: OffsetPoint,
    control1: OffsetPoint,
    control2: OffsetPoint,
    end: OffsetPoint,
) -> Option<f64> {
    angle_from_to(start, control1)
        .or_else(|| angle_from_to(start, control2))
        .or_else(|| angle_from_to(start, end))
}

fn bezier_segment_end_forward_angle(
    start: OffsetPoint,
    control1: OffsetPoint,
    control2: OffsetPoint,
    end: OffsetPoint,
) -> Option<f64> {
    angle_from_to(control2, end)
        .or_else(|| angle_from_to(control1, end))
        .or_else(|| angle_from_to(start, end))
}

fn offset_segment_start_forward_angle(segment: &OffsetSegment) -> Option<f64> {
    match segment {
        OffsetSegment::Line { start, end, .. } => angle_from_to(*start, *end),
        OffsetSegment::Bezier {
            start,
            control1,
            control2,
            end,
            ..
        } => bezier_segment_start_forward_angle(*start, *control1, *control2, *end),
        OffsetSegment::Arc {
            center,
            start,
            radius,
            sweep_angle_deg,
            ..
        } => {
            if radius.abs() <= EPSILON || sweep_angle_deg.abs() <= EPSILON {
                return None;
            }
            let radial = angle_from_to(*center, *start)?;
            Some(normalize_degrees(
                radial + if *sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 },
            ))
        }
    }
}

fn offset_segment_end_forward_angle(segment: &OffsetSegment) -> Option<f64> {
    match segment {
        OffsetSegment::Line { start, end, .. } => angle_from_to(*start, *end),
        OffsetSegment::Bezier {
            start,
            control1,
            control2,
            end,
            ..
        } => bezier_segment_end_forward_angle(*start, *control1, *control2, *end),
        OffsetSegment::Arc {
            center,
            end,
            radius,
            sweep_angle_deg,
            ..
        } => {
            if radius.abs() <= EPSILON || sweep_angle_deg.abs() <= EPSILON {
                return None;
            }
            let radial = angle_from_to(*center, *end)?;
            Some(normalize_degrees(
                radial + if *sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 },
            ))
        }
    }
}

pub(crate) fn offset_line_endpoint_measurements(
    segments: &[OffsetSegment],
) -> (Value, Value, Value, Value) {
    let start = segments.first().map(segment_start);
    let end = segments.last().map(segment_end);
    let start_tangent = segments.iter().find_map(offset_segment_start_forward_angle);
    let end_tangent = segments
        .iter()
        .rev()
        .find_map(offset_segment_end_forward_angle)
        .map(|angle| normalize_degrees(angle + 180.0));

    (
        start
            .map(|point| computed_point(String::new(), String::new(), point))
            .unwrap_or(Value::Null),
        end.map(|point| computed_point(String::new(), String::new(), point))
            .unwrap_or(Value::Null),
        start_tangent.map(Value::from).unwrap_or(Value::Null),
        end_tangent.map(Value::from).unwrap_or(Value::Null),
    )
}

/// Applies the same endpoint-measurement authority to already-serialized
/// offset segments, as used by split-line evaluation.
pub(crate) fn offset_line_endpoint_measurements_from_values(
    values: &[Value],
) -> (Value, Value, Value, Value) {
    let segments = values
        .iter()
        .filter_map(|value| {
            let length = value.get("length")?.as_f64()?;
            match value.get("kind")?.as_str()? {
                "line" => Some(OffsetSegment::Line {
                    start: value_point(value.get("start")?)?,
                    end: value_point(value.get("end")?)?,
                    length,
                }),
                "bezier" => Some(OffsetSegment::Bezier {
                    start: value_point(value.get("start")?)?,
                    control1: value_point(value.get("control1")?)?,
                    control2: value_point(value.get("control2")?)?,
                    end: value_point(value.get("end")?)?,
                    length,
                }),
                "arc" => Some(OffsetSegment::Arc {
                    center: value_point(value.get("center")?)?,
                    start: value_point(value.get("start")?)?,
                    end: value_point(value.get("end")?)?,
                    radius: value.get("radius")?.as_f64()?,
                    start_angle_deg: value.get("startAngleDeg")?.as_f64()?,
                    sweep_angle_deg: value.get("sweepAngleDeg")?.as_f64()?,
                    length,
                }),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    offset_line_endpoint_measurements(&segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f64, y: f64) -> OffsetPoint {
        OffsetPoint { x, y }
    }

    #[test]
    fn scans_past_directionless_leading_and_trailing_segments() {
        let segments = vec![
            OffsetSegment::Line {
                start: point(0.0, 0.0),
                end: point(0.0, 0.0),
                length: 0.0,
            },
            OffsetSegment::Line {
                start: point(0.0, 0.0),
                end: point(10.0, 0.0),
                length: 10.0,
            },
            OffsetSegment::Line {
                start: point(10.0, 0.0),
                end: point(10.0, 0.0),
                length: 0.0,
            },
        ];
        let (_, _, start_tangent, end_tangent) = offset_line_endpoint_measurements(&segments);
        assert_eq!(start_tangent, json!(0.0));
        assert_eq!(end_tangent, json!(180.0));
    }

    #[test]
    fn leaves_all_directionless_endpoint_directions_null() {
        let segments = vec![
            OffsetSegment::Line {
                start: point(0.0, 0.0),
                end: point(0.0, 0.0),
                length: 0.0,
            },
            OffsetSegment::Bezier {
                start: point(0.0, 0.0),
                control1: point(0.0, 0.0),
                control2: point(0.0, 0.0),
                end: point(0.0, 0.0),
                length: 0.0,
            },
            OffsetSegment::Arc {
                center: point(0.0, 0.0),
                start: point(0.0, 0.0),
                end: point(0.0, 0.0),
                radius: 0.0,
                start_angle_deg: 45.0,
                sweep_angle_deg: 0.0,
                length: 0.0,
            },
        ];
        let (_, _, start_tangent, end_tangent) = offset_line_endpoint_measurements(&segments);
        assert_eq!(start_tangent, Value::Null);
        assert_eq!(end_tangent, Value::Null);
    }

    #[test]
    fn derives_arc_direction_from_geometric_endpoints() {
        let segments = vec![OffsetSegment::Arc {
            center: point(0.0, 0.0),
            start: point(0.0, 10.0),
            end: point(10.0, 0.0),
            radius: 10.0,
            start_angle_deg: 0.0,
            sweep_angle_deg: 90.0,
            length: 10.0,
        }];
        let (_, _, start_tangent, end_tangent) = offset_line_endpoint_measurements(&segments);
        assert_eq!(start_tangent, json!(180.0));
        assert_eq!(end_tangent, json!(270.0));
    }
}
