use std::time::Instant;

use serde_json::{json, Value};

use super::{evaluate_document_input, EvaluationInput, EvaluationPayload};

fn point(id: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "name": id,
        "type": "freePoint",
        "activity": "visible",
        "x": x,
        "y": y
    })
}

fn line(id: &str, start_point_id: &str, end_point_id: &str) -> Value {
    json!({
        "id": id,
        "name": id,
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": start_point_id },
        "endPoint": { "mode": "reference", "pointId": end_point_id }
    })
}

fn run_performance_case(name: &str, elements: Vec<Value>) -> EvaluationPayload {
    let started = Instant::now();
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    eprintln!(
        "{name}: {} geometry, {} errors, {:?}",
        result.computed_geometry.len(),
        result.errors.len(),
        started.elapsed()
    );
    result
}

#[test]
#[ignore]
fn performance_1000_line_elements() {
    let mut elements = Vec::new();
    for index in 0..501 {
        elements.push(point(
            &format!("p{index}"),
            (index as f64) * 5.0,
            ((index % 7) as f64) * 3.0,
        ));
    }
    for index in 0..500 {
        elements.push(line(
            &format!("line{index}"),
            &format!("p{index}"),
            &format!("p{}", index + 1),
        ));
    }

    let result = run_performance_case("performance_1000_line_elements", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 1001);
}

#[test]
#[ignore]
fn performance_many_beziers() {
    let mut elements = vec![point("origin", 0.0, 0.0)];
    for index in 0..150 {
        let start_id = format!("start{index}");
        let mid_id = format!("mid{index}");
        let end_id = format!("end{index}");
        elements.push(point(&start_id, 0.0, index as f64));
        elements.push(point(&mid_id, 50.0, (index as f64) + 30.0));
        elements.push(point(&end_id, 100.0, index as f64));
        elements.push(json!({
            "id": format!("curve{index}"),
            "name": format!("curve{index}"),
            "type": "bezierCurve",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": start_id },
            "startHandleAngleDeg": 0,
            "startHandleLength": 20,
            "intermediatePoints": [
                {
                    "id": format!("intermediate{index}"),
                    "point": { "mode": "reference", "pointId": mid_id },
                    "handleAngleDeg": 180,
                    "incomingHandleLength": 18,
                    "outgoingHandleLength": 18
                }
            ],
            "endPoint": { "mode": "reference", "pointId": end_id },
            "endHandleAngleDeg": 180,
            "endHandleLength": 20
        }));
    }

    let result = run_performance_case("performance_many_beziers", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 601);
}

#[test]
#[ignore]
fn performance_many_offset_lines() {
    let mut elements = Vec::new();
    for index in 0..201 {
        elements.push(point(
            &format!("p{index}"),
            (index as f64) * 4.0,
            ((index % 5) as f64) * 6.0,
        ));
    }
    for index in 0..200 {
        elements.push(line(
            &format!("base{index}"),
            &format!("p{index}"),
            &format!("p{}", index + 1),
        ));
        elements.push(json!({
            "id": format!("offset{index}"),
            "name": format!("offset{index}"),
            "type": "offsetLine",
            "activity": "visible",
            "baseLineIds": [format!("base{index}")],
            "offset": 10,
            "side": "right",
            "closed": false
        }));
    }

    let result = run_performance_case("performance_many_offset_lines", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 601);
}

#[test]
#[ignore]
fn performance_deep_groups() {
    let mut elements = Vec::new();
    for index in 0..100 {
        let parent = if index == 0 {
            None
        } else {
            Some(format!("group{}", index - 1))
        };
        let mut group = json!({
            "id": format!("group{index}"),
            "name": format!("group{index}"),
            "type": "group",
            "activity": "visible",
            "expanded": true
        });
        if let Some(parent_group_id) = parent {
            group["parentGroupId"] = json!(parent_group_id);
        }
        elements.push(group);
    }
    for index in 0..300 {
        let mut nested_point = point(&format!("p{index}"), index as f64, index as f64);
        nested_point["parentGroupId"] = json!("group99");
        elements.push(nested_point);
    }

    let result = run_performance_case("performance_deep_groups", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 300);
    assert_eq!(result.effective_enabled_element_ids.len(), 400);
}

#[test]
#[ignore]
fn performance_many_dependency_errors() {
    let mut elements = Vec::new();
    for index in 0..400 {
        elements.push(json!({
            "id": format!("line{index}"),
            "name": format!("line{index}"),
            "type": "line",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": format!("missing-start{index}") },
            "endPoint": { "mode": "reference", "pointId": format!("missing-end{index}") }
        }));
    }

    let result = run_performance_case("performance_many_dependency_errors", elements);
    assert_eq!(result.computed_geometry.len(), 0);
    assert_eq!(result.errors.len(), 400);
}
