use serde_json::{json, Value};

use super::super::bezier_math::Point as BmPoint;
use super::super::point_anchor::computed_point;
use super::super::split_line_evaluator::{
    best_sample_hit, refine_offset_sample_hit, split_offset_segment, SampleKind, SampleSegment,
};
use super::super::types::Point as ComputedPoint;
use super::line::reversed_angle;
use super::primitives::{angle_from_to, value_point, Point, EPSILON, TOLERANCE_MM};
use super::EndpointMoveResult;

fn to_bm_point(point: Point) -> BmPoint {
    BmPoint {
        x: point.x,
        y: point.y,
    }
}

fn segment_length(segment: &Value) -> f64 {
    segment.get("length").and_then(Value::as_f64).unwrap_or(0.0)
}

fn to_sample_segments(segments: &[Value]) -> Option<Vec<SampleSegment>> {
    segments
        .iter()
        .map(|segment| {
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
        .collect()
}

fn normalize_direction(start: Point, end: Point) -> Option<Point> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    (length > EPSILON).then(|| Point {
        x: dx / length,
        y: dy / length,
    })
}

fn arc_tangent_direction(angle_deg: f64, sweep_angle_deg: f64) -> Point {
    let angle_rad = angle_deg.to_radians();
    let sign = if sweep_angle_deg >= 0.0 { 1.0 } else { -1.0 };
    Point {
        x: -angle_rad.sin() * sign,
        y: angle_rad.cos() * sign,
    }
}

// Analytic forward tangent direction at a segment's start/end, used (unlike a
// chord-sampled approach) so extension checks and appended extension segments
// stay exact for bezier/arc offset sub-segments.
fn segment_start_forward(segment: &Value) -> Option<Point> {
    match segment.get("kind")?.as_str()? {
        "line" => {
            let start = segment.get("start").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            normalize_direction(start, end)
        }
        "bezier" => {
            let start = segment.get("start").and_then(value_point)?;
            let control1 = segment.get("control1").and_then(value_point)?;
            let control2 = segment.get("control2").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            normalize_direction(start, control1)
                .or_else(|| normalize_direction(start, control2))
                .or_else(|| normalize_direction(start, end))
        }
        "arc" => {
            let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
            Some(arc_tangent_direction(start_angle_deg, sweep_angle_deg))
        }
        _ => None,
    }
}

fn segment_end_forward(segment: &Value) -> Option<Point> {
    match segment.get("kind")?.as_str()? {
        "line" => {
            let start = segment.get("start").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            normalize_direction(start, end)
        }
        "bezier" => {
            let start = segment.get("start").and_then(value_point)?;
            let control1 = segment.get("control1").and_then(value_point)?;
            let control2 = segment.get("control2").and_then(value_point)?;
            let end = segment.get("end").and_then(value_point)?;
            normalize_direction(control2, end)
                .or_else(|| normalize_direction(control1, end))
                .or_else(|| normalize_direction(start, end))
        }
        "arc" => {
            let start_angle_deg = segment.get("startAngleDeg")?.as_f64()?;
            let sweep_angle_deg = segment.get("sweepAngleDeg")?.as_f64()?;
            Some(arc_tangent_direction(
                start_angle_deg + sweep_angle_deg,
                sweep_angle_deg,
            ))
        }
        _ => None,
    }
}

fn segment_endpoint(segment: &Value, key: &str) -> Option<Point> {
    segment.get(key).and_then(value_point)
}

fn direction_angle(direction: Point) -> Value {
    angle_from_to(Point { x: 0.0, y: 0.0 }, direction)
}

fn endpoint_metadata(segments: &[Value]) -> (Value, Value, Value, Value) {
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
        .and_then(segment_start_forward)
        .map(direction_angle)
        .unwrap_or(Value::Null);
    let end_tangent = segments
        .last()
        .and_then(segment_end_forward)
        .map(|direction| reversed_angle(&direction_angle(direction)))
        .unwrap_or(Value::Null);
    (start, end, start_tangent, end_tangent)
}

fn analytic_geometry(line: &Value, segments: Vec<Value>) -> Option<Value> {
    if segments.is_empty() {
        return None;
    }
    let element_id = line.get("elementId")?.as_str()?;
    let name = line.get("name")?.as_str()?;
    let (start, end, start_tangent_angle_deg, end_tangent_angle_deg) = endpoint_metadata(&segments);
    let length = segments.iter().map(segment_length).sum::<f64>();
    Some(json!({
        "kind": line.get("kind").cloned().unwrap_or_else(|| json!("offsetLine")),
        "elementId": element_id,
        "name": name,
        "baseLineIds": line.get("baseLineIds").cloned().unwrap_or_else(|| json!([])),
        "start": start,
        "end": end,
        "segments": segments,
        "closed": false,
        "length": length,
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg
    }))
}

fn zero_length_error(name: &str) -> EndpointMoveResult {
    EndpointMoveResult::Error(format!(
        "{name} の端点移動後の長さが0になるため、変更できません。"
    ))
}

// Truncate the offset line at an on-body point, keeping the retained side's
// other segments -- including analytic bezier/arc sub-segments -- untouched.
fn truncate_offset_at_body(
    line: &Value,
    endpoint_key: &str,
    segments: &[Value],
    segment_index: usize,
    local_t: f64,
    hit_point: BmPoint,
) -> EndpointMoveResult {
    let name = line.get("name").and_then(Value::as_str).unwrap_or_default();
    let element_id = line
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some((mut left, mut right)) =
        split_offset_segment(&segments[segment_index], local_t, hit_point)
    else {
        return EndpointMoveResult::Error(format!("{name} の端点を変更できません。"));
    };

    if endpoint_key == "end" {
        left["end"] = computed_point(
            format!("{element_id}:end"),
            format!("{name}.終点"),
            hit_point.x,
            hit_point.y,
        );
        let mut out: Vec<Value> = segments[..segment_index].to_vec();
        out.push(left);
        let geometry = analytic_geometry(line, out);
        return geometry.map_or_else(|| zero_length_error(name), EndpointMoveResult::Geometry);
    }

    right["start"] = computed_point(
        format!("{element_id}:start"),
        format!("{name}.始点"),
        hit_point.x,
        hit_point.y,
    );
    let mut out: Vec<Value> = vec![right];
    out.extend(segments[segment_index + 1..].iter().cloned());
    let geometry = analytic_geometry(line, out);
    geometry.map_or_else(|| zero_length_error(name), EndpointMoveResult::Geometry)
}

// Extend by appending a straight segment along the terminal segment's
// analytic tangent direction, leaving every existing segment untouched.
fn extend_offset_along_tangent(
    line: &Value,
    endpoint_key: &str,
    segments: &[Value],
    target: Point,
) -> EndpointMoveResult {
    let name = line.get("name").and_then(Value::as_str).unwrap_or_default();
    let element_id = line
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if endpoint_key == "start" {
        let Some(first) = segments.first() else {
            return EndpointMoveResult::Error(format!(
                "{name} は端点方向を決められないため、変更できません。"
            ));
        };
        let Some(anchor) = segment_endpoint(first, "start") else {
            return EndpointMoveResult::Error(format!(
                "{name} は端点方向を決められないため、変更できません。"
            ));
        };
        if first.get("kind").and_then(Value::as_str) == Some("line") {
            let mut updated = first.clone();
            updated["start"] = computed_point(
                format!("{element_id}:start"),
                format!("{name}.始点"),
                target.x,
                target.y,
            );
            let end = segment_endpoint(first, "end").unwrap_or(anchor);
            updated["length"] = json!((target.x - end.x).hypot(target.y - end.y));
            let mut out = vec![updated];
            out.extend(segments[1..].iter().cloned());
            let geometry = analytic_geometry(line, out);
            return geometry.map_or_else(|| zero_length_error(name), EndpointMoveResult::Geometry);
        }
        let extension = json!({
            "kind": "line",
            "start": computed_point(format!("{element_id}:start"), format!("{name}.始点"), target.x, target.y),
            "end": computed_point(format!("{element_id}:extension:start"), format!("{name}.延長始点"), anchor.x, anchor.y),
            "length": (target.x - anchor.x).hypot(target.y - anchor.y)
        });
        let mut out = vec![extension];
        out.extend(segments.iter().cloned());
        let geometry = analytic_geometry(line, out);
        return geometry.map_or_else(|| zero_length_error(name), EndpointMoveResult::Geometry);
    }

    let Some(last) = segments.last() else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };
    let Some(anchor) = segment_endpoint(last, "end") else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };
    if last.get("kind").and_then(Value::as_str) == Some("line") {
        let mut updated = last.clone();
        updated["end"] = computed_point(
            format!("{element_id}:end"),
            format!("{name}.終点"),
            target.x,
            target.y,
        );
        let start = segment_endpoint(last, "start").unwrap_or(anchor);
        updated["length"] = json!((target.x - start.x).hypot(target.y - start.y));
        let mut out: Vec<Value> = segments[..segments.len() - 1].to_vec();
        out.push(updated);
        let geometry = analytic_geometry(line, out);
        return geometry.map_or_else(|| zero_length_error(name), EndpointMoveResult::Geometry);
    }
    let extension = json!({
        "kind": "line",
        "start": computed_point(format!("{element_id}:extension:end"), format!("{name}.延長終点"), anchor.x, anchor.y),
        "end": computed_point(format!("{element_id}:end"), format!("{name}.終点"), target.x, target.y),
        "length": (target.x - anchor.x).hypot(target.y - anchor.y)
    });
    let mut out = segments.to_vec();
    out.push(extension);
    let geometry = analytic_geometry(line, out);
    geometry.map_or_else(|| zero_length_error(name), EndpointMoveResult::Geometry)
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
    let Some(segments) = line.get("segments").and_then(Value::as_array) else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };
    if segments.is_empty() {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    }
    let Some(sample_segments) = to_sample_segments(segments) else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };

    let target_point = Point {
        x: target.x,
        y: target.y,
    };
    let target_bm = to_bm_point(target_point);
    let (hit, _total_length) = best_sample_hit(target_bm, &sample_segments);

    if let Some(hit) = hit {
        if let Some(refined_hit) = refine_offset_sample_hit(target_bm, segments, &hit) {
            if refined_hit.distance_from_line <= TOLERANCE_MM {
                let interior = if endpoint_key == "end" {
                    refined_hit.segment_index > 0 || refined_hit.local_t > EPSILON
                } else {
                    refined_hit.segment_index + 1 < segments.len()
                        || refined_hit.local_t < 1.0 - EPSILON
                };
                if interior {
                    return truncate_offset_at_body(
                        line,
                        endpoint_key,
                        segments,
                        refined_hit.segment_index,
                        refined_hit.local_t,
                        refined_hit.point,
                    );
                }
                return zero_length_error(name);
            }
        }
    }

    let terminal = if endpoint_key == "start" {
        segments.first()
    } else {
        segments.last()
    };
    let Some(terminal) = terminal else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };
    let forward = if endpoint_key == "start" {
        segment_start_forward(terminal)
    } else {
        segment_end_forward(terminal)
    };
    let anchor = if endpoint_key == "start" {
        segment_endpoint(terminal, "start")
    } else {
        segment_endpoint(terminal, "end")
    };
    let (Some(forward), Some(anchor)) = (forward, anchor) else {
        return EndpointMoveResult::Error(format!(
            "{name} は端点方向を決められないため、変更できません。"
        ));
    };
    let tangent_distance =
        ((target_point.x - anchor.x) * forward.y - (target_point.y - anchor.y) * forward.x).abs();
    if tangent_distance > TOLERANCE_MM {
        return EndpointMoveResult::Error(format!(
            "{name} の{}は、指定点が線上または端点接線の延長上にないため移動できません。",
            if endpoint_key == "start" {
                "始点"
            } else {
                "終点"
            }
        ));
    }

    extend_offset_along_tangent(line, endpoint_key, segments, target_point)
}
