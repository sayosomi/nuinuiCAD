use serde_json::{json, Value};

use super::bezier_path::approximate_segment_length;
use super::errors::{dependency_error, geometry_error};
use super::math::CIRCLE_EPSILON;
use super::offset_types::{
    line_length, offset_line_endpoint_measurements, value_point, OffsetPoint, OffsetSegment,
};
use super::path_reverse_geometry::reverse_line_like_geometry;
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

fn point_distance(a: &OffsetPoint, b: &OffsetPoint) -> f64 {
    line_length(*a, *b)
}

fn endpoints(geometry: &Value) -> Option<(Value, Value)> {
    match geometry.get("kind")?.as_str()? {
        "bezierCurve" => {
            let segments = geometry.get("segments")?.as_array()?;
            Some((
                segments.first()?.get("start")?.clone(),
                segments.last()?.get("end")?.clone(),
            ))
        }
        "line" | "arcLine" | "offsetLine" | "joinedPath" => {
            Some((geometry.get("start")?.clone(), geometry.get("end")?.clone()))
        }
        _ => None,
    }
}

fn exact_segments(geometry: &Value) -> Option<Vec<Value>> {
    match geometry.get("kind")?.as_str()? {
        "line" => Some(vec![json!({
            "kind": "line",
            "start": geometry.get("start")?,
            "end": geometry.get("end")?,
            "length": geometry.get("length")?
        })]),
        "arcLine" => Some(vec![json!({
            "kind": "arc",
            "center": geometry.get("center")?,
            "start": geometry.get("start")?,
            "end": geometry.get("end")?,
            "radius": geometry.get("radius")?,
            "startAngleDeg": geometry.get("startAngleDeg")?,
            "sweepAngleDeg": geometry.get("sweepAngleDeg")?,
            "length": geometry.get("length")?
        })]),
        "bezierCurve" => geometry
            .get("segments")?
            .as_array()?
            .iter()
            .map(|segment| {
                let mut next = segment.clone();
                let length = approximate_segment_length(segment, 32)?;
                next["kind"] = json!("bezier");
                next["length"] = json!(length);
                Some(next)
            })
            .collect(),
        "offsetLine" | "joinedPath" => geometry.get("segments")?.as_array().cloned(),
        _ => None,
    }
}

fn offset_segment(value: &Value) -> Option<OffsetSegment> {
    let kind = value.get("kind")?.as_str()?;
    match kind {
        "line" => {
            let start = value_point(value.get("start")?)?;
            let end = value_point(value.get("end")?)?;
            Some(OffsetSegment::Line {
                start,
                end,
                length: value.get("length")?.as_f64()?,
            })
        }
        "bezier" => Some(OffsetSegment::Bezier {
            start: value_point(value.get("start")?)?,
            control1: value_point(value.get("control1")?)?,
            control2: value_point(value.get("control2")?)?,
            end: value_point(value.get("end")?)?,
            length: value.get("length")?.as_f64()?,
        }),
        "arc" => Some(OffsetSegment::Arc {
            center: value_point(value.get("center")?)?,
            start: value_point(value.get("start")?)?,
            end: value_point(value.get("end")?)?,
            radius: value.get("radius")?.as_f64()?,
            start_angle_deg: value.get("startAngleDeg")?.as_f64()?,
            sweep_angle_deg: value.get("sweepAngleDeg")?.as_f64()?,
            length: value.get("length")?.as_f64()?,
        }),
        _ => None,
    }
}

pub(crate) fn evaluate_joined_path(element: &Value, state: &mut EvaluationState) {
    let Some(path_ids) = element.get("pathIds").and_then(Value::as_array) else {
        state.errors.push(geometry_error(
            element,
            format!("{} の paths を解決できません。", element_name(element)),
        ));
        return;
    };
    if path_ids.is_empty() {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の paths は空にできません。少なくとも1つの path を指定してください。",
                element_name(element)
            ),
        ));
        return;
    }

    let mut sources = Vec::new();
    for path_id in path_ids.iter().filter_map(Value::as_str) {
        let Some(source) = state.computed_geometry.get(path_id) else {
            state.errors.push(dependency_error(state, element, path_id));
            return;
        };
        if !matches!(
            source.get("kind").and_then(Value::as_str),
            Some("line" | "arcLine" | "bezierCurve" | "offsetLine" | "joinedPath")
        ) {
            state.errors.push(dependency_error(state, element, path_id));
            return;
        }
        let Some((start, end)) = endpoints(source) else {
            state.errors.push(geometry_error(
                element,
                format!(
                    "{} の path「{}」には有効な始点または終点がありません。",
                    element_name(element),
                    path_id
                ),
            ));
            return;
        };
        if let Some(previous) = sources.last() {
            let Some((_, current_end)) = endpoints(previous) else {
                state.errors.push(geometry_error(
                    element,
                    format!("{} の chain end を解決できません。", element_name(element)),
                ));
                return;
            };
            let Some(current_end) = value_point(&current_end) else {
                state.errors.push(geometry_error(
                    element,
                    format!("{} の chain end を解決できません。", element_name(element)),
                ));
                return;
            };
            let authored_start = value_point(&start);
            let authored_end = value_point(&end);
            match (authored_start, authored_end) {
                (Some(authored_start), Some(_))
                    if point_distance(&authored_start, &current_end) <= CIRCLE_EPSILON => {}
                (Some(_), Some(authored_end))
                    if point_distance(&authored_end, &current_end) <= CIRCLE_EPSILON =>
                {
                    let Some(reversed) = reverse_line_like_geometry(source) else {
                        state.errors.push(geometry_error(
                            element,
                            format!(
                                "{} の path「{}」を反転できません。",
                                element_name(element),
                                path_id
                            ),
                        ));
                        return;
                    };
                    sources.push(reversed);
                    continue;
                }
                _ => {
                    state.errors.push(geometry_error(element, format!("{} の path「{}」は現在の chain end に接続していません。path の順序または向きを確認してください。", element_name(element), path_id)));
                    return;
                }
            }
        }
        sources.push(source.clone());
    }

    let Some(first_endpoints) = endpoints(sources.first().expect("non-empty paths")) else {
        return;
    };
    let Some(last_endpoints) = endpoints(sources.last().expect("non-empty paths")) else {
        return;
    };
    if element
        .get("closed")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let Some(first_start) = value_point(&first_endpoints.0) else {
            return;
        };
        let Some(last_end) = value_point(&last_endpoints.1) else {
            return;
        };
        if point_distance(&first_start, &last_end) > CIRCLE_EPSILON {
            state.errors.push(geometry_error(
                element,
                format!("{} は closed: true ですが、最後の path.end が最初の path.start に接続していません。閉じるための線分は自動生成されません。", element_name(element)),
            ));
            return;
        }
    }

    let Some(segment_groups) = sources
        .iter()
        .map(exact_segments)
        .collect::<Option<Vec<_>>>()
    else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の path primitive を正確に結合できません。",
                element_name(element)
            ),
        ));
        return;
    };
    let segments = segment_groups.into_iter().flatten().collect::<Vec<_>>();
    let measurements = segments
        .iter()
        .map(offset_segment)
        .collect::<Option<Vec<_>>>();
    let Some(measurements) = measurements else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の path primitive を正確に結合できません。",
                element_name(element)
            ),
        ));
        return;
    };
    let length = segments
        .iter()
        .filter_map(|segment| segment.get("length").and_then(Value::as_f64))
        .sum::<f64>();
    let (_, _, start_tangent, end_tangent) = offset_line_endpoint_measurements(&measurements);
    let id = element_id(element).unwrap_or_default();
    let name = element_name(element);
    let mut geometry = json!({
        "kind": "joinedPath",
        "elementId": id,
        "name": name,
        "pathIds": path_ids,
        "segments": segments,
        "closed": element.get("closed").and_then(Value::as_bool).unwrap_or(false),
        "length": length,
        "start": first_endpoints.0,
        "end": last_endpoints.1,
        "startTangentAngleDeg": start_tangent,
        "endTangentAngleDeg": end_tangent
    });
    if let Some(object) = geometry.as_object_mut() {
        object.insert("pathIds".to_owned(), Value::Array(path_ids.to_vec()));
    }
    insert_geometry(state, id, geometry);
}
