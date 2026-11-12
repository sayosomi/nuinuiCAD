use super::edge_extend_test_support::*;
use super::endpoint_move::{move_endpoint, EndpointMoveResult};
use super::line_intersections::find_line_intersections;
use super::types::Point as ComputedPoint;
use super::*;
use serde_json::json;

fn endpoint_move_path(kind: &str) -> serde_json::Value {
    let mut geometry = json!({
        "kind": kind,
        "elementId": "owner",
        "name": "Path",
        "start": { "x": 0.0, "y": 0.0 },
        "end": { "x": 10.0, "y": 0.0 },
        "segments": [{
            "kind": "bezier",
            "start": { "x": 0.0, "y": 0.0 },
            "control1": { "x": 3.0, "y": 0.0 },
            "control2": { "x": 7.0, "y": 0.0 },
            "end": { "x": 10.0, "y": 0.0 },
            "length": 10.0
        }],
        "closed": false,
        "length": 10.0
    });
    if kind == "joinedPath" {
        geometry["pathIds"] = json!([]);
    } else {
        geometry["baseLineIds"] = json!(["base-a"]);
    }
    geometry
}

fn move_path_endpoint(
    geometry: &serde_json::Value,
    endpoint_key: &str,
    x: f64,
    y: f64,
) -> serde_json::Value {
    let target = ComputedPoint {
        element_id: "target".to_owned(),
        name: "Target".to_owned(),
        x,
        y,
    };
    match move_endpoint(geometry, endpoint_key, &target, serde_json::Value::Null) {
        EndpointMoveResult::Geometry(result) => result,
        EndpointMoveResult::Error(message) => panic!("endpoint move failed: {message}"),
    }
}

#[test]
fn issue1591_joined_path_endpoint_extension_preserves_empty_path_ids_and_stations() {
    let mut joined_path = endpoint_move_path("joinedPath");
    let stations = json!({
        "left": { "segmentIndex": 0, "t": 0.0 },
        "right": { "segmentIndex": 0, "t": 0.6 }
    });
    joined_path["extractionStations"] = stations.clone();
    joined_path["baseLineIds"] = json!(["invalid-for-joined-path"]);

    let moved = move_path_endpoint(&joined_path, "start", -5.0, 0.0);

    assert_eq!(moved["kind"], "joinedPath");
    assert_eq!(moved["pathIds"], json!([]));
    assert_eq!(moved["extractionStations"], stations);
    assert!(moved.get("baseLineIds").is_none());
    assert_eq!(moved["closed"], json!(false));
    assert_eq!(moved["start"]["x"], json!(-5.0));
    assert_eq!(moved["end"]["x"], json!(10.0));
    assert_eq!(moved["length"], json!(15.0));
    assert_eq!(moved["startTangentAngleDeg"], json!(0.0));
    assert_eq!(moved["endTangentAngleDeg"], json!(180.0));
    assert_eq!(moved["segments"].as_array().unwrap().len(), 2);
    assert_eq!(moved["segments"][1], joined_path["segments"][0]);
}

#[test]
fn issue1591_joined_path_truncation_preserves_path_ids_without_fabricating_stations() {
    let mut joined_path = endpoint_move_path("joinedPath");
    joined_path["pathIds"] = json!(["source-path"]);
    joined_path["baseLineIds"] = json!(["invalid-for-joined-path"]);

    let moved = move_path_endpoint(&joined_path, "end", 5.0, 0.0);

    assert_eq!(moved["kind"], "joinedPath");
    assert_eq!(moved["pathIds"], json!(["source-path"]));
    assert!(moved.get("extractionStations").is_none());
    assert!(moved.get("baseLineIds").is_none());
    assert_eq!(moved["closed"], json!(false));
    assert_eq!(moved["start"]["x"], json!(0.0));
    assert_eq!(moved["end"]["x"], json!(5.0));
    assert_eq!(moved["length"], json!(5.0));
    assert_eq!(moved["startTangentAngleDeg"], json!(0.0));
    assert_eq!(moved["endTangentAngleDeg"], json!(180.0));
    assert_eq!(moved["segments"].as_array().unwrap().len(), 1);
}

#[test]
fn issue1591_offset_line_endpoint_extension_and_truncation_retain_base_line_ids() {
    let offset_line = endpoint_move_path("offsetLine");

    let extended = move_path_endpoint(&offset_line, "start", -5.0, 0.0);
    assert_eq!(extended["kind"], "offsetLine");
    assert_eq!(extended["baseLineIds"], json!(["base-a"]));
    assert!(extended.get("pathIds").is_none());
    assert!(extended.get("extractionStations").is_none());
    assert_eq!(extended["closed"], json!(false));
    assert_eq!(extended["start"]["x"], json!(-5.0));
    assert_eq!(extended["end"]["x"], json!(10.0));
    assert_eq!(extended["length"], json!(15.0));
    assert_eq!(extended["startTangentAngleDeg"], json!(0.0));
    assert_eq!(extended["endTangentAngleDeg"], json!(180.0));

    let truncated = move_path_endpoint(&offset_line, "end", 5.0, 0.0);
    assert_eq!(truncated["kind"], "offsetLine");
    assert_eq!(truncated["baseLineIds"], json!(["base-a"]));
    assert!(truncated.get("pathIds").is_none());
    assert!(truncated.get("extractionStations").is_none());
    assert_eq!(truncated["closed"], json!(false));
    assert_eq!(truncated["start"]["x"], json!(0.0));
    assert_eq!(truncated["end"]["x"], json!(5.0));
    assert_eq!(truncated["length"], json!(5.0));
    assert_eq!(truncated["startTangentAngleDeg"], json!(0.0));
    assert_eq!(truncated["endTangentAngleDeg"], json!(180.0));
}

#[test]
fn edge_extends_and_trims_two_line_endpoints() {
    let result = evaluate_document_input(EvaluationInput {
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
                "activity": "visible",
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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

fn open_joined_path_geometry(kind: &str, y: f64) -> serde_json::Value {
    json!({
        "kind": kind,
        "start": { "x": 0.0, "y": y },
        "end": { "x": 10.0, "y": y },
        "segments": [{
            "kind": "bezier",
            "start": { "x": 0.0, "y": y },
            "control1": { "x": 3.0, "y": y },
            "control2": { "x": 7.0, "y": y },
            "end": { "x": 10.0, "y": y },
            "length": 10.0
        }],
        "closed": false,
        "length": 10.0
    })
}

fn vertical_extension_control() -> serde_json::Value {
    json!({
        "kind": "line",
        "start": { "x": -5.0, "y": -2.0 },
        "end": { "x": -5.0, "y": 2.0 },
        "length": 4.0
    })
}

#[test]
fn issue1591_joined_path_endpoint_extensions_match_offset_lines_for_both_tiny_offsets() {
    for y in [1.7789e-11, -1.7789e-11] {
        let joined_path = open_joined_path_geometry("joinedPath", y);
        let offset_line = open_joined_path_geometry("offsetLine", y);
        let vertical = vertical_extension_control();
        let joined = find_line_intersections(&joined_path, &vertical, true).unwrap();
        let offset = find_line_intersections(&offset_line, &vertical, true).unwrap();

        assert!(joined.error.is_none());
        assert!(offset.error.is_none());
        assert_eq!(joined.intersections.len(), 1);
        assert_eq!(offset.intersections.len(), 1);
        let joined_hit = joined.intersections[0];
        let offset_hit = offset.intersections[0];
        assert!((joined_hit.x - offset_hit.x).abs() < 1e-12);
        assert!((joined_hit.y - offset_hit.y).abs() < 1e-12);
        assert!((joined_hit.x + 5.0).abs() < 1e-12);
        assert!((joined_hit.y - y).abs() < 1e-12);
    }
}

#[test]
fn issue1591_closed_joined_path_and_offset_line_do_not_receive_endpoint_extensions() {
    let closed_segments = json!([
        { "kind": "line", "start": { "x": 0.0, "y": 0.0 }, "end": { "x": 10.0, "y": 0.0 }, "length": 10.0 },
        { "kind": "line", "start": { "x": 10.0, "y": 0.0 }, "end": { "x": 10.0, "y": 10.0 }, "length": 10.0 },
        { "kind": "line", "start": { "x": 10.0, "y": 10.0 }, "end": { "x": 0.0, "y": 10.0 }, "length": 10.0 },
        { "kind": "line", "start": { "x": 0.0, "y": 10.0 }, "end": { "x": 0.0, "y": 0.0 }, "length": 10.0 }
    ]);
    let joined_path = json!({
        "kind": "joinedPath", "start": { "x": 0.0, "y": 0.0 },
        "end": { "x": 0.0, "y": 0.0 }, "segments": closed_segments.clone(),
        "closed": true, "length": 40.0
    });
    let offset_line = json!({
        "kind": "offsetLine", "start": { "x": 0.0, "y": 0.0 },
        "end": { "x": 0.0, "y": 0.0 }, "segments": closed_segments,
        "closed": true, "length": 40.0
    });
    let outside = json!({
        "kind": "line", "start": { "x": -1.0, "y": -1.0 },
        "end": { "x": -1.0, "y": 1.0 }, "length": 2.0
    });

    assert_eq!(
        find_line_intersections(&joined_path, &outside, true)
            .unwrap()
            .intersections
            .len(),
        0
    );
    assert_eq!(
        find_line_intersections(&offset_line, &outside, true)
            .unwrap()
            .intersections
            .len(),
        0
    );
}

#[test]
fn edge_trims_a_bezier_and_a_line() {
    let result = evaluate_document_input(EvaluationInput {
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
                "activity": "visible",
                "endpoint1": { "lineId": "curve", "endpointKey": "end" },
                "endpoint2": { "lineId": "vline", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
                "activity": "visible",
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
                "activity": "visible",
                "endpoint1": { "lineId": "curve", "endpointKey": "end" },
                "endpoint2": { "lineId": "vcurve", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 50.0, 0.0),
            free_point("c", "C", 80.0, -20.0),
            free_point("d", "D", 80.0, 20.0),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "activity": "visible",
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
                "activity": "visible",
                "endpoint1": { "lineId": "curve", "endpointKey": "end" },
                "endpoint2": { "lineId": "vline", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("ab", "AB", "a", "b"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "activity": "visible",
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "ab", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(same_line.errors[0].message.contains("同じ線"));

    let parallel = evaluate_document_input(EvaluationInput {
        evaluation_order: None,

        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
                "activity": "visible",
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(parallel.errors[0].message.contains("交点"));

    let invalid_index = evaluate_document_input(EvaluationInput {
        evaluation_order: None,

        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
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
                "activity": "visible",
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0.5
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(invalid_index.errors[0].message.contains("0以上の整数"));
}
