use serde_json::{json, Value};

use super::bezier_path;
use super::math::{arc_tangent_angles, normalize_degrees};
use super::point_anchor::computed_point;

const CURVE_STEPS: usize = 96;
const ARC_STEPS: f64 = 96.0;
pub(crate) const EPSILON: f64 = 1e-7;

#[derive(Clone, Copy)]
pub(crate) struct Point {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

pub(crate) struct PathSample {
    pub(crate) point: Point,
    pub(crate) distance: f64,
}

pub(crate) struct CornerArc {
    pub(crate) geometry: Value,
    pub(crate) start: Point,
    pub(crate) end: Point,
}

pub(crate) fn value_point(value: &Value) -> Option<Point> {
    Some(Point {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

pub(crate) fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}

fn cross(a: Point, b: Point) -> f64 {
    a.x * b.y - a.y * b.x
}

fn normalize(point: Point) -> Option<Point> {
    let length = point.x.hypot(point.y);
    (length > EPSILON).then_some(Point {
        x: point.x / length,
        y: point.y / length,
    })
}

fn point_at(start: Point, direction: Point, amount: f64) -> Point {
    Point {
        x: start.x + direction.x * amount,
        y: start.y + direction.y * amount,
    }
}

fn same_point(a: Point, b: Point) -> bool {
    distance(a, b) <= EPSILON
}

fn angle_of_point(center: Point, point: Point) -> f64 {
    normalize_degrees((point.y - center.y).atan2(point.x - center.x).to_degrees())
}

fn signed_sweep(start_angle_deg: f64, end_angle_deg: f64, ccw: bool) -> f64 {
    let positive = normalize_degrees(end_angle_deg - start_angle_deg);
    if ccw {
        positive
    } else {
        positive - 360.0
    }
}

fn arc_point(center: Point, radius: f64, angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    Point {
        x: center.x + angle_rad.cos() * radius,
        y: center.y + angle_rad.sin() * radius,
    }
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

pub(crate) fn geometry_points(geometry: &Value) -> Option<Vec<Point>> {
    match geometry.get("kind")?.as_str()? {
        "line" => Some(vec![
            geometry.get("start").and_then(value_point)?,
            geometry.get("end").and_then(value_point)?,
        ]),
        "arcLine" => arc_points(geometry),
        "bezierCurve" => bezier_points(geometry),
        "offsetLine" | "joinedPath" => {
            let mut output = Vec::new();
            for (index, segment) in geometry.get("segments")?.as_array()?.iter().enumerate() {
                let points = offset_segment_points(segment)?;
                if index == 0 {
                    output.extend(points);
                } else {
                    output.extend(points.into_iter().skip(1));
                }
            }
            Some(output)
        }
        _ => None,
    }
}

fn path_samples(points: &[Point]) -> Vec<PathSample> {
    let mut samples = Vec::new();
    let mut accumulated = 0.0;
    for (index, point) in points.iter().enumerate() {
        if index > 0 {
            accumulated += distance(points[index - 1], *point);
        }
        samples.push(PathSample {
            point: *point,
            distance: accumulated,
        });
    }
    samples
}

fn endpoint_point(geometry: &Value, endpoint_key: &str) -> Option<Point> {
    match geometry.get("kind")?.as_str()? {
        "line" | "arcLine" | "offsetLine" | "joinedPath" => {
            geometry.get(endpoint_key).and_then(value_point)
        }
        "bezierCurve" => {
            let segments = geometry.get("segments")?.as_array()?;
            if endpoint_key == "start" {
                segments.first()?.get("start").and_then(value_point)
            } else {
                segments.last()?.get("end").and_then(value_point)
            }
        }
        _ => None,
    }
}

fn endpoint_inward_direction(samples: &[PathSample], endpoint_key: &str) -> Option<Point> {
    if samples.len() < 2 {
        return None;
    }
    if endpoint_key == "start" {
        return normalize(Point {
            x: samples[1].point.x - samples[0].point.x,
            y: samples[1].point.y - samples[0].point.y,
        });
    }
    let last = samples.last()?;
    let before_last = samples.get(samples.len() - 2)?;
    normalize(Point {
        x: before_last.point.x - last.point.x,
        y: before_last.point.y - last.point.y,
    })
}

pub(crate) fn ray_direction_for_endpoint(
    geometry: &Value,
    endpoint_key: &str,
    corner: Point,
    samples: &[PathSample],
) -> Option<Point> {
    let selected = endpoint_point(geometry, endpoint_key)?;
    normalize(Point {
        x: selected.x - corner.x,
        y: selected.y - corner.y,
    })
    .or_else(|| endpoint_inward_direction(samples, endpoint_key))
}

pub(crate) fn samples_for_geometry(geometry: &Value) -> Option<Vec<PathSample>> {
    geometry_points(geometry).map(|points| path_samples(&points))
}

pub(crate) fn corner_radius_geometry(
    element_id: &str,
    element_name: &str,
    corner: Point,
    direction1: Point,
    direction2: Point,
    radius: f64,
) -> Option<CornerArc> {
    let unit1 = normalize(direction1)?;
    let unit2 = normalize(direction2)?;
    let clamped_dot = dot(unit1, unit2).clamp(-1.0, 1.0);
    let angle = clamped_dot.acos();
    if angle <= EPSILON || (std::f64::consts::PI - angle).abs() <= EPSILON {
        return None;
    }
    let tangent_distance = radius / (angle / 2.0).tan();
    let bisector = normalize(Point {
        x: unit1.x + unit2.x,
        y: unit1.y + unit2.y,
    })?;
    let center_distance = radius / (angle / 2.0).sin();
    let center = point_at(corner, bisector, center_distance);
    let tangent1 = point_at(corner, unit1, tangent_distance);
    let tangent2 = point_at(corner, unit2, tangent_distance);
    let start_angle_deg = angle_of_point(center, tangent1);
    let end_angle_deg = angle_of_point(center, tangent2);
    let ccw = cross(
        Point {
            x: tangent1.x - center.x,
            y: tangent1.y - center.y,
        },
        Point {
            x: tangent2.x - center.x,
            y: tangent2.y - center.y,
        },
    ) >= 0.0;
    let sweep_angle_deg = signed_sweep(start_angle_deg, end_angle_deg, ccw);
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let geometry = json!({
        "kind": "arcLine",
        "elementId": element_id,
        "name": element_name,
        "centerPointId": Value::Null,
        "center": computed_point(format!("{element_id}:center"), format!("{element_name}.中心点"), center.x, center.y),
        "start": computed_point(format!("{element_id}:start"), format!("{element_name}.始点"), tangent1.x, tangent1.y),
        "end": computed_point(format!("{element_id}:end"), format!("{element_name}.終点"), tangent2.x, tangent2.y),
        "radius": radius,
        "startAngleDeg": start_angle_deg,
        "endAngleDeg": end_angle_deg,
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg,
        "sweepAngleDeg": sweep_angle_deg,
        "length": radius * sweep_angle_deg.to_radians().abs()
    });
    Some(CornerArc {
        geometry,
        start: tangent1,
        end: tangent2,
    })
}

pub(crate) fn points_same_from_geometry(arc: &CornerArc) -> bool {
    same_point(arc.start, arc.end)
}

pub(crate) fn point_from_intersection(x: f64, y: f64) -> Point {
    Point { x, y }
}
