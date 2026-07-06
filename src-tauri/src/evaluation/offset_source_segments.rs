use serde_json::Value;

use super::offset_bezier::unit_tangent_at;
use super::offset_types::{
    arc_point, line_length, value_point, OffsetPoint, SourceSegment, EPSILON,
};

const TANGENT_CONTINUITY_COST_MM: f64 = 0.25;

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
            start_angle_deg: start_angle_deg + sweep_angle_deg,
            sweep_angle_deg: -*sweep_angle_deg,
        },
    }
}

fn reverse_source_segments(segments: &[SourceSegment]) -> Vec<SourceSegment> {
    segments.iter().rev().map(reverse_source_segment).collect()
}

#[derive(Clone)]
struct OrientedSourceGroup {
    segments: Vec<SourceSegment>,
    cost: f64,
    previous_orientation: Option<usize>,
}

fn group_connection_cost(previous: &[SourceSegment], next: &[SourceSegment]) -> f64 {
    let distance = line_length(source_end(previous.last().unwrap()), source_start(&next[0]));
    let Some(previous_tangent) = source_end_tangent(previous.last().unwrap()) else {
        return distance;
    };
    let Some(next_tangent) = source_start_tangent(&next[0]) else {
        return distance;
    };
    let dot = (previous_tangent.x * next_tangent.x + previous_tangent.y * next_tangent.y)
        .clamp(-1.0, 1.0);
    distance + (1.0 - dot) * TANGENT_CONTINUITY_COST_MM
}

fn orient_source_groups_for_initial_orientation(
    groups: &[Vec<SourceSegment>],
    initial_orientation: usize,
    closed: bool,
) -> (Vec<Vec<SourceSegment>>, f64) {
    let candidates = groups
        .iter()
        .map(|group| [group.clone(), reverse_source_segments(group)])
        .collect::<Vec<_>>();
    let mut states = vec![vec![
        OrientedSourceGroup {
            segments: candidates[0][0].clone(),
            cost: if initial_orientation == 0 {
                0.0
            } else {
                f64::INFINITY
            },
            previous_orientation: None,
        },
        OrientedSourceGroup {
            segments: candidates[0][1].clone(),
            cost: if initial_orientation == 1 {
                0.0
            } else {
                f64::INFINITY
            },
            previous_orientation: None,
        },
    ]];

    for index in 1..candidates.len() {
        let next_states = candidates[index]
            .iter()
            .map(|segments| {
                let first_cost = states[index - 1][0].cost
                    + group_connection_cost(&states[index - 1][0].segments, segments);
                let second_cost = states[index - 1][1].cost
                    + group_connection_cost(&states[index - 1][1].segments, segments);
                let previous_orientation = if first_cost <= second_cost { 0 } else { 1 };
                OrientedSourceGroup {
                    segments: segments.clone(),
                    cost: first_cost.min(second_cost),
                    previous_orientation: Some(previous_orientation),
                }
            })
            .collect();
        states.push(next_states);
    }

    let last_states = states.last().unwrap();
    let terminal_cost = |orientation: usize| {
        if closed {
            last_states[orientation].cost
                + group_connection_cost(
                    &last_states[orientation].segments,
                    &candidates[0][initial_orientation],
                )
        } else {
            last_states[orientation].cost
        }
    };
    let terminal_orientation = if terminal_cost(0) <= terminal_cost(1) {
        0
    } else {
        1
    };
    let terminal_cost = terminal_cost(terminal_orientation);
    let mut oriented_groups = vec![Vec::new(); states.len()];
    let mut orientation = terminal_orientation;
    for index in (0..states.len()).rev() {
        oriented_groups[index] = states[index][orientation].segments.clone();
        if let Some(previous) = states[index][orientation].previous_orientation {
            orientation = previous;
        }
    }
    (oriented_groups, terminal_cost)
}

fn orient_source_groups(groups: &[Vec<SourceSegment>], closed: bool) -> Vec<Vec<SourceSegment>> {
    if groups.len() <= 1 {
        return groups.to_vec();
    }
    let forward = orient_source_groups_for_initial_orientation(groups, 0, closed);
    let reversed = orient_source_groups_for_initial_orientation(groups, 1, closed);
    if forward.1 <= reversed.1 {
        forward.0
    } else {
        reversed.0
    }
}

pub(crate) fn connect_source_segment_groups(
    groups: &[Vec<SourceSegment>],
    closed: bool,
) -> Vec<SourceSegment> {
    let oriented_groups = orient_source_groups(groups, closed);
    let mut connected = Vec::new();
    for group in oriented_groups {
        if group.is_empty() {
            continue;
        }
        if let Some(previous) = connected.last() {
            if let Some(connector) =
                connector_segment(source_end(previous), source_start(&group[0]))
            {
                connected.push(connector);
            }
        }
        connected.extend(group);
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
    fn tangent_continuity_orients_equally_close_source_groups() {
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
        assert_eq!(control1.x, 20.0);
        assert_eq!(control1.y, 0.0);
    }
}
