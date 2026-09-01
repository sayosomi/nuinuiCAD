use serde_json::{json, Value};

use super::bezier_path::approximate_segment_length;
use super::line_transform::LineTransform;
use super::offset_source_segments::{source_end, source_start};
use super::offset_types::{
    angle_of_point, computed_point, line_length, offset_line_endpoint_measurements, OffsetPoint,
    OffsetSegment, SourceSegment, EPSILON,
};

fn copy_point(element_id: &str, name: &str, index: usize, point: OffsetPoint) -> Value {
    computed_point(
        format!("{element_id}:{index}"),
        format!("{name}.{}", index + 1),
        point,
    )
}

fn copy_segment_value(
    segment: &OffsetSegment,
    element_id: &str,
    name: &str,
    index: usize,
    include_bezier_control_metadata: bool,
) -> Value {
    match segment {
        OffsetSegment::Line { start, end, length } => json!({
            "kind": "line",
            "start": copy_point(element_id, name, index, *start),
            "end": copy_point(element_id, name, index, *end),
            "length": length
        }),
        OffsetSegment::Bezier {
            start,
            control1,
            control2,
            end,
            length,
        } => json!({
            "kind": "bezier",
            "start": copy_point(element_id, name, index, *start),
            "control1": if include_bezier_control_metadata {
                copy_point(element_id, name, index, *control1)
            } else {
                json!({ "x": control1.x, "y": control1.y })
            },
            "control2": if include_bezier_control_metadata {
                copy_point(element_id, name, index, *control2)
            } else {
                json!({ "x": control2.x, "y": control2.y })
            },
            "end": copy_point(element_id, name, index, *end),
            "length": length
        }),
        OffsetSegment::Arc {
            center,
            start,
            end,
            radius,
            start_angle_deg,
            sweep_angle_deg,
            length,
        } => json!({
            "kind": "arc",
            "center": copy_point(element_id, name, index, *center),
            "start": copy_point(element_id, name, index, *start),
            "end": copy_point(element_id, name, index, *end),
            "radius": radius,
            "startAngleDeg": start_angle_deg,
            "sweepAngleDeg": sweep_angle_deg,
            "length": length
        }),
    }
}

fn transform_source_segment(
    segment: &SourceSegment,
    transform: &LineTransform,
) -> Option<OffsetSegment> {
    match segment {
        SourceSegment::Line { start, end } => {
            let next_start = transform.apply(*start)?;
            let next_end = transform.apply(*end)?;
            let length = line_length(next_start, next_end);
            (length > EPSILON).then_some(OffsetSegment::Line {
                start: next_start,
                end: next_end,
                length,
            })
        }
        SourceSegment::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            let next_start = transform.apply(*start)?;
            let next_control1 = transform.apply(*control1)?;
            let next_control2 = transform.apply(*control2)?;
            let next_end = transform.apply(*end)?;
            let segment_value = json!({
                "start": { "x": next_start.x, "y": next_start.y },
                "control1": { "x": next_control1.x, "y": next_control1.y },
                "control2": { "x": next_control2.x, "y": next_control2.y },
                "end": { "x": next_end.x, "y": next_end.y }
            });
            let length = approximate_segment_length(&segment_value, 32)?;
            (length > EPSILON).then_some(OffsetSegment::Bezier {
                start: next_start,
                control1: next_control1,
                control2: next_control2,
                end: next_end,
                length,
            })
        }
        SourceSegment::Arc {
            center,
            radius: _,
            start_angle_deg: _,
            sweep_angle_deg,
        } => {
            let next_center = transform.apply(*center)?;
            let next_start = transform.apply(source_start(segment))?;
            let next_end = transform.apply(source_end(segment))?;
            let next_radius = line_length(next_center, next_start);
            let start_angle_deg = angle_of_point(next_center, next_start);
            let next_sweep = if transform.reverse_orientation() {
                -*sweep_angle_deg
            } else {
                *sweep_angle_deg
            };
            Some(OffsetSegment::Arc {
                center: next_center,
                start: next_start,
                end: next_end,
                radius: next_radius,
                start_angle_deg,
                sweep_angle_deg: next_sweep,
                length: next_radius * next_sweep.to_radians().abs(),
            })
        }
    }
}

pub(crate) fn copied_offset_line_geometry(
    element_id: &str,
    name: &str,
    base_line_ids: Vec<String>,
    source_segments: &[SourceSegment],
    transform: &LineTransform,
    include_bezier_control_metadata: bool,
) -> Option<Value> {
    let segments = source_segments
        .iter()
        .filter_map(|segment| transform_source_segment(segment, transform))
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return None;
    }
    let (_, _, start_tangent_angle_deg, end_tangent_angle_deg) =
        offset_line_endpoint_measurements(&segments);
    let segment_values = segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            copy_segment_value(
                segment,
                element_id,
                name,
                index,
                include_bezier_control_metadata,
            )
        })
        .collect::<Vec<_>>();
    let start = segment_values
        .first()
        .and_then(|segment| segment.get("start"))
        .cloned()
        .unwrap_or(Value::Null);
    let end = segment_values
        .last()
        .and_then(|segment| segment.get("end"))
        .cloned()
        .unwrap_or(Value::Null);
    Some(json!({
        "kind": "offsetLine",
        "elementId": element_id,
        "name": name,
        "baseLineIds": base_line_ids,
        "start": start,
        "end": end,
        "segments": segment_values,
        "closed": false,
        "length": segments.iter().map(|segment| match segment {
            OffsetSegment::Line { length, .. }
            | OffsetSegment::Bezier { length, .. }
            | OffsetSegment::Arc { length, .. } => length,
        }).sum::<f64>(),
        "startTangentAngleDeg": start_tangent_angle_deg,
        "endTangentAngleDeg": end_tangent_angle_deg
    }))
}
