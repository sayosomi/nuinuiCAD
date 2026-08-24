use serde_json::Value;
use std::collections::HashMap;

use super::bezier_math::{
    cubic_derivative, project_point_onto_curve, signed_curvature_at, Point as BezierPoint, EPSILON,
};
use super::errors::{dependency_error, geometry_error};
use super::line_path::tangent_at_point_on_geometry;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{computed_point, point_anchor_or_error};
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

const LINE_POINT_TOLERANCE: f64 = 0.001;

#[derive(Clone, Copy)]
struct CurveSideFrame {
    tangent: BezierPoint,
    normal: BezierPoint,
}

fn curve_side_frame_at(segment: &Value, local_t: f64, curve_side: &str) -> Option<CurveSideFrame> {
    let first = cubic_derivative(segment, local_t)?;
    let speed = first.x.hypot(first.y);
    if !speed.is_finite() || speed <= EPSILON {
        return None;
    }
    let curvature = signed_curvature_at(segment, local_t)?;
    if !curvature.is_finite() || curvature.abs() <= EPSILON {
        return None;
    }

    let tangent = BezierPoint {
        x: first.x / speed,
        y: first.y / speed,
    };
    let left_normal = BezierPoint {
        x: -tangent.y,
        y: tangent.x,
    };
    let concave_sign = if curvature > 0.0 { 1.0 } else { -1.0 };
    let concave_normal = BezierPoint {
        x: concave_sign * left_normal.x,
        y: concave_sign * left_normal.y,
    };
    let normal = if curve_side == "concave" {
        concave_normal
    } else {
        BezierPoint {
            x: -concave_normal.x,
            y: -concave_normal.y,
        }
    };
    Some(CurveSideFrame { tangent, normal })
}

fn curve_side_point(
    base_line: &Value,
    base_point: BezierPoint,
    curve_side: &str,
    distance: f64,
) -> Result<BezierPoint, &'static str> {
    if curve_side != "convex" && curve_side != "concave" {
        return Err("curveSide は convex または concave で指定してください。");
    }
    let Some(segments) = base_line.get("segments").and_then(Value::as_array) else {
        return Err("curveSide のベジェ曲線区間が不正です。");
    };
    let Some(projection) = project_point_onto_curve(segments, base_point) else {
        return Err(
            "curveSide の基準点は基準ベジェ曲線上にありません。基準曲線上の点を指定してください。",
        );
    };
    if projection.distance > LINE_POINT_TOLERANCE {
        return Err(
            "curveSide の基準点は基準ベジェ曲線上にありません。基準曲線上の点を指定してください。",
        );
    }

    let mut samples = vec![(projection.segment_index, projection.local_t)];
    if projection.local_t <= EPSILON && projection.segment_index > 0 {
        samples.insert(0, (projection.segment_index - 1, 1.0));
    } else if projection.local_t >= 1.0 - EPSILON && projection.segment_index + 1 < segments.len() {
        samples.push((projection.segment_index + 1, 0.0));
    }

    let frames: Option<Vec<CurveSideFrame>> = samples
        .iter()
        .map(|(segment_index, local_t)| {
            curve_side_frame_at(&segments[*segment_index], *local_t, curve_side)
        })
        .collect();
    let Some(frames) = frames else {
        return Err("curveSide を決定する接線または曲率が不定義です。");
    };
    let Some(first) = frames.first() else {
        return Err("curveSide を決定するベジェ曲線区間がありません。");
    };
    if let Some(second) = frames.get(1) {
        let tangent_mismatch =
            (first.tangent.x - second.tangent.x).hypot(first.tangent.y - second.tangent.y);
        let normal_mismatch =
            (first.normal.x - second.normal.x).hypot(first.normal.y - second.normal.y);
        if tangent_mismatch > EPSILON || normal_mismatch > EPSILON {
            return Err("curveSide の基準点がベジェ曲線の曖昧な内部 join にあります。corner または不一致の曲率側は指定できません。");
        }
    }

    Ok(BezierPoint {
        x: base_point.x + first.normal.x * distance,
        y: base_point.y + first.normal.y * distance,
    })
}

pub(crate) fn evaluate_line_tangent_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(base_line_id) = element.get("baseLineId").and_then(Value::as_str) else {
        return;
    };
    let Some(base_line) = state.computed_geometry.get(base_line_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    };
    let Some(base_point) = point_anchor_or_error(
        element,
        element.get("basePoint").unwrap_or(&Value::Null),
        "basePoint",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let Some(distance) = evaluate_numeric_or_push(
        element.get("distance").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    if element.get("curveSide").is_some() {
        let Some(curve_side) = element.get("curveSide").and_then(Value::as_str) else {
            state.errors.push(geometry_error(
                element,
                format!(
                    "{}: curveSide は convex または concave で指定してください。",
                    element_name(element)
                ),
            ));
            return;
        };
        if base_line.get("kind").and_then(Value::as_str) != Some("bezierCurve") {
            state.errors.push(geometry_error(
                element,
                format!(
                    "{} の curveSide はベジェ曲線の計算結果にのみ指定できます。",
                    element_name(element)
                ),
            ));
            return;
        }
        if distance < 0.0 {
            state.errors.push(geometry_error(
                element,
                format!(
                    "{} の curveSide の距離は0以上で指定してください。",
                    element_name(element)
                ),
            ));
            return;
        }
        let point = match curve_side_point(
            &base_line,
            BezierPoint {
                x: base_point.x,
                y: base_point.y,
            },
            curve_side,
            distance,
        ) {
            Ok(point) => point,
            Err(error) => {
                state.errors.push(geometry_error(
                    element,
                    format!("{}: {error}", element_name(element)),
                ));
                return;
            }
        };
        let id = element_id(element).unwrap_or_default();
        insert_geometry(
            state,
            id.clone(),
            computed_point(id, element_name(element), point.x, point.y),
        );
        return;
    }

    if !matches!(
        base_line.get("kind").and_then(Value::as_str),
        Some("line" | "arcLine" | "bezierCurve" | "offsetLine" | "polyline")
    ) {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    }

    let Some((base_tangent_angle_deg, _distance_from_line)) = tangent_at_point_on_geometry(
        &base_line,
        (base_point.x, base_point.y),
        LINE_POINT_TOLERANCE,
    ) else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の基準点は基準線上にありません。基準線上の点を指定してください。",
                element_name(element)
            ),
        ));
        return;
    };

    let Some(tangent_angle_deg) = evaluate_numeric_or_push(
        element.get("tangentAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };

    let angle_rad = (base_tangent_angle_deg + tangent_angle_deg).to_radians();
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            base_point.x + angle_rad.cos() * distance,
            base_point.y + angle_rad.sin() * distance,
        ),
    );
}
