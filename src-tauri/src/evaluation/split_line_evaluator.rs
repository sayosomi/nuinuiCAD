use serde_json::{json, Value};
use std::collections::HashMap;

use super::bezier_path::{approximate_segment_length, cubic_point_at};
use super::errors::{dependency_error, geometry_error};
use super::math::{arc_tangent_angles, normalize_degrees};
use super::point_anchor::{anchor_reference_element_id, computed_point, point_anchor_or_error};
use super::types::{
    element_id, element_name, insert_geometry, EvaluationState, Point as ComputedPoint,
};

const TOLERANCE_MM: f64 = 0.001;
const EPSILON: f64 = 1e-9;
const CURVE_STEPS: usize = 32;

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

struct Projection {
    raw_t: f64,
    t: f64,
    projection: Point,
    distance: f64,
}

struct SampleHit {
    segment_index: usize,
    local_t: f64,
    distance_from_start: f64,
    distance_from_line: f64,
    point: Point,
}

struct SplitResult {
    near: Value,
    far: Value,
}

enum SplitGeometryResult {
    Split(SplitResult),
    Endpoint,
    NotOnLine,
}

fn value_point(value: &Value) -> Option<Point> {
    Some(Point {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

fn split_point_value(split_point: &ComputedPoint, point: Point) -> Value {
    computed_point(
        split_point.element_id.clone(),
        split_point.name.clone(),
        point.x,
        point.y,
    )
}

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

fn interpolate(start: Point, end: Point, t: f64) -> Point {
    Point {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
    }
}

fn angle_from_to(start: Point, end: Point) -> Value {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    if length <= EPSILON {
        Value::Null
    } else {
        json!(normalize_degrees(dy.atan2(dx).to_degrees()))
    }
}

fn projected_point(point: Point, start: Point, end: Point) -> Option<Projection> {
    let vector = Point {
        x: end.x - start.x,
        y: end.y - start.y,
    };
    let length_squared = vector.x * vector.x + vector.y * vector.y;
    if length_squared <= EPSILON {
        return None;
    }
    let raw_t = ((point.x - start.x) * vector.x + (point.y - start.y) * vector.y) / length_squared;
    let t = raw_t.clamp(0.0, 1.0);
    let projection = interpolate(start, end, t);
    Some(Projection {
        raw_t,
        t,
        projection,
        distance: distance(point, projection),
    })
}

fn computed_line(
    element_id: &str,
    name: &str,
    start: Value,
    end: Value,
    start_point_id: Value,
    end_point_id: Value,
) -> Value {
    let start_point = value_point(&start).unwrap_or(Point { x: 0.0, y: 0.0 });
    let end_point = value_point(&end).unwrap_or(Point { x: 0.0, y: 0.0 });
    let start_angle = angle_from_to(start_point, end_point);
    let end_angle = angle_from_to(end_point, start_point);
    json!({
        "kind": "line",
        "elementId": element_id,
        "name": name,
        "startPointId": start_point_id,
        "endPointId": end_point_id,
        "start": start,
        "end": end,
        "length": distance(start_point, end_point),
        "startAngleDeg": start_angle,
        "endAngleDeg": end_angle,
        "startTangentAngleDeg": start_angle,
        "endTangentAngleDeg": end_angle
    })
}

fn line_point_id(line: &Value, key: &str) -> Value {
    line.get(key).cloned().unwrap_or(Value::Null)
}

fn split_line_geometry(
    line: &Value,
    split_point: &ComputedPoint,
    split_line_id: &str,
    split_line_name: &str,
    split_point_id: Value,
) -> SplitGeometryResult {
    let Some(start) = line.get("start").and_then(value_point) else {
        return SplitGeometryResult::NotOnLine;
    };
    let Some(end) = line.get("end").and_then(value_point) else {
        return SplitGeometryResult::NotOnLine;
    };
    let Some(projection) = projected_point(
        Point {
            x: split_point.x,
            y: split_point.y,
        },
        start,
        end,
    ) else {
        return SplitGeometryResult::NotOnLine;
    };
    if projection.distance > TOLERANCE_MM
        || projection.raw_t < -EPSILON
        || projection.raw_t > 1.0 + EPSILON
    {
        return SplitGeometryResult::NotOnLine;
    }
    let line_length = line.get("length").and_then(Value::as_f64).unwrap_or(0.0);
    let endpoint_threshold = TOLERANCE_MM / line_length.max(TOLERANCE_MM);
    if projection.t <= endpoint_threshold || projection.t >= 1.0 - endpoint_threshold {
        return SplitGeometryResult::Endpoint;
    }

    let split = split_point_value(split_point, projection.projection);
    let base_id = line
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let base_name = line.get("name").and_then(Value::as_str).unwrap_or_default();
    SplitGeometryResult::Split(SplitResult {
        near: computed_line(
            base_id,
            base_name,
            line.get("start").cloned().unwrap_or(Value::Null),
            split.clone(),
            line_point_id(line, "startPointId"),
            split_point_id.clone(),
        ),
        far: computed_line(
            split_line_id,
            split_line_name,
            split,
            line.get("end").cloned().unwrap_or(Value::Null),
            split_point_id,
            line_point_id(line, "endPointId"),
        ),
    })
}

fn arc_point(center: Point, radius: f64, angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    Point {
        x: center.x + angle_rad.cos() * radius,
        y: center.y + angle_rad.sin() * radius,
    }
}

fn arc_geometry(
    element_id: &str,
    name: &str,
    center: Value,
    center_point_id: Value,
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
) -> Value {
    let center_point = value_point(&center).unwrap_or(Point { x: 0.0, y: 0.0 });
    let end_angle_deg = start_angle_deg + sweep_angle_deg;
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let start = arc_point(center_point, radius, start_angle_deg);
    let end = arc_point(center_point, radius, end_angle_deg);
    json!({
        "kind": "arcLine",
        "elementId": element_id,
        "name": name,
        "centerPointId": center_point_id,
        "center": center,
        "start": computed_point(format!("{element_id}:start"), format!("{name}.始点"), start.x, start.y),
        "end": computed_point(format!("{element_id}:end"), format!("{name}.終点"), end.x, end.y),
        "radius": radius,
        "startAngleDeg": start_angle_deg,
        "endAngleDeg": end_angle_deg,
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg,
        "sweepAngleDeg": sweep_angle_deg,
        "length": radius.max(0.0) * sweep_angle_deg.to_radians().abs()
    })
}

fn signed_arc_progress(start_angle_deg: f64, sweep_angle_deg: f64, point_angle_deg: f64) -> f64 {
    if sweep_angle_deg >= 0.0 {
        normalize_degrees(point_angle_deg - start_angle_deg)
    } else {
        -normalize_degrees(start_angle_deg - point_angle_deg)
    }
}

fn split_arc_geometry(
    arc: &Value,
    split_point: &ComputedPoint,
    split_line_id: &str,
    split_line_name: &str,
) -> SplitGeometryResult {
    let Some(center_value) = arc.get("center").cloned() else {
        return SplitGeometryResult::NotOnLine;
    };
    let Some(center) = value_point(&center_value) else {
        return SplitGeometryResult::NotOnLine;
    };
    let radius = arc.get("radius").and_then(Value::as_f64).unwrap_or(0.0);
    let start_angle_deg = arc
        .get("startAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let sweep_angle_deg = arc
        .get("sweepAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if radius <= EPSILON || sweep_angle_deg.abs() <= EPSILON {
        return SplitGeometryResult::NotOnLine;
    }
    let point = Point {
        x: split_point.x,
        y: split_point.y,
    };
    if (distance(point, center) - radius).abs() > TOLERANCE_MM {
        return SplitGeometryResult::NotOnLine;
    }
    let point_angle_deg =
        normalize_degrees((point.y - center.y).atan2(point.x - center.x).to_degrees());
    let progress = signed_arc_progress(start_angle_deg, sweep_angle_deg, point_angle_deg);
    let t = progress / sweep_angle_deg;
    let projected = arc_point(center, radius, start_angle_deg + progress);
    if !(-EPSILON..=1.0 + EPSILON).contains(&t) || distance(projected, point) > TOLERANCE_MM {
        return SplitGeometryResult::NotOnLine;
    }
    let length = arc.get("length").and_then(Value::as_f64).unwrap_or(0.0);
    if t <= TOLERANCE_MM / length.max(TOLERANCE_MM)
        || t >= 1.0 - TOLERANCE_MM / length.max(TOLERANCE_MM)
    {
        return SplitGeometryResult::Endpoint;
    }
    let base_id = arc
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let base_name = arc.get("name").and_then(Value::as_str).unwrap_or_default();
    let center_point_id = arc.get("centerPointId").cloned().unwrap_or(Value::Null);
    SplitGeometryResult::Split(SplitResult {
        near: arc_geometry(
            base_id,
            base_name,
            center_value.clone(),
            center_point_id.clone(),
            radius,
            start_angle_deg,
            progress,
        ),
        far: arc_geometry(
            split_line_id,
            split_line_name,
            center_value,
            center_point_id,
            radius,
            start_angle_deg + progress,
            sweep_angle_deg - progress,
        ),
    })
}

fn cubic_point(segment: &Value, t: f64) -> Option<Point> {
    cubic_point_at(segment, t).map(|point| Point {
        x: point.x,
        y: point.y,
    })
}

fn split_bezier_like(segment: &Value, t: f64) -> Option<(Point, Value, Value)> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let p01 = interpolate(start, control1, t);
    let p12 = interpolate(control1, control2, t);
    let p23 = interpolate(control2, end, t);
    let p012 = interpolate(p01, p12, t);
    let p123 = interpolate(p12, p23, t);
    let p0123 = interpolate(p012, p123, t);
    Some((
        p0123,
        json!({
            "control1": { "x": p01.x, "y": p01.y },
            "control2": { "x": p012.x, "y": p012.y }
        }),
        json!({
            "control1": { "x": p123.x, "y": p123.y },
            "control2": { "x": p23.x, "y": p23.y }
        }),
    ))
}

struct SampleSegment {
    length: f64,
    segment: Value,
    kind: SampleKind,
}

enum SampleKind {
    Line,
    Bezier,
    Arc,
}

fn sample_point(segment: &SampleSegment, t: f64) -> Option<Point> {
    match segment.kind {
        SampleKind::Line => Some(interpolate(
            value_point(segment.segment.get("start")?)?,
            value_point(segment.segment.get("end")?)?,
            t,
        )),
        SampleKind::Bezier => cubic_point(&segment.segment, t),
        SampleKind::Arc => {
            let center = segment.segment.get("center").and_then(value_point)?;
            let radius = segment.segment.get("radius")?.as_f64()?;
            let start_angle_deg = segment.segment.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = segment.segment.get("sweepAngleDeg")?.as_f64()?;
            Some(arc_point(
                center,
                radius,
                start_angle_deg + sweep_angle_deg * t,
            ))
        }
    }
}

fn best_sample_hit(split_point: Point, segments: &[SampleSegment]) -> (Option<SampleHit>, f64) {
    let mut total_length = 0.0;
    let mut best: Option<SampleHit> = None;
    for (segment_index, segment) in segments.iter().enumerate() {
        let sample_points = (0..=CURVE_STEPS)
            .filter_map(|index| {
                let t = index as f64 / CURVE_STEPS as f64;
                Some((t, sample_point(segment, t)?))
            })
            .collect::<Vec<_>>();
        let mut segment_distance = 0.0;
        for pair in sample_points.windows(2) {
            let (start_t, start_point) = pair[0];
            let (end_t, end_point) = pair[1];
            let sample_length = distance(start_point, end_point);
            if let Some(projection) = projected_point(split_point, start_point, end_point) {
                if (-EPSILON..=1.0 + EPSILON).contains(&projection.raw_t) {
                    let candidate = SampleHit {
                        segment_index,
                        local_t: start_t + (end_t - start_t) * projection.t,
                        distance_from_start: total_length
                            + segment_distance
                            + sample_length * projection.t,
                        distance_from_line: projection.distance,
                        point: projection.projection,
                    };
                    if best.as_ref().map_or(true, |current| {
                        candidate.distance_from_line < current.distance_from_line
                    }) {
                        best = Some(candidate);
                    }
                }
            }
            segment_distance += sample_length;
        }
        total_length += segment.length;
    }
    (best, total_length)
}

fn bezier_segment_with_points(original: &Value, start: Value, end: Value) -> Value {
    let mut next = original.clone();
    next["start"] = start;
    next["end"] = end;
    next
}

fn bezier_length(segment: &Value) -> f64 {
    approximate_segment_length(segment, 32).unwrap_or(0.0)
}

fn split_bezier_curve_geometry(
    curve: &Value,
    split_point: &ComputedPoint,
    split_line_id: &str,
    split_line_name: &str,
    split_point_id: Value,
) -> SplitGeometryResult {
    let Some(segments) = curve.get("segments").and_then(Value::as_array) else {
        return SplitGeometryResult::NotOnLine;
    };
    let sample_segments = segments
        .iter()
        .map(|segment| SampleSegment {
            length: bezier_length(segment),
            segment: segment.clone(),
            kind: SampleKind::Bezier,
        })
        .collect::<Vec<_>>();
    let (hit, total_length) = best_sample_hit(
        Point {
            x: split_point.x,
            y: split_point.y,
        },
        &sample_segments,
    );
    let Some(hit) = hit else {
        return SplitGeometryResult::NotOnLine;
    };
    if hit.distance_from_line > TOLERANCE_MM {
        return SplitGeometryResult::NotOnLine;
    }
    if hit.distance_from_start <= TOLERANCE_MM
        || hit.distance_from_start >= total_length - TOLERANCE_MM
    {
        return SplitGeometryResult::Endpoint;
    }

    let original = &segments[hit.segment_index];
    let Some((split_point_xy, left_patch, right_patch)) = split_bezier_like(original, hit.local_t)
    else {
        return SplitGeometryResult::NotOnLine;
    };
    let split_value = split_point_value(split_point, split_point_xy);
    let mut left = bezier_segment_with_points(
        original,
        original.get("start").cloned().unwrap_or(Value::Null),
        split_value.clone(),
    );
    left["control1"] = left_patch["control1"].clone();
    left["control2"] = left_patch["control2"].clone();
    let mut right = bezier_segment_with_points(
        original,
        split_value,
        original.get("end").cloned().unwrap_or(Value::Null),
    );
    right["control1"] = right_patch["control1"].clone();
    right["control2"] = right_patch["control2"].clone();

    let near_segments = segments[..hit.segment_index]
        .iter()
        .cloned()
        .chain(std::iter::once(left))
        .collect::<Vec<_>>();
    let far_segments = std::iter::once(right)
        .chain(segments[hit.segment_index + 1..].iter().cloned())
        .collect::<Vec<_>>();
    let mut near = curve.clone();
    near["segments"] = json!(near_segments);
    near["endPointId"] = split_point_id.clone();
    near["intermediatePointIds"] = json!(curve
        .get("intermediatePointIds")
        .and_then(Value::as_array)
        .map(|ids| ids[..hit.segment_index.min(ids.len())].to_vec())
        .unwrap_or_default());
    near["length"] = json!(near["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .map(bezier_length)
        .sum::<f64>());

    let mut far = curve.clone();
    far["elementId"] = json!(split_line_id);
    far["name"] = json!(split_line_name);
    far["startPointId"] = split_point_id;
    far["intermediatePointIds"] = json!(curve
        .get("intermediatePointIds")
        .and_then(Value::as_array)
        .map(|ids| ids[hit.segment_index.min(ids.len())..].to_vec())
        .unwrap_or_default());
    far["segments"] = json!(far_segments);
    far["length"] = json!(far["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .map(bezier_length)
        .sum::<f64>());

    SplitGeometryResult::Split(SplitResult { near, far })
}

fn offset_segment_length(segment: &Value) -> f64 {
    match segment.get("kind").and_then(Value::as_str) {
        Some("line") => {
            let Some(start) = segment.get("start").and_then(value_point) else {
                return 0.0;
            };
            let Some(end) = segment.get("end").and_then(value_point) else {
                return 0.0;
            };
            distance(start, end)
        }
        Some("bezier") => bezier_length(segment),
        Some("arc") => {
            let radius = segment.get("radius").and_then(Value::as_f64).unwrap_or(0.0);
            let sweep = segment
                .get("sweepAngleDeg")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            radius.max(0.0) * sweep.to_radians().abs()
        }
        _ => 0.0,
    }
}

fn split_offset_segment(segment: &Value, t: f64, split_point: Point) -> Option<(Value, Value)> {
    match segment.get("kind").and_then(Value::as_str)? {
        "line" => {
            let start = segment.get("start").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            let mut left = segment.clone();
            left["end"] = computed_point(
                segment
                    .get("end")
                    .and_then(|point| point.get("elementId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                segment
                    .get("end")
                    .and_then(|point| point.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                split_point.x,
                split_point.y,
            );
            left["length"] = json!(distance(start, split_point));
            let mut right = segment.clone();
            right["start"] = computed_point(
                segment
                    .get("start")
                    .and_then(|point| point.get("elementId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                segment
                    .get("start")
                    .and_then(|point| point.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                split_point.x,
                split_point.y,
            );
            right["length"] = json!(distance(split_point, end));
            Some((left, right))
        }
        "bezier" => {
            let (point, left_patch, right_patch) = split_bezier_like(segment, t)?;
            let mut left = segment.clone();
            left["control1"] = left_patch["control1"].clone();
            left["control2"] = left_patch["control2"].clone();
            left["end"] = computed_point(
                segment
                    .get("end")
                    .and_then(|point| point.get("elementId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                segment
                    .get("end")
                    .and_then(|point| point.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                point.x,
                point.y,
            );
            left["length"] = json!(bezier_length(&left));
            let mut right = segment.clone();
            right["control1"] = right_patch["control1"].clone();
            right["control2"] = right_patch["control2"].clone();
            right["start"] = computed_point(
                segment
                    .get("start")
                    .and_then(|point| point.get("elementId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                segment
                    .get("start")
                    .and_then(|point| point.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                point.x,
                point.y,
            );
            right["length"] = json!(bezier_length(&right));
            Some((left, right))
        }
        "arc" => {
            let sweep = segment.get("sweepAngleDeg")?.as_f64()? * t;
            let radius = segment.get("radius")?.as_f64()?;
            let mut left = segment.clone();
            left["sweepAngleDeg"] = json!(sweep);
            left["end"] = computed_point(
                segment
                    .get("end")
                    .and_then(|point| point.get("elementId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                segment
                    .get("end")
                    .and_then(|point| point.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                split_point.x,
                split_point.y,
            );
            left["length"] = json!(radius.max(0.0) * sweep.to_radians().abs());
            let mut right = segment.clone();
            right["start"] = computed_point(
                segment
                    .get("start")
                    .and_then(|point| point.get("elementId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                segment
                    .get("start")
                    .and_then(|point| point.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                split_point.x,
                split_point.y,
            );
            right["startAngleDeg"] = json!(segment.get("startAngleDeg")?.as_f64()? + sweep);
            right["sweepAngleDeg"] = json!(segment.get("sweepAngleDeg")?.as_f64()? - sweep);
            right["length"] = json!(
                radius.max(0.0)
                    * (segment.get("sweepAngleDeg")?.as_f64()? - sweep)
                        .to_radians()
                        .abs()
            );
            Some((left, right))
        }
        _ => None,
    }
}

fn split_offset_line_geometry(
    line: &Value,
    split_point: &ComputedPoint,
    split_line_id: &str,
    split_line_name: &str,
) -> SplitGeometryResult {
    let Some(segments) = line.get("segments").and_then(Value::as_array) else {
        return SplitGeometryResult::NotOnLine;
    };
    let sample_segments = segments
        .iter()
        .filter_map(|segment| {
            Some(SampleSegment {
                length: segment.get("length").and_then(Value::as_f64)?,
                segment: segment.clone(),
                kind: match segment.get("kind").and_then(Value::as_str)? {
                    "line" => SampleKind::Line,
                    "bezier" => SampleKind::Bezier,
                    "arc" => SampleKind::Arc,
                    _ => return None,
                },
            })
        })
        .collect::<Vec<_>>();
    let (hit, total_length) = best_sample_hit(
        Point {
            x: split_point.x,
            y: split_point.y,
        },
        &sample_segments,
    );
    let Some(hit) = hit else {
        return SplitGeometryResult::NotOnLine;
    };
    if hit.distance_from_line > TOLERANCE_MM {
        return SplitGeometryResult::NotOnLine;
    }
    if hit.distance_from_start <= TOLERANCE_MM
        || hit.distance_from_start >= total_length - TOLERANCE_MM
    {
        return SplitGeometryResult::Endpoint;
    }
    let Some((left, right)) =
        split_offset_segment(&segments[hit.segment_index], hit.local_t, hit.point)
    else {
        return SplitGeometryResult::NotOnLine;
    };
    let near_segments = segments[..hit.segment_index]
        .iter()
        .cloned()
        .chain(std::iter::once(left))
        .collect::<Vec<_>>();
    let far_segments = std::iter::once(right)
        .chain(segments[hit.segment_index + 1..].iter().cloned())
        .collect::<Vec<_>>();
    let mut near = line.clone();
    near["closed"] = json!(false);
    near["segments"] = json!(near_segments);
    near["length"] = json!(near["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .map(offset_segment_length)
        .sum::<f64>());
    let mut far = line.clone();
    far["elementId"] = json!(split_line_id);
    far["name"] = json!(split_line_name);
    far["closed"] = json!(false);
    far["segments"] = json!(far_segments);
    far["length"] = json!(far["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .map(offset_segment_length)
        .sum::<f64>());
    SplitGeometryResult::Split(SplitResult { near, far })
}

fn split_geometry(
    geometry: &Value,
    split_point: &ComputedPoint,
    split_line_id: &str,
    split_line_name: &str,
    split_point_id: Value,
) -> SplitGeometryResult {
    match geometry.get("kind").and_then(Value::as_str) {
        Some("line") => split_line_geometry(
            geometry,
            split_point,
            split_line_id,
            split_line_name,
            split_point_id,
        ),
        Some("arcLine") => {
            split_arc_geometry(geometry, split_point, split_line_id, split_line_name)
        }
        Some("bezierCurve") => split_bezier_curve_geometry(
            geometry,
            split_point,
            split_line_id,
            split_line_name,
            split_point_id,
        ),
        Some("offsetLine") => {
            split_offset_line_geometry(geometry, split_point, split_line_id, split_line_name)
        }
        _ => SplitGeometryResult::NotOnLine,
    }
}

fn is_supported_line_geometry(geometry: &Value) -> bool {
    matches!(
        geometry.get("kind").and_then(Value::as_str),
        Some("line" | "arcLine" | "bezierCurve" | "offsetLine")
    )
}

pub(crate) fn evaluate_split_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(base_line_id) = element.get("baseLineId").and_then(Value::as_str) else {
        return;
    };
    let Some(base_geometry) = state.computed_geometry.get(base_line_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    };
    if !is_supported_line_geometry(&base_geometry) {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    }
    let Some(split_point_anchor) = element.get("splitPoint") else {
        return;
    };
    let Some(split_point) = point_anchor_or_error(
        element,
        split_point_anchor,
        "splitPoint",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let split_point_id = anchor_reference_element_id(split_point_anchor)
        .map(Value::from)
        .unwrap_or(Value::Null);
    let id = element_id(element).unwrap_or_default();
    let name = element_name(element);
    match split_geometry(&base_geometry, &split_point, &id, &name, split_point_id) {
        SplitGeometryResult::Split(result) => {
            insert_geometry(state, base_line_id.to_owned(), result.near);
            insert_geometry(state, id, result.far);
        }
        SplitGeometryResult::Endpoint => state.errors.push(geometry_error(
            element,
            format!(
                "{name} の点は基準線の端点です。線を2つに分割するため、基準線の途中にある点を指定してください。"
            ),
        )),
        SplitGeometryResult::NotOnLine => state.errors.push(geometry_error(
            element,
            format!(
                "{name} の点は基準線上にありません。延長線上ではなく、基準線の上にある点を指定してください。"
            ),
        )),
    }
}
