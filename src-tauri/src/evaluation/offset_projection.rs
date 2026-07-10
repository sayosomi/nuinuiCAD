use serde_json::Value;

use super::bezier_math::{
    cubic_point, distance, interpolate, refine_bezier_projection, value_point, Point,
};
use super::math::normalize_degrees;

const EPSILON: f64 = 1e-9;

pub(crate) struct OffsetSegmentProjection {
    pub(crate) local_t: f64,
    pub(crate) point: Point,
    pub(crate) distance: f64,
}

fn project_line(point: Point, start: Point, end: Point) -> Option<OffsetSegmentProjection> {
    let vector = Point {
        x: end.x - start.x,
        y: end.y - start.y,
    };
    let length_squared = vector.x * vector.x + vector.y * vector.y;
    if length_squared <= EPSILON {
        return None;
    }
    let raw_t = ((point.x - start.x) * vector.x + (point.y - start.y) * vector.y) / length_squared;
    if !(-EPSILON..=1.0 + EPSILON).contains(&raw_t) {
        return None;
    }
    let local_t = raw_t.clamp(0.0, 1.0);
    let projected = interpolate(start, end, local_t);
    Some(OffsetSegmentProjection {
        local_t,
        point: projected,
        distance: distance(point, projected),
    })
}

fn project_arc(point: Point, segment: &Value) -> Option<OffsetSegmentProjection> {
    let center = segment.get("center").and_then(value_point)?;
    let radius = segment.get("radius")?.as_f64()?;
    let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
    let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
    if radius <= EPSILON || sweep_angle_deg.abs() <= EPSILON {
        return None;
    }
    let point_angle_deg = (point.y - center.y).atan2(point.x - center.x).to_degrees();
    let progress_deg = if sweep_angle_deg >= 0.0 {
        normalize_degrees(point_angle_deg - start_angle_deg)
    } else {
        -normalize_degrees(start_angle_deg - point_angle_deg)
    };
    let raw_t = progress_deg / sweep_angle_deg;
    if !(-EPSILON..=1.0 + EPSILON).contains(&raw_t) {
        return None;
    }
    let local_t = raw_t.clamp(0.0, 1.0);
    let angle_rad = (start_angle_deg + sweep_angle_deg * local_t).to_radians();
    let projected = Point {
        x: center.x + angle_rad.cos() * radius,
        y: center.y + angle_rad.sin() * radius,
    };
    Some(OffsetSegmentProjection {
        local_t,
        point: projected,
        distance: distance(point, projected),
    })
}

// Sampling picks a candidate offset sub-segment. This function then performs
// the exact primitive projection used for validation and splitting.
pub(crate) fn project_point_onto_offset_segment(
    point: Point,
    segment: &Value,
    seed_t: f64,
) -> Option<OffsetSegmentProjection> {
    match segment.get("kind")?.as_str()? {
        "line" => project_line(
            point,
            segment.get("start").and_then(value_point)?,
            segment.get("end").and_then(value_point)?,
        ),
        "arc" => project_arc(point, segment),
        "bezier" => {
            let refined = refine_bezier_projection(segment, point, seed_t)?;
            let projected = cubic_point(segment, refined.local_t)?;
            Some(OffsetSegmentProjection {
                local_t: refined.local_t,
                point: projected,
                distance: refined.distance_from_line,
            })
        }
        _ => None,
    }
}

fn sample_point(segment: &Value, t: f64) -> Option<Point> {
    match segment.get("kind")?.as_str()? {
        "line" => Some(interpolate(
            segment.get("start").and_then(value_point)?,
            segment.get("end").and_then(value_point)?,
            t,
        )),
        "bezier" => cubic_point(segment, t),
        "arc" => {
            let center = segment.get("center").and_then(value_point)?;
            let radius = segment.get("radius")?.as_f64()?;
            let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
            let angle_rad = (start_angle_deg + sweep_angle_deg * t).to_radians();
            Some(Point {
                x: center.x + angle_rad.cos() * radius,
                y: center.y + angle_rad.sin() * radius,
            })
        }
        _ => None,
    }
}

pub(crate) fn project_point_onto_offset_line(
    point: Point,
    segments: &[Value],
) -> Option<OffsetSegmentProjection> {
    let mut best: Option<OffsetSegmentProjection> = None;
    for segment in segments {
        let mut seed_t = 0.0;
        let mut seed_distance = f64::INFINITY;
        for index in 0..=32 {
            let t = index as f64 / 32.0;
            let Some(sampled) = sample_point(segment, t) else {
                continue;
            };
            let candidate = distance(point, sampled);
            if candidate < seed_distance {
                seed_distance = candidate;
                seed_t = t;
            }
        }
        let Some(projected) = project_point_onto_offset_segment(point, segment, seed_t) else {
            continue;
        };
        if best
            .as_ref()
            .map_or(true, |current| projected.distance < current.distance)
        {
            best = Some(projected);
        }
    }
    best
}
