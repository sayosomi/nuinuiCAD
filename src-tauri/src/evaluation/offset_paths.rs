use serde_json::{json, Value};

use super::offset_bezier::offset_bezier_segment_groups;
use super::offset_joins::{
    join_intersection, line_connector, pointed_join_connectors, with_end, with_start,
};
use super::offset_source_segments::{
    connect_source_segment_groups, connector_segment, source_end, source_segments_for_geometry,
    source_start,
};
use super::offset_types::{
    arc_point, computed_point, line_length, normalize_degrees, offset_line_endpoint_measurements,
    segment_end, segment_start, JoinMode, OffsetBuildResult, OffsetPoint, OffsetSegment,
    RawOffsetSegment, SourceSegment, EPSILON,
};

fn offset_line_segment(segment: &SourceSegment, offset: f64) -> Option<OffsetSegment> {
    let SourceSegment::Line { start, end } = segment else {
        return None;
    };
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    if length <= EPSILON {
        return None;
    }
    let nx = (dy / length) * offset;
    let ny = (-dx / length) * offset;
    let next_start = OffsetPoint {
        x: start.x + nx,
        y: start.y + ny,
    };
    let next_end = OffsetPoint {
        x: end.x + nx,
        y: end.y + ny,
    };
    Some(OffsetSegment::Line {
        start: next_start,
        end: next_end,
        length: line_length(next_start, next_end),
    })
}

fn offset_arc_segment(
    segment: &SourceSegment,
    offset: f64,
    element_name: &str,
) -> Result<Option<OffsetSegment>, String> {
    let SourceSegment::Arc {
        center,
        radius,
        start_angle_deg,
        sweep_angle_deg,
    } = segment
    else {
        return Ok(None);
    };
    let next_radius = radius
        + if *sweep_angle_deg >= 0.0 {
            -offset
        } else {
            offset
        };
    if next_radius <= EPSILON {
        return Err(format!(
            "{element_name} はオフセット後の円弧半径が0以下になるため作図できません。オフセット量または左右を変更してください。"
        ));
    }
    let start = arc_point(*center, next_radius, *start_angle_deg);
    let end = arc_point(*center, next_radius, start_angle_deg + sweep_angle_deg);
    Ok(Some(OffsetSegment::Arc {
        center: *center,
        start,
        end,
        radius: next_radius,
        start_angle_deg: normalize_degrees(*start_angle_deg),
        sweep_angle_deg: *sweep_angle_deg,
        length: next_radius * sweep_angle_deg.to_radians().abs(),
    }))
}

fn named_segment_value(
    segment: &OffsetSegment,
    element_id: &str,
    name: &str,
    index: usize,
) -> Value {
    let prefix = format!("{element_id}:segment-{}", index + 1);
    match segment {
        OffsetSegment::Line { start, end, length } => json!({
            "kind": "line",
            "start": computed_point(format!("{prefix}:start"), format!("{name}.区間{}始点", index + 1), *start),
            "end": computed_point(format!("{prefix}:end"), format!("{name}.区間{}終点", index + 1), *end),
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
            "start": computed_point(format!("{prefix}:start"), format!("{name}.区間{}始点", index + 1), *start),
            "control1": { "x": control1.x, "y": control1.y },
            "control2": { "x": control2.x, "y": control2.y },
            "end": computed_point(format!("{prefix}:end"), format!("{name}.区間{}終点", index + 1), *end),
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
            "center": computed_point(format!("{prefix}:center"), format!("{name}.区間{}中心", index + 1), *center),
            "start": computed_point(format!("{prefix}:start"), format!("{name}.区間{}始点", index + 1), *start),
            "end": computed_point(format!("{prefix}:end"), format!("{name}.区間{}終点", index + 1), *end),
            "radius": radius,
            "startAngleDeg": start_angle_deg,
            "sweepAngleDeg": sweep_angle_deg,
            "length": length
        }),
    }
}

fn endpoint_measurement_values(segments: &[OffsetSegment]) -> (Value, Value, Value, Value) {
    let (start, end, start_tangent, end_tangent) = offset_line_endpoint_measurements(segments);
    (start, end, start_tangent, end_tangent)
}

pub(crate) fn is_line_like_geometry(geometry: Option<&Value>) -> bool {
    matches!(
        geometry
            .and_then(|value| value.get("kind"))
            .and_then(Value::as_str),
        Some("line" | "arcLine" | "bezierCurve" | "offsetLine")
    )
}

pub(crate) fn build_offset_line_geometry(
    element_id: &str,
    name: &str,
    base_line_ids: Vec<String>,
    base_geometries: &[Value],
    offset: f64,
    closed: bool,
) -> OffsetBuildResult {
    let source_segment_groups = base_geometries
        .iter()
        .map(source_segments_for_geometry)
        .filter(|segments| !segments.is_empty())
        .collect::<Vec<_>>();
    if source_segment_groups.is_empty() {
        return OffsetBuildResult {
            geometry: None,
            error: Some(format!(
                "{name} は基準線から作図できる線分がありません。基準線を指定してください。"
            )),
            warnings: Vec::new(),
        };
    }

    let mut connected_source_segments =
        connect_source_segment_groups(&source_segment_groups, closed);
    if closed {
        if let Some(connector) = connector_segment(
            source_end(connected_source_segments.last().unwrap()),
            source_start(&connected_source_segments[0]),
        ) {
            connected_source_segments.push(connector);
        }
    }

    let mut raw_segments = Vec::<RawOffsetSegment>::new();
    let mut warnings = Vec::<String>::new();
    for segment in &connected_source_segments {
        match segment {
            SourceSegment::Line { .. } => {
                if let Some(next) = offset_line_segment(segment, offset) {
                    raw_segments.push(RawOffsetSegment {
                        segment: next,
                        join_with_previous: JoinMode::Miter,
                        source: segment.clone(),
                    });
                }
            }
            SourceSegment::Bezier { .. } => {
                let result = offset_bezier_segment_groups(segment, offset);
                if result.trimmed && warnings.is_empty() {
                    warnings.push(format!(
                        "{name} はオフセット量が曲線の曲率半径を超える箇所があるため、一部区間をトリムしました。オフセット量を下げると全体を作図できます。"
                    ));
                }
                for (group_index, group) in result.groups.into_iter().enumerate() {
                    for (index, next) in group.into_iter().enumerate() {
                        raw_segments.push(RawOffsetSegment {
                            segment: next,
                            join_with_previous: if index > 0 {
                                JoinMode::Smooth
                            } else if group_index > 0 {
                                JoinMode::None
                            } else {
                                JoinMode::Miter
                            },
                            source: segment.clone(),
                        });
                    }
                }
            }
            SourceSegment::Arc { .. } => match offset_arc_segment(segment, offset, name) {
                Ok(Some(next)) => raw_segments.push(RawOffsetSegment {
                    segment: next,
                    join_with_previous: JoinMode::Miter,
                    source: segment.clone(),
                }),
                Ok(None) => {}
                Err(error) => {
                    return OffsetBuildResult {
                        geometry: None,
                        error: Some(error),
                        warnings: Vec::new(),
                    }
                }
            },
        }
    }

    if raw_segments.is_empty() {
        return OffsetBuildResult {
            geometry: None,
            error: Some(format!(
                "{name} は基準線から作図できる長さの線分がありません。"
            )),
            warnings,
        };
    }

    let mut adjusted = raw_segments
        .iter()
        .map(|item| item.segment.clone())
        .collect::<Vec<_>>();
    let mut connectors = Vec::<(usize, OffsetSegment)>::new();
    let join_count = if closed {
        adjusted.len()
    } else {
        adjusted.len().saturating_sub(1)
    };
    for index in 0..join_count {
        let next_index = (index + 1) % adjusted.len();
        let join_mode = raw_segments[next_index].join_with_previous;
        if join_mode == JoinMode::Smooth || join_mode == JoinMode::None {
            continue;
        }
        if let Some(intersection) = join_intersection(&adjusted[index], &adjusted[next_index]) {
            adjusted[index] = with_end(&adjusted[index], intersection);
            adjusted[next_index] = with_start(&adjusted[next_index], intersection);
            continue;
        }
        let pointed_connectors = pointed_join_connectors(
            &RawOffsetSegment {
                segment: adjusted[index].clone(),
                ..raw_segments[index].clone()
            },
            &RawOffsetSegment {
                segment: adjusted[next_index].clone(),
                ..raw_segments[next_index].clone()
            },
            offset,
            element_id,
            name,
            index,
        );
        if !pointed_connectors.is_empty() {
            connectors.extend(
                pointed_connectors
                    .into_iter()
                    .map(|segment| (index, segment)),
            );
            continue;
        }
        if let Some(connector) = line_connector(
            segment_end(&adjusted[index]),
            segment_start(&adjusted[next_index]),
            element_id,
            name,
            index,
        ) {
            connectors.push((index, connector));
        }
    }

    let mut output_segments = Vec::<OffsetSegment>::new();
    for (index, segment) in adjusted.iter().enumerate() {
        output_segments.push(segment.clone());
        output_segments.extend(
            connectors
                .iter()
                .filter(|(connector_index, _)| *connector_index == index)
                .map(|(_, connector)| connector.clone()),
        );
    }

    let (_, _, start_tangent_angle_deg, end_tangent_angle_deg) =
        endpoint_measurement_values(&output_segments);
    let segment_values = output_segments
        .iter()
        .enumerate()
        .map(|(index, segment)| named_segment_value(segment, element_id, name, index))
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
    let length = output_segments.iter().map(segment_length).sum::<f64>();

    OffsetBuildResult {
        geometry: Some(json!({
            "kind": "offsetLine",
            "elementId": element_id,
            "name": name,
            "baseLineIds": base_line_ids,
            "start": start,
            "end": end,
            "segments": segment_values,
            "closed": closed,
            "length": length,
            "startTangentAngleDeg": start_tangent_angle_deg,
            "endTangentAngleDeg": end_tangent_angle_deg
        })),
        error: None,
        warnings,
    }
}

fn segment_length(segment: &OffsetSegment) -> f64 {
    match segment {
        OffsetSegment::Line { length, .. }
        | OffsetSegment::Bezier { length, .. }
        | OffsetSegment::Arc { length, .. } => *length,
    }
}
