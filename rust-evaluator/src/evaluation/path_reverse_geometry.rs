//! Pure reversal of already-computed line-like geometry JSON.

use serde_json::{json, Value};

use super::bezier_path::approximate_segment_length;
use super::math::arc_tangent_angles;
use super::offset_types::{
    angle_of_point, line_length, offset_line_endpoint_measurements, value_point, OffsetSegment,
};

fn swap_fields(next: &mut Value, first: &str, second: &str) -> Option<()> {
    let first_value = next.get(first)?.clone();
    let second_value = next.get(second)?.clone();
    next[first] = second_value;
    next[second] = first_value;
    Some(())
}

fn reverse_line(line: &Value) -> Option<Value> {
    let mut next = line.clone();
    swap_fields(&mut next, "start", "end")?;
    swap_fields(&mut next, "startPointId", "endPointId")?;
    let start = value_point(next.get("start")?)?;
    let end = value_point(next.get("end")?)?;
    let start_angle = angle_of_point(start, end);
    let end_angle = angle_of_point(end, start);
    next["startAngleDeg"] = json!(start_angle);
    next["endAngleDeg"] = json!(end_angle);
    next["startTangentAngleDeg"] = json!(start_angle);
    next["endTangentAngleDeg"] = json!(end_angle);
    Some(next)
}

fn reverse_arc(arc: &Value) -> Option<Value> {
    let mut next = arc.clone();
    let start_angle = arc.get("startAngleDeg")?.as_f64()?;
    let sweep = arc.get("sweepAngleDeg")?.as_f64()?;
    swap_fields(&mut next, "start", "end")?;
    let next_start_angle = start_angle + sweep;
    let next_end_angle = start_angle;
    let next_sweep = -sweep;
    let (start_tangent, end_tangent) =
        arc_tangent_angles(next_start_angle, next_end_angle, next_sweep);
    next["startAngleDeg"] = json!(next_start_angle);
    next["endAngleDeg"] = json!(next_end_angle);
    next["sweepAngleDeg"] = json!(next_sweep);
    next["startTangentAngleDeg"] = json!(start_tangent);
    next["endTangentAngleDeg"] = json!(end_tangent);
    Some(next)
}

fn reverse_bezier_segment(segment: &Value) -> Option<Value> {
    let mut next = segment.clone();
    swap_fields(&mut next, "start", "end")?;
    swap_fields(&mut next, "startPointId", "endPointId")?;
    swap_fields(&mut next, "control1", "control2")?;
    Some(next)
}

fn reverse_bezier(curve: &Value) -> Option<Value> {
    let segments = curve
        .get("segments")?
        .as_array()?
        .iter()
        .rev()
        .map(reverse_bezier_segment)
        .collect::<Option<Vec<_>>>()?;
    let first = segments.first()?;
    let last = segments.last()?;
    let start = value_point(first.get("start")?)?;
    let start_control = value_point(first.get("control1")?)?;
    let end = value_point(last.get("end")?)?;
    let end_control = value_point(last.get("control2")?)?;
    let intermediate_slot_ids = curve
        .get("intermediateSlotIds")?
        .as_array()?
        .iter()
        .rev()
        .cloned()
        .collect::<Vec<_>>();
    let mut next = curve.clone();
    swap_fields(&mut next, "startPointId", "endPointId")?;
    swap_fields(&mut next, "startHandleAngleDeg", "endHandleAngleDeg")?;
    swap_fields(&mut next, "startHandleLength", "endHandleLength")?;
    next["segments"] = json!(segments);
    next["intermediateSlotIds"] = json!(intermediate_slot_ids);
    next["startTangentAngleDeg"] = json!(angle_of_point(start, start_control));
    next["endTangentAngleDeg"] = json!(angle_of_point(end, end_control));
    Some(next)
}

fn reverse_offset_segment(segment: &Value) -> Option<(Value, OffsetSegment)> {
    let kind = segment.get("kind")?.as_str()?;
    let mut next = segment.clone();
    swap_fields(&mut next, "start", "end")?;
    match kind {
        "line" => {
            let start = value_point(next.get("start")?)?;
            let end = value_point(next.get("end")?)?;
            next["length"] = json!(line_length(start, end));
            Some((
                next,
                OffsetSegment::Line {
                    start,
                    end,
                    length: line_length(start, end),
                },
            ))
        }
        "bezier" => {
            swap_fields(&mut next, "control1", "control2")?;
            let length = approximate_segment_length(&next, 32)?;
            let start = value_point(next.get("start")?)?;
            let control1 = value_point(next.get("control1")?)?;
            let control2 = value_point(next.get("control2")?)?;
            let end = value_point(next.get("end")?)?;
            next["length"] = json!(length);
            Some((
                next,
                OffsetSegment::Bezier {
                    start,
                    control1,
                    control2,
                    end,
                    length,
                },
            ))
        }
        "arc" => {
            let start_angle = segment.get("startAngleDeg")?.as_f64()?;
            let sweep = segment.get("sweepAngleDeg")?.as_f64()?;
            let radius = segment.get("radius")?.as_f64()?;
            let center = value_point(next.get("center")?)?;
            let start = value_point(next.get("start")?)?;
            let end = value_point(next.get("end")?)?;
            let next_start_angle = start_angle + sweep;
            let next_sweep = -sweep;
            let length = radius * next_sweep.to_radians().abs();
            next["startAngleDeg"] = json!(next_start_angle);
            next["sweepAngleDeg"] = json!(next_sweep);
            next["length"] = json!(length);
            Some((
                next,
                OffsetSegment::Arc {
                    center,
                    start,
                    end,
                    radius,
                    start_angle_deg: next_start_angle,
                    sweep_angle_deg: next_sweep,
                    length,
                },
            ))
        }
        _ => None,
    }
}

fn reverse_offset(line: &Value) -> Option<Value> {
    let segments = line
        .get("segments")?
        .as_array()?
        .iter()
        .rev()
        .map(reverse_offset_segment)
        .collect::<Option<Vec<_>>>()?;
    if segments.is_empty() {
        return None;
    }
    let (values, measurements): (Vec<_>, Vec<_>) = segments.into_iter().unzip();
    let (_, _, start_tangent, end_tangent) = offset_line_endpoint_measurements(&measurements);
    let mut next = line.clone();
    next["start"] = values.first()?.get("start")?.clone();
    next["end"] = values.last()?.get("end")?.clone();
    next["segments"] = json!(values);
    next["startTangentAngleDeg"] = start_tangent;
    next["endTangentAngleDeg"] = end_tangent;
    Some(next)
}

fn reverse_polyline(line: &Value) -> Option<Value> {
    let values = line
        .get("segments")?
        .as_array()?
        .iter()
        .rev()
        .map(|segment| {
            let start = segment.get("end")?.clone();
            let end = segment.get("start")?.clone();
            let start_point = value_point(&start)?;
            let end_point = value_point(&end)?;
            Some(json!({
                "kind": "line",
                "start": start,
                "end": end,
                "length": line_length(start_point, end_point)
            }))
        })
        .collect::<Option<Vec<_>>>()?;
    if values.is_empty() {
        return None;
    }
    let first_nonzero = values
        .iter()
        .find(|segment| segment.get("length").and_then(Value::as_f64).unwrap_or(0.0) > 1e-9);
    let last_nonzero = values
        .iter()
        .rev()
        .find(|segment| segment.get("length").and_then(Value::as_f64).unwrap_or(0.0) > 1e-9);
    let start_tangent = first_nonzero.and_then(|segment| {
        let start = value_point(segment.get("start")?)?;
        let end = value_point(segment.get("end")?)?;
        (line_length(start, end) > 1e-9).then(|| angle_of_point(start, end))
    });
    let end_tangent = last_nonzero.and_then(|segment| {
        let end = value_point(segment.get("end")?)?;
        let start = value_point(segment.get("start")?)?;
        (line_length(end, start) > 1e-9).then(|| angle_of_point(end, start))
    });
    let mut next = line.clone();
    next["segments"] = json!(values);
    next["start"] = next
        .get("segments")?
        .as_array()?
        .first()?
        .get("start")?
        .clone();
    next["end"] = if line.get("closed").and_then(Value::as_bool).unwrap_or(false) {
        next["start"].clone()
    } else {
        next.get("segments")?
            .as_array()?
            .last()?
            .get("end")?
            .clone()
    };
    next["startTangentAngleDeg"] = json!(start_tangent);
    next["endTangentAngleDeg"] = json!(end_tangent);
    Some(next)
}

pub(crate) fn reverse_line_like_geometry(geometry: &Value) -> Option<Value> {
    match geometry.get("kind")?.as_str()? {
        "line" => reverse_line(geometry),
        "arcLine" => reverse_arc(geometry),
        "bezierCurve" => reverse_bezier(geometry),
        "offsetLine" => reverse_offset(geometry),
        "polyline" => reverse_polyline(geometry),
        _ => None,
    }
}
