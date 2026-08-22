use serde_json::{json, Value};

use super::corner_radius_path::{
    distance, samples_for_geometry, value_point, PathSample, Point, EPSILON,
};
use super::math::normalize_degrees;
use super::offset_types::{
    line_length, offset_line_endpoint_measurements, OffsetPoint, OffsetSegment,
};
use super::point_anchor::computed_point;

fn to_offset(point: Point) -> OffsetPoint {
    OffsetPoint {
        x: point.x,
        y: point.y,
    }
}

fn nearest_distance_on_path(samples: &[PathSample], target: Point) -> Option<(f64, f64)> {
    let mut best: Option<(f64, f64)> = None;
    for pair in samples.windows(2) {
        let current = &pair[0];
        let next = &pair[1];
        let vector = Point {
            x: next.point.x - current.point.x,
            y: next.point.y - current.point.y,
        };
        let length_squared = vector.x * vector.x + vector.y * vector.y;
        if length_squared <= EPSILON {
            continue;
        }
        let raw_t = ((target.x - current.point.x) * vector.x
            + (target.y - current.point.y) * vector.y)
            / length_squared;
        let t = raw_t.clamp(0.0, 1.0);
        let projected = Point {
            x: current.point.x + vector.x * t,
            y: current.point.y + vector.y * t,
        };
        let point_distance = distance(projected, target);
        if best.map_or(true, |(_, best_distance)| point_distance < best_distance) {
            best = Some((
                current.distance + (next.distance - current.distance) * t,
                point_distance,
            ));
        }
    }
    best
}

pub(crate) fn tangent_point_distance(
    samples: &[PathSample],
    endpoint_key: &str,
    tangent_point: Point,
) -> Option<f64> {
    let (nearest_distance, point_distance) = nearest_distance_on_path(samples, tangent_point)?;
    if point_distance > 0.25 {
        return None;
    }
    let total = samples.last()?.distance;
    if nearest_distance < -EPSILON || nearest_distance > total + EPSILON {
        return None;
    }
    if endpoint_key == "start" || endpoint_key == "end" {
        Some(nearest_distance)
    } else {
        None
    }
}

fn polyline_segments(element_id: &str, name: &str, points: &[Point]) -> Vec<Value> {
    points
        .windows(2)
        .enumerate()
        .filter_map(|(index, pair)| {
            let start = pair[0];
            let end = pair[1];
            let length = distance(start, end);
            (length > EPSILON).then(|| {
                json!({
                    "kind": "line",
                    "start": computed_point(format!("{element_id}:trim-{}:start", index + 1), format!("{name}.区間{}始点", index + 1), start.x, start.y),
                    "end": computed_point(format!("{element_id}:trim-{}:end", index + 1), format!("{name}.区間{}終点", index + 1), end.x, end.y),
                    "length": length
                })
            })
        })
        .collect()
}

fn offset_segment_for_measurement(segment: &Value) -> Option<OffsetSegment> {
    let start = to_offset(segment.get("start").and_then(value_point)?);
    let end = to_offset(segment.get("end").and_then(value_point)?);
    let length = segment.get("length")?.as_f64()?;
    Some(OffsetSegment::Line { start, end, length })
}

fn trimmed_polyline_geometry(
    geometry: &Value,
    endpoint_key: &str,
    tangent_point: Point,
) -> Option<Value> {
    let samples = samples_for_geometry(geometry)?;
    if samples.len() < 2 {
        return None;
    }
    let (nearest_distance, point_distance) = nearest_distance_on_path(&samples, tangent_point)?;
    if point_distance > 0.25 {
        return None;
    }
    let total = samples.last()?.distance;
    let trim_distance = nearest_distance.clamp(0.0, total);
    let retained = if endpoint_key == "start" {
        std::iter::once(tangent_point)
            .chain(
                samples
                    .iter()
                    .filter(|sample| sample.distance > trim_distance + EPSILON)
                    .map(|sample| sample.point),
            )
            .collect::<Vec<_>>()
    } else {
        samples
            .iter()
            .filter(|sample| sample.distance < trim_distance - EPSILON)
            .map(|sample| sample.point)
            .chain(std::iter::once(tangent_point))
            .collect::<Vec<_>>()
    };
    if retained.len() < 2 {
        return None;
    }
    let element_id = geometry.get("elementId")?.as_str()?;
    let name = geometry.get("name")?.as_str()?;
    let segment_values = polyline_segments(element_id, name, &retained);
    if segment_values.is_empty() {
        return None;
    }
    let measurement_segments = segment_values
        .iter()
        .map(offset_segment_for_measurement)
        .collect::<Option<Vec<_>>>()?;
    let (_, _, start_tangent_angle_deg, end_tangent_angle_deg) =
        offset_line_endpoint_measurements(&measurement_segments);
    let start = segment_values.first()?.get("start")?.clone();
    let end = segment_values.last()?.get("end")?.clone();
    Some(json!({
        "kind": "offsetLine",
        "elementId": element_id,
        "name": name,
        "baseLineIds": [],
        "start": start,
        "end": end,
        "segments": segment_values,
        "closed": false,
        "length": measurement_segments.iter().map(|segment| match segment {
            OffsetSegment::Line { length, .. } => length,
            _ => &0.0,
        }).sum::<f64>(),
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg
    }))
}

fn trimmed_line_geometry(
    geometry: &Value,
    endpoint_key: &str,
    tangent_point: Point,
) -> Option<Value> {
    let source_start = geometry.get("start").and_then(value_point)?;
    let source_end = geometry.get("end").and_then(value_point)?;
    let start = if endpoint_key == "start" {
        tangent_point
    } else {
        source_start
    };
    let end = if endpoint_key == "end" {
        tangent_point
    } else {
        source_end
    };
    let length = line_length(to_offset(start), to_offset(end));
    if length <= EPSILON {
        return None;
    }
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let mut next = geometry.clone();
    let element_id = geometry.get("elementId")?.as_str()?;
    let name = geometry.get("name")?.as_str()?;
    next["start"] = computed_point(
        format!("{element_id}:start"),
        format!("{name}.始点"),
        start.x,
        start.y,
    );
    next["end"] = computed_point(
        format!("{element_id}:end"),
        format!("{name}.終点"),
        end.x,
        end.y,
    );
    next["length"] = json!(length);
    next["startAngleDeg"] = json!(normalize_degrees(dy.atan2(dx).to_degrees()));
    next["endAngleDeg"] = json!(normalize_degrees((-dy).atan2(-dx).to_degrees()));
    Some(next)
}

pub(crate) fn trimmed_geometry(
    geometry: &Value,
    endpoint_key: &str,
    tangent_point: Point,
) -> Option<Value> {
    if geometry.get("kind").and_then(Value::as_str) == Some("line") {
        trimmed_line_geometry(geometry, endpoint_key, tangent_point)
    } else {
        trimmed_polyline_geometry(geometry, endpoint_key, tangent_point)
    }
}
