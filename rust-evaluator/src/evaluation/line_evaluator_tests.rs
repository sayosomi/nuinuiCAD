use super::*;
use serde_json::{json, Value};

fn input(elements: Vec<Value>) -> EvaluationInput {
    EvaluationInput {
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
    }
}

fn direct_arc(radius: f64) -> Vec<Value> {
    vec![
        json!({
            "id": "center",
            "name": "中心",
            "type": "freePoint",
            "activity": "visible",
            "x": 10,
            "y": 20
        }),
        json!({
            "id": "arc",
            "name": "円弧",
            "type": "arcLine",
            "activity": "visible",
            "centerPoint": { "mode": "reference", "pointId": "center" },
            "radius": radius,
            "startAngleDeg": 0,
            "endAngleDeg": 90
        }),
    ]
}

fn has_geometry(result: &EvaluationPayload, id: &str) -> bool {
    result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!(id))
}

#[test]
fn evaluates_a_positive_direct_arc_radius_normally() {
    let result = evaluate_document_input(input(direct_arc(10.0)));

    assert!(result.errors.is_empty());
    assert!(has_geometry(&result, "arc"));
    let arc = result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!("arc"))
        .expect("expected computed direct arc");
    assert_eq!(arc["radius"], json!(10.0));
    assert_eq!(
        arc["start"],
        json!({
            "kind": "point",
            "elementId": "arc:start",
            "name": "円弧.始点",
            "x": 20.0,
            "y": 20.0
        })
    );
    assert_eq!(
        arc["end"],
        json!({
            "kind": "point",
            "elementId": "arc:end",
            "name": "円弧.終点",
            "x": 10.0,
            "y": 30.0
        })
    );
}

#[test]
fn rejects_zero_and_negative_direct_arc_radii_without_computed_geometry() {
    for radius in [0.0, -10.0] {
        let result = evaluate_document_input(input(direct_arc(radius)));

        assert!(!has_geometry(&result, "arc"));
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].element_id, "arc");
        assert_eq!(result.errors[0].missing_dependency_id, "arc");
        assert_eq!(
            result.errors[0].message,
            "円弧 の半径は0より大きい値で指定してください。"
        );
    }
}
