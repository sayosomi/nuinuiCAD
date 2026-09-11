use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

#[test]
fn evaluates_ordered_joined_paths_with_reversal_and_closed_validation() {
    let result = evaluate_document_input(EvaluationInput {
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
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
            free_point("d", "D", 20.0, 0.0),
            line("first", "First", "a", "b"),
            line("backward", "Backward", "d", "b"),
            element(json!({
                "id": "joined",
                "name": "Joined",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "backward"],
                "closed": false
            })),
            line("bc", "BC", "b", "c"),
            line("ca", "CA", "c", "a"),
            element(json!({
                "id": "closed",
                "name": "Closed",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "bc", "ca"],
                "closed": true
            })),
            element(json!({
                "id": "duplicates",
                "name": "Duplicates",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "first"],
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

    let joined = geometry(&result, "joined");
    assert_eq!(joined["kind"], json!("joinedPath"));
    assert_eq!(joined["pathIds"], json!(["first", "backward"]));
    assert_eq!(joined["segments"][1]["start"]["x"], json!(10.0));
    assert_eq!(joined["segments"][1]["end"]["x"], json!(20.0));
    assert_eq!(
        geometry(&result, "closed")["segments"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        geometry(&result, "duplicates")["pathIds"],
        json!(["first", "first"])
    );
    assert_eq!(
        geometry(&result, "duplicates")["segments"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn uses_shared_epsilon_and_preserves_authored_bezier_orientation_on_a_tie() {
    let result = evaluate_document_input(EvaluationInput {
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("inside", "Inside", 10.0 + 0.5e-9, 0.0),
            free_point("outside", "Outside", 10.0 + 1.5e-9, 0.0),
            free_point("inside_end", "Inside End", 10.0 + 0.5e-9, 10.0),
            free_point("outside_end", "Outside End", 10.0 + 1.5e-9, 10.0),
            free_point("curve_start", "Curve Start", 0.0, 10.0),
            line("first", "First", "a", "b"),
            line("inside_line", "Inside Line", "inside", "inside_end"),
            line("outside_line", "Outside Line", "outside", "outside_end"),
            arch_curve("reversed_curve", "Reversed Curve", "curve_start", "b"),
            arch_curve("tie_curve", "Tie Curve", "inside", "inside_end"),
            element(json!({
                "id": "inside_join",
                "name": "Inside Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "inside_line"],
                "closed": false
            })),
            element(json!({
                "id": "outside_join",
                "name": "Outside Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "outside_line"],
                "closed": false
            })),
            element(json!({
                "id": "reversed_join",
                "name": "Reversed Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "reversed_curve"],
                "closed": false
            })),
            element(json!({
                "id": "tie_join",
                "name": "Tie Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "tie_curve"],
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

    assert!(!geometry_missing(&result, "inside_join"));
    assert!(geometry_missing(&result, "outside_join"));

    let reversed_curve = &geometry(&result, "reversed_curve")["segments"][0];
    let reversed_join = &geometry(&result, "reversed_join")["segments"][1];
    assert_eq!(reversed_join["start"], reversed_curve["end"]);
    assert_eq!(reversed_join["control1"], reversed_curve["control2"]);
    assert_eq!(reversed_join["control2"], reversed_curve["control1"]);
    assert_eq!(reversed_join["end"], reversed_curve["start"]);

    let tie_curve = &geometry(&result, "tie_curve")["segments"][0];
    let tie_join = &geometry(&result, "tie_join")["segments"][1];
    assert_eq!(tie_join["start"], tie_curve["start"]);
    assert_eq!(tie_join["control1"], tie_curve["control1"]);
    assert_eq!(tie_join["control2"], tie_curve["control2"]);
    assert_eq!(tie_join["end"], tie_curve["end"]);
}

#[test]
fn reverses_directed_arcs_broad_paths_and_nested_joined_paths_exactly() {
    let result = evaluate_document_input(EvaluationInput {
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("center", "Center", 0.0, 0.0),
            free_point("broad_start", "Broad Start", 20.0, 0.0),
            free_point("broad_middle", "Broad Middle", 10.0, 0.0),
            free_point("prefix_start", "Prefix Start", -10.0, 0.0),
            line("first", "First", "a", "b"),
            element(json!({
                "id": "degenerate",
                "name": "Degenerate",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "b" },
                    { "mode": "reference", "pointId": "b" }
                ],
                "closed": false
            })),
            element(json!({
                "id": "zero",
                "name": "Zero",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "a" },
                    { "mode": "reference", "pointId": "a" }
                ],
                "closed": false
            })),
            element(json!({
                "id": "arc",
                "name": "Arc",
                "type": "arcLine",
                "activity": "visible",
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10.0,
                "startAngleDeg": 90.0,
                "endAngleDeg": 0.0,
                "direction": "clockwise"
            })),
            element(json!({
                "id": "broad",
                "name": "Broad",
                "type": "polyline",
                "activity": "visible",
                "points": [
                    { "mode": "reference", "pointId": "broad_start" },
                    { "mode": "reference", "pointId": "broad_middle" },
                    { "mode": "reference", "pointId": "b" }
                ],
                "closed": false
            })),
            line("nested_a", "Nested A", "broad_middle", "a"),
            line("nested_b", "Nested B", "broad_start", "broad_middle"),
            line("prefix", "Prefix", "prefix_start", "a"),
            element(json!({
                "id": "nested",
                "name": "Nested",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["nested_b", "nested_a"],
                "closed": false
            })),
            element(json!({
                "id": "arc_join",
                "name": "Arc Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "arc"],
                "closed": false
            })),
            element(json!({
                "id": "broad_join",
                "name": "Broad Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["first", "broad"],
                "closed": false
            })),
            element(json!({
                "id": "nested_join",
                "name": "Nested Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["prefix", "nested"],
                "closed": false
            })),
            element(json!({
                "id": "degenerate_join",
                "name": "Degenerate Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["degenerate"],
                "closed": false
            })),
            element(json!({
                "id": "zero_join",
                "name": "Zero Join",
                "type": "joinedPath",
                "activity": "visible",
                "pathIds": ["zero"],
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

    let arc_segment = &geometry(&result, "arc_join")["segments"][1];
    assert_eq!(arc_segment["startAngleDeg"], json!(0.0));
    assert_eq!(arc_segment["sweepAngleDeg"], json!(90.0));
    assert_close(arc_segment["start"]["x"].as_f64().unwrap(), 10.0);
    assert_close(arc_segment["end"]["y"].as_f64().unwrap(), 10.0);

    let broad_source = geometry(&result, "broad")["segments"].as_array().unwrap();
    let broad_join = geometry(&result, "broad_join")["segments"]
        .as_array()
        .unwrap();
    for (source, actual) in broad_source.iter().rev().zip(broad_join.iter().skip(1)) {
        assert_eq!(actual["kind"], json!("line"));
        assert_eq!(actual["start"], source["end"]);
        assert_eq!(actual["end"], source["start"]);
        assert_eq!(actual["length"], source["length"]);
    }

    let nested_join = geometry(&result, "nested_join")["segments"]
        .as_array()
        .unwrap();
    assert_eq!(nested_join[0]["start"]["x"], json!(-10.0));
    assert_eq!(nested_join[0]["end"]["x"], json!(0.0));
    assert_eq!(nested_join[1]["start"]["x"], json!(0.0));
    assert_eq!(nested_join[1]["end"]["x"], json!(10.0));
    assert_eq!(nested_join[2]["start"]["x"], json!(10.0));
    assert_eq!(nested_join[2]["end"]["x"], json!(20.0));

    assert_eq!(
        geometry(&result, "degenerate_join")["startTangentAngleDeg"],
        json!(0.0)
    );
    assert_eq!(
        geometry(&result, "degenerate_join")["endTangentAngleDeg"],
        json!(180.0)
    );
    assert_eq!(
        geometry(&result, "zero_join")["startTangentAngleDeg"],
        json!(null)
    );
    assert_eq!(
        geometry(&result, "zero_join")["endTangentAngleDeg"],
        json!(null)
    );
}

#[test]
fn rejects_empty_and_discontinuous_joined_paths() {
    let result = evaluate_document_input(EvaluationInput {
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "empty",
            "name": "Empty",
            "type": "joinedPath",
            "activity": "visible",
            "pathIds": [],
            "closed": false
        }))],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    assert!(geometry_missing(&result, "empty"));
    assert_eq!(result.errors.len(), 1);
}
