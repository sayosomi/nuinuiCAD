use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

#[test]
fn evaluates_ordered_open_and_closed_polylines_with_duplicate_segments() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("c", "C", 10.0, 10.0),
            element(json!({
                "id": "open",
                "name": "Open",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "b" },
                    { "mode": "reference", "pointId": "c" }
                ],
                "closed": false
            })),
            element(json!({
                "id": "closed",
                "name": "Closed",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "b" },
                    { "mode": "reference", "pointId": "c" }
                ],
                "closed": true
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

    let open = geometry(&result, "open");
    let closed = geometry(&result, "closed");
    assert_eq!(open["kind"], json!("polyline"));
    assert_eq!(open["segments"].as_array().unwrap().len(), 3);
    assert_eq!(open["segments"][0]["length"], json!(0.0));
    assert_eq!(closed["segments"].as_array().unwrap().len(), 3);
    assert_eq!(closed["closed"], json!(true));
    assert_eq!(closed["segments"][2]["end"]["x"], json!(0.0));
    assert_eq!(closed["segments"][2]["end"]["y"], json!(0.0));
    assert_close(
        closed["length"].as_f64().unwrap(),
        10.0 + 10.0 + 200.0_f64.sqrt(),
    );
    assert_eq!(closed["startTangentAngleDeg"], json!(0.0));
}

#[test]
fn rejects_polyline_cardinality_without_computed_geometry() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            element(json!({
                "id": "polyline",
                "name": "Polyline",
                "type": "polyline",
                "activity": "visible",
                "points": [{ "mode": "reference", "pointId": "a" }],
                "closed": false
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

    assert!(geometry_missing(&result, "polyline"));
    assert_eq!(result.errors.len(), 1);
}

#[test]
fn suppressed_closed_closure_still_reports_the_first_point_as_end() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("c", "C", 0.0, 1e-10),
            element(json!({
                "id": "closed",
                "name": "Closed",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "b" },
                    { "mode": "reference", "pointId": "c" }
                ],
                "closed": true
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

    let closed = geometry(&result, "closed");
    assert_eq!(closed["segments"].as_array().unwrap().len(), 2);
    assert_eq!(closed["end"]["x"], json!(0.0));
    assert_eq!(closed["end"]["y"], json!(0.0));
}

#[test]
fn splits_a_polyline_through_the_existing_broad_path_consumer() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("c", "C", 10.0, 10.0),
            element(json!({
                "id": "base",
                "name": "Base",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "b" },
                    { "mode": "reference", "pointId": "c" }
                ],
                "closed": false
            })),
            element(json!({
                "id": "split",
                "name": "Split",
                "type": "splitLine",
                "activity": "visible",
                "baseLineId": "base",
                "splitPoint": { "mode": "coordinate", "x": 5.0, "y": 0.0 }
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

    assert!(
        result.errors.is_empty(),
        "unexpected errors: {:?}",
        result.errors
    );
    let base = geometry(&result, "base");
    let split = geometry(&result, "split");
    assert_eq!(base["kind"], json!("polyline"));
    assert_eq!(base["length"], json!(5.0));
    assert_eq!(base["end"]["x"], json!(5.0));
    assert_eq!(split["kind"], json!("polyline"));
    assert_eq!(split["length"], json!(15.0));
    assert_eq!(split["start"]["x"], json!(5.0));
    assert_eq!(split["end"]["y"], json!(10.0));
}
