use serde_json::Value;

use super::offset_bezier::unit_tangent_at;
use super::offset_types::{
    arc_point, line_length, value_point, OffsetPoint, SourceSegment, EPSILON,
};

fn bezier_source_segments(curve: &Value) -> Vec<SourceSegment> {
    curve
        .get("segments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|segment| {
            Some(SourceSegment::Bezier {
                start: value_point(segment.get("start")?)?,
                control1: value_point(segment.get("control1")?)?,
                control2: value_point(segment.get("control2")?)?,
                end: value_point(segment.get("end")?)?,
            })
        })
        .collect()
}

fn offset_line_source_segments(line: &Value) -> Vec<SourceSegment> {
    line.get("segments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(
            |segment| match segment.get("kind").and_then(Value::as_str)? {
                "line" => Some(SourceSegment::Line {
                    start: value_point(segment.get("start")?)?,
                    end: value_point(segment.get("end")?)?,
                }),
                "bezier" => Some(SourceSegment::Bezier {
                    start: value_point(segment.get("start")?)?,
                    control1: value_point(segment.get("control1")?)?,
                    control2: value_point(segment.get("control2")?)?,
                    end: value_point(segment.get("end")?)?,
                }),
                "arc" => Some(SourceSegment::Arc {
                    center: value_point(segment.get("center")?)?,
                    radius: segment.get("radius")?.as_f64()?,
                    start_angle_deg: segment.get("startAngleDeg")?.as_f64()?,
                    sweep_angle_deg: segment.get("sweepAngleDeg")?.as_f64()?,
                }),
                _ => None,
            },
        )
        .collect()
}

pub(crate) fn source_segments_for_geometry(geometry: &Value) -> Vec<SourceSegment> {
    match geometry.get("kind").and_then(Value::as_str) {
        Some("line") => {
            let Some(start) = geometry.get("start").and_then(value_point) else {
                return Vec::new();
            };
            let Some(end) = geometry.get("end").and_then(value_point) else {
                return Vec::new();
            };
            vec![SourceSegment::Line { start, end }]
        }
        Some("arcLine") => {
            let Some(center) = geometry.get("center").and_then(value_point) else {
                return Vec::new();
            };
            let Some(radius) = geometry.get("radius").and_then(Value::as_f64) else {
                return Vec::new();
            };
            let Some(start_angle_deg) = geometry.get("startAngleDeg").and_then(Value::as_f64)
            else {
                return Vec::new();
            };
            let Some(sweep_angle_deg) = geometry.get("sweepAngleDeg").and_then(Value::as_f64)
            else {
                return Vec::new();
            };
            vec![SourceSegment::Arc {
                center,
                radius: radius.max(0.0),
                start_angle_deg,
                sweep_angle_deg,
            }]
        }
        Some("bezierCurve") => bezier_source_segments(geometry),
        Some("offsetLine") => offset_line_source_segments(geometry),
        _ => Vec::new(),
    }
}

pub(crate) fn source_end(segment: &SourceSegment) -> OffsetPoint {
    match segment {
        SourceSegment::Line { end, .. } | SourceSegment::Bezier { end, .. } => *end,
        SourceSegment::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
        } => arc_point(*center, *radius, start_angle_deg + sweep_angle_deg),
    }
}

pub(crate) fn source_start(segment: &SourceSegment) -> OffsetPoint {
    match segment {
        SourceSegment::Line { start, .. } | SourceSegment::Bezier { start, .. } => *start,
        SourceSegment::Arc {
            center,
            radius,
            start_angle_deg,
            ..
        } => arc_point(*center, *radius, *start_angle_deg),
    }
}

pub(crate) fn connector_segment(start: OffsetPoint, end: OffsetPoint) -> Option<SourceSegment> {
    (line_length(start, end) > EPSILON).then_some(SourceSegment::Line { start, end })
}

pub(crate) fn source_start_tangent(segment: &SourceSegment) -> Option<OffsetPoint> {
    match segment {
        SourceSegment::Line { start, end } => {
            let length = line_length(*start, *end);
            (length > EPSILON).then_some(OffsetPoint {
                x: (end.x - start.x) / length,
                y: (end.y - start.y) / length,
            })
        }
        SourceSegment::Bezier { .. } => Some(unit_tangent_at(segment, 0.0)),
        SourceSegment::Arc {
            start_angle_deg,
            sweep_angle_deg,
            ..
        } => {
            let tangent_angle =
                (start_angle_deg + if *sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 }).to_radians();
            Some(OffsetPoint {
                x: tangent_angle.cos(),
                y: tangent_angle.sin(),
            })
        }
    }
}

pub(crate) fn source_end_tangent(segment: &SourceSegment) -> Option<OffsetPoint> {
    match segment {
        SourceSegment::Line { start, end } => {
            let length = line_length(*start, *end);
            (length > EPSILON).then_some(OffsetPoint {
                x: (end.x - start.x) / length,
                y: (end.y - start.y) / length,
            })
        }
        SourceSegment::Bezier { .. } => Some(unit_tangent_at(segment, 1.0)),
        SourceSegment::Arc {
            start_angle_deg,
            sweep_angle_deg,
            ..
        } => {
            let end_angle_deg = start_angle_deg + sweep_angle_deg;
            let tangent_angle =
                (end_angle_deg + if *sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 }).to_radians();
            Some(OffsetPoint {
                x: tangent_angle.cos(),
                y: tangent_angle.sin(),
            })
        }
    }
}

pub(crate) fn connect_source_segment_groups(
    groups: &[Vec<SourceSegment>],
    closed: bool,
) -> Vec<SourceSegment> {
    let oriented_groups = groups;
    let mut connected = Vec::new();
    for group in oriented_groups {
        if group.is_empty() {
            continue;
        }
        if let Some(previous) = connected.last() {
            if connector_segment(source_end(previous), source_start(&group[0])).is_some() {
                return Vec::new();
            }
        }
        connected.extend(group.iter().cloned());
    }
    if closed
        && connected.len() > 1
        && connector_segment(
            source_end(connected.last().unwrap()),
            source_start(&connected[0]),
        )
        .is_some()
    {
        return Vec::new();
    }
    connected
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f64, y: f64) -> OffsetPoint {
        OffsetPoint { x, y }
    }

    #[test]
    fn preserves_explicit_source_direction() {
        let incoming = SourceSegment::Line {
            start: point(-50.0, 0.0),
            end: point(0.0, 0.0),
        };
        let loop_with_opposite_source_direction = SourceSegment::Bezier {
            start: point(0.0, 0.0),
            control1: point(-20.0, 0.0),
            control2: point(20.0, 0.0),
            end: point(0.0, 0.0),
        };

        let connected = connect_source_segment_groups(
            &[vec![incoming], vec![loop_with_opposite_source_direction]],
            false,
        );

        assert_eq!(connected.len(), 2);
        let SourceSegment::Bezier { control1, .. } = connected[1] else {
            panic!("expected Bezier segment");
        };
        assert_eq!(control1.x, -20.0);
        assert_eq!(control1.y, 0.0);
    }
}
