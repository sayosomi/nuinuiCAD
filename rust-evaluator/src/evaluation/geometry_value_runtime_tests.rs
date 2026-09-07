use serde_json::{json, Value};

use super::{evaluate_document_input, EvaluationInput};

fn number(value: f64) -> Value {
    json!({
        "kind": "numberLiteral",
        "span": { "start": 0, "end": 1 },
        "value": value,
        "type": { "kind": "number" }
    })
}

fn input(elements: Vec<Value>, program: Vec<Value>) -> EvaluationInput {
    EvaluationInput {
        elements,
        evaluation_limit_index: Some(1),
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        geometry_value_program: Some(Value::Array(program)),
        module_materialization: None,
    }
}

#[test]
fn coordinate_value_stays_out_of_drawable_geometry_and_feeds_a_line() {
    let occurrence = json!({
        "sourceStatementId": "value:p",
        "instancePath": []
    });
    let element = json!({
        "id": "drawable:line",
        "name": "L",
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "geometryValue", "occurrence": occurrence.clone() },
        "endPoint": { "mode": "coordinate", "x": 30, "y": 20 }
    });
    let program = json!({
        "sourceStatementId": "value:p",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "point",
        "occurrence": occurrence,
        "executionPosition": -0.5,
        "construction": {
            "kind": "coordinate",
            "x": number(10.0),
            "y": number(20.0)
        }
    });

    let result = evaluate_document_input(input(vec![element], vec![program]));
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry_values.len(), 1);
    assert_eq!(result.computed_geometry.len(), 1);
    assert_eq!(result.evaluated_element_ids, vec!["drawable:line"]);
    assert_eq!(result.effective_visible_element_ids, vec!["drawable:line"]);
    assert_eq!(result.effective_enabled_element_ids, vec!["drawable:line"]);
    assert_eq!(result.computed_geometry_values[0]["value"]["kind"], "point");
    assert_eq!(result.computed_geometry[0]["start"]["x"], 10.0);
    assert_eq!(result.computed_geometry[0]["length"], 20.0);
}
