use serde_json::{json, Value};

use super::super::point_anchor::computed_point;
use super::super::types::Point as ComputedPoint;
use super::arc::arc_point;
use super::bezier::cubic_point;
use super::line::reversed_angle;
use super::primitives::{
    angle_from_to, distance, interpolate, line_distance, value_point, PathSample, Point, EPSILON,
    TOLERANCE_MM,
};
use super::EndpointMoveResult;

const CURVE_STEPS: usize = 64;
const ARC_STEPS: f64 = 64.0;

fn offset_segment_points(segment: &Value) -> Option<Vec<Point>> {
    match segment.get("kind")?.as_str()? {
        "line" => Some(vec![
            segment.get("start").and_then(value_point)?,
            segment.get("end").and_then(value_point)?,
        ]),
        "bezier" => Some(
            (0..=CURVE_STEPS)
                .filter_map(|index| cubic_point(segment, index as f64 / CURVE_STEPS as f64))
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
        let projected = interpolate(current.point, next.point, t);
        let point_distance = distance(projected, target);
        let path_distance = current.distance + (next.distance - current.distance) * t;
        if best.map_or(true, |(_, best_point_distance)| {
            point_distance < best_point_distance
        }) {
            best = Some((path_distance, point_distance));
        }
    }
    best
}

fn offset_line_endpoint_measurements(segments: &[Value]) -> (Value, Value, Value, Value) {
    let start = segments
        .first()
        .and_then(|segment| segment.get("start"))
        .cloned()
        .unwrap_or(Value::Null);
    let end = segments
        .last()
        .and_then(|segment| segment.get("end"))
        .cloned()
        .unwrap_or(Value::Null);
    let start_tangent = segments
        .first()
        .and_then(|segment| {
            Some(angle_from_to(
                value_point(segment.get("start")?)?,
                value_point(segment.get("end")?)?,
            ))
        })
        .unwrap_or(Value::Null);
    let end_tangent = segments
        .last()
        .and_then(|segment| {
            Some(reversed_angle(&angle_from_to(
                value_point(segment.get("start")?)?,
                value_point(segment.get("end")?)?,
            )))
        })
        .unwrap_or(Value::Null);
    (start, end, start_tangent, end_tangent)
}

fn polyline_geometry(line: &Value, points: &[Point]) -> Option<Value> {
    let element_id = line.get("elementId")?.as_str()?;
    let name = line.get("name")?.as_str()?;
    let segments = points
        .windows(2)
        .enumerate()
        .filter_map(|(index, pair)| {
            let start = pair[0];
            let end = pair[1];
            let length = distance(start, end);
            (length > EPSILON).then(|| {
                json!({
                    "kind": "line",
                    "start": computed_point(format!("{element_id}:segment-{index}:start"), format!("{name}.区間{}始点", index + 1), start.x, start.y),
                    "end": computed_point(format!("{element_id}:segment-{index}:end"), format!("{name}.区間{}終点", index + 1), end.x, end.y),
                    "length": length
                })
            })
        })
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return None;
    }
    let (start, end, start_tangent_angle_deg, end_tangent_angle_deg) =
        offset_line_endpoint_measurements(&segments);
    Some(json!({
        "kind": "offsetLine",
        "elementId": element_id,
        "name": name,
        "baseLineIds": line.get("baseLineIds").cloned().unwrap_or_else(|| json!([])),
        "start": start,
        "end": end,
        "segments": segments,
        "closed": false,
        "length": segments.iter().map(|segment| segment.get("length").and_then(Value::as_f64).unwrap_or(0.0)).sum::<f64>(),
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg
    }))
}

fn tangent_line_distance(samples: &[PathSample], endpoint_key: &str, target: Point) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }
    if endpoint_key == "start" {
        line_distance(target, samples[0].point, samples[1].point)
    } else {
        line_distance(
            target,
            samples[samples.len() - 2].point,
            samples[samples.len() - 1].point,
        )
    }
}

pub(super) fn move_offset_endpoint(
    line: &Value,
    endpoint_key: &str,
    target: &ComputedPoint,
) -> EndpointMoveResult {
    let name = line.get("name").and_then(Value::as_str).unwrap_or_default();
    if line.get("closed").and_then(Value::as_bool).unwrap_or(false) {
        return EndpointMoveResult::Error(format!(
            "{name} は閉じた線のため、端点を変更できません。"
        ));
    }
    let Some(points) = offset_points(line) else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };
    let samples = path_samples(&points);
    if samples.len() < 2 {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    }
    let target_point = Point {
        x: target.x,
        y: target.y,
    };
    let total = samples.last().map(|sample| sample.distance).unwrap_or(0.0);
    if let Some((nearest_distance, point_distance)) =
        nearest_distance_on_path(&samples, target_point)
    {
        if point_distance <= TOLERANCE_MM {
            let trim_distance = nearest_distance.clamp(0.0, total);
            let retained = if endpoint_key == "start" {
                std::iter::once(target_point)
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
                    .chain(std::iter::once(target_point))
                    .collect::<Vec<_>>()
            };
            return polyline_geometry(line, &retained).map_or_else(
                || {
                    EndpointMoveResult::Error(format!(
                        "{name} の端点移動後の長さが0になるため、変更できません。"
                    ))
                },
                EndpointMoveResult::Geometry,
            );
        }
    }
    if tangent_line_distance(&samples, endpoint_key, target_point)
        .map_or(true, |value| value > TOLERANCE_MM)
    {
        return EndpointMoveResult::Error(format!(
            "{name} の{}は、指定点が線上または端点接線の延長上にないため移動できません。",
            if endpoint_key == "start" {
                "始点"
            } else {
                "終点"
            }
        ));
    }
    let retained = if endpoint_key == "start" {
        std::iter::once(target_point)
            .chain(points)
            .collect::<Vec<_>>()
    } else {
        points
            .into_iter()
            .chain(std::iter::once(target_point))
            .collect::<Vec<_>>()
    };
    polyline_geometry(line, &retained).map_or_else(
        || {
            EndpointMoveResult::Error(format!(
                "{name} の端点移動後の長さが0になるため、変更できません。"
            ))
        },
        EndpointMoveResult::Geometry,
    )
}
