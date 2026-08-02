use serde_json::{json, Value};
use std::collections::HashMap;

use super::errors::{dependency_error, geometry_error};
use super::line_copy_geometry::copied_offset_line_geometry;
use super::line_transform::{transform_line_like_geometry, LineTransform};
use super::numeric_expression::evaluate_numeric_or_push;
use super::offset_paths::is_line_like_geometry;
use super::offset_source_segments::{connect_source_segment_groups, source_segments_for_geometry};
use super::offset_types::{line_length, OffsetPoint};
use super::point_anchor::point_anchor_or_error;
use super::types::{element_id, element_name, element_type, insert_geometry, EvaluationState};

fn base_line_ids(element: &Value) -> Vec<String> {
    element
        .get("baseLineIds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

fn point_to_offset(point: &super::types::Point) -> OffsetPoint {
    OffsetPoint {
        x: point.x,
        y: point.y,
    }
}

fn collect_base_geometries(
    element: &Value,
    state: &mut EvaluationState,
) -> Option<(Vec<String>, Vec<Value>)> {
    let ids = base_line_ids(element);
    let mut geometries = Vec::new();
    let mut has_missing_base = false;
    for id in &ids {
        let geometry = state.computed_geometry.get(id);
        if !is_line_like_geometry(geometry) {
            state.errors.push(dependency_error(state, element, id));
            has_missing_base = true;
            continue;
        }
        if let Some(geometry) = geometry {
            geometries.push(geometry.clone());
        }
    }
    (!has_missing_base).then_some((ids, geometries))
}

fn evaluate_copy_with_transform(
    element: &Value,
    state: &mut EvaluationState,
    transform: &LineTransform,
) {
    let Some((base_line_ids, base_geometries)) = collect_base_geometries(element, state) else {
        return;
    };
    let source_segment_groups = base_geometries
        .iter()
        .map(source_segments_for_geometry)
        .filter(|segments| !segments.is_empty())
        .collect::<Vec<_>>();
    let id = element_id(element).unwrap_or_default();
    let name = element_name(element);
    if source_segment_groups.is_empty() {
        state.errors.push(geometry_error(
            element,
            format!("{name} は基準線から作図できる線分がありません。基準線を指定してください。"),
        ));
        return;
    }
    let source_segments = connect_source_segment_groups(&source_segment_groups, false);
    if source_segments.is_empty() {
        state.errors.push(geometry_error(
            element,
            format!("{name} の基準線は指定順・指定方向で連続していません。reverse を使うか順序を見直してください。"),
        ));
        return;
    }
    let include_bezier_control_metadata = element_type(element) == Some("copyLine");
    let Some(geometry) = copied_offset_line_geometry(
        &id,
        &name,
        base_line_ids,
        &source_segments,
        transform,
        include_bezier_control_metadata,
    ) else {
        state.errors.push(geometry_error(
            element,
            format!("{name} は基準線から作図できる長さの線分がありません。"),
        ));
        return;
    };
    insert_geometry(state, id, geometry);
}

fn apply_transform_to_targets(
    element: &Value,
    state: &mut EvaluationState,
    transform: &LineTransform,
) {
    let ids = base_line_ids(element);
    let name = element_name(element);
    if ids.is_empty() {
        state.errors.push(geometry_error(
            element,
            format!("{name} は対象線が指定されていません。対象線を指定してください。"),
        ));
        return;
    }

    let mut next_geometry = HashMap::<String, Value>::new();
    for id in ids {
        let current = next_geometry
            .get(&id)
            .or_else(|| state.computed_geometry.get(&id));
        if !is_line_like_geometry(current) {
            state.errors.push(dependency_error(state, element, &id));
            return;
        }
        let Some(current) = current else {
            state.errors.push(dependency_error(state, element, &id));
            return;
        };
        let Some(transformed) = transform_line_like_geometry(current, transform) else {
            let current_name = current
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            state.errors.push(geometry_error(
                element,
                format!("{name}: {current_name} を移動できません。"),
            ));
            return;
        };
        next_geometry.insert(id, transformed);
    }

    for (id, geometry) in next_geometry {
        insert_geometry(state, id, geometry);
    }
}

pub(crate) fn evaluate_copy_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start_anchor) = element.get("startPoint") else {
        return;
    };
    let Some(start_point) = point_anchor_or_error(
        element,
        start_anchor,
        "start",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_anchor) = element.get("endPoint") else {
        return;
    };
    let Some(end_point) = point_anchor_or_error(
        element,
        end_anchor,
        "end",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(angle_deg) = evaluate_numeric_or_push(
        element.get("angleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(scale) = evaluate_numeric_or_push(
        element.get("scale").unwrap_or(&json!(1.0)),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if scale <= 0.0 {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は倍率が0以下のためコピーできません。倍率を正の値にしてください。",
                element_name(element)
            ),
        ));
        return;
    }
    let transform = LineTransform::move_between(
        point_to_offset(&start_point),
        point_to_offset(&end_point),
        angle_deg,
        element
            .get("mirrorX")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        scale,
    );
    evaluate_copy_with_transform(element, state, &transform);
}

pub(crate) fn evaluate_symmetric_copy_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(axis1_anchor) = element.get("axisPoint1") else {
        return;
    };
    let Some(axis_point1) = point_anchor_or_error(
        element,
        axis1_anchor,
        "axisPoint1",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(axis2_anchor) = element.get("axisPoint2") else {
        return;
    };
    let Some(axis_point2) = point_anchor_or_error(
        element,
        axis2_anchor,
        "axisPoint2",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let axis_point1 = point_to_offset(&axis_point1);
    let axis_point2 = point_to_offset(&axis_point2);
    if line_length(axis_point1, axis_point2) <= super::offset_types::EPSILON {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の対称軸は同じ点を2回指定できません。",
                element_name(element)
            ),
        ));
        return;
    }
    let Some(transform) = LineTransform::reflect(axis_point1, axis_point2) else {
        return;
    };
    evaluate_copy_with_transform(element, state, &transform);
}

pub(crate) fn evaluate_move(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start_anchor) = element.get("startPoint") else {
        return;
    };
    let Some(start_point) = point_anchor_or_error(
        element,
        start_anchor,
        "start",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_anchor) = element.get("endPoint") else {
        return;
    };
    let Some(end_point) = point_anchor_or_error(
        element,
        end_anchor,
        "end",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(angle_deg) = evaluate_numeric_or_push(
        element.get("angleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(scale) = evaluate_numeric_or_push(
        element.get("scale").unwrap_or(&json!(1.0)),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if scale <= 0.0 {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は倍率が0以下のため移動できません。倍率を正の値にしてください。",
                element_name(element)
            ),
        ));
        return;
    }
    let transform = LineTransform::move_between(
        point_to_offset(&start_point),
        point_to_offset(&end_point),
        angle_deg,
        element
            .get("mirrorX")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        scale,
    );
    apply_transform_to_targets(element, state, &transform);
}

pub(crate) fn evaluate_symmetric_move(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(axis1_anchor) = element.get("axisPoint1") else {
        return;
    };
    let Some(axis_point1) = point_anchor_or_error(
        element,
        axis1_anchor,
        "axisPoint1",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(axis2_anchor) = element.get("axisPoint2") else {
        return;
    };
    let Some(axis_point2) = point_anchor_or_error(
        element,
        axis2_anchor,
        "axisPoint2",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let axis_point1 = point_to_offset(&axis_point1);
    let axis_point2 = point_to_offset(&axis_point2);
    if line_length(axis_point1, axis_point2) <= super::offset_types::EPSILON {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の対称軸は同じ点を2回指定できません。",
                element_name(element)
            ),
        ));
        return;
    }
    let Some(transform) = LineTransform::reflect(axis_point1, axis_point2) else {
        return;
    };
    apply_transform_to_targets(element, state, &transform);
}
