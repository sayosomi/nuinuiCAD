use serde_json::{json, Value};

use super::errors::{dependency_error, geometry_error};
use super::geometry_value_kernels::{common_tangent_geometry_kernel, StructuralPoint};
use super::line_geometry_input::resolve_line_geometry_input;
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

fn arc_geometry(
    state: &mut EvaluationState,
    element: &Value,
    key: &str,
    label: &str,
) -> Option<Value> {
    let reference_id = element.get(key).and_then(Value::as_str).unwrap_or_default();
    let owner_id = element_id(element).unwrap_or_default();
    let Some(geometry) = resolve_line_geometry_input(state, &owner_id, key, reference_id) else {
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
    let c1x = first["center"]["x"].as_f64().unwrap_or(f64::NAN);
    let c1y = first["center"]["y"].as_f64().unwrap_or(f64::NAN);
    let c2x = second["center"]["x"].as_f64().unwrap_or(f64::NAN);
    let c2y = second["center"]["y"].as_f64().unwrap_or(f64::NAN);
    let kind = element
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("external");
    let side = element
        .get("side")
        .and_then(Value::as_str)
        .unwrap_or("left");
    let structural = match common_tangent_geometry_kernel(
        StructuralPoint { x: c1x, y: c1y },
        r1,
        StructuralPoint { x: c2x, y: c2y },
        r2,
        kind,
        side,
    ) {
        Ok(value) => value,
        Err(messages) => {
            for message in messages {
                state.errors.push(geometry_error(element, message));
            }
            return;
        }
    };
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
        "x": structural.start.x, "y": structural.start.y
              },
              "end": {
        "kind": "point", "elementId": format!("{id}:end"), "name": format!("{name}.終点"),
        "x": structural.end.x, "y": structural.end.y
              },
              "length": structural.length,
              "startAngleDeg": structural.start_angle_deg,
              "endAngleDeg": structural.end_angle_deg,
              "startTangentAngleDeg": structural.start_tangent_angle_deg,
              "endTangentAngleDeg": structural.end_tangent_angle_deg
          }),
    );
}
