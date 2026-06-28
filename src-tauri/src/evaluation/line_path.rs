use serde_json::Value;

use super::math::CIRCLE_EPSILON;

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

fn path_segment(start: PathPoint, end: PathPoint) -> Option<PathSegment> {
    let length = distance(start, end);
    (length > CIRCLE_EPSILON).then_some(PathSegment { start, end, length })
}

fn arc_point(center: PathPoint, radius: f64, angle_deg: f64) -> PathPoint {
    let angle_rad = angle_deg.to_radians();
    PathPoint {
        x: center.x + angle_rad.cos() * radius,
        y: center.y - angle_rad.sin() * radius,
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

fn segments_for_geometry(geometry: &Value) -> Option<Vec<PathSegment>> {
    match geometry.get("kind")?.as_str()? {
        "line" => {
            let start = geometry.get("start").and_then(value_point)?;
            let end = geometry.get("end").and_then(value_point)?;
            Some(path_segment(start, end).into_iter().collect())
        }
        "arcLine" => arc_segments(geometry),
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
