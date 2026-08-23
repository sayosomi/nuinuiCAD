use nuinuicad_rust_evaluator::{evaluate_document, EvaluationInput};
use serde_json::json;

#[test]
fn computed_offset_retains_hover_inspection_metadata() {
    let elements = vec![
        json!({
            "id": "a",
            "name": "A",
            "type": "freePoint",
            "activity": "visible",
            "x": 0,
            "y": 0
        }),
        json!({
            "id": "b",
            "name": "B",
            "type": "freePoint",
            "activity": "visible",
            "x": 100,
            "y": 0
        }),
        json!({
            "id": "base",
            "name": "Base",
            "type": "line",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" }
        }),
        json!({
            "id": "offset",
            "name": "Seam",
            "type": "offsetLine",
            "activity": "visible",
            "baseLineIds": ["base"],
            "offset": 10,
            "side": "left",
            "closed": false
        }),
    ];

    let result = evaluate_document(EvaluationInput {
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
    })
    .expect("offset evaluation should succeed");

    let geometry = result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!("offset"))
        .expect("expected offset geometry");

    assert_eq!(geometry["offsetDistance"], json!(10.0));
    assert_eq!(geometry["offsetSide"], json!("left"));
}
