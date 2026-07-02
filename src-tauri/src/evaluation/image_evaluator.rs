use serde_json::{json, Value};
use std::collections::HashMap;

use super::errors::geometry_error;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{computed_point, point_anchor_or_error};
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

const MM_PER_INCH: f64 = 25.4;

pub(crate) fn evaluate_image(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(origin_anchor) = element.get("originPoint") else {
        return;
    };
    let Some(origin) = point_anchor_or_error(
        element,
        origin_anchor,
        "origin",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(scale) = evaluate_numeric_or_push(
        element.get("scale").unwrap_or(&Value::Null),
        state,
        element,
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

    let natural_width_px = element
        .get("naturalWidthPx")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let natural_height_px = element
        .get("naturalHeightPx")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let source_dpi = element
        .get("sourceDpi")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if natural_width_px <= 0.0 || natural_height_px <= 0.0 || source_dpi <= 0.0 || scale <= 0.0 {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} は画像寸法、DPI、倍率が0以下のため配置できません。画像を読み込み直すか、倍率を正の値にしてください。",
                element_name(element)
            ),
        ));
        return;
    }

    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "image",
            "elementId": id,
            "name": element_name(element),
            "sourcePath": element.get("sourcePath").and_then(Value::as_str).unwrap_or_default(),
            "origin": computed_point(origin.element_id, origin.name, origin.x, origin.y),
            "naturalWidthPx": natural_width_px,
            "naturalHeightPx": natural_height_px,
            "sourceDpi": source_dpi,
            "targetPixelsPerMm": element.get("targetPixelsPerMm").and_then(Value::as_f64).unwrap_or(0.0),
            "scale": scale,
            "angleDeg": angle_deg,
            "mirrorX": element.get("mirrorX").and_then(Value::as_bool).unwrap_or(false),
            "widthMm": (natural_width_px / source_dpi) * MM_PER_INCH * scale,
            "heightMm": (natural_height_px / source_dpi) * MM_PER_INCH * scale
        }),
    );
}
