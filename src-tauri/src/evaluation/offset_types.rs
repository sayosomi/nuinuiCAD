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
    degrees.rem_euclid(360.0)
}

pub(crate) fn positive_sweep_degrees(start_angle_deg: f64, end_angle_deg: f64) -> f64 {
    normalize_degrees(end_angle_deg - start_angle_deg)
}

pub(crate) fn arc_point(center: OffsetPoint, radius: f64, angle_deg: f64) -> OffsetPoint {
    let angle_rad = angle_deg.to_radians();
    OffsetPoint {
        x: center.x + angle_rad.cos() * radius,
        y: center.y - angle_rad.sin() * radius,
    }
}

pub(crate) fn angle_of_point(center: OffsetPoint, point: OffsetPoint) -> f64 {
    normalize_degrees((center.y - point.y).atan2(point.x - center.x).to_degrees())
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
    let dy = start.y - end.y;
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
            start_angle_deg,
            sweep_angle_deg,
            ..
        } => Some(normalize_degrees(
            start_angle_deg + if *sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 },
        )),
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
            start_angle_deg,
            sweep_angle_deg,
            ..
        } => Some(normalize_degrees(
            start_angle_deg + sweep_angle_deg + if *sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 },
        )),
    }
}

pub(crate) fn offset_line_endpoint_measurements(
    segments: &[OffsetSegment],
) -> (Value, Value, Value, Value) {
    let start = segments.first().map(segment_start);
    let end = segments.last().map(segment_end);
    let start_tangent = segments
        .first()
        .and_then(offset_segment_start_forward_angle);
    let end_tangent = segments
        .last()
        .and_then(offset_segment_end_forward_angle)
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
