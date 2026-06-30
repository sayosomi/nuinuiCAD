use serde_json::Value;

use super::bezier_path;
use super::math::{normalize_degrees, CIRCLE_EPSILON};

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

    let point = if distance_from_endpoint < 0.0 {
        extend_from(start_point, start_direction, distance_from_endpoint)
    } else if distance_from_endpoint > total_length {
        extend_from(
            end_point,
            end_direction,
            distance_from_endpoint - total_length,
        )
    } else {
        let mut remaining = distance_from_endpoint;
        for segment in &segments {
            if remaining <= segment.length {
                let t = if segment.length <= CIRCLE_EPSILON {
                    0.0
                } else {
                    remaining / segment.length
                };
                let point = interpolate(segment.start, segment.end, t);
                return Some((point.x, point.y));
            }
            remaining -= segment.length;
        }
        end_point
    };

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
    Some((
        normalize_degrees((-direction.y).atan2(direction.x).to_degrees()),
        best.1,
    ))
}
