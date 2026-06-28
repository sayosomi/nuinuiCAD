use serde_json::{json, Value};
use std::collections::HashMap;

use super::errors::dependency_error;
use super::numeric_expression::evaluate_numeric_or_push;
use super::types::{
    element_id, element_name, element_type, find_element_name, ElementId, EvaluationState, Point,
};

pub(crate) fn computed_point(
    id: impl Into<String>,
    name: impl Into<String>,
    x: f64,
    y: f64,
) -> Value {
    json!({
        "kind": "point",
        "elementId": id.into(),
        "name": name.into(),
        "x": x,
        "y": y
    })
}

pub(crate) fn point_from_geometry(value: &Value) -> Option<Point> {
    if value.get("kind")?.as_str()? != "point" {
        return None;
    }
    Some(Point {
        element_id: value.get("elementId")?.as_str()?.to_owned(),
        name: value.get("name")?.as_str()?.to_owned(),
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

pub(crate) fn point_from_value(value: &Value) -> Option<Point> {
    Some(Point {
        element_id: value.get("elementId")?.as_str()?.to_owned(),
        name: value.get("name")?.as_str()?.to_owned(),
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

pub(crate) fn point_anchor_for_element(element: &Value) -> Option<Value> {
    if element_type(element) != Some("offsetPoint")
        && element_type(element) != Some("polarOffsetPoint")
    {
        return None;
    }
    element.get("fromPoint").cloned().or_else(|| {
        element
            .get("fromPointId")
            .and_then(Value::as_str)
            .map(|point_id| {
                json!({
                    "mode": "reference",
                    "pointId": point_id
                })
            })
    })
}

pub(crate) fn anchor_reference_element_id(anchor: &Value) -> Option<ElementId> {
    match anchor.get("mode")?.as_str()? {
        "reference" => anchor.get("pointId")?.as_str().map(ToOwned::to_owned),
        "derived" => anchor.get("elementId")?.as_str().map(ToOwned::to_owned),
        _ => None,
    }
}

pub(crate) fn resolve_derived_point(
    source: &Value,
    point_key: &str,
    state: &EvaluationState,
) -> Option<Point> {
    match source.get("kind")?.as_str()? {
        "line" => {
            if point_key == "start" {
                source.get("start").and_then(point_from_value)
            } else if point_key == "end" {
                source.get("end").and_then(point_from_value)
            } else {
                None
            }
        }
        "arcLine" => {
            if point_key == "center" {
                source.get("center").and_then(point_from_value)
            } else if point_key == "start" {
                source.get("start").and_then(point_from_value)
            } else if point_key == "end" {
                source.get("end").and_then(point_from_value)
            } else {
                None
            }
        }
        "bezierCurve" => {
            if point_key == "start" {
                source
                    .get("segments")?
                    .as_array()?
                    .first()?
                    .get("start")
                    .and_then(point_from_value)
            } else if point_key == "end" {
                source
                    .get("segments")?
                    .as_array()?
                    .last()?
                    .get("end")
                    .and_then(point_from_value)
            } else {
                let intermediate_id = point_key.strip_prefix("intermediate:")?;
                let element_id = source.get("elementId")?.as_str()?;
                let element = state
                    .elements_by_id
                    .get(element_id)
                    .and_then(|index| state.elements.get(*index))?;
                if element_type(element) != Some("bezierCurve") {
                    return None;
                }
                let index = element
                    .get("intermediatePoints")?
                    .as_array()?
                    .iter()
                    .position(|point| {
                        point.get("id").and_then(Value::as_str) == Some(intermediate_id)
                    })?;
                source
                    .get("segments")?
                    .as_array()?
                    .get(index)?
                    .get("end")
                    .and_then(point_from_value)
            }
        }
        _ => None,
    }
}

pub(crate) fn point_anchor_or_error(
    element: &Value,
    anchor: &Value,
    anchor_key: &str,
    state: &mut EvaluationState,
    local_variables: &HashMap<String, f64>,
    local_variable_names: &HashMap<String, String>,
) -> Option<Point> {
    match anchor.get("mode").and_then(Value::as_str) {
        Some("reference") => {
            let point_id = anchor.get("pointId")?.as_str()?;
            let point = state
                .computed_geometry
                .get(point_id)
                .and_then(point_from_geometry);
            if point.is_none() {
                state
                    .errors
                    .push(dependency_error(state, element, point_id));
            }
            point
        }
        Some("derived") => {
            let source_id = anchor.get("elementId")?.as_str()?;
            let point_key = anchor.get("pointKey")?.as_str()?;
            let point = state
                .computed_geometry
                .get(source_id)
                .and_then(|source| resolve_derived_point(source, point_key, state));
            if point.is_none() {
                state
                    .errors
                    .push(dependency_error(state, element, source_id));
            }
            point.map(|point| Point {
                element_id: format!("{source_id}:{point_key}"),
                name: format!(
                    "{}.{}",
                    find_element_name(state, source_id).unwrap_or_else(|| source_id.to_owned()),
                    point_key
                ),
                ..point
            })
        }
        Some("coordinate") => {
            let x = evaluate_numeric_or_push(
                anchor.get("x").unwrap_or(&Value::Null),
                state,
                element,
                local_variables,
                local_variable_names,
            )?;
            let y = evaluate_numeric_or_push(
                anchor.get("y").unwrap_or(&Value::Null),
                state,
                element,
                local_variables,
                local_variable_names,
            )?;
            Some(Point {
                element_id: format!("{}:{anchor_key}", element_id(element).unwrap_or_default()),
                name: format!("{}.{anchor_key}", element_name(element)),
                x,
                y,
            })
        }
        _ => None,
    }
}

pub(crate) fn get_computed_point_or_error(
    element: &Value,
    point_id: &str,
    state: &mut EvaluationState,
) -> Option<Point> {
    let point = state
        .computed_geometry
        .get(point_id)
        .and_then(point_from_geometry);
    if point.is_none() {
        state
            .errors
            .push(dependency_error(state, element, point_id));
    }
    point
}
