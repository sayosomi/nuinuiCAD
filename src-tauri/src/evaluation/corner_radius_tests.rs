use super::edge_extend_test_support::*;
use super::*;
use serde_json::{json, Value};

fn corner(endpoint1_line_id: &str, endpoint2_line_id: &str, radius: Value) -> Value {
    element(json!({
        "id": "corner",
        "name": "角R",
        "type": "cornerRadiusArcLine",
        "visible": true,
        "enabled": true,
        "endpoint1": { "lineId": endpoint1_line_id, "endpointKey": "end" },
        "endpoint2": { "lineId": endpoint2_line_id, "endpointKey": "start" },
        "radius": radius,
        "intersectionIndex": { "kind": "expression", "expression": "@index" },
        "numericVariables": [{ "id": "index", "name": "番号", "value": 0 }]
    }))
}

fn corner_with_variables(endpoint1_line_id: &str, endpoint2_line_id: &str) -> Value {
    element(json!({
        "id": "corner",
        "name": "角R",
        "type": "cornerRadiusArcLine",
        "visible": true,
        "enabled": true,
        "endpoint1": { "lineId": endpoint1_line_id, "endpointKey": "end" },
        "endpoint2": { "lineId": endpoint2_line_id, "endpointKey": "start" },
        "radius": { "kind": "expression", "expression": "@radius" },
        "intersectionIndex": { "kind": "expression", "expression": "@index" },
        "numericVariables": [
            { "id": "radius", "name": "半径", "value": 10 },
            { "id": "index", "name": "番号", "value": 0 }
        ]
    }))
}

fn bezier_curve(id: &str, start_id: &str, end_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": "曲線",
        "type": "bezierCurve",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": start_id },
        "startHandleAngleDeg": 0,
        "startHandleLength": 30,
        "intermediatePoints": [],
        "endPoint": { "mode": "reference", "pointId": end_id },
        "endHandleAngleDeg": 180,
        "endHandleLength": 30
    }))
}

#[test]
fn corner_radius_trims_two_lines_and_creates_arc() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 100.0, 100.0),
            line("ab", "AB", "a", "b"),
            line("bc", "BC", "b", "c"),
            corner_with_variables("ab", "bc"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let arc = geometry(&result, "corner");
    assert_eq!(arc["kind"], json!("arcLine"));
    assert_close(arc["radius"].as_f64().unwrap(), 10.0);
    assert_close(arc["start"]["x"].as_f64().unwrap(), 90.0);
    assert_close(arc["start"]["y"].as_f64().unwrap(), 0.0);
    assert_close(arc["end"]["x"].as_f64().unwrap(), 100.0);
    assert_close(arc["end"]["y"].as_f64().unwrap(), 10.0);
    assert_close(geometry(&result, "ab")["end"]["x"].as_f64().unwrap(), 90.0);
    assert_close(
        geometry(&result, "bc")["start"]["y"].as_f64().unwrap(),
        10.0,
    );
}

#[test]
fn corner_radius_trims_bezier_and_offset_line_to_polylines() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("d", "D", 50.0, -50.0),
            free_point("e", "E", 50.0, 50.0),
            bezier_curve("curve", "a", "b"),
            line("de", "DE", "d", "e"),
            corner("curve", "de", json!(10)),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    assert_eq!(geometry(&result, "curve")["kind"], json!("offsetLine"));
    assert_eq!(geometry(&result, "corner")["kind"], json!("arcLine"));

    let offset_result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 100.0, -10.0),
            free_point("d", "D", 100.0, -100.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "visible": true,
                "enabled": true,
                "baseLineIds": ["ab"],
                "offset": 10,
                "side": "right",
                "closed": false
            })),
            corner("offset", "cd", json!(5)),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(
        offset_result.errors.is_empty(),
        "{:?}",
        offset_result.errors
    );
    assert_eq!(
        geometry(&offset_result, "offset")["kind"],
        json!("offsetLine")
    );
    assert_eq!(geometry(&offset_result, "corner")["kind"], json!("arcLine"));
}

#[test]
fn corner_radius_can_feed_downstream_line_elements() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 100.0, 100.0),
            line("ab", "AB", "a", "b"),
            line("bc", "BC", "b", "c"),
            corner("ab", "bc", json!(10)),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "corner", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_eq!(geometry(&result, "mid")["kind"], json!("point"));
}

#[test]
fn corner_radius_reports_geometry_and_dependency_errors() {
    let same_line = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("ab", "AB", "a", "b"),
            corner("ab", "ab", json!(10)),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(same_line.errors[0].message.contains("同じ線"));

    let radius_error = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 100.0, 100.0),
            line("ab", "AB", "a", "b"),
            line("bc", "BC", "b", "c"),
            corner("ab", "bc", json!(0)),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(radius_error.errors[0].message.contains("半径"));

    let missing = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![corner("missing", "late", json!(10))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert_eq!(missing.errors[0].missing_dependency_id, "missing");
}
