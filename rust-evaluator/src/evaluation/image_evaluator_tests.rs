use super::*;
use serde_json::{json, Value};

fn image_element(target_pixels_per_mm: Value) -> Value {
    json!({
        "id": "image",
        "name": "画像",
        "type": "image",
        "activity": "visible",
        "sourcePath": "image.png",
        "originPoint": { "mode": "coordinate", "x": 0.0, "y": 0.0 },
        "naturalWidthPx": 300.0,
        "naturalHeightPx": 150.0,
        "sourceDpi": 300.0,
        "targetPixelsPerMm": target_pixels_per_mm,
        "scale": 1.0,
        "angleDeg": 0.0,
        "mirrorX": false
    })
}

fn evaluate_image(target_pixels_per_mm: Value) -> EvaluationPayload {
    evaluate_document(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![image_element(target_pixels_per_mm)],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    })
    .expect("image evaluation should reach the production evaluator")
}

fn assert_image_geometry_error(result: &EvaluationPayload) {
    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].element_id, "image");
    assert_eq!(result.errors[0].missing_dependency_id, "image");
    assert!(result.errors[0].message.contains("目標解像度"));
}

#[test]
fn image_evaluation_preserves_positive_target_pixels_per_mm() {
    let result = evaluate_image(json!(10.0));

    assert!(result.errors.is_empty());
    let geometry = result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!("image"))
        .expect("expected computed image geometry");
    assert_eq!(geometry["targetPixelsPerMm"], json!(10.0));
}

#[test]
fn image_evaluation_rejects_zero_target_pixels_per_mm() {
    let result = evaluate_image(json!(0.0));

    assert_image_geometry_error(&result);
}

#[test]
fn image_evaluation_rejects_negative_target_pixels_per_mm() {
    let result = evaluate_image(json!(-1.0));

    assert_image_geometry_error(&result);
}
