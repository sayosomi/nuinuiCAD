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
