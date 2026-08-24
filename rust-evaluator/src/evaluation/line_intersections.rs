use serde_json::Value;

use super::bezier_math::cubic_derivative as bm_cubic_derivative;
use super::bezier_path::{self, cubic_point_at};

const ARC_STEPS: f64 = 64.0;
const CURVE_STEPS: usize = 64;
const EXTENSION_LENGTH: f64 = 1_000_000.0;
const EPSILON: f64 = 1e-9;
const DEDUPE_EPSILON: f64 = 1e-5;
const INTERSECTION_TOLERANCE: f64 = 1e-6;

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone)]
enum SegmentPrimitive {
    // Only genuinely straight sources (line geometry, offsetLine "line"
    // sub-segments, and extension rays) produce this primitive -- arcLine and
    // bezierCurve chords carry their own analytic primitive instead, so this
    // is always exact and needs no separate flag.
    Line,
    Bezier {
        segment: Value,
        t_start: f64,
        t_end: f64,
    },
    Arc {
        center: Point,
        radius: f64,
        start_angle_deg: f64,
        sweep_angle_deg: f64,
        // Sweep fraction range this chord covers, in [0, 1] over the arc's
        // own start_angle_deg..start_angle_deg+sweep_angle_deg span.
        u_start: f64,
        u_end: f64,
    },
}

#[derive(Clone)]
struct IntersectionSegment {
    start: Point,
    end: Point,
    start_distance: f64,
    end_distance: f64,
    primitive: SegmentPrimitive,
}

#[derive(Clone, Copy)]
pub(crate) struct LineIntersection {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) line1_distance: f64,
    pub(crate) line2_distance: f64,
}

pub(crate) struct LineIntersectionResult {
    pub(crate) intersections: Vec<LineIntersection>,
    pub(crate) error: Option<String>,
}

struct SegmentIntersection {
    point: Point,
    line1_distance: f64,
    line2_distance: f64,
    overlap: bool,
}

fn value_point(value: &Value) -> Option<Point> {
    Some(Point {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

fn distance(start: Point, end: Point) -> f64 {
    (end.x - start.x).hypot(end.y - start.y)
}

fn vector_between(start: Point, end: Point) -> Point {
    Point {
        x: end.x - start.x,
        y: end.y - start.y,
    }
}

fn normalize_vector(vector: Point) -> Option<Point> {
    let length = vector.x.hypot(vector.y);
    (length > EPSILON).then_some(Point {
        x: vector.x / length,
        y: vector.y / length,
    })
}

fn arc_point(center: Point, radius: f64, angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    Point {
        x: center.x + angle_rad.cos() * radius,
        y: center.y + angle_rad.sin() * radius,
    }
}

fn point_path_segments(points: &[Point]) -> Vec<IntersectionSegment> {
    let mut segments = Vec::new();
    let mut accumulated = 0.0;

    for pair in points.windows(2) {
        let start = pair[0];
        let end = pair[1];
        let length = distance(start, end);
        if length <= EPSILON {
            continue;
        }

        segments.push(IntersectionSegment {
            start,
            end,
            start_distance: accumulated,
            end_distance: accumulated + length,
            primitive: SegmentPrimitive::Line,
        });
        accumulated += length;
    }

    segments
}

// Append chord-sampled seeds for one arc span (used both for a bare arcLine
// geometry and for a single "arc" offsetLine sub-segment), continuing the
// running `accumulated` distance so multi-segment offset lines stay
// contiguous.
fn push_arc_chords(
    output: &mut Vec<IntersectionSegment>,
    accumulated: &mut f64,
    center: Point,
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
) {
    let safe_radius = radius.max(0.0);
    let step_count = ((sweep_angle_deg.abs() / 360.0) * ARC_STEPS)
        .ceil()
        .max(1.0) as usize;

    for index in 0..step_count {
        let u_start = index as f64 / step_count as f64;
        let u_end = (index + 1) as f64 / step_count as f64;
        let start = arc_point(
            center,
            safe_radius,
            start_angle_deg + sweep_angle_deg * u_start,
        );
        let end = arc_point(
            center,
            safe_radius,
            start_angle_deg + sweep_angle_deg * u_end,
        );
        let length = distance(start, end);
        if length <= EPSILON {
            continue;
        }

        output.push(IntersectionSegment {
            start,
            end,
            start_distance: *accumulated,
            end_distance: *accumulated + length,
            primitive: SegmentPrimitive::Arc {
                center,
                radius: safe_radius,
                start_angle_deg,
                sweep_angle_deg,
                u_start,
                u_end,
            },
        });
        *accumulated += length;
    }
}

fn arc_path_segments(
    center: Point,
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
) -> Vec<IntersectionSegment> {
    let mut output = Vec::new();
    let mut accumulated = 0.0;
    push_arc_chords(
        &mut output,
        &mut accumulated,
        center,
        radius,
        start_angle_deg,
        sweep_angle_deg,
    );
    output
}

// Append chord-sampled seeds for one bezier sub-segment, continuing the
// running `accumulated` distance. Returns None if the segment JSON is
// malformed.
fn push_bezier_chords(
    output: &mut Vec<IntersectionSegment>,
    accumulated: &mut f64,
    segment: &Value,
) -> Option<()> {
    let points = bezier_path::segment_points(segment, CURVE_STEPS)?;
    for (index, pair) in points.windows(2).enumerate() {
        let start = Point {
            x: pair[0].x,
            y: pair[0].y,
        };
        let end = Point {
            x: pair[1].x,
            y: pair[1].y,
        };
        let length = distance(start, end);
        if length <= EPSILON {
            continue;
        }

        output.push(IntersectionSegment {
            start,
            end,
            start_distance: *accumulated,
            end_distance: *accumulated + length,
            primitive: SegmentPrimitive::Bezier {
                segment: segment.clone(),
                t_start: index as f64 / CURVE_STEPS as f64,
                t_end: (index + 1) as f64 / CURVE_STEPS as f64,
            },
        });
        *accumulated += length;
    }
    Some(())
}

fn bezier_path_segments(geometry: &Value) -> Option<Vec<IntersectionSegment>> {
    let segments = geometry.get("segments")?.as_array()?;
    let mut output = Vec::new();
    let mut accumulated = 0.0;

    for segment in segments {
        push_bezier_chords(&mut output, &mut accumulated, segment)?;
    }

    Some(output)
}

// Dispatch each offsetLine sub-segment to its own analytic primitive (line,
// bezier, or arc) instead of flattening the whole offset line into a single
// approximate polyline. This preserves curve identity for refinement and,
// unlike the previous implementation, does not special-case closed offset
// lines -- a closed offset line can still be intersected, it just never gets
// endpoint extension segments (see `endpoint_tangents`).
fn offset_path_segments(line: &Value) -> Option<Vec<IntersectionSegment>> {
    let segments = line.get("segments")?.as_array()?;
    let mut output = Vec::new();
    let mut accumulated = 0.0;

    for segment in segments {
        match segment.get("kind")?.as_str()? {
            "line" => {
                let start = segment.get("start").and_then(value_point)?;
                let end = segment.get("end").and_then(value_point)?;
                let length = distance(start, end);
                if length > EPSILON {
                    output.push(IntersectionSegment {
                        start,
                        end,
                        start_distance: accumulated,
                        end_distance: accumulated + length,
                        primitive: SegmentPrimitive::Line,
                    });
                    accumulated += length;
                }
            }
            "bezier" => {
                push_bezier_chords(&mut output, &mut accumulated, segment)?;
            }
            "arc" => {
                let center = segment.get("center").and_then(value_point)?;
                let radius = segment.get("radius")?.as_f64()?;
                let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
                let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
                push_arc_chords(
                    &mut output,
                    &mut accumulated,
                    center,
                    radius,
                    start_angle_deg,
                    sweep_angle_deg,
                );
            }
            _ => return None,
        }
    }

    Some(output)
}

fn path_segments_for_line(geometry: &Value) -> Option<Vec<IntersectionSegment>> {
    match geometry.get("kind")?.as_str()? {
        "line" => {
            let start = geometry.get("start").and_then(value_point)?;
            let end = geometry.get("end").and_then(value_point)?;
            Some(point_path_segments(&[start, end]))
        }
        "arcLine" => {
            let center = geometry.get("center").and_then(value_point)?;
            let radius = geometry.get("radius")?.as_f64()?;
            let start_angle_deg = geometry.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = geometry.get("sweepAngleDeg")?.as_f64()?;
            Some(arc_path_segments(
                center,
                radius,
                start_angle_deg,
                sweep_angle_deg,
            ))
        }
        "bezierCurve" => bezier_path_segments(geometry),
        "offsetLine" | "joinedPath" => offset_path_segments(geometry),
        _ => None,
    }
}

fn bezier_start_forward(segment: &Value) -> Option<Point> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;

    normalize_vector(vector_between(start, control1))
        .or_else(|| normalize_vector(vector_between(start, control2)))
        .or_else(|| normalize_vector(vector_between(start, end)))
}

fn bezier_end_forward(segment: &Value) -> Option<Point> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;

    normalize_vector(vector_between(control2, end))
        .or_else(|| normalize_vector(vector_between(control1, end)))
        .or_else(|| normalize_vector(vector_between(start, end)))
}

fn arc_forward_tangent(angle_deg: f64, sweep_angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    let direction = if sweep_angle_deg >= 0.0 { 1.0 } else { -1.0 };
    Point {
        x: -angle_rad.sin() * direction,
        y: angle_rad.cos() * direction,
    }
}

fn offset_segment_start_forward(segment: &Value) -> Option<Point> {
    match segment.get("kind")?.as_str()? {
        "line" => {
            let start = segment.get("start").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            normalize_vector(vector_between(start, end))
        }
        "bezier" => bezier_start_forward(segment),
        "arc" => Some(arc_forward_tangent(
            segment.get("startAngleDeg")?.as_f64()?,
            segment.get("sweepAngleDeg")?.as_f64()?,
        )),
        _ => None,
    }
}

fn offset_segment_end_forward(segment: &Value) -> Option<Point> {
    match segment.get("kind")?.as_str()? {
        "line" => {
            let start = segment.get("start").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            normalize_vector(vector_between(start, end))
        }
        "bezier" => bezier_end_forward(segment),
        "arc" => {
            let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
            Some(arc_forward_tangent(
                start_angle_deg + sweep_angle_deg,
                sweep_angle_deg,
            ))
        }
        _ => None,
    }
}

struct EndpointTangents {
    start: Point,
    end: Point,
    start_forward: Point,
    end_forward: Point,
}

fn endpoint_tangents(geometry: &Value) -> Option<EndpointTangents> {
    match geometry.get("kind")?.as_str()? {
        "line" => {
            let start = geometry.get("start").and_then(value_point)?;
            let end = geometry.get("end").and_then(value_point)?;
            let forward = normalize_vector(vector_between(start, end))?;
            Some(EndpointTangents {
                start,
                end,
                start_forward: forward,
                end_forward: forward,
            })
        }
        "arcLine" => {
            let start = geometry.get("start").and_then(value_point)?;
            let end = geometry.get("end").and_then(value_point)?;
            let start_angle_deg = geometry.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = geometry.get("sweepAngleDeg")?.as_f64()?;
            Some(EndpointTangents {
                start,
                end,
                start_forward: arc_forward_tangent(start_angle_deg, sweep_angle_deg),
                end_forward: arc_forward_tangent(
                    start_angle_deg + sweep_angle_deg,
                    sweep_angle_deg,
                ),
            })
        }
        "bezierCurve" => {
            let segments = geometry.get("segments")?.as_array()?;
            let first = segments.first()?;
            let last = segments.last()?;
            Some(EndpointTangents {
                start: first.get("start").and_then(value_point)?,
                end: last.get("end").and_then(value_point)?,
                start_forward: bezier_start_forward(first)?,
                end_forward: bezier_end_forward(last)?,
            })
        }
        "offsetLine" | "joinedPath" => {
            if geometry
                .get("closed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return None;
            }
            let segments = geometry.get("segments")?.as_array()?;
            let first = segments.first()?;
            let last = segments.last()?;
            Some(EndpointTangents {
                start: first.get("start").and_then(value_point)?,
                end: last.get("end").and_then(value_point)?,
                start_forward: offset_segment_start_forward(first)?,
                end_forward: offset_segment_end_forward(last)?,
            })
        }
        _ => None,
    }
}

fn extension_segments(
    segments: &[IntersectionSegment],
    geometry: &Value,
) -> Vec<IntersectionSegment> {
    let Some(tangents) = endpoint_tangents(geometry) else {
        return Vec::new();
    };
    let total_distance = segments
        .last()
        .map(|segment| segment.end_distance)
        .unwrap_or_else(|| {
            geometry
                .get("length")
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        });

    vec![
        IntersectionSegment {
            start: Point {
                x: tangents.start.x - tangents.start_forward.x * EXTENSION_LENGTH,
                y: tangents.start.y - tangents.start_forward.y * EXTENSION_LENGTH,
            },
            end: tangents.start,
            start_distance: -EXTENSION_LENGTH,
            end_distance: 0.0,
            primitive: SegmentPrimitive::Line,
        },
        IntersectionSegment {
            start: tangents.end,
            end: Point {
                x: tangents.end.x + tangents.end_forward.x * EXTENSION_LENGTH,
                y: tangents.end.y + tangents.end_forward.y * EXTENSION_LENGTH,
            },
            start_distance: total_distance,
            end_distance: total_distance + EXTENSION_LENGTH,
            primitive: SegmentPrimitive::Line,
        },
    ]
}

fn cross(a: Point, b: Point) -> f64 {
    a.x * b.y - a.y * b.x
}

fn segment_intersection(
    a: &IntersectionSegment,
    b: &IntersectionSegment,
) -> Option<SegmentIntersection> {
    let r = Point {
        x: a.end.x - a.start.x,
        y: a.end.y - a.start.y,
    };
    let s = Point {
        x: b.end.x - b.start.x,
        y: b.end.y - b.start.y,
    };
    let denominator = cross(r, s);
    let qp = Point {
        x: b.start.x - a.start.x,
        y: b.start.y - a.start.y,
    };

    if denominator.abs() <= EPSILON {
        if cross(qp, r).abs() <= EPSILON {
            return Some(SegmentIntersection {
                point: a.start,
                line1_distance: 0.0,
                line2_distance: 0.0,
                overlap: true,
            });
        }
        return None;
    }

    let t = cross(qp, s) / denominator;
    let u = cross(qp, r) / denominator;
    if !(-EPSILON..=1.0 + EPSILON).contains(&t) || !(-EPSILON..=1.0 + EPSILON).contains(&u) {
        return None;
    }

    let clamped_t = t.clamp(0.0, 1.0);
    let clamped_u = u.clamp(0.0, 1.0);
    Some(SegmentIntersection {
        point: Point {
            x: a.start.x + r.x * clamped_t,
            y: a.start.y + r.y * clamped_t,
        },
        line1_distance: a.start_distance + (a.end_distance - a.start_distance) * clamped_t,
        line2_distance: b.start_distance + (b.end_distance - b.start_distance) * clamped_u,
        overlap: false,
    })
}

fn projection_t(point: Point, start: Point, end: Point) -> Option<f64> {
    let vector = Point {
        x: end.x - start.x,
        y: end.y - start.y,
    };
    let length_squared = vector.x * vector.x + vector.y * vector.y;
    if length_squared <= EPSILON {
        return None;
    }
    Some(((point.x - start.x) * vector.x + (point.y - start.y) * vector.y) / length_squared)
}

fn chord_seed(segment: &IntersectionSegment, start: f64, end: f64, rough_point: Point) -> f64 {
    projection_t(rough_point, segment.start, segment.end)
        .map(|chord_t| (start + (end - start) * chord_t).clamp(start, end))
        .unwrap_or((start + end) / 2.0)
}

fn signed_distance_to_line(point: Point, line: &IntersectionSegment) -> f64 {
    cross(
        Point {
            x: point.x - line.start.x,
            y: point.y - line.start.y,
        },
        Point {
            x: line.end.x - line.start.x,
            y: line.end.y - line.start.y,
        },
    )
}

fn cubic_point(segment: &Value, t: f64) -> Option<Point> {
    cubic_point_at(segment, t).map(|point| Point {
        x: point.x,
        y: point.y,
    })
}

fn cubic_derivative(segment: &Value, t: f64) -> Option<Point> {
    bm_cubic_derivative(segment, t).map(|point| Point {
        x: point.x,
        y: point.y,
    })
}

// Refine a Bézier↔Bézier crossing with a damped Newton solve confined to the
// two seed chords' local ranges. A rough crossing is only a candidate and is
// never returned when the analytic solve cannot establish a root.
fn refine_bezier_bezier_intersection(
    a: &IntersectionSegment,
    b: &IntersectionSegment,
    rough_point: Point,
) -> Option<(Point, f64, f64)> {
    let SegmentPrimitive::Bezier {
        segment: seg_a,
        t_start: a_start,
        t_end: a_end,
    } = &a.primitive
    else {
        return None;
    };
    let SegmentPrimitive::Bezier {
        segment: seg_b,
        t_start: b_start,
        t_end: b_end,
    } = &b.primitive
    else {
        return None;
    };

    let solve = |mut t_a: f64, mut t_b: f64| -> Option<(Point, f64, f64)> {
        for _ in 0..40 {
            let pa = cubic_point(seg_a, t_a)?;
            let pb = cubic_point(seg_b, t_b)?;
            let fx = pa.x - pb.x;
            let fy = pa.y - pb.y;
            let residual = fx.hypot(fy);
            if !residual.is_finite() {
                return None;
            }
            if residual <= EPSILON {
                break;
            }
            let da = cubic_derivative(seg_a, t_a)?;
            let db = cubic_derivative(seg_b, t_b)?;
            let det = db.x * da.y - da.x * db.y;
            if !det.is_finite() || det.abs() <= EPSILON {
                return None;
            }
            let dt_a = (db.y * fx - db.x * fy) / det;
            let dt_b = (da.y * fx - da.x * fy) / det;
            if !dt_a.is_finite() || !dt_b.is_finite() {
                return None;
            }

            let mut damping = 1.0;
            let mut accepted = false;
            while damping >= 1.0 / 1024.0 {
                let next_a = t_a + damping * dt_a;
                let next_b = t_b + damping * dt_b;
                if next_a < *a_start - EPSILON
                    || next_a > *a_end + EPSILON
                    || next_b < *b_start - EPSILON
                    || next_b > *b_end + EPSILON
                {
                    damping /= 2.0;
                    continue;
                }
                let next_pa = cubic_point(seg_a, next_a)?;
                let next_pb = cubic_point(seg_b, next_b)?;
                if (next_pa.x - next_pb.x).hypot(next_pa.y - next_pb.y) < residual {
                    t_a = next_a;
                    t_b = next_b;
                    accepted = true;
                    break;
                }
                damping /= 2.0;
            }
            if !accepted {
                return None;
            }
        }

        let pa = cubic_point(seg_a, t_a)?;
        let pb = cubic_point(seg_b, t_b)?;
        let residual = (pa.x - pb.x).hypot(pa.y - pb.y);
        (residual.is_finite() && residual <= INTERSECTION_TOLERANCE).then_some((pa, t_a, t_b))
    };

    let rough_a = chord_seed(a, *a_start, *a_end, rough_point);
    let rough_b = chord_seed(b, *b_start, *b_end, rough_point);
    let middle_a = (a_start + a_end) / 2.0;
    let middle_b = (b_start + b_end) / 2.0;
    solve(rough_a, rough_b)
        .or_else(|| solve(middle_a, middle_b))
        .or_else(|| solve(rough_a, middle_b))
        .or_else(|| solve(middle_a, rough_b))
}

fn refine_bezier_line_intersection(
    bezier: &IntersectionSegment,
    line: &IntersectionSegment,
) -> Option<(Point, f64, f64)> {
    let SegmentPrimitive::Bezier {
        segment,
        t_start,
        t_end,
    } = &bezier.primitive
    else {
        return None;
    };
    let SegmentPrimitive::Line = line.primitive else {
        return None;
    };

    let mut low = *t_start;
    let mut high = *t_end;
    let mut low_value = signed_distance_to_line(cubic_point(segment, low)?, line);
    let high_value = signed_distance_to_line(cubic_point(segment, high)?, line);

    if low_value.abs() <= EPSILON {
        let point = cubic_point(segment, low)?;
        let line_t = projection_t(point, line.start, line.end)?;
        if !(-EPSILON..=1.0 + EPSILON).contains(&line_t) {
            return None;
        }
        return Some((point, low, line_t));
    }
    if high_value.abs() <= EPSILON {
        let point = cubic_point(segment, high)?;
        let line_t = projection_t(point, line.start, line.end)?;
        if !(-EPSILON..=1.0 + EPSILON).contains(&line_t) {
            return None;
        }
        return Some((point, high, line_t));
    }
    if low_value.signum() == high_value.signum() {
        return None;
    }

    for _ in 0..80 {
        let mid = (low + high) / 2.0;
        let mid_value = signed_distance_to_line(cubic_point(segment, mid)?, line);
        if mid_value.abs() <= EPSILON {
            low = mid;
            high = mid;
            break;
        }
        if low_value.signum() == mid_value.signum() {
            low = mid;
            low_value = mid_value;
        } else {
            high = mid;
        }
    }

    let t = (low + high) / 2.0;
    let point = cubic_point(segment, t)?;
    let line_t = projection_t(point, line.start, line.end)?;
    if !(-EPSILON..=1.0 + EPSILON).contains(&line_t) {
        return None;
    }
    Some((point, t, line_t.clamp(0.0, 1.0)))
}

fn distance_at_segment_t(segment: &IntersectionSegment, t: f64) -> f64 {
    let SegmentPrimitive::Bezier { t_start, t_end, .. } = segment.primitive else {
        return segment.start_distance;
    };
    let span = t_end - t_start;
    let local_t = if span.abs() <= EPSILON {
        0.0
    } else {
        ((t - t_start) / span).clamp(0.0, 1.0)
    };
    segment.start_distance + (segment.end_distance - segment.start_distance) * local_t
}

fn distance_at_arc_u(segment: &IntersectionSegment, u: f64) -> f64 {
    let SegmentPrimitive::Arc { u_start, u_end, .. } = segment.primitive else {
        return segment.start_distance;
    };
    let span = u_end - u_start;
    let local_u = if span.abs() <= EPSILON {
        0.0
    } else {
        ((u - u_start) / span).clamp(0.0, 1.0)
    };
    segment.start_distance + (segment.end_distance - segment.start_distance) * local_u
}

// Real roots of a*x^2 + b*x + c = 0. A discriminant that is negative only by
// numerical noise (within EPSILON) is treated as a tangent double root instead
// of "no roots", so near-tangent line/circle configurations stay stable.
fn quadratic_roots(a: f64, b: f64, c: f64) -> Vec<f64> {
    if a.abs() <= EPSILON {
        return if b.abs() <= EPSILON {
            Vec::new()
        } else {
            vec![-c / b]
        };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < -EPSILON {
        return Vec::new();
    }
    let sqrt_discriminant = discriminant.max(0.0).sqrt();
    if sqrt_discriminant <= EPSILON {
        return vec![-b / (2.0 * a)];
    }
    vec![
        (-b - sqrt_discriminant) / (2.0 * a),
        (-b + sqrt_discriminant) / (2.0 * a),
    ]
}

// Return the representative of an angle that belongs to this particular seed
// chord. Full circles have both u=0 and u=1 at their seam, so unwrap around
// the chord's local range rather than choosing a global modulo fraction.
fn sweep_fraction_for_angle_in_range(
    start_angle_deg: f64,
    sweep_angle_deg: f64,
    angle_deg: f64,
    u_start: f64,
    u_end: f64,
) -> Option<f64> {
    if sweep_angle_deg.abs() <= EPSILON {
        return None;
    }
    let midpoint = (u_start + u_end) / 2.0;
    let center_turn =
        ((start_angle_deg + sweep_angle_deg * midpoint - angle_deg) / 360.0).floor() as i64;
    let mut best: Option<f64> = None;
    for turn in (center_turn - 2)..=(center_turn + 2) {
        let u = (angle_deg + 360.0 * turn as f64 - start_angle_deg) / sweep_angle_deg;
        if u < u_start - EPSILON || u > u_end + EPSILON {
            continue;
        }
        if best.as_ref().map_or(true, |current| {
            (u - midpoint).abs() < (*current - midpoint).abs()
        }) {
            best = Some(u);
        }
    }
    best.map(|u| u.clamp(u_start, u_end))
}

// Analytic circle-vs-infinite-line intersection, seeded from the rough
// polyline crossing to pick between up to two roots. Only accepts a root
// whose line parameter lies in the line chord's own [0, 1] span and whose arc
// sweep fraction lies within *this seed chord's* local u_start..u_end range
// (not the arc's global [0, 1]) -- so a chord only claims roots that actually
// belong to it, even when the circle intersects the line elsewhere along the
// arc's full sweep.
fn refine_arc_line_intersection(
    arc: &IntersectionSegment,
    line: &IntersectionSegment,
    rough_point: Point,
) -> Option<(Point, f64, f64)> {
    let SegmentPrimitive::Arc {
        center,
        radius,
        start_angle_deg,
        sweep_angle_deg,
        u_start,
        u_end,
    } = arc.primitive
    else {
        return None;
    };
    let SegmentPrimitive::Line = line.primitive else {
        return None;
    };

    let d = Point {
        x: line.end.x - line.start.x,
        y: line.end.y - line.start.y,
    };
    let f = Point {
        x: line.start.x - center.x,
        y: line.start.y - center.y,
    };
    let a_coef = d.x * d.x + d.y * d.y;
    if a_coef <= EPSILON {
        return None;
    }
    let b_coef = 2.0 * (f.x * d.x + f.y * d.y);
    let c_coef = f.x * f.x + f.y * f.y - radius * radius;

    let mut best: Option<(Point, f64, f64, f64)> = None;
    for line_t in quadratic_roots(a_coef, b_coef, c_coef) {
        if !(-EPSILON..=1.0 + EPSILON).contains(&line_t) {
            continue;
        }
        let point = Point {
            x: line.start.x + d.x * line_t,
            y: line.start.y + d.y * line_t,
        };
        let angle_deg = (point.y - center.y).atan2(point.x - center.x).to_degrees();
        let Some(u) = sweep_fraction_for_angle_in_range(
            start_angle_deg,
            sweep_angle_deg,
            angle_deg,
            u_start,
            u_end,
        ) else {
            continue;
        };
        let dist_to_rough = (point.x - rough_point.x).hypot(point.y - rough_point.y);
        if best
            .as_ref()
            .map_or(true, |existing| dist_to_rough < existing.3)
        {
            best = Some((point, line_t.clamp(0.0, 1.0), u, dist_to_rough));
        }
    }

    best.map(|(point, line_t, u, _)| (point, u, line_t))
}

// Analytic circle-circle intersection (0/1/2 points). A discriminant-like
// term that is negative only by numerical noise is clamped to 0 (tangent
// circles), matching `quadratic_roots`'s tolerance style. Concentric (or
// coincident-center) circles have no well-defined finite intersection set
// and return no points.
fn circle_circle_intersections(
    center_a: Point,
    radius_a: f64,
    center_b: Point,
    radius_b: f64,
) -> Vec<Point> {
    let dx = center_b.x - center_a.x;
    let dy = center_b.y - center_a.y;
    let d = dx.hypot(dy);
    if d <= EPSILON {
        return Vec::new();
    }
    if d > radius_a + radius_b + EPSILON || d < (radius_a - radius_b).abs() - EPSILON {
        return Vec::new();
    }

    let a = (radius_a * radius_a - radius_b * radius_b + d * d) / (2.0 * d);
    let h = (radius_a * radius_a - a * a).max(0.0).sqrt();
    let mid = Point {
        x: center_a.x + a * dx / d,
        y: center_a.y + a * dy / d,
    };
    if h <= EPSILON {
        return vec![mid];
    }
    let perp = Point {
        x: -dy / d,
        y: dx / d,
    };
    vec![
        Point {
            x: mid.x + perp.x * h,
            y: mid.y + perp.y * h,
        },
        Point {
            x: mid.x - perp.x * h,
            y: mid.y - perp.y * h,
        },
    ]
}

// Refine an Arc<->Arc crossing analytically, seeded from the rough polyline
// crossing to pick between up to two circle-circle roots. Each candidate
// point's sweep fraction is checked against *both* seed chords' own local
// u_start..u_end ranges (not either arc's global [0, 1]).
fn refine_arc_arc_intersection(
    a: &IntersectionSegment,
    b: &IntersectionSegment,
    rough_point: Point,
) -> Option<(Point, f64, f64)> {
    let SegmentPrimitive::Arc {
        center: center_a,
        radius: radius_a,
        start_angle_deg: start_a,
        sweep_angle_deg: sweep_a,
        u_start: u_start_a,
        u_end: u_end_a,
    } = a.primitive
    else {
        return None;
    };
    let SegmentPrimitive::Arc {
        center: center_b,
        radius: radius_b,
        start_angle_deg: start_b,
        sweep_angle_deg: sweep_b,
        u_start: u_start_b,
        u_end: u_end_b,
    } = b.primitive
    else {
        return None;
    };

    let mut best: Option<(Point, f64, f64, f64)> = None;
    for point in circle_circle_intersections(center_a, radius_a, center_b, radius_b) {
        let angle_a_deg = (point.y - center_a.y)
            .atan2(point.x - center_a.x)
            .to_degrees();
        let Some(u_a) =
            sweep_fraction_for_angle_in_range(start_a, sweep_a, angle_a_deg, u_start_a, u_end_a)
        else {
            continue;
        };

        let angle_b_deg = (point.y - center_b.y)
            .atan2(point.x - center_b.x)
            .to_degrees();
        let Some(u_b) =
            sweep_fraction_for_angle_in_range(start_b, sweep_b, angle_b_deg, u_start_b, u_end_b)
        else {
            continue;
        };

        let dist_to_rough = (point.x - rough_point.x).hypot(point.y - rough_point.y);
        if best
            .as_ref()
            .map_or(true, |existing| dist_to_rough < existing.3)
        {
            best = Some((point, u_a, u_b, dist_to_rough));
        }
    }

    best.map(|(point, u_a, u_b, _)| (point, u_a, u_b))
}

fn arc_point_at_u(
    center: Point,
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
    u: f64,
) -> Point {
    arc_point(center, radius, start_angle_deg + sweep_angle_deg * u)
}

// d/du of arc_point_at_u: the arc is parameterized by sweep fraction u (not
// angle directly), so the chain rule picks up a factor of sweep_angle_deg
// (in radians) from d(theta)/du.
fn arc_derivative_at_u(radius: f64, start_angle_deg: f64, sweep_angle_deg: f64, u: f64) -> Point {
    let theta_rad = (start_angle_deg + sweep_angle_deg * u).to_radians();
    let sweep_rad = sweep_angle_deg.to_radians();
    Point {
        x: -radius * sweep_rad * theta_rad.sin(),
        y: radius * sweep_rad * theta_rad.cos(),
    }
}

// Refine a Bézier<->Arc crossing with 2D Newton solving B(t) = Arc(u), where
// Arc(u) = center + radius*(cos(start+sweep*u), sin(start+sweep*u)) so u is
// the arc's own sweep fraction (handles negative sweep and >180-degree
// sweeps naturally, unlike parameterizing directly by angle). Mirrors
// `refine_bezier_bezier_intersection`'s Jacobian-solve structure and
// defensive conditions (singular/non-finite Jacobian, non-finite step,
// 40-iteration cap, final residual tolerance), plus an extra requirement
// specific to arcs: the converged (t, u) must land within *this seed
// chord's own* local ranges (t_start..t_end and u_start..u_end), not just
// the global [0, 1] each side is clamped to during iteration -- otherwise a
// chord could steal a root that actually belongs to a neighboring chord.
fn refine_bezier_arc_intersection(
    bezier: &IntersectionSegment,
    arc: &IntersectionSegment,
    rough_point: Point,
) -> Option<(Point, f64, f64)> {
    let SegmentPrimitive::Bezier {
        segment,
        t_start,
        t_end,
    } = &bezier.primitive
    else {
        return None;
    };
    let SegmentPrimitive::Arc {
        center,
        radius,
        start_angle_deg,
        sweep_angle_deg,
        u_start,
        u_end,
    } = arc.primitive
    else {
        return None;
    };

    let solve = |mut t: f64, mut u: f64| -> Option<(Point, f64, f64)> {
        for _ in 0..40 {
            let pt = cubic_point(segment, t)?;
            let pu = arc_point_at_u(center, radius, start_angle_deg, sweep_angle_deg, u);
            let fx = pt.x - pu.x;
            let fy = pt.y - pu.y;
            let residual = fx.hypot(fy);
            if !residual.is_finite() {
                return None;
            }
            if residual <= EPSILON {
                break;
            }
            let dt_vec = cubic_derivative(segment, t)?;
            let arc_deriv = arc_derivative_at_u(radius, start_angle_deg, sweep_angle_deg, u);
            let neg_arc_deriv = Point {
                x: -arc_deriv.x,
                y: -arc_deriv.y,
            };
            let det = neg_arc_deriv.x * dt_vec.y - dt_vec.x * neg_arc_deriv.y;
            if !det.is_finite() || det.abs() <= EPSILON {
                return None;
            }
            let step_t = (neg_arc_deriv.y * fx - neg_arc_deriv.x * fy) / det;
            let step_u = (dt_vec.y * fx - dt_vec.x * fy) / det;
            if !step_t.is_finite() || !step_u.is_finite() {
                return None;
            }

            let mut damping = 1.0;
            let mut accepted = false;
            while damping >= 1.0 / 1024.0 {
                let next_t = t + damping * step_t;
                let next_u = u + damping * step_u;
                if next_t < *t_start - EPSILON
                    || next_t > *t_end + EPSILON
                    || next_u < u_start - EPSILON
                    || next_u > u_end + EPSILON
                {
                    damping /= 2.0;
                    continue;
                }
                let next_pt = cubic_point(segment, next_t)?;
                let next_pu =
                    arc_point_at_u(center, radius, start_angle_deg, sweep_angle_deg, next_u);
                if (next_pt.x - next_pu.x).hypot(next_pt.y - next_pu.y) < residual {
                    t = next_t;
                    u = next_u;
                    accepted = true;
                    break;
                }
                damping /= 2.0;
            }
            if !accepted {
                return None;
            }
        }

        let pt = cubic_point(segment, t)?;
        let pu = arc_point_at_u(center, radius, start_angle_deg, sweep_angle_deg, u);
        let residual = (pt.x - pu.x).hypot(pt.y - pu.y);
        (residual.is_finite() && residual <= INTERSECTION_TOLERANCE).then_some((pt, t, u))
    };

    let bisect_circle_root = || -> Option<(Point, f64, f64)> {
        let circle_residual = |t: f64| -> Option<f64> {
            let point = cubic_point(segment, t)?;
            Some((point.x - center.x).powi(2) + (point.y - center.y).powi(2) - radius.powi(2))
        };
        let mut low = *t_start;
        let mut high = *t_end;
        let mut low_value = circle_residual(low)?;
        let high_value = circle_residual(high)?;
        if !low_value.is_finite() || !high_value.is_finite() {
            return None;
        }
        if low_value.abs() > EPSILON
            && high_value.abs() > EPSILON
            && low_value.signum() == high_value.signum()
        {
            return None;
        }
        for _ in 0..80 {
            let mid = (low + high) / 2.0;
            let mid_value = circle_residual(mid)?;
            if mid_value.abs() <= EPSILON {
                low = mid;
                high = mid;
                break;
            }
            if low_value.signum() == mid_value.signum() {
                low = mid;
                low_value = mid_value;
            } else {
                high = mid;
            }
        }
        let bezier_t = (low + high) / 2.0;
        let point = cubic_point(segment, bezier_t)?;
        let angle_deg = (point.y - center.y).atan2(point.x - center.x).to_degrees();
        let arc_u = sweep_fraction_for_angle_in_range(
            start_angle_deg,
            sweep_angle_deg,
            angle_deg,
            u_start,
            u_end,
        )?;
        let arc_point = arc_point_at_u(center, radius, start_angle_deg, sweep_angle_deg, arc_u);
        ((point.x - arc_point.x).hypot(point.y - arc_point.y) <= INTERSECTION_TOLERANCE)
            .then_some((point, bezier_t, arc_u))
    };

    let rough_t = chord_seed(bezier, *t_start, *t_end, rough_point);
    let rough_u = chord_seed(arc, u_start, u_end, rough_point);
    let middle_t = (t_start + t_end) / 2.0;
    let middle_u = (u_start + u_end) / 2.0;
    solve(rough_t, rough_u)
        .or_else(|| solve(middle_t, middle_u))
        .or_else(|| solve(rough_t, middle_u))
        .or_else(|| solve(middle_t, rough_u))
        .or_else(bisect_circle_root)
}

fn refine_intersection(
    a: &IntersectionSegment,
    b: &IntersectionSegment,
    intersection: SegmentIntersection,
) -> Option<SegmentIntersection> {
    if matches!(a.primitive, SegmentPrimitive::Bezier { .. })
        && matches!(b.primitive, SegmentPrimitive::Bezier { .. })
    {
        if let Some((point, a_t, b_t)) = refine_bezier_bezier_intersection(a, b, intersection.point)
        {
            return Some(SegmentIntersection {
                point,
                line1_distance: distance_at_segment_t(a, a_t),
                line2_distance: distance_at_segment_t(b, b_t),
                overlap: false,
            });
        }
        return None;
    }
    if matches!(a.primitive, SegmentPrimitive::Arc { .. })
        && matches!(b.primitive, SegmentPrimitive::Arc { .. })
    {
        if let Some((point, u_a, u_b)) = refine_arc_arc_intersection(a, b, intersection.point) {
            return Some(SegmentIntersection {
                point,
                line1_distance: distance_at_arc_u(a, u_a),
                line2_distance: distance_at_arc_u(b, u_b),
                overlap: false,
            });
        }
        return None;
    }
    if matches!(a.primitive, SegmentPrimitive::Bezier { .. })
        && matches!(b.primitive, SegmentPrimitive::Arc { .. })
    {
        if let Some((point, bezier_t, arc_u)) =
            refine_bezier_arc_intersection(a, b, intersection.point)
        {
            return Some(SegmentIntersection {
                point,
                line1_distance: distance_at_segment_t(a, bezier_t),
                line2_distance: distance_at_arc_u(b, arc_u),
                overlap: false,
            });
        }
        return None;
    }
    if matches!(a.primitive, SegmentPrimitive::Arc { .. })
        && matches!(b.primitive, SegmentPrimitive::Bezier { .. })
    {
        if let Some((point, bezier_t, arc_u)) =
            refine_bezier_arc_intersection(b, a, intersection.point)
        {
            return Some(SegmentIntersection {
                point,
                line1_distance: distance_at_arc_u(a, arc_u),
                line2_distance: distance_at_segment_t(b, bezier_t),
                overlap: false,
            });
        }
        return None;
    }
    if matches!(a.primitive, SegmentPrimitive::Bezier { .. }) {
        if let Some((point, bezier_t, line_t)) = refine_bezier_line_intersection(a, b) {
            return Some(SegmentIntersection {
                point,
                line1_distance: distance_at_segment_t(a, bezier_t),
                line2_distance: b.start_distance + (b.end_distance - b.start_distance) * line_t,
                overlap: false,
            });
        }
        return None;
    }
    if matches!(b.primitive, SegmentPrimitive::Bezier { .. }) {
        if let Some((point, bezier_t, line_t)) = refine_bezier_line_intersection(b, a) {
            return Some(SegmentIntersection {
                point,
                line1_distance: a.start_distance + (a.end_distance - a.start_distance) * line_t,
                line2_distance: distance_at_segment_t(b, bezier_t),
                overlap: false,
            });
        }
        return None;
    }
    if matches!(a.primitive, SegmentPrimitive::Arc { .. }) {
        if let Some((point, arc_u, line_t)) = refine_arc_line_intersection(a, b, intersection.point)
        {
            return Some(SegmentIntersection {
                point,
                line1_distance: distance_at_arc_u(a, arc_u),
                line2_distance: b.start_distance + (b.end_distance - b.start_distance) * line_t,
                overlap: false,
            });
        }
        return None;
    }
    if matches!(b.primitive, SegmentPrimitive::Arc { .. }) {
        if let Some((point, arc_u, line_t)) = refine_arc_line_intersection(b, a, intersection.point)
        {
            return Some(SegmentIntersection {
                point,
                line1_distance: a.start_distance + (a.end_distance - a.start_distance) * line_t,
                line2_distance: distance_at_arc_u(b, arc_u),
                overlap: false,
            });
        }
        return None;
    }
    Some(intersection)
}

fn same_point(a: &LineIntersection, b: &LineIntersection) -> bool {
    (a.x - b.x).hypot(a.y - b.y) <= DEDUPE_EPSILON
}

pub(crate) fn find_line_intersections(
    line1: &Value,
    line2: &Value,
    use_extensions: bool,
) -> Option<LineIntersectionResult> {
    let base_segments1 = path_segments_for_line(line1)?;
    let base_segments2 = path_segments_for_line(line2)?;
    let mut segments1 = base_segments1.clone();
    let mut segments2 = base_segments2.clone();
    if use_extensions {
        segments1.extend(extension_segments(&base_segments1, line1));
        segments2.extend(extension_segments(&base_segments2, line2));
    }

    let mut intersections = Vec::<LineIntersection>::new();
    for segment1 in &segments1 {
        for segment2 in &segments2 {
            let Some(intersection) = segment_intersection(segment1, segment2) else {
                continue;
            };
            let Some(intersection) = refine_intersection(segment1, segment2, intersection) else {
                continue;
            };
            if intersection.overlap {
                return Some(LineIntersectionResult {
                    intersections,
                    error: Some(
                        "参照線同士が重なっているため、交点を一意に決められません。重ならない線を指定してください。"
                            .to_owned(),
                    ),
                });
            }

            let item = LineIntersection {
                x: intersection.point.x,
                y: intersection.point.y,
                line1_distance: intersection.line1_distance,
                line2_distance: intersection.line2_distance,
            };
            if !intersections
                .iter()
                .any(|existing| same_point(existing, &item))
            {
                intersections.push(item);
            }
        }
    }

    intersections.sort_by(|a, b| {
        a.line1_distance
            .total_cmp(&b.line1_distance)
            .then(a.line2_distance.total_cmp(&b.line2_distance))
            .then(a.x.total_cmp(&b.x))
            .then(a.y.total_cmp(&b.y))
    });

    Some(LineIntersectionResult {
        intersections,
        error: None,
    })
}
