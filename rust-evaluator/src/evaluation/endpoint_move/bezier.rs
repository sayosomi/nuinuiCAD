use serde_json::{json, Value};

use super::super::bezier_math::{
    distance as bm_distance, project_point_onto_curve, split_bezier_like,
    value_point as bm_value_point, CurveProjection, Point as BmPoint,
};
use super::super::bezier_path::approximate_segment_length;
use super::super::math::normalize_degrees;
use super::super::point_anchor::computed_point;
use super::super::types::Point as ComputedPoint;
use super::primitives::{value_point, Point, EPSILON, TOLERANCE_MM};
use super::EndpointMoveResult;

fn point_on_angle_line(point: Point, origin: Point, angle_deg: f64) -> f64 {
    let angle_rad = angle_deg.to_radians();
    let direction = Point {
        x: angle_rad.cos(),
        y: angle_rad.sin(),
    };
    ((point.x - origin.x) * direction.y - (point.y - origin.y) * direction.x).abs()
}

fn handle_point(point: Point, angle_deg: f64, length: f64) -> Value {
    let angle_rad = angle_deg.to_radians();
    json!({
        "x": point.x + angle_rad.cos() * length,
        "y": point.y + angle_rad.sin() * length
    })
}

fn angle_between(start: BmPoint, end: BmPoint) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if dx.hypot(dy) <= EPSILON {
        None
    } else {
        Some(normalize_degrees(dy.atan2(dx).to_degrees()))
    }
}

// Shorten the curve by truncating it at an on-body point (de Casteljau split),
// keeping start→split when moving the end, or split→end when moving the start.
fn truncate_bezier_at_body(
    curve: &Value,
    endpoint_key: &str,
    hit: &CurveProjection,
    target_point_id: Value,
) -> EndpointMoveResult {
    let name = curve
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let element_id = curve
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(segments) = curve.get("segments").and_then(Value::as_array) else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };
    let original = &segments[hit.segment_index];
    let Some((split_point, left_patch, right_patch)) = split_bezier_like(original, hit.local_t)
    else {
        return EndpointMoveResult::Error(format!("{name} の端点を変更できません。"));
    };
    let intermediate = curve
        .get("intermediatePointIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut geometry = curve.clone();

    if endpoint_key == "end" {
        let control2 = left_patch.get("control2").and_then(bm_value_point);
        let mut truncated = original.clone();
        truncated["endPointId"] = target_point_id.clone();
        truncated["control1"] = left_patch["control1"].clone();
        truncated["control2"] = left_patch["control2"].clone();
        truncated["end"] = computed_point(
            format!("{element_id}:end"),
            format!("{name}.終点"),
            split_point.x,
            split_point.y,
        );
        let mut out: Vec<Value> = segments[..hit.segment_index].to_vec();
        out.push(truncated);
        let length: f64 = out
            .iter()
            .filter_map(|segment| approximate_segment_length(segment, 32))
            .sum();
        if length <= EPSILON {
            return EndpointMoveResult::Error(format!(
                "{name} の端点移動後の長さが0になるため、変更できません。"
            ));
        }
        let fallback = curve
            .get("endHandleAngleDeg")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let end_handle_angle = control2
            .and_then(|c| angle_between(c, split_point))
            .unwrap_or(fallback);
        let end_handle_length = control2.map_or(0.0, |c| bm_distance(c, split_point));
        let kept = intermediate[..hit.segment_index.min(intermediate.len())].to_vec();
        geometry["endPointId"] = target_point_id;
        geometry["segments"] = json!(out);
        geometry["length"] = json!(length);
        geometry["endHandleAngleDeg"] = json!(end_handle_angle);
        geometry["endHandleLength"] = json!(end_handle_length);
        geometry["endTangentAngleDeg"] = json!(normalize_degrees(end_handle_angle + 180.0));
        geometry["intermediatePointIds"] = json!(kept);
        if hit.segment_index == 0 {
            // The truncated segment is also the first segment, so the curve's
            // own start handle (segments[0].control1) shrank along with it.
            let start_point = original.get("start").and_then(bm_value_point);
            let control1 = left_patch.get("control1").and_then(bm_value_point);
            if let (Some(start_point), Some(control1)) = (start_point, control1) {
                let start_fallback = curve
                    .get("startHandleAngleDeg")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let start_handle_angle =
                    angle_between(start_point, control1).unwrap_or(start_fallback);
                let start_handle_length = bm_distance(start_point, control1);
                geometry["startHandleAngleDeg"] = json!(start_handle_angle);
                geometry["startHandleLength"] = json!(start_handle_length);
                geometry["startTangentAngleDeg"] = json!(normalize_degrees(start_handle_angle));
            }
        }
        return EndpointMoveResult::Geometry(geometry);
    }

    let control1 = right_patch.get("control1").and_then(bm_value_point);
    let mut truncated = original.clone();
    truncated["startPointId"] = target_point_id.clone();
    truncated["control1"] = right_patch["control1"].clone();
    truncated["control2"] = right_patch["control2"].clone();
    truncated["start"] = computed_point(
        format!("{element_id}:start"),
        format!("{name}.始点"),
        split_point.x,
        split_point.y,
    );
    let mut out: Vec<Value> = vec![truncated];
    out.extend(segments[hit.segment_index + 1..].iter().cloned());
    let length: f64 = out
        .iter()
        .filter_map(|segment| approximate_segment_length(segment, 32))
        .sum();
    if length <= EPSILON {
        return EndpointMoveResult::Error(format!(
            "{name} の端点移動後の長さが0になるため、変更できません。"
        ));
    }
    let fallback = curve
        .get("startHandleAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let start_handle_angle = control1
        .and_then(|c| angle_between(split_point, c))
        .unwrap_or(fallback);
    let start_handle_length = control1.map_or(0.0, |c| bm_distance(split_point, c));
    let kept = intermediate[hit.segment_index.min(intermediate.len())..].to_vec();
    geometry["startPointId"] = target_point_id;
    geometry["segments"] = json!(out);
    geometry["length"] = json!(length);
    geometry["startHandleAngleDeg"] = json!(start_handle_angle);
    geometry["startHandleLength"] = json!(start_handle_length);
    geometry["startTangentAngleDeg"] = json!(normalize_degrees(start_handle_angle));
    geometry["intermediatePointIds"] = json!(kept);
    if hit.segment_index == segments.len() - 1 {
        // The truncated segment is also the last segment, so the curve's own
        // end handle (segments[last].control2) shrank along with it.
        let end_point = original.get("end").and_then(bm_value_point);
        let control2 = right_patch.get("control2").and_then(bm_value_point);
        if let (Some(end_point), Some(control2)) = (end_point, control2) {
            let end_fallback = curve
                .get("endHandleAngleDeg")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let end_handle_angle = angle_between(control2, end_point).unwrap_or(end_fallback);
            let end_handle_length = bm_distance(control2, end_point);
            geometry["endHandleAngleDeg"] = json!(end_handle_angle);
            geometry["endHandleLength"] = json!(end_handle_length);
            geometry["endTangentAngleDeg"] = json!(normalize_degrees(end_handle_angle + 180.0));
        }
    }
    EndpointMoveResult::Geometry(geometry)
}

pub(super) fn move_bezier_endpoint(
    curve: &Value,
    endpoint_key: &str,
    target: &ComputedPoint,
    target_point_id: Value,
) -> EndpointMoveResult {
    let name = curve
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(source_segments) = curve.get("segments").and_then(Value::as_array) else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };
    let Some(first) = source_segments.first() else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };
    let Some(last) = source_segments.last() else {
        return EndpointMoveResult::Error(format!(
            "{name} は区間がないため、端点を変更できません。"
        ));
    };

    // On the curve body: shorten by truncating at the point.
    let target_bm = BmPoint {
        x: target.x,
        y: target.y,
    };
    if let Some(hit) = project_point_onto_curve(source_segments, target_bm) {
        if hit.distance <= TOLERANCE_MM {
            let global_t = hit.segment_index as f64 + hit.local_t;
            let interior = if endpoint_key == "end" {
                global_t > EPSILON
            } else {
                global_t < source_segments.len() as f64 - EPSILON
            };
            if interior {
                return truncate_bezier_at_body(curve, endpoint_key, &hit, target_point_id);
            }
            // On the curve body but at (or past) the opposite endpoint: the
            // move would collapse the curve to zero length.
            return EndpointMoveResult::Error(format!(
                "{name} の端点移動後の長さが0になるため、変更できません。"
            ));
        }
    }

    let source_point = if endpoint_key == "start" {
        first.get("start").and_then(value_point)
    } else {
        last.get("end").and_then(value_point)
    };
    let Some(source_point) = source_point else {
        return EndpointMoveResult::Error("端点を変更できません。".to_owned());
    };
    let angle_deg = if endpoint_key == "start" {
        curve
            .get("startHandleAngleDeg")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    } else {
        curve
            .get("endHandleAngleDeg")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let target_point = Point {
        x: target.x,
        y: target.y,
    };
    if point_on_angle_line(target_point, source_point, angle_deg) > TOLERANCE_MM {
        return EndpointMoveResult::Error(format!(
            "{name} の{}は、指定点が端点角度の直線上にないため移動できません。",
            if endpoint_key == "start" {
                "始点"
            } else {
                "終点"
            }
        ));
    }
    let element_id = curve
        .get("elementId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let start_handle_angle = curve
        .get("startHandleAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let start_handle_length = curve
        .get("startHandleLength")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let end_handle_angle = curve
        .get("endHandleAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let end_handle_length = curve
        .get("endHandleLength")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let segments = source_segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let mut next = segment.clone();
            if endpoint_key == "start" && index == 0 {
                let start = computed_point(
                    format!("{element_id}:start"),
                    format!("{name}.始点"),
                    target.x,
                    target.y,
                );
                next["startPointId"] = target_point_id.clone();
                next["start"] = start;
                next["control1"] =
                    handle_point(target_point, start_handle_angle, start_handle_length);
            }
            if endpoint_key == "end" && index == source_segments.len() - 1 {
                let end = computed_point(
                    format!("{element_id}:end"),
                    format!("{name}.終点"),
                    target.x,
                    target.y,
                );
                next["endPointId"] = target_point_id.clone();
                next["control2"] =
                    handle_point(target_point, end_handle_angle + 180.0, end_handle_length);
                next["end"] = end;
            }
            next
        })
        .collect::<Vec<_>>();
    let length = segments
        .iter()
        .filter_map(|segment| approximate_segment_length(segment, 32))
        .sum::<f64>();
    if length <= EPSILON {
        return EndpointMoveResult::Error(format!(
            "{name} の端点移動後の長さが0になるため、変更できません。"
        ));
    }
    let mut geometry = curve.clone();
    geometry["startPointId"] = if endpoint_key == "start" {
        target_point_id.clone()
    } else {
        curve.get("startPointId").cloned().unwrap_or(Value::Null)
    };
    geometry["endPointId"] = if endpoint_key == "end" {
        target_point_id
    } else {
        curve.get("endPointId").cloned().unwrap_or(Value::Null)
    };
    geometry["segments"] = json!(segments);
    geometry["length"] = json!(length);
    EndpointMoveResult::Geometry(geometry)
}
