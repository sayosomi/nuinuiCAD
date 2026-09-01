use super::edge_extend_test_support::*;
use super::*;
use serde_json::{json, Value};

fn bezier_curve(id: &str, start_id: &str, end_id: &str) -> Value {
    element(json!({
        "id": id,
        "name": "曲線",
        "type": "bezierCurve",
        "activity": "visible",
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
fn copy_line_rejects_a_discontinuous_source_list() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("move", "移動先", 20.0, 10.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("center", "中心", 0.0, 0.0),
            line("line", "線", "a", "b"),
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
            bezier_curve("curve", "a", "b"),
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
            element(json!({
                "id": "copy",
                "name": "コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "move" },
                "angleDeg": 90,
                "mirrorX": false,
                "baseLineIds": ["line", "arc", "curve", "offset"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(!result.errors.is_empty());
}

#[test]
fn copy_line_mirror_reverses_arc_sweep() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("move", "移動先", 0.0, 0.0),
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
            element(json!({
                "id": "copy",
                "name": "コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "move" },
                "angleDeg": 0,
                "mirrorX": true,
                "baseLineIds": ["arc"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    let arc = &geometry(&result, "copy")["segments"][0];
    assert_eq!(arc["kind"], json!("arc"));
    assert_close(arc["sweepAngleDeg"].as_f64().unwrap(), -90.0);
}

#[test]
fn copy_line_arc_scale_keeps_radius_and_length_consistent() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("target", "移動先", 20.0, 30.0),
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
            element(json!({
                "id": "double",
                "name": "2倍コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 2,
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["arc"]
            })),
            element(json!({
                "id": "half",
                "name": "半分コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 0.5,
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["arc"]
            })),
            element(json!({
                "id": "rotated",
                "name": "回転コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 1,
                "angleDeg": 45,
                "mirrorX": false,
                "baseLineIds": ["arc"]
            })),
            element(json!({
                "id": "mirrored",
                "name": "反転コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 1,
                "angleDeg": 0,
                "mirrorX": true,
                "baseLineIds": ["arc"]
            })),
            element(json!({
                "id": "mirrored-double",
                "name": "反転2倍コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 2,
                "angleDeg": 0,
                "mirrorX": true,
                "baseLineIds": ["arc"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    for (id, expected_radius, expected_sweep) in [
        ("double", 20.0, 90.0),
        ("half", 5.0, 90.0),
        ("rotated", 10.0, 90.0),
        ("mirrored", 10.0, -90.0),
        ("mirrored-double", 20.0, -90.0),
    ] {
        let copy = geometry(&result, id);
        let arc = &copy["segments"][0];
        assert_eq!(arc["kind"], json!("arc"));
        let center = &arc["center"];
        let start = &arc["start"];
        let end = &arc["end"];
        let center_x = center["x"].as_f64().unwrap();
        let center_y = center["y"].as_f64().unwrap();
        let start_x = start["x"].as_f64().unwrap();
        let start_y = start["y"].as_f64().unwrap();
        let end_x = end["x"].as_f64().unwrap();
        let end_y = end["y"].as_f64().unwrap();
        let radius = arc["radius"].as_f64().unwrap();
        let expected_length = expected_radius * std::f64::consts::PI / 2.0;
        assert_close(radius, expected_radius);
        assert_close(radius, (start_x - center_x).hypot(start_y - center_y));
        assert_close(radius, (end_x - center_x).hypot(end_y - center_y));
        assert_close(arc["sweepAngleDeg"].as_f64().unwrap(), expected_sweep);
        assert_close(arc["length"].as_f64().unwrap(), expected_length);
        assert_close(copy["length"].as_f64().unwrap(), expected_length);
    }
}

#[test]
fn copy_line_and_move_scale_around_end_point() {
    let copy_result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("target", "移動先", 10.0, 10.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 20.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "copy",
                "name": "コピー",
                "type": "copyLine",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 0.5,
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["line"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(copy_result.errors.is_empty());
    let copy = geometry(&copy_result, "copy");
    assert_close(copy["segments"][0]["start"]["x"].as_f64().unwrap(), 10.0);
    assert_close(copy["segments"][0]["end"]["x"].as_f64().unwrap(), 20.0);
    assert_close(copy["length"].as_f64().unwrap(), 10.0);

    let move_result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("origin", "原点", 0.0, 0.0),
            free_point("target", "移動先", 10.0, 10.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 20.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "move",
                "name": "移動",
                "type": "move",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "origin" },
                "endPoint": { "mode": "reference", "pointId": "target" },
                "scale": 0.5,
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["line"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(move_result.errors.is_empty());
    assert!(geometry_missing(&move_result, "move"));
    assert_close(
        geometry(&move_result, "line")["start"]["x"]
            .as_f64()
            .unwrap(),
        10.0,
    );
    assert_close(
        geometry(&move_result, "line")["end"]["x"].as_f64().unwrap(),
        20.0,
    );
    assert_close(
        geometry(&move_result, "line")["length"].as_f64().unwrap(),
        10.0,
    );
}

#[test]
fn symmetric_copy_line_rejects_a_discontinuous_source_list() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("axis1", "軸1", 0.0, 0.0),
            free_point("axis2", "軸2", 100.0, 0.0),
            free_point("a", "A", 0.0, 10.0),
            free_point("b", "B", 100.0, 10.0),
            line("line", "線", "a", "b"),
            bezier_curve("curve", "a", "b"),
            element(json!({
                "id": "copy",
                "name": "対称コピー",
                "type": "symmetricCopyLine",
                "activity": "visible",
                "axisPoint1": { "mode": "reference", "pointId": "axis1" },
                "axisPoint2": { "mode": "reference", "pointId": "axis2" },
                "baseLineIds": ["line", "curve"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(!result.errors.is_empty());
}

#[test]
fn move_updates_existing_geometry_and_downstream_references() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("from", "From", 0.0, 0.0),
            free_point("to", "To", 20.0, 0.0),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "move",
                "name": "移動",
                "type": "move",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "from" },
                "endPoint": { "mode": "reference", "pointId": "to" },
                "angleDeg": 0,
                "mirrorX": false,
                "baseLineIds": ["line"]
            })),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "activity": "visible",
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "move"));
    assert_close(
        geometry(&result, "line")["start"]["x"].as_f64().unwrap(),
        20.0,
    );
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 70.0);
}

#[test]
fn symmetric_move_reports_axis_and_dependency_errors() {
    let axis_error = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("axis", "軸", 0.0, 0.0),
            free_point("a", "A", 0.0, 10.0),
            free_point("b", "B", 100.0, 10.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "move",
                "name": "対称移動",
                "type": "symmetricMove",
                "activity": "visible",
                "axisPoint1": { "mode": "reference", "pointId": "axis" },
                "axisPoint2": { "mode": "reference", "pointId": "axis" },
                "baseLineIds": ["line"]
            })),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(axis_error.errors[0].message.contains("同じ点"));

    let dependency_error = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("axis1", "軸1", 0.0, 0.0),
            free_point("axis2", "軸2", 100.0, 0.0),
            element(json!({
                "id": "move",
                "name": "対称移動",
                "type": "symmetricMove",
                "activity": "visible",
                "axisPoint1": { "mode": "reference", "pointId": "axis1" },
                "axisPoint2": { "mode": "reference", "pointId": "axis2" },
                "baseLineIds": ["late"]
            })),
            free_point("a", "A", 0.0, 10.0),
            free_point("b", "B", 100.0, 10.0),
            line("late", "後方線", "a", "b"),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert_eq!(dependency_error.errors[0].missing_dependency_id, "late");
}
