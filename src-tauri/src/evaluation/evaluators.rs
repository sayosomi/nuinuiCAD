use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::numeric_expression::numeric_value;
use super::point_anchor::{
    anchor_reference_element_id, computed_point, get_computed_point_or_error,
    point_anchor_for_element, point_anchor_or_error, point_from_value,
};
use super::types::{
    element_id, element_name, element_type, find_element_name, insert_geometry, insert_variable,
    parent_group_id, DependencyError, ElementId, EvaluationState, NumericEvalError, Point,
};

pub(crate) fn dependency_error(
    state: &EvaluationState,
    element: &Value,
    missing_dependency_id: &str,
) -> DependencyError {
    let missing_dependency_name = find_element_name(state, missing_dependency_id);
    let dependency_label = missing_dependency_name
        .clone()
        .unwrap_or_else(|| missing_dependency_id.to_owned());
    let disabled_group_id = state
        .group_states
        .get(missing_dependency_id)
        .and_then(|state| state.disabled_by_group_id.clone());
    let disabled_group_name = disabled_group_id
        .as_deref()
        .and_then(|id| find_element_name(state, id));
    let element_name = element_name(element);

    DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: missing_dependency_id.to_owned(),
        missing_dependency_name,
        message: disabled_group_name.map_or_else(
            || {
                format!(
                    "{element_name} は {dependency_label} を参照していますが、{dependency_label} はこの要素より後にあるか、存在しません。{dependency_label} を {element_name} より前に移動してください。"
                )
            },
            |group_name| {
                format!(
                    "{element_name} は {dependency_label} を参照していますが、{dependency_label} はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、参照先を変更してください。"
                )
            },
        ),
    }
}

pub(crate) fn numeric_error(state: &mut EvaluationState, element: &Value, error: NumericEvalError) {
    let disabled_group_id = state
        .group_states
        .get(&error.dependency_id)
        .and_then(|state| state.disabled_by_group_id.clone());
    let disabled_group_name = disabled_group_id
        .as_deref()
        .and_then(|id| find_element_name(state, id));
    let element_name = element_name(element);

    state.errors.push(DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: error.dependency_id,
        missing_dependency_name: error.dependency_name,
        message: disabled_group_name.map_or_else(
            || format!("{element_name} の数値式を評価できません。{}", error.message),
            |group_name| {
                format!(
                    "{element_name} の数値式を評価できません。参照先はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、数値式を変更してください。"
                )
            },
        ),
    });
}

pub(crate) fn evaluate_numeric_or_push(
    value: &Value,
    state: &mut EvaluationState,
    element: &Value,
    local_variables: &HashMap<String, f64>,
    local_variable_names: &HashMap<String, String>,
) -> Option<f64> {
    match numeric_value(value, state, element, local_variables, local_variable_names) {
        Ok(value) => Some(value),
        Err(error) => {
            numeric_error(state, element, error);
            None
        }
    }
}

pub(crate) fn evaluate_local_variables(
    element_index: usize,
    state: &mut EvaluationState,
) -> Option<(HashMap<String, f64>, HashMap<String, String>)> {
    let element = state.elements[element_index].clone();
    let mut local_variable_values = HashMap::new();
    let mut local_variable_names = HashMap::new();

    for index in (0..element_index).rev() {
        let candidate = &state.elements[index];
        if element_type(candidate) != Some("variable")
            || !variable_is_in_scope(candidate, &element, state)
        {
            continue;
        }
        let Some(candidate_id) = element_id(candidate) else {
            continue;
        };
        let Some(computed) = state.computed_variables.get(&candidate_id) else {
            continue;
        };
        let Some(value) = computed.get("value").and_then(Value::as_f64) else {
            continue;
        };
        let candidate_name = element_name(candidate);
        local_variable_values
            .entry(candidate_id.clone())
            .or_insert(value);
        local_variable_values
            .entry(candidate_name.clone())
            .or_insert(value);
        local_variable_names
            .entry(candidate_id)
            .or_insert(candidate_name.clone());
        local_variable_names
            .entry(candidate_name.clone())
            .or_insert(candidate_name);
    }

    if let Some(variables) = element.get("numericVariables").and_then(Value::as_array) {
        for variable in variables {
            let Some(variable_id) = variable.get("id").and_then(Value::as_str) else {
                continue;
            };
            let variable_name = variable
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(variable_id)
                .to_owned();
            local_variable_names.insert(variable_id.to_owned(), variable_name.clone());
            local_variable_names.insert(variable_name.clone(), variable_name.clone());
            let value = evaluate_numeric_or_push(
                variable.get("value").unwrap_or(&Value::Null),
                state,
                &element,
                &local_variable_values,
                &local_variable_names,
            )?;
            local_variable_values.insert(variable_id.to_owned(), value);
            local_variable_values.insert(variable_name, value);
        }
    }

    Some((local_variable_values, local_variable_names))
}

fn ancestor_group_ids(element: &Value, state: &EvaluationState) -> Vec<ElementId> {
    let mut ids = Vec::new();
    let mut visited = HashSet::new();
    let mut parent_id = parent_group_id(element);

    while let Some(id) = parent_id {
        if !visited.insert(id.clone()) {
            break;
        }
        ids.push(id.clone());
        parent_id = state
            .elements_by_id
            .get(&id)
            .and_then(|index| state.elements.get(*index))
            .and_then(parent_group_id);
    }

    ids
}

fn variable_is_in_scope(variable: &Value, consumer: &Value, state: &EvaluationState) -> bool {
    if variable.get("scope").and_then(Value::as_str) == Some("global") {
        return true;
    }
    match parent_group_id(variable) {
        None => parent_group_id(consumer).is_none(),
        Some(parent_id) => {
            parent_group_id(consumer).as_deref() == Some(parent_id.as_str())
                || ancestor_group_ids(consumer, state).contains(&parent_id)
        }
    }
}

pub(crate) fn evaluate_variable_element(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let value_mode = element
        .get("valueMode")
        .and_then(Value::as_str)
        .unwrap_or("expression");
    let value = match value_mode {
        "expression" => evaluate_numeric_or_push(
            element.get("expression").unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ),
        "pointDistance" => {
            let Some(point1) = point_anchor_or_error(
                element,
                element.get("point1").unwrap_or(&Value::Null),
                "point1",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let Some(point2) = point_anchor_or_error(
                element,
                element.get("point2").unwrap_or(&Value::Null),
                "point2",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            Some((point2.x - point1.x).hypot(point2.y - point1.y))
        }
        "pointAngle" => {
            let Some(point1) = point_anchor_or_error(
                element,
                element.get("point1").unwrap_or(&Value::Null),
                "point1",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let Some(point2) = point_anchor_or_error(
                element,
                element.get("point2").unwrap_or(&Value::Null),
                "point2",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            Some(normalize_degrees(
                (point1.y - point2.y)
                    .atan2(point2.x - point1.x)
                    .to_degrees(),
            ))
        }
        "pointLineDistance" => {
            let Some(point) = point_anchor_or_error(
                element,
                element.get("point").unwrap_or(&Value::Null),
                "point",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let line_id = element
                .get("lineId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(line) = state.computed_geometry.get(line_id).cloned() else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let Some(start) = line.get("start").and_then(point_from_value) else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let Some(end) = line.get("end").and_then(point_from_value) else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let dx = end.x - start.x;
            let dy = end.y - start.y;
            let length = dx.hypot(dy);
            if length <= 1e-9 {
                state.errors.push(DependencyError {
                    element_id: element_id(element).unwrap_or_default(),
                    element_name: element_name(element),
                    missing_dependency_id: element_id(element).unwrap_or_default(),
                    missing_dependency_name: Some(element_name(element)),
                    message: format!(
                        "{} は長さ0のため点線距離を計算できません。",
                        element_name(element)
                    ),
                });
                return;
            }
            Some((dx * (start.y - point.y) - (start.x - point.x) * dy).abs() / length)
        }
        _ => None,
    };

    let Some(value) = value else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_variable(
        state,
        id.clone(),
        json!({
            "kind": "variable",
            "elementId": id,
            "name": element_name(element),
            "value": value
        }),
    );
}

pub(crate) fn evaluate_free_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(x) = evaluate_numeric_or_push(
        element.get("x").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(y) = evaluate_numeric_or_push(
        element.get("y").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), x, y),
    );
}

pub(crate) fn evaluate_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchor) = point_anchor_for_element(element) else {
        return;
    };
    let from_point = if anchor.get("mode").and_then(Value::as_str) == Some("reference") {
        get_computed_point_or_error(
            element,
            anchor
                .get("pointId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            state,
        )
    } else {
        point_anchor_or_error(
            element,
            &anchor,
            "from",
            state,
            &local_variables.0,
            &local_variables.1,
        )
    };
    let Some(from_point) = from_point else {
        return;
    };
    let Some(dx) = evaluate_numeric_or_push(
        element.get("dx").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(dy) = evaluate_numeric_or_push(
        element.get("dy").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            from_point.x + dx,
            from_point.y + dy,
        ),
    );
}

pub(crate) fn evaluate_polar_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchor) = point_anchor_for_element(element) else {
        return;
    };
    let from_point = if anchor.get("mode").and_then(Value::as_str) == Some("reference") {
        get_computed_point_or_error(
            element,
            anchor
                .get("pointId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            state,
        )
    } else {
        point_anchor_or_error(
            element,
            &anchor,
            "from",
            state,
            &local_variables.0,
            &local_variables.1,
        )
    };
    let Some(from_point) = from_point else {
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
    let Some(distance) = evaluate_numeric_or_push(
        element.get("distance").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let angle_rad = angle_deg.to_radians();
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            from_point.x + angle_rad.cos() * distance,
            from_point.y - angle_rad.sin() * distance,
        ),
    );
}

pub(crate) fn evaluate_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start_anchor) = element.get("startPoint") else {
        return;
    };
    let Some(end_anchor) = element.get("endPoint") else {
        return;
    };
    let Some(start) = point_anchor_or_error(
        element,
        start_anchor,
        "start",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end) = point_anchor_or_error(
        element,
        end_anchor,
        "end",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    let start_angle = angle_from_to(&start, &end);
    let end_angle = angle_from_to(&end, &start);
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "line",
            "elementId": id,
            "name": element_name(element),
            "startPointId": anchor_reference_element_id(start_anchor),
            "endPointId": anchor_reference_element_id(end_anchor),
            "start": computed_point(start.element_id, start.name, start.x, start.y),
            "end": computed_point(end.element_id, end.name, end.x, end.y),
            "length": length,
            "startAngleDeg": start_angle,
            "endAngleDeg": end_angle,
            "startTangentAngleDeg": start_angle,
            "endTangentAngleDeg": end_angle
        }),
    );
}

pub(crate) fn evaluate_arc_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(center_anchor) = element.get("centerPoint") else {
        return;
    };
    let Some(center) = point_anchor_or_error(
        element,
        center_anchor,
        "center",
        state,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(radius) = evaluate_numeric_or_push(
        element.get("radius").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(start_angle_deg) = evaluate_numeric_or_push(
        element.get("startAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_angle_deg) = evaluate_numeric_or_push(
        element.get("endAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let safe_radius = if radius > 0.0 { radius } else { 0.0 };
    let sweep_angle_deg = normalize_degrees(end_angle_deg - start_angle_deg);
    let start_angle_rad = start_angle_deg.to_radians();
    let end_angle_rad = end_angle_deg.to_radians();
    let tangent_offset = if sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "arcLine",
            "elementId": id,
            "name": element_name(element),
            "centerPointId": anchor_reference_element_id(center_anchor),
            "center": computed_point(center.element_id, center.name, center.x, center.y),
            "start": computed_point(format!("{}:start", element_id(element).unwrap_or_default()), format!("{}.始点", element_name(element)), center.x + start_angle_rad.cos() * safe_radius, center.y - start_angle_rad.sin() * safe_radius),
            "end": computed_point(format!("{}:end", element_id(element).unwrap_or_default()), format!("{}.終点", element_name(element)), center.x + end_angle_rad.cos() * safe_radius, center.y - end_angle_rad.sin() * safe_radius),
            "radius": radius,
            "startAngleDeg": start_angle_deg,
            "endAngleDeg": end_angle_deg,
            "startTangentAngleDeg": normalize_degrees(start_angle_deg + tangent_offset),
            "endTangentAngleDeg": normalize_degrees(end_angle_deg + tangent_offset + 180.0),
            "sweepAngleDeg": sweep_angle_deg,
            "length": safe_radius * sweep_angle_deg.to_radians()
        }),
    );
}

fn angle_from_to(start: &Point, end: &Point) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    (length > 1e-9).then(|| normalize_degrees(dy.atan2(dx).to_degrees()))
}

fn normalize_degrees(degrees: f64) -> f64 {
    degrees.rem_euclid(360.0)
}
