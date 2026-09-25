use super::*;
use serde_json::{json, Value};

fn input(elements: Vec<Value>) -> EvaluationInput {
    EvaluationInput {
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
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    }
}

fn expression(source: &str) -> Value {
    json!({ "expression": source })
}

#[test]
fn free_point_accumulates_independent_numeric_input_errors_in_parameter_order() {
    let result = evaluate_document_input(input(vec![json!({
        "id": "point",
        "name": "Point",
        "type": "freePoint",
        "activity": "visible",
        "x": expression("1 / 0"),
        "y": expression("sqrt(-1)")
    })]));

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors.len(), 2);
    assert_eq!(result.errors[0].missing_dependency_id, "1 / 0");
    assert_eq!(result.errors[1].missing_dependency_id, "sqrt(-1)");
}

#[test]
fn offset_and_polar_points_accumulate_sibling_numeric_errors_after_resolving_the_anchor() {
    let result = evaluate_document_input(input(vec![
        json!({
            "id": "base",
            "name": "Base",
            "type": "freePoint",
            "activity": "visible",
            "x": 0,
            "y": 0
        }),
        json!({
            "id": "offset",
            "name": "Offset",
            "type": "offsetPoint",
            "activity": "visible",
            "fromPoint": { "mode": "reference", "pointId": "base" },
            "dx": expression("1 / 0"),
            "dy": expression("sqrt(-1)")
        }),
        json!({
            "id": "polar",
            "name": "Polar",
            "type": "polarOffsetPoint",
            "activity": "visible",
            "fromPoint": { "mode": "reference", "pointId": "base" },
            "angleDeg": expression("1 / 0"),
            "distance": expression("sqrt(-1)")
        }),
    ]));

    assert_eq!(result.errors.len(), 4);
    assert_eq!(result.errors[0].element_id, "offset");
    assert_eq!(result.errors[0].missing_dependency_id, "1 / 0");
    assert_eq!(result.errors[1].element_id, "offset");
    assert_eq!(result.errors[1].missing_dependency_id, "sqrt(-1)");
    assert_eq!(result.errors[2].element_id, "polar");
    assert_eq!(result.errors[2].missing_dependency_id, "1 / 0");
    assert_eq!(result.errors[3].element_id, "polar");
    assert_eq!(result.errors[3].missing_dependency_id, "sqrt(-1)");
}

#[test]
fn division_point_accumulates_both_independent_coordinate_anchor_errors() {
    let result = evaluate_document_input(input(vec![json!({
        "id": "between",
        "name": "Between",
        "type": "divisionPoint",
        "activity": "visible",
        "startPoint": {
            "mode": "coordinate",
            "x": expression("1 / 0"),
            "y": expression("sqrt(-1)")
        },
        "endPoint": {
            "mode": "coordinate",
            "x": expression("1 / 0"),
            "y": expression("sqrt(-1)")
        },
        "placement": { "kind": "ratio", "value": 0.5 }
    })]));

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors.len(), 4);
    assert_eq!(result.errors[0].missing_dependency_id, "1 / 0");
    assert_eq!(result.errors[1].missing_dependency_id, "sqrt(-1)");
    assert_eq!(result.errors[2].missing_dependency_id, "1 / 0");
    assert_eq!(result.errors[3].missing_dependency_id, "sqrt(-1)");
}
