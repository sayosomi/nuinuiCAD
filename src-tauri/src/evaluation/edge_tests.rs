use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

#[test]
fn edge_extends_and_trims_two_line_endpoints() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 150.0, 80.0),
            free_point("d", "D", 150.0, 160.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "edge"));
    assert_close(geometry(&result, "ab")["end"]["x"].as_f64().unwrap(), 150.0);
    assert_close(geometry(&result, "ab")["end"]["y"].as_f64().unwrap(), 0.0);
    assert_close(
        geometry(&result, "cd")["start"]["x"].as_f64().unwrap(),
        150.0,
    );
    assert_close(geometry(&result, "cd")["start"]["y"].as_f64().unwrap(), 0.0);
}

#[test]
fn edge_trims_a_bezier_and_a_line() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            free_point("c", "C", 50.0, -50.0),
            free_point("d", "D", 50.0, 50.0),
            arch_curve("curve", "曲線", "start", "end"),
            line("vline", "縦線", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "curve", "endpointKey": "end" },
                "endpoint2": { "lineId": "vline", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });

    assert!(result.errors.is_empty());
    // The arch apex is at (50, 30); both trim there.
    let curve = geometry(&result, "curve");
    let moved_end = &curve["segments"].as_array().unwrap().last().unwrap()["end"];
    assert_close(moved_end["x"].as_f64().unwrap(), 50.0);
    assert_close(moved_end["y"].as_f64().unwrap(), 30.0);
    assert_close(
        geometry(&result, "vline")["start"]["x"].as_f64().unwrap(),
        50.0,
    );
    assert_close(
        geometry(&result, "vline")["start"]["y"].as_f64().unwrap(),
        30.0,
    );
}

#[test]
fn edge_trims_two_bezier_curves() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            free_point("vstart", "縦始点", 50.0, -40.0),
            free_point("vend", "縦終点", 50.0, 80.0),
            arch_curve("curve", "曲線", "start", "end"),
            element(json!({
                "id": "vcurve",
                "name": "縦曲線",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "vstart" },
                "startHandleAngleDeg": 90,
                "startHandleLength": 40,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "vend" },
                "endHandleAngleDeg": 270,
                "endHandleLength": 40
            })),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "curve", "endpointKey": "end" },
                "endpoint2": { "lineId": "vcurve", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });

    assert!(result.errors.is_empty());
    // Both curves pass through (50, 30); the 2D-Newton corner lands there.
    let curve = geometry(&result, "curve");
    let vcurve = geometry(&result, "vcurve");
    let curve_end = &curve["segments"].as_array().unwrap().last().unwrap()["end"];
    let vcurve_start = &vcurve["segments"][0]["start"];
    assert_close_within(curve_end["x"].as_f64().unwrap(), 50.0, 1e-5);
    assert_close_within(curve_end["y"].as_f64().unwrap(), 30.0, 1e-5);
    assert_close_within(vcurve_start["x"].as_f64().unwrap(), 50.0, 1e-5);
    assert_close_within(vcurve_start["y"].as_f64().unwrap(), 30.0, 1e-5);
}

#[test]
fn edge_extends_a_bezier_along_its_handle_angle() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 50.0, 0.0),
            free_point("c", "C", 80.0, -20.0),
            free_point("d", "D", 80.0, 20.0),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "start" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 15,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "end" },
                "endHandleAngleDeg": 0,
                "endHandleLength": 15
            })),
            line("vline", "縦線", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "curve", "endpointKey": "end" },
                "endpoint2": { "lineId": "vline", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });

    assert!(result.errors.is_empty());
    // The straight end tangent (angle 0) extends to meet the vertical line at x = 80.
    let curve = geometry(&result, "curve");
    let moved_end = &curve["segments"].as_array().unwrap().last().unwrap()["end"];
    assert_close(moved_end["x"].as_f64().unwrap(), 80.0);
    assert_close(moved_end["y"].as_f64().unwrap(), 0.0);
    assert_close(
        geometry(&result, "vline")["start"]["x"].as_f64().unwrap(),
        80.0,
    );
}

#[test]
fn edge_reports_geometry_errors() {
    let same_line = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("ab", "AB", "a", "b"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "ab", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });
    assert!(same_line.errors[0].message.contains("同じ線"));

    let parallel = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 0.0, 20.0),
            free_point("d", "D", 100.0, 20.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });
    assert!(parallel.errors[0].message.contains("交点"));

    let invalid_index = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 50.0, -20.0),
            free_point("d", "D", 50.0, 20.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0.5
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
    });
    assert!(invalid_index.errors[0].message.contains("0以上の整数"));
}
