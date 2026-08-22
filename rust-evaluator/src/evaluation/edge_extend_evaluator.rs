use serde_json::Value;
use std::collections::HashMap;

use super::endpoint_move::{is_supported_line_geometry, move_endpoint, EndpointMoveResult};
use super::errors::{dependency_error, geometry_error};
use super::line_intersections::find_line_intersections;
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::{anchor_reference_element_id, point_anchor_or_error};
use super::types::{
    element_display_name, element_id, insert_geometry, ElementId, EvaluationState,
    Point as ComputedPoint,
};

struct EndpointRef {
    line_id: ElementId,
    endpoint_key: String,
}

struct EndpointMove {
    endpoint: EndpointRef,
    target: ComputedPoint,
    target_point_id: Value,
}

fn endpoint_ref(value: &Value) -> Option<EndpointRef> {
    Some(EndpointRef {
        line_id: value.get("lineId")?.as_str()?.to_owned(),
        endpoint_key: value.get("endpointKey")?.as_str()?.to_owned(),
    })
}

fn line_geometry_or_error(
    element: &Value,
    endpoint: &EndpointRef,
    state: &mut EvaluationState,
) -> Option<Value> {
    let Some(geometry) = state.computed_geometry.get(&endpoint.line_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, &endpoint.line_id));
        return None;
    };
    if !is_supported_line_geometry(&geometry) {
        state
            .errors
            .push(dependency_error(state, element, &endpoint.line_id));
        return None;
    }
    Some(geometry)
}

fn apply_endpoint_moves(
    element: &Value,
    moves: Vec<EndpointMove>,
    state: &mut EvaluationState,
) -> bool {
    let mut next_geometry: HashMap<ElementId, Value> = HashMap::new();
    for current_move in moves {
        let current = if let Some(geometry) = next_geometry.get(&current_move.endpoint.line_id) {
            geometry.clone()
        } else {
            let Some(geometry) = line_geometry_or_error(element, &current_move.endpoint, state)
            else {
                return false;
            };
            geometry
        };
        match move_endpoint(
            &current,
            &current_move.endpoint.endpoint_key,
            &current_move.target,
            current_move.target_point_id,
        ) {
            EndpointMoveResult::Geometry(geometry) => {
                next_geometry.insert(current_move.endpoint.line_id, geometry);
            }
            EndpointMoveResult::Error(error) => {
                state.errors.push(geometry_error(
                    element,
                    format!("{}: {error}", element_display_name(element)),
                ));
                return false;
            }
        }
    }
    for (element_id, geometry) in next_geometry {
        insert_geometry(state, element_id, geometry);
    }
    true
}

fn target_point(element: &Value, point: (f64, f64), name: String) -> ComputedPoint {
    ComputedPoint {
        element_id: format!("{}:target", element_id(element).unwrap_or_default()),
        name,
        x: point.0,
        y: point.1,
    }
}

pub(crate) fn evaluate_edge(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(endpoint1) = element.get("endpoint1").and_then(endpoint_ref) else {
        return;
    };
    let Some(endpoint2) = element.get("endpoint2").and_then(endpoint_ref) else {
        return;
    };
    let name = element_display_name(element);
    if endpoint1.line_id == endpoint2.line_id {
        state.errors.push(geometry_error(
            element,
            format!(
                "{name} は同じ線を2回参照しているため、エッジを作れません。端点1と端点2に別の線を指定してください。"
            ),
        ));
        return;
    }

    let Some(line1) = line_geometry_or_error(element, &endpoint1, state) else {
        return;
    };
    let Some(line2) = line_geometry_or_error(element, &endpoint2, state) else {
        return;
    };
    let Some(intersection_index) = evaluate_numeric_or_push(
        element.get("intersectionIndex").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if !intersection_index.is_finite()
        || intersection_index < 0.0
        || intersection_index.fract() != 0.0
    {
        state.errors.push(geometry_error(
            element,
            format!("{name} の番号は0以上の整数で指定してください。"),
        ));
        return;
    }

    let Some(intersection_result) = find_line_intersections(&line1, &line2, true) else {
        state
            .errors
            .push(dependency_error(state, element, &endpoint1.line_id));
        return;
    };
    if let Some(error) = intersection_result.error {
        state.errors.push(geometry_error(element, error));
        return;
    }
    let intersection_index = intersection_index as usize;
    let Some(intersection) = intersection_result.intersections.get(intersection_index) else {
        let message = if intersection_result.intersections.is_empty() {
            format!("{name} は参照線同士の交点を見つけられません。平行線など、延長しても交差しない線はエッジにできません。")
        } else {
            format!(
                "{name} の番号 {intersection_index} に対応する交点はありません。交点数は {} 個です。",
                intersection_result.intersections.len()
            )
        };
        state.errors.push(geometry_error(element, message));
        return;
    };
    let corner = target_point(
        element,
        (intersection.x, intersection.y),
        format!("{name}.交点"),
    );
    apply_endpoint_moves(
        element,
        vec![
            EndpointMove {
                endpoint: endpoint1,
                target: corner.clone(),
                target_point_id: Value::Null,
            },
            EndpointMove {
                endpoint: endpoint2,
                target: corner,
                target_point_id: Value::Null,
            },
        ],
        state,
    );
}

pub(crate) fn evaluate_extend_trim(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(endpoint) = element.get("endpoint").and_then(endpoint_ref) else {
        return;
    };
    let Some(point_anchor) = element.get("point") else {
        return;
    };
    let Some(point) = point_anchor_or_error(
        element,
        point_anchor,
        "point",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let target_point_id = anchor_reference_element_id(point_anchor)
        .map(Value::from)
        .unwrap_or(Value::Null);
    apply_endpoint_moves(
        element,
        vec![EndpointMove {
            endpoint,
            target: point,
            target_point_id,
        }],
        state,
    );
}
