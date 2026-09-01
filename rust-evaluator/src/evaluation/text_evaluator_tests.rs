use super::*;
use serde_json::json;

fn evaluate_text(font_size: f64) -> EvaluationPayload {
    evaluate_document(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![json!({
            "id": "text",
            "name": "注記",
            "type": "text",
            "activity": "visible",
            "text": "注記",
            "anchor": null,
            "fontSize": font_size
        })],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    })
    .expect("text evaluation should reach the production evaluator")
}

#[test]
fn text_evaluation_preserves_positive_font_size() {
    let result = evaluate_text(3.0);

    assert!(result.errors.is_empty());
    let geometry = result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!("text"))
        .expect("expected computed text geometry");
    assert_eq!(geometry["fontSize"], json!(3.0));
}

#[test]
fn text_evaluation_rejects_zero_font_size() {
    let result = evaluate_text(0.0);

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].element_id, "text");
    assert_eq!(result.errors[0].missing_dependency_id, "text");
    assert_eq!(
        result.errors[0].message,
        "注記 の文字サイズは0より大きい値で指定してください。"
    );
}

#[test]
fn text_evaluation_rejects_negative_font_size() {
    let result = evaluate_text(-1.0);

    assert!(result.computed_geometry.is_empty());
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].element_id, "text");
    assert_eq!(result.errors[0].missing_dependency_id, "text");
    assert_eq!(
        result.errors[0].message,
        "注記 の文字サイズは0より大きい値で指定してください。"
    );
}
