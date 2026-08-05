use super::*;
use serde_json::{json, Value};

fn element(value: Value) -> Value {
    value
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
        .expect("expected computed geometry")
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-6,
        "expected {actual} to be close to {expected}"
    );
}

fn assert_close_with_tolerance(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "expected {actual} to be within {tolerance} of {expected}"
    );
}

fn free_point(id: &str, name: &str, x: f64, y: f64) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "freePoint",
        "activity": "visible",
        "x": x,
        "y": y
    }))
}

fn line(id: &str, name: &str, start_id: &str, end_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": start_id },
        "endPoint": { "mode": "reference", "pointId": end_id }
    }))
}

fn split_line(id: &str, base_line_id: &str, point_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": "分割線",
        "type": "splitLine",
        "activity": "visible",
        "baseLineId": base_line_id,
        "splitPoint": { "mode": "reference", "pointId": point_id }
    }))
}

#[test]
fn splits_line_and_updates_base_geometry() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            free_point("p", "分割点", 40.0, 0.0),
            split_line("split", "line", "p"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "line");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("line"));
    assert_eq!(far["kind"], json!("line"));
    assert_close(near["end"]["x"].as_f64().unwrap(), 40.0);
    assert_close(near["length"].as_f64().unwrap(), 40.0);
    assert_close(far["start"]["x"].as_f64().unwrap(), 40.0);
    assert_close(far["length"].as_f64().unwrap(), 60.0);
}

#[test]
fn rejects_split_point_outside_or_at_endpoint() {
    let outside = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            free_point("p", "外側点", 160.0, 0.0),
            split_line("split", "line", "p"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(outside
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("split")));
    assert!(outside.errors[0].message.contains("基準線上"));

    let endpoint = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            split_line("split", "line", "a"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(endpoint
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("split")));
    assert!(endpoint.errors[0].message.contains("端点"));
}

#[test]
fn splits_arc_line() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "activity": "visible",
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
            free_point(
                "mid",
                "中点",
                std::f64::consts::SQRT_2 * 5.0,
                std::f64::consts::SQRT_2 * 5.0,
            ),
            split_line("split", "arc", "mid"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "arc");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("arcLine"));
    assert_eq!(far["kind"], json!("arcLine"));
    assert_close(near["sweepAngleDeg"].as_f64().unwrap(), 45.0);
    assert_close(far["startAngleDeg"].as_f64().unwrap(), 45.0);
    assert_close(far["sweepAngleDeg"].as_f64().unwrap(), 45.0);
}

#[test]
fn splits_bezier_curve() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "start" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 30,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "end" },
                "endHandleAngleDeg": 180,
                "endHandleLength": 30
            })),
            free_point("mid", "中点", 50.0, 0.0),
            split_line("split", "curve", "mid"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "curve");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("bezierCurve"));
    assert_eq!(far["kind"], json!("bezierCurve"));
    assert_close_with_tolerance(
        near["segments"].as_array().unwrap().last().unwrap()["end"]["x"]
            .as_f64()
            .unwrap(),
        50.0,
        0.01,
    );
    assert_close_with_tolerance(
        far["segments"][0]["start"]["x"].as_f64().unwrap(),
        50.0,
        0.01,
    );
}

#[test]
fn splits_bezier_curve_at_intersection_with_angle_line() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("b", "点B", 28.931366411079747, -77.9400300699557),
            free_point("c", "点C", 176.6944080265404, -62.993702802121724),
            free_point("d", "点D", 101.39129725109973, -1.4362552885086997),
            element(json!({
                "id": "curve",
                "name": "曲線BC",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "b" },
                "startHandleAngleDeg": 335.4717868151397,
                "startHandleLength": 33.637281785342516,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "c" },
                "endHandleAngleDeg": 33.64482285411668,
                "endHandleLength": 51.81048707583799
            })),
            element(json!({
                "id": "direction",
                "name": "D方向線",
                "type": "angleLengthLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "d" },
                "angleDeg": -77,
                "length": 100
            })),
            element(json!({
                "id": "intersection",
                "name": "交点",
                "type": "intersectionPoint",
                "activity": "visible",
                "line1Id": "direction",
                "line2Id": "curve",
                "intersectionIndex": 0,
                "useExtensions": false
            })),
            split_line("split", "curve", "intersection"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let intersection = geometry(&result, "intersection");
    let near = geometry(&result, "curve");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("bezierCurve"));
    assert_eq!(far["kind"], json!("bezierCurve"));
    assert_close_with_tolerance(
        near["segments"].as_array().unwrap().last().unwrap()["end"]["x"]
            .as_f64()
            .unwrap(),
        intersection["x"].as_f64().unwrap(),
        1e-6,
    );
    assert_close_with_tolerance(
        near["segments"].as_array().unwrap().last().unwrap()["end"]["y"]
            .as_f64()
            .unwrap(),
        intersection["y"].as_f64().unwrap(),
        1e-6,
    );
    assert_close_with_tolerance(
        far["segments"][0]["start"]["x"].as_f64().unwrap(),
        intersection["x"].as_f64().unwrap(),
        1e-6,
    );
    assert_close_with_tolerance(
        far["segments"][0]["start"]["y"].as_f64().unwrap(),
        intersection["y"].as_f64().unwrap(),
        1e-6,
    );
}

#[test]
fn splits_offset_line() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "activity": "visible",
                "baseLineIds": ["line"],
                "offset": 10,
                "side": "right",
                "closed": false
            })),
            free_point("mid", "中点", 50.0, -10.0),
            split_line("split", "offset", "mid"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let near = geometry(&result, "offset");
    let far = geometry(&result, "split");
    assert_eq!(near["kind"], json!("offsetLine"));
    assert_eq!(far["kind"], json!("offsetLine"));
    assert_close(near["segments"][0]["end"]["x"].as_f64().unwrap(), 50.0);
    assert_close(far["segments"][0]["start"]["x"].as_f64().unwrap(), 50.0);
    assert_close(near["length"].as_f64().unwrap(), 50.0);
    assert_close(far["length"].as_f64().unwrap(), 50.0);
}

#[test]
fn reports_base_and_split_point_dependencies() {
    let base_missing = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![split_line("split", "line", "p")],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert_eq!(base_missing.errors[0].element_id, "split");
    assert_eq!(base_missing.errors[0].missing_dependency_id, "line");

    let point_missing = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            split_line("split", "line", "p"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert_eq!(point_missing.errors[0].element_id, "split");
    assert_eq!(point_missing.errors[0].missing_dependency_id, "p");
}

#[test]
fn split_line_can_feed_downstream_line_helpers() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "基準線", "a", "b"),
            free_point("p", "分割点", 40.0, 0.0),
            split_line("split", "line", "p"),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "activity": "visible",
                "endpoint": { "lineId": "split", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "activity": "visible",
                "baseLineIds": ["split"],
                "offset": 10,
                "side": "right",
                "closed": false
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 70.0);
    assert_close(
        geometry(&result, "offset")["segments"][0]["start"]["y"]
            .as_f64()
            .unwrap(),
        -10.0,
    );
}
