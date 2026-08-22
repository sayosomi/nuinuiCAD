use serde_json::{json, Value};

use super::errors::{dependency_error, geometry_error};
use super::math::{angle_from_to, CIRCLE_EPSILON};
use super::types::{element_id, element_name, insert_geometry, EvaluationState, Point};

const COLLAPSED_MESSAGE: &str = "2つの接点が一致するため、有限長の共通接線として表現できません。2つの円の位置・半径または kind を変更してください。";

fn arc_geometry(
    state: &mut EvaluationState,
    element: &Value,
    key: &str,
    label: &str,
) -> Option<Value> {
    let reference_id = element.get(key).and_then(Value::as_str).unwrap_or_default();
    let Some(geometry) = state.computed_geometry.get(reference_id).cloned() else {
        let error = dependency_error(state, element, reference_id);
        state.errors.push(error);
        return None;
    };
    if geometry.get("kind").and_then(Value::as_str) != Some("arcLine") {
        state.errors.push(geometry_error(
            element,
            format!("{label} に円弧が指定されていません。共通接線には円弧を指定してください。"),
        ));
        return None;
    }
    Some(geometry)
}

pub(crate) fn evaluate_common_tangent_line(element: &Value, state: &mut EvaluationState) {
    let first = arc_geometry(state, element, "firstLineId", "first");
    let second = arc_geometry(state, element, "secondLineId", "second");
    let (Some(first), Some(second)) = (first, second) else {
        return;
    };

    let r1 = first
        .get("radius")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    let r2 = second
        .get("radius")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    if r1 <= CIRCLE_EPSILON {
        state.errors.push(geometry_error(
            element,
            "first の半径が0以下です。共通接線には半径のある円弧を指定してください。".to_owned(),
        ));
    }
    if r2 <= CIRCLE_EPSILON {
        state.errors.push(geometry_error(
            element,
            "second の半径が0以下です。共通接線には半径のある円弧を指定してください。".to_owned(),
        ));
    }
    if r1 <= CIRCLE_EPSILON || r2 <= CIRCLE_EPSILON {
        return;
    }

    let c1x = first["center"]["x"].as_f64().unwrap_or(f64::NAN);
    let c1y = first["center"]["y"].as_f64().unwrap_or(f64::NAN);
    let c2x = second["center"]["x"].as_f64().unwrap_or(f64::NAN);
    let c2y = second["center"]["y"].as_f64().unwrap_or(f64::NAN);
    let dx = c2x - c1x;
    let dy = c2y - c1y;
    let distance = dx.hypot(dy);
    if distance <= CIRCLE_EPSILON {
        let message = if (r1 - r2).abs() <= CIRCLE_EPSILON {
            "2つの円が同一円のため、共通接線を1本に決定できません。"
        } else {
            "2つの円が同心円のため、共通接線は存在しません。"
        };
        state
            .errors
            .push(geometry_error(element, message.to_owned()));
        return;
    }

    let kind = element
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("external");
    let side = element
        .get("side")
        .and_then(Value::as_str)
        .unwrap_or("left");
    let second_radius_sign = if kind == "internal" { -1.0 } else { 1.0 };
    let threshold = if kind == "internal" {
        r1 + r2
    } else {
        (r1 - r2).abs()
    };
    if distance < threshold - CIRCLE_EPSILON {
        state.errors.push(geometry_error(
  element,
  format!("kind: {kind} の共通接線は存在しません。2つの円の位置・半径または kind を変更してください。"),
        ));
        return;
    }
    if distance <= threshold + CIRCLE_EPSILON {
        state
            .errors
            .push(geometry_error(element, COLLAPSED_MESSAGE.to_owned()));
        return;
    }

    let cosine = ((r1 - second_radius_sign * r2) / distance).clamp(-1.0, 1.0);
    let sine_squared = 1.0 - cosine * cosine;
    let sine = if sine_squared < 0.0 && sine_squared > -CIRCLE_EPSILON {
        0.0
    } else {
        sine_squared.max(0.0).sqrt()
    };
    let ux = dx / distance;
    let uy = dy / distance;
    let vx = -uy;
    let vy = ux;
    let side_sign = if side == "right" { -1.0 } else { 1.0 };
    let nx = cosine * ux + side_sign * sine * vx;
    let ny = cosine * uy + side_sign * sine * vy;
    let start_x = c1x + r1 * nx;
    let start_y = c1y + r1 * ny;
    let end_x = c2x + second_radius_sign * r2 * nx;
    let end_y = c2y + second_radius_sign * r2 * ny;
    let length = (end_x - start_x).hypot(end_y - start_y);
    if length <= CIRCLE_EPSILON {
        state
            .errors
            .push(geometry_error(element, COLLAPSED_MESSAGE.to_owned()));
        return;
    }

    let start_point = Point {
        element_id: String::new(),
        name: String::new(),
        x: start_x,
        y: start_y,
    };
    let end_point = Point {
        element_id: String::new(),
        name: String::new(),
        x: end_x,
        y: end_y,
    };
    let start_angle = angle_from_to(&start_point, &end_point);
    let end_angle = angle_from_to(&end_point, &start_point);
    let id = element_id(element).unwrap_or_default();
    let name = element_name(element);
    insert_geometry(
        state,
        id.clone(),
        json!({
              "kind": "line",
              "elementId": id,
              "name": name,
              "startPointId": null,
              "endPointId": null,
              "start": {
        "kind": "point", "elementId": format!("{id}:start"), "name": format!("{name}.始点"),
        "x": start_x, "y": start_y
              },
              "end": {
        "kind": "point", "elementId": format!("{id}:end"), "name": format!("{name}.終点"),
        "x": end_x, "y": end_y
              },
              "length": length,
              "startAngleDeg": start_angle,
              "endAngleDeg": end_angle,
              "startTangentAngleDeg": start_angle,
              "endTangentAngleDeg": end_angle
          }),
    );
}
