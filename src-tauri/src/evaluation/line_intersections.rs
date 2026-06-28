use serde_json::Value;

use super::bezier_path;

const ARC_STEPS: f64 = 64.0;
const CURVE_STEPS: usize = 64;
const EXTENSION_LENGTH: f64 = 1_000_000.0;
const EPSILON: f64 = 1e-9;
const DEDUPE_EPSILON: f64 = 1e-5;

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy)]
struct IntersectionSegment {
    start: Point,
    end: Point,
    start_distance: f64,
    end_distance: f64,
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

fn arc_point(center: Point, radius: f64, angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    Point {
        x: center.x + angle_rad.cos() * radius,
        y: center.y - angle_rad.sin() * radius,
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

fn bezier_points(geometry: &Value) -> Option<Vec<Point>> {
    Some(
        bezier_path::curve_points(geometry, CURVE_STEPS)?
            .into_iter()
            .map(|point| Point {
                x: point.x,
                y: point.y,
            })
            .collect(),
    )
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
            Some(point_path_segments(&[start, end]))
        }
        "arcLine" => arc_points(geometry).map(|points| point_path_segments(&points)),
        "bezierCurve" => bezier_points(geometry).map(|points| point_path_segments(&points)),
        "offsetLine" => {
            if geometry
                .get("closed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Some(Vec::new());
            }
            offset_points(geometry).map(|points| point_path_segments(&points))
        }
        _ => None,
    }
}

fn extension_segments(segments: &[IntersectionSegment]) -> Vec<IntersectionSegment> {
    let Some(first) = segments.first() else {
        return Vec::new();
    };
    let Some(last) = segments.last() else {
        return Vec::new();
    };
    let first_length = distance(first.start, first.end);
    let last_length = distance(last.start, last.end);
    if first_length <= EPSILON || last_length <= EPSILON {
        return Vec::new();
    }

    let start_direction = Point {
        x: (first.start.x - first.end.x) / first_length,
        y: (first.start.y - first.end.y) / first_length,
    };
    let end_direction = Point {
        x: (last.end.x - last.start.x) / last_length,
        y: (last.end.y - last.start.y) / last_length,
    };

    vec![
        IntersectionSegment {
            start: Point {
                x: first.start.x + start_direction.x * EXTENSION_LENGTH,
                y: first.start.y + start_direction.y * EXTENSION_LENGTH,
            },
            end: first.start,
            start_distance: -EXTENSION_LENGTH,
            end_distance: 0.0,
        },
        IntersectionSegment {
            start: last.end,
            end: Point {
                x: last.end.x + end_direction.x * EXTENSION_LENGTH,
                y: last.end.y + end_direction.y * EXTENSION_LENGTH,
            },
            start_distance: last.end_distance,
            end_distance: last.end_distance + EXTENSION_LENGTH,
        },
    ]
}

fn cross(a: Point, b: Point) -> f64 {
    a.x * b.y - a.y * b.x
}

fn segment_intersection(
    a: IntersectionSegment,
    b: IntersectionSegment,
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
        segments1.extend(extension_segments(&base_segments1));
        segments2.extend(extension_segments(&base_segments2));
    }

    let mut intersections = Vec::<LineIntersection>::new();
    for segment1 in &segments1 {
        for segment2 in &segments2 {
            let Some(intersection) = segment_intersection(*segment1, *segment2) else {
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
