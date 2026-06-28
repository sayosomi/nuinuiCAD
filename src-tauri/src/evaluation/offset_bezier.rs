use super::offset_types::{line_length, OffsetPoint, OffsetSegment, SourceSegment, EPSILON};

const BEZIER_OFFSET_FLATNESS_TOLERANCE_MM: f64 = 0.1;
const BEZIER_OFFSET_MAX_DEPTH: usize = 12;
const BEZIER_LENGTH_STEPS: usize = 16;
const OVER_OFFSET_SAMPLE_STEPS: usize = 64;
const OVER_OFFSET_MIN_SCALE: f64 = 0.02;

#[derive(Clone, Copy)]
struct PlainBezierSegment {
    start: OffsetPoint,
    control1: OffsetPoint,
    control2: OffsetPoint,
    end: OffsetPoint,
}

pub(crate) struct OffsetBezierGroups {
    pub(crate) groups: Vec<Vec<OffsetSegment>>,
    pub(crate) trimmed: bool,
}

pub(crate) fn cubic_source_point_at(segment: &SourceSegment, t: f64) -> OffsetPoint {
    let SourceSegment::Bezier {
        start,
        control1,
        control2,
        end,
    } = segment
    else {
        return OffsetPoint { x: 0.0, y: 0.0 };
    };
    cubic_point(*start, *control1, *control2, *end, t)
}

fn cubic_derivative_at(segment: &SourceSegment, t: f64) -> OffsetPoint {
    let SourceSegment::Bezier {
        start,
        control1,
        control2,
        end,
    } = segment
    else {
        return OffsetPoint { x: 0.0, y: 0.0 };
    };
    let inverse = 1.0 - t;
    OffsetPoint {
        x: 3.0 * inverse * inverse * (control1.x - start.x)
            + 6.0 * inverse * t * (control2.x - control1.x)
            + 3.0 * t * t * (end.x - control2.x),
        y: 3.0 * inverse * inverse * (control1.y - start.y)
            + 6.0 * inverse * t * (control2.y - control1.y)
            + 3.0 * t * t * (end.y - control2.y),
    }
}

fn cubic_second_derivative_at(segment: &SourceSegment, t: f64) -> OffsetPoint {
    let SourceSegment::Bezier {
        start,
        control1,
        control2,
        end,
    } = segment
    else {
        return OffsetPoint { x: 0.0, y: 0.0 };
    };
    OffsetPoint {
        x: 6.0 * (1.0 - t) * (control2.x - 2.0 * control1.x + start.x)
            + 6.0 * t * (end.x - 2.0 * control2.x + control1.x),
        y: 6.0 * (1.0 - t) * (control2.y - 2.0 * control1.y + start.y)
            + 6.0 * t * (end.y - 2.0 * control2.y + control1.y),
    }
}

fn fallback_tangent(segment: &SourceSegment, at_end: bool) -> OffsetPoint {
    let SourceSegment::Bezier {
        start,
        control1,
        control2,
        end,
    } = segment
    else {
        return OffsetPoint { x: 1.0, y: 0.0 };
    };
    let candidates = if at_end {
        vec![
            OffsetPoint {
                x: end.x - control2.x,
                y: end.y - control2.y,
            },
            OffsetPoint {
                x: end.x - control1.x,
                y: end.y - control1.y,
            },
            OffsetPoint {
                x: end.x - start.x,
                y: end.y - start.y,
            },
        ]
    } else {
        vec![
            OffsetPoint {
                x: control1.x - start.x,
                y: control1.y - start.y,
            },
            OffsetPoint {
                x: control2.x - start.x,
                y: control2.y - start.y,
            },
            OffsetPoint {
                x: end.x - start.x,
                y: end.y - start.y,
            },
        ]
    };
    candidates
        .into_iter()
        .find(|candidate| candidate.x.hypot(candidate.y) > EPSILON)
        .unwrap_or(OffsetPoint { x: 1.0, y: 0.0 })
}

fn cubic_point(
    start: OffsetPoint,
    control1: OffsetPoint,
    control2: OffsetPoint,
    end: OffsetPoint,
    t: f64,
) -> OffsetPoint {
    let inverse = 1.0 - t;
    let a = inverse * inverse * inverse;
    let b = 3.0 * inverse * inverse * t;
    let c = 3.0 * inverse * t * t;
    let d = t * t * t;
    OffsetPoint {
        x: a * start.x + b * control1.x + c * control2.x + d * end.x,
        y: a * start.y + b * control1.y + c * control2.y + d * end.y,
    }
}

pub(crate) fn unit_tangent_at(segment: &SourceSegment, t: f64) -> OffsetPoint {
    let tangent = cubic_derivative_at(segment, t);
    let length = tangent.x.hypot(tangent.y);
    if length > EPSILON {
        return OffsetPoint {
            x: tangent.x / length,
            y: tangent.y / length,
        };
    }
    let fallback = fallback_tangent(segment, t >= 0.5);
    let fallback_length = fallback.x.hypot(fallback.y);
    if fallback_length > EPSILON {
        OffsetPoint {
            x: fallback.x / fallback_length,
            y: fallback.y / fallback_length,
        }
    } else {
        OffsetPoint { x: 1.0, y: 0.0 }
    }
}

fn offset_point_by_tangent(point: OffsetPoint, tangent: OffsetPoint, offset: f64) -> OffsetPoint {
    let length = tangent.x.hypot(tangent.y);
    if length <= EPSILON {
        return point;
    }
    OffsetPoint {
        x: point.x + (-tangent.y / length) * offset,
        y: point.y + (tangent.x / length) * offset,
    }
}

fn offset_point_at(segment: &SourceSegment, t: f64, offset: f64) -> OffsetPoint {
    offset_point_by_tangent(
        cubic_source_point_at(segment, t),
        unit_tangent_at(segment, t),
        offset,
    )
}

fn signed_curvature_at(segment: &SourceSegment, t: f64) -> f64 {
    let first = cubic_derivative_at(segment, t);
    let second = cubic_second_derivative_at(segment, t);
    let speed = first.x.hypot(first.y);
    if speed <= EPSILON {
        return 0.0;
    }
    (first.x * second.y - first.y * second.x) / speed.powi(3)
}

fn is_safe_offset_t(segment: &SourceSegment, t: f64, offset: f64) -> bool {
    1.0 - offset * signed_curvature_at(segment, t) > OVER_OFFSET_MIN_SCALE
}

fn find_safe_boundary(segment: &SourceSegment, safe_t: f64, unsafe_t: f64, offset: f64) -> f64 {
    let mut safe = safe_t;
    let mut unsafe_value = unsafe_t;
    for _ in 0..32 {
        let mid = (safe + unsafe_value) / 2.0;
        if is_safe_offset_t(segment, mid, offset) {
            safe = mid;
        } else {
            unsafe_value = mid;
        }
    }
    safe
}

fn safe_offset_intervals(segment: &SourceSegment, offset: f64) -> (Vec<(f64, f64)>, bool) {
    let mut intervals = Vec::new();
    let mut interval_start = is_safe_offset_t(segment, 0.0, offset).then_some(0.0);
    let mut previous_t = 0.0;
    let mut previous_safe = interval_start.is_some();

    for index in 1..=OVER_OFFSET_SAMPLE_STEPS {
        let current_t = index as f64 / OVER_OFFSET_SAMPLE_STEPS as f64;
        let current_safe = is_safe_offset_t(segment, current_t, offset);
        if previous_safe && !current_safe {
            if let Some(start) = interval_start {
                let boundary = find_safe_boundary(segment, previous_t, current_t, offset);
                if boundary - start > EPSILON {
                    intervals.push((start, boundary));
                }
                interval_start = None;
            }
        } else if !previous_safe && current_safe {
            interval_start = Some(find_safe_boundary(segment, current_t, previous_t, offset));
        }
        previous_t = current_t;
        previous_safe = current_safe;
    }

    if let Some(start) = interval_start {
        if 1.0 - start > EPSILON {
            intervals.push((start, 1.0));
        }
    }
    let trimmed = intervals.len() != 1
        || intervals
            .first()
            .is_some_and(|(start, end)| *start > EPSILON || *end < 1.0 - EPSILON);
    (intervals, trimmed)
}

fn fit_offset_bezier_segment(
    segment: &SourceSegment,
    t0: f64,
    t1: f64,
    offset: f64,
) -> PlainBezierSegment {
    let start = offset_point_at(segment, t0, offset);
    let end = offset_point_at(segment, t1, offset);
    let mid_t = (t0 + t1) / 2.0;
    let mid = offset_point_at(segment, mid_t, offset);
    let start_tangent = unit_tangent_at(segment, t0);
    let end_tangent = unit_tangent_at(segment, t1);
    let chord_length = line_length(start, end).max(EPSILON);
    let target = OffsetPoint {
        x: (mid.x - (start.x + end.x) / 2.0) / 0.375,
        y: (mid.y - (start.y + end.y) / 2.0) / 0.375,
    };
    let a11 = start_tangent.x * start_tangent.x + start_tangent.y * start_tangent.y;
    let a12 = -(start_tangent.x * end_tangent.x + start_tangent.y * end_tangent.y);
    let a22 = end_tangent.x * end_tangent.x + end_tangent.y * end_tangent.y;
    let b1 = start_tangent.x * target.x + start_tangent.y * target.y;
    let b2 = -(end_tangent.x * target.x + end_tangent.y * target.y);
    let determinant = a11 * a22 - a12 * a12;
    let fallback_handle_length = chord_length / 3.0;
    let raw_start_handle = if determinant.abs() > EPSILON {
        (b1 * a22 - b2 * a12) / determinant
    } else {
        fallback_handle_length
    };
    let raw_end_handle = if determinant.abs() > EPSILON {
        (a11 * b2 - a12 * b1) / determinant
    } else {
        fallback_handle_length
    };
    let max_handle_length = chord_length * 2.0;
    let start_handle_length = if raw_start_handle.is_finite() && raw_start_handle > 0.0 {
        raw_start_handle.min(max_handle_length)
    } else {
        fallback_handle_length
    };
    let end_handle_length = if raw_end_handle.is_finite() && raw_end_handle > 0.0 {
        raw_end_handle.min(max_handle_length)
    } else {
        fallback_handle_length
    };

    PlainBezierSegment {
        start,
        control1: OffsetPoint {
            x: start.x + start_tangent.x * start_handle_length,
            y: start.y + start_tangent.y * start_handle_length,
        },
        control2: OffsetPoint {
            x: end.x - end_tangent.x * end_handle_length,
            y: end.y - end_tangent.y * end_handle_length,
        },
        end,
    }
}

fn squared_distance(first: OffsetPoint, second: OffsetPoint) -> f64 {
    let dx = first.x - second.x;
    let dy = first.y - second.y;
    dx * dx + dy * dy
}

fn offset_bezier_approximation_error(
    source: &SourceSegment,
    candidate: PlainBezierSegment,
    t0: f64,
    t1: f64,
    offset: f64,
) -> f64 {
    [0.25, 0.5, 0.75]
        .into_iter()
        .map(|local_t| {
            let source_t = t0 + (t1 - t0) * local_t;
            squared_distance(
                cubic_point(
                    candidate.start,
                    candidate.control1,
                    candidate.control2,
                    candidate.end,
                    local_t,
                ),
                offset_point_at(source, source_t, offset),
            )
        })
        .fold(0.0, f64::max)
        .sqrt()
}

pub(crate) fn approximate_bezier_length(segment: &OffsetSegment) -> f64 {
    let OffsetSegment::Bezier {
        start,
        control1,
        control2,
        end,
        ..
    } = segment
    else {
        return 0.0;
    };
    let mut length = 0.0;
    let mut previous = *start;
    for index in 1..=BEZIER_LENGTH_STEPS {
        let point = cubic_point(
            *start,
            *control1,
            *control2,
            *end,
            index as f64 / BEZIER_LENGTH_STEPS as f64,
        );
        length += line_length(previous, point);
        previous = point;
    }
    length
}

fn offset_bezier_leaf_segment(candidate: PlainBezierSegment) -> Option<OffsetSegment> {
    if line_length(candidate.start, candidate.end) <= EPSILON {
        return None;
    }
    let mut output = OffsetSegment::Bezier {
        start: candidate.start,
        control1: candidate.control1,
        control2: candidate.control2,
        end: candidate.end,
        length: 0.0,
    };
    let length = approximate_bezier_length(&output);
    if let OffsetSegment::Bezier { length: item, .. } = &mut output {
        *item = length;
    }
    Some(output)
}

fn offset_bezier_segments(
    segment: &SourceSegment,
    offset: f64,
    t0: f64,
    t1: f64,
    depth: usize,
) -> Vec<OffsetSegment> {
    let candidate = fit_offset_bezier_segment(segment, t0, t1, offset);
    let error = offset_bezier_approximation_error(segment, candidate, t0, t1, offset);
    if depth >= BEZIER_OFFSET_MAX_DEPTH || error <= BEZIER_OFFSET_FLATNESS_TOLERANCE_MM {
        return offset_bezier_leaf_segment(candidate).into_iter().collect();
    }
    let mid_t = (t0 + t1) / 2.0;
    let mut output = offset_bezier_segments(segment, offset, t0, mid_t, depth + 1);
    output.extend(offset_bezier_segments(
        segment,
        offset,
        mid_t,
        t1,
        depth + 1,
    ));
    output
}

pub(crate) fn offset_bezier_segment_groups(
    segment: &SourceSegment,
    offset: f64,
) -> OffsetBezierGroups {
    let (intervals, trimmed) = safe_offset_intervals(segment, offset);
    OffsetBezierGroups {
        groups: intervals
            .into_iter()
            .map(|(t0, t1)| offset_bezier_segments(segment, offset, t0, t1, 0))
            .filter(|segments| !segments.is_empty())
            .collect(),
        trimmed,
    }
}
