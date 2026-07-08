use serde_json::Value;

use super::bezier_math::cubic_derivative as bm_cubic_derivative;
use super::bezier_path::{self, cubic_point_at};

const ARC_STEPS: f64 = 64.0;
const CURVE_STEPS: usize = 64;
const EXTENSION_LENGTH: f64 = 1_000_000.0;
const EPSILON: f64 = 1e-9;
const DEDUPE_EPSILON: f64 = 1e-5;
const BEZIER_INTERSECTION_TOLERANCE: f64 = 1e-6;

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone)]
enum SegmentPrimitive {
    Line {
        exact: bool,
    },
    Bezier {
        segment: Value,
        t_start: f64,
        t_end: f64,
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

fn point_path_segments(points: &[Point], exact_line: bool) -> Vec<IntersectionSegment> {
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
            primitive: SegmentPrimitive::Line { exact: exact_line },
        });
        accumulated += length;
    }

    segments
}

fn arc_points(geometry: &Value) -> Option<Vec<Point>> {
    let center = geometry.get("center").and_then(value_point)?;
    let radius = geometry.get("radius")?.as_f64()?.max(0.0);
    let start_angle_deg = geometry.get("startAngleDeg")?.as_f64()?;
    let sweep_angle_deg = geometry.get("sweepAngleDeg")?.as_f64()?;
    let step_count = ((sweep_angle_deg.abs() / 360.0) * ARC_STEPS)
        .ceil()
        .max(1.0) as usize;

    Some(
        (0..=step_count)
            .map(|index| {
                arc_point(
                    center,
                    radius,
                    start_angle_deg + (sweep_angle_deg * index as f64) / step_count as f64,
                )
            })
            .collect(),
    )
}

fn bezier_path_segments(geometry: &Value) -> Option<Vec<IntersectionSegment>> {
    let segments = geometry.get("segments")?.as_array()?;
    let mut output = Vec::new();
    let mut accumulated = 0.0;

    for segment in segments {
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
                start_distance: accumulated,
                end_distance: accumulated + length,
                primitive: SegmentPrimitive::Bezier {
                    segment: segment.clone(),
                    t_start: index as f64 / CURVE_STEPS as f64,
                    t_end: (index + 1) as f64 / CURVE_STEPS as f64,
                },
            });
            accumulated += length;
        }
    }

    Some(output)
}

fn offset_segment_points(segment: &Value) -> Option<Vec<Point>> {
    match segment.get("kind")?.as_str()? {
        "line" => Some(vec![
            segment.get("start").and_then(value_point)?,
            segment.get("end").and_then(value_point)?,
        ]),
        "bezier" => Some(
            bezier_path::segment_points(segment, CURVE_STEPS)?
                .into_iter()
                .map(|point| Point {
                    x: point.x,
                    y: point.y,
                })
                .collect(),
        ),
        "arc" => {
            let center = segment.get("center").and_then(value_point)?;
            let radius = segment.get("radius")?.as_f64()?.max(0.0);
            let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
            let step_count = ((sweep_angle_deg.abs() / 360.0) * ARC_STEPS)
                .ceil()
                .max(1.0) as usize;
            Some(
                (0..=step_count)
                    .map(|index| {
                        arc_point(
                            center,
                            radius,
                            start_angle_deg + (sweep_angle_deg * index as f64) / step_count as f64,
                        )
                    })
                    .collect(),
            )
        }
        _ => None,
    }
}

fn offset_points(line: &Value) -> Option<Vec<Point>> {
    line.get("segments")?
        .as_array()?
        .iter()
        .enumerate()
        .try_fold(Vec::new(), |mut output, (index, segment)| {
            let points = offset_segment_points(segment)?;
            if index == 0 {
                output.extend(points);
            } else {
                output.extend(points.into_iter().skip(1));
            }
            Some(output)
        })
}

fn path_segments_for_line(geometry: &Value) -> Option<Vec<IntersectionSegment>> {
    match geometry.get("kind")?.as_str()? {
        "line" => {
            let start = geometry.get("start").and_then(value_point)?;
            let end = geometry.get("end").and_then(value_point)?;
            Some(point_path_segments(&[start, end], true))
        }
        "arcLine" => arc_points(geometry).map(|points| point_path_segments(&points, false)),
        "bezierCurve" => bezier_path_segments(geometry),
        "offsetLine" => {
            if geometry
                .get("closed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Some(Vec::new());
            }
            offset_points(geometry).map(|points| point_path_segments(&points, false))
        }
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
        "offsetLine" => {
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
            primitive: SegmentPrimitive::Line { exact: true },
        },
        IntersectionSegment {
            start: tangents.end,
            end: Point {
                x: tangents.end.x + tangents.end_forward.x * EXTENSION_LENGTH,
                y: tangents.end.y + tangents.end_forward.y * EXTENSION_LENGTH,
            },
            start_distance: total_distance,
            end_distance: total_distance + EXTENSION_LENGTH,
            primitive: SegmentPrimitive::Line { exact: true },
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

// Refine a Bézier↔Bézier crossing with 2D Newton solving A(t) = B(u), seeded
// from the rough polyline crossing. Returns None when it cannot converge
// (e.g. near-tangent curves), leaving the rough crossing in place.
fn refine_bezier_bezier_intersection(
    a: &IntersectionSegment,
    b: &IntersectionSegment,
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

    let mut t_a = (a_start + a_end) / 2.0;
    let mut t_b = (b_start + b_end) / 2.0;

    for _ in 0..40 {
        let pa = cubic_point(seg_a, t_a)?;
        let pb = cubic_point(seg_b, t_b)?;
        let fx = pa.x - pb.x;
        let fy = pa.y - pb.y;
        if fx.hypot(fy) <= EPSILON {
            break;
        }
        let da = cubic_derivative(seg_a, t_a)?;
        let db = cubic_derivative(seg_b, t_b)?;
        // Jacobian J = [[da.x, -db.x], [da.y, -db.y]]; solve J·d = -F.
        let det = db.x * da.y - da.x * db.y;
        if det.abs() <= EPSILON {
            return None;
        }
        let dt_a = (db.y * fx - db.x * fy) / det;
        let dt_b = (da.y * fx - da.x * fy) / det;
        t_a = (t_a + dt_a).clamp(0.0, 1.0);
        t_b = (t_b + dt_b).clamp(0.0, 1.0);
    }

    let pa = cubic_point(seg_a, t_a)?;
    let pb = cubic_point(seg_b, t_b)?;
    if (pa.x - pb.x).hypot(pa.y - pb.y) > BEZIER_INTERSECTION_TOLERANCE {
        return None;
    }
    Some((pa, t_a, t_b))
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
    let SegmentPrimitive::Line { exact: true } = line.primitive else {
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

fn refine_intersection(
    a: &IntersectionSegment,
    b: &IntersectionSegment,
    intersection: SegmentIntersection,
) -> SegmentIntersection {
    if matches!(a.primitive, SegmentPrimitive::Bezier { .. })
        && matches!(b.primitive, SegmentPrimitive::Bezier { .. })
    {
        if let Some((point, a_t, b_t)) = refine_bezier_bezier_intersection(a, b) {
            return SegmentIntersection {
                point,
                line1_distance: distance_at_segment_t(a, a_t),
                line2_distance: distance_at_segment_t(b, b_t),
                overlap: false,
            };
        }
    }
    if matches!(a.primitive, SegmentPrimitive::Bezier { .. }) {
        if let Some((point, bezier_t, line_t)) = refine_bezier_line_intersection(a, b) {
            return SegmentIntersection {
                point,
                line1_distance: distance_at_segment_t(a, bezier_t),
                line2_distance: b.start_distance + (b.end_distance - b.start_distance) * line_t,
                overlap: false,
            };
        }
    }
    if matches!(b.primitive, SegmentPrimitive::Bezier { .. }) {
        if let Some((point, bezier_t, line_t)) = refine_bezier_line_intersection(b, a) {
            return SegmentIntersection {
                point,
                line1_distance: a.start_distance + (a.end_distance - a.start_distance) * line_t,
                line2_distance: distance_at_segment_t(b, bezier_t),
                overlap: false,
            };
        }
    }
    intersection
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
            let intersection = refine_intersection(segment1, segment2, intersection);
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
