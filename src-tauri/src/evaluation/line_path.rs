use serde_json::Value;

use super::bezier_math::{cubic_derivative, project_point_onto_curve, Point as BezierPoint};
use super::bezier_path;
use super::math::{normalize_degrees, CIRCLE_EPSILON};
use super::offset_projection::project_point_onto_offset_line;

const CURVE_PATH_STEPS: f64 = 32.0;

#[derive(Clone, Copy)]
struct PathPoint {
    x: f64,
    y: f64,
}

struct PathSegment {
    start: PathPoint,
    end: PathPoint,
    length: f64,
}

fn value_point(value: &Value) -> Option<PathPoint> {
    Some(PathPoint {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

fn distance(start: PathPoint, end: PathPoint) -> f64 {
    (end.x - start.x).hypot(end.y - start.y)
}

fn interpolate(start: PathPoint, end: PathPoint, t: f64) -> PathPoint {
    PathPoint {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
    }
}

fn unit_vector(start: PathPoint, end: PathPoint) -> Option<PathPoint> {
    let length = distance(start, end);
    (length > CIRCLE_EPSILON).then(|| PathPoint {
        x: (end.x - start.x) / length,
        y: (end.y - start.y) / length,
    })
}

fn angle_from_direction(direction: PathPoint) -> f64 {
    normalize_degrees(direction.y.atan2(direction.x).to_degrees())
}

fn extend_from(point: PathPoint, direction: PathPoint, distance_from_point: f64) -> PathPoint {
    PathPoint {
        x: point.x + direction.x * distance_from_point,
        y: point.y + direction.y * distance_from_point,
    }
}

fn projected_point_on_segment(point: PathPoint, segment: &PathSegment) -> Option<(PathPoint, f64)> {
    let vector = PathPoint {
        x: segment.end.x - segment.start.x,
        y: segment.end.y - segment.start.y,
    };
    let length_squared = vector.x * vector.x + vector.y * vector.y;
    if length_squared <= CIRCLE_EPSILON {
        return None;
    }

    let raw_t = ((point.x - segment.start.x) * vector.x + (point.y - segment.start.y) * vector.y)
        / length_squared;
    let t = raw_t.clamp(0.0, 1.0);
    let projected = interpolate(segment.start, segment.end, t);
    Some((projected, distance(point, projected)))
}

fn path_segment(start: PathPoint, end: PathPoint) -> Option<PathSegment> {
    let length = distance(start, end);
    (length > CIRCLE_EPSILON).then_some(PathSegment { start, end, length })
}

fn bezier_endpoint_tangent(segment: &Value, at_end: bool) -> Option<PathPoint> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let direction = if at_end {
        PathPoint {
            x: end.x - control2.x,
            y: end.y - control2.y,
        }
    } else {
        PathPoint {
            x: control1.x - start.x,
            y: control1.y - start.y,
        }
    };
    (direction.x.hypot(direction.y) > CIRCLE_EPSILON).then_some(direction)
}

fn bezier_endpoint_tangent_at_point(
    segment: &Value,
    point: PathPoint,
    tolerance: f64,
) -> Option<(f64, f64)> {
    let start = segment.get("start").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let start_distance = distance(point, start);
    let end_distance = distance(point, end);

    if start_distance <= tolerance {
        if let Some(direction) = bezier_endpoint_tangent(segment, false) {
            return Some((angle_from_direction(direction), start_distance));
        }
    }
    if end_distance <= tolerance {
        if let Some(direction) = bezier_endpoint_tangent(segment, true) {
            return Some((angle_from_direction(direction), end_distance));
        }
    }
    None
}

fn bezier_endpoint_tangent_on_geometry(
    geometry: &Value,
    point: PathPoint,
    tolerance: f64,
) -> Option<(f64, f64)> {
    let segments = geometry.get("segments")?.as_array()?;
    match geometry.get("kind")?.as_str()? {
        "bezierCurve" => segments
            .iter()
            .filter_map(|segment| bezier_endpoint_tangent_at_point(segment, point, tolerance))
            .min_by(|(_, left), (_, right)| left.total_cmp(right)),
        "offsetLine" => segments
            .iter()
            .filter(|segment| segment.get("kind").and_then(Value::as_str) == Some("bezier"))
            .filter_map(|segment| bezier_endpoint_tangent_at_point(segment, point, tolerance))
            .min_by(|(_, left), (_, right)| left.total_cmp(right)),
        _ => None,
    }
}

fn arc_point(center: PathPoint, radius: f64, angle_deg: f64) -> PathPoint {
    let angle_rad = angle_deg.to_radians();
    PathPoint {
        x: center.x + angle_rad.cos() * radius,
        y: center.y + angle_rad.sin() * radius,
    }
}

fn arc_segments(geometry: &Value) -> Option<Vec<PathSegment>> {
    let center = geometry.get("center").and_then(value_point)?;
    let radius = geometry.get("radius")?.as_f64()?.max(0.0);
    let start_angle_deg = geometry.get("startAngleDeg")?.as_f64()?;
    let sweep_angle_deg = geometry.get("sweepAngleDeg")?.as_f64()?;
    let step_count = ((sweep_angle_deg.abs() / 360.0) * CURVE_PATH_STEPS)
        .ceil()
        .max(1.0) as usize;
    let points = (0..=step_count)
        .map(|index| {
            arc_point(
                center,
                radius,
                start_angle_deg + (sweep_angle_deg * index as f64) / step_count as f64,
            )
        })
        .collect::<Vec<_>>();

    Some(
        points
            .windows(2)
            .filter_map(|pair| path_segment(pair[0], pair[1]))
            .collect(),
    )
}

fn bezier_segments(geometry: &Value) -> Option<Vec<PathSegment>> {
    let points = bezier_path::curve_points(geometry, CURVE_PATH_STEPS as usize)?;
    Some(
        points
            .windows(2)
            .filter_map(|pair| {
                path_segment(
                    PathPoint {
                        x: pair[0].x,
                        y: pair[0].y,
                    },
                    PathPoint {
                        x: pair[1].x,
                        y: pair[1].y,
                    },
                )
            })
            .collect(),
    )
}

fn offset_segment_points(segment: &Value) -> Option<Vec<PathPoint>> {
    match segment.get("kind")?.as_str()? {
        "line" => Some(vec![
            segment.get("start").and_then(value_point)?,
            segment.get("end").and_then(value_point)?,
        ]),
        "bezier" => Some(
            bezier_path::segment_points(segment, CURVE_PATH_STEPS as usize)?
                .into_iter()
                .map(|point| PathPoint {
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
            let step_count = ((sweep_angle_deg.abs() / 360.0) * CURVE_PATH_STEPS)
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

fn offset_segments(geometry: &Value) -> Option<Vec<PathSegment>> {
    let mut output = Vec::new();
    for segment in geometry.get("segments")?.as_array()? {
        let points = offset_segment_points(segment)?;
        output.extend(
            points
                .windows(2)
                .filter_map(|pair| path_segment(pair[0], pair[1])),
        );
    }
    Some(output)
}

fn segments_for_geometry(geometry: &Value) -> Option<Vec<PathSegment>> {
    match geometry.get("kind")?.as_str()? {
        "line" => {
            let start = geometry.get("start").and_then(value_point)?;
            let end = geometry.get("end").and_then(value_point)?;
            Some(path_segment(start, end).into_iter().collect())
        }
        "arcLine" => arc_segments(geometry),
        "bezierCurve" => bezier_segments(geometry),
        "offsetLine" => offset_segments(geometry),
        _ => None,
    }
}

// Move a point located by the 32-step arc-length walk onto the *true* geometry:
// the analytic cubic for Béziers, the exact circle for arcs, and the analytic
// primitives contained by offset lines.
fn snap_onto_geometry(geometry: &Value, point: PathPoint) -> Option<PathPoint> {
    match geometry.get("kind").and_then(Value::as_str)? {
        "bezierCurve" => {
            let segments = geometry.get("segments")?.as_array()?;
            let projection = project_point_onto_curve(
                segments,
                BezierPoint {
                    x: point.x,
                    y: point.y,
                },
            )?;
            Some(PathPoint {
                x: projection.point.x,
                y: projection.point.y,
            })
        }
        "arcLine" => {
            let center = geometry.get("center").and_then(value_point)?;
            let radius = geometry.get("radius")?.as_f64()?.max(0.0);
            let direction = unit_vector(center, point)?;
            Some(PathPoint {
                x: center.x + direction.x * radius,
                y: center.y + direction.y * radius,
            })
        }
        "offsetLine" => {
            let segments = geometry.get("segments")?.as_array()?;
            let projection = project_point_onto_offset_line(
                BezierPoint {
                    x: point.x,
                    y: point.y,
                },
                segments,
            )?;
            Some(PathPoint {
                x: projection.point.x,
                y: projection.point.y,
            })
        }
        _ => None,
    }
}

pub(crate) fn geometry_length(geometry: &Value) -> Option<f64> {
    geometry.get("length")?.as_f64()
}

pub(crate) fn point_at_distance_from_endpoint(
    geometry: &Value,
    endpoint_key: &str,
    distance_from_endpoint: f64,
) -> Option<(f64, f64)> {
    let forward_segments = segments_for_geometry(geometry)?;
    let segments = if endpoint_key == "start" {
        forward_segments
    } else {
        forward_segments
            .into_iter()
            .rev()
            .map(|segment| PathSegment {
                start: segment.end,
                end: segment.start,
                length: segment.length,
            })
            .collect()
    };
    if segments.is_empty() {
        return None;
    }

    let total_length = segments.iter().map(|segment| segment.length).sum::<f64>();
    let start_point = segments.first()?.start;
    let end_point = segments.last()?.end;
    let start_direction = unit_vector(segments.first()?.start, segments.first()?.end)?;
    let end_direction = unit_vector(segments.last()?.start, segments.last()?.end)?;

    // Beyond either endpoint the point extends straight along the endpoint
    // tangent — intentionally off-curve, so no snapping.
    if distance_from_endpoint < 0.0 {
        let point = extend_from(start_point, start_direction, distance_from_endpoint);
        return Some((point.x, point.y));
    }
    if distance_from_endpoint > total_length {
        let point = extend_from(
            end_point,
            end_direction,
            distance_from_endpoint - total_length,
        );
        return Some((point.x, point.y));
    }

    let mut remaining = distance_from_endpoint;
    let mut chord_point = end_point;
    for segment in &segments {
        if remaining <= segment.length {
            let t = if segment.length <= CIRCLE_EPSILON {
                0.0
            } else {
                remaining / segment.length
            };
            chord_point = interpolate(segment.start, segment.end, t);
            break;
        }
        remaining -= segment.length;
    }

    // Place the in-range point on the true geometry, not the sampled chord.
    let point = snap_onto_geometry(geometry, chord_point).unwrap_or(chord_point);
    Some((point.x, point.y))
}

pub(crate) fn tangent_at_point_on_geometry(
    geometry: &Value,
    point: (f64, f64),
    tolerance: f64,
) -> Option<(f64, f64)> {
    let point = PathPoint {
        x: point.0,
        y: point.1,
    };
    if let Some(tangent) = bezier_endpoint_tangent_on_geometry(geometry, point, tolerance) {
        return Some(tangent);
    }

    // Analytic tangent on the true geometry for Béziers and arcs.
    match geometry.get("kind").and_then(Value::as_str) {
        Some("bezierCurve") => {
            let segments = geometry.get("segments")?.as_array()?;
            let projection = project_point_onto_curve(
                segments,
                BezierPoint {
                    x: point.x,
                    y: point.y,
                },
            )?;
            if projection.distance > tolerance {
                return None;
            }
            let derivative =
                cubic_derivative(&segments[projection.segment_index], projection.local_t)?;
            return Some((
                angle_from_direction(PathPoint {
                    x: derivative.x,
                    y: derivative.y,
                }),
                projection.distance,
            ));
        }
        Some("arcLine") => {
            let center = geometry.get("center").and_then(value_point)?;
            let radius = geometry.get("radius")?.as_f64()?.max(0.0);
            let sweep_angle_deg = geometry.get("sweepAngleDeg")?.as_f64()?;
            let radial = unit_vector(center, point)?;
            let distance_from_line = (distance(center, point) - radius).abs();
            if distance_from_line > tolerance {
                return None;
            }
            // Forward tangent = radial rotated 90° in the sweep direction.
            let sign = if sweep_angle_deg >= 0.0 { 1.0 } else { -1.0 };
            let tangent = PathPoint {
                x: -radial.y * sign,
                y: radial.x * sign,
            };
            return Some((angle_from_direction(tangent), distance_from_line));
        }
        _ => {}
    }

    let segments = segments_for_geometry(geometry)?;
    let best = segments
        .iter()
        .filter_map(|segment| {
            projected_point_on_segment(point, segment)
                .map(|(_, distance_from_line)| (segment, distance_from_line))
        })
        .min_by(|(_, left), (_, right)| left.total_cmp(right))?;

    if best.1 > tolerance {
        return None;
    }

    let direction = unit_vector(best.0.start, best.0.end)?;
    Some((angle_from_direction(direction), best.1))
}
