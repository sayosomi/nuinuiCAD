use super::*;
use serde_json::{json, Value};

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
        .expect("expected computed geometry")
}

fn evaluate(elements: Vec<Value>) -> EvaluationPayload {
    evaluate_document_input(EvaluationInput {
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
}

fn base_elements() -> Vec<Value> {
    vec![
        json!({"id":"a","name":"A","type":"freePoint","activity":"visible","x":0,"y":0}),
        json!({"id":"b","name":"B","type":"freePoint","activity":"visible","x":10,"y":0}),
        json!({"id":"c","name":"C","type":"freePoint","activity":"visible","x":20,"y":0}),
        json!({"id":"first","name":"First","type":"line","activity":"visible","startPoint":{"mode":"reference","pointId":"a"},"endPoint":{"mode":"reference","pointId":"b"}}),
        json!({"id":"backward","name":"Backward","type":"line","activity":"visible","startPoint":{"mode":"reference","pointId":"c"},"endPoint":{"mode":"reference","pointId":"b"}}),
    ]
}

#[test]
fn joins_in_authored_order_and_reverses_a_later_source_without_mutating_it() {
    let mut elements = base_elements();
    elements.push(json!({"id":"joined","name":"Joined","type":"joinedPath","activity":"visible","pathIds":["first","backward"],"closed":false}));
    let result = evaluate(elements);
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let joined = geometry(&result, "joined");
    assert_eq!(joined["kind"], json!("joinedPath"));
    assert_eq!(joined["pathIds"], json!(["first", "backward"]));
    assert_eq!(joined["segments"][1]["start"]["x"], json!(10.0));
    assert_eq!(joined["segments"][1]["end"]["x"], json!(20.0));
}

#[test]
fn rejects_empty_and_failed_closure_without_synthesizing_geometry() {
    let result = evaluate(vec![
        json!({"id":"empty","name":"Empty","type":"joinedPath","activity":"visible","pathIds":[],"closed":false}),
    ]);
    assert_eq!(
        result
            .computed_geometry
            .iter()
            .find(|geometry| geometry["elementId"] == json!("empty")),
        None
    );
    assert_eq!(result.errors.len(), 1);

    let mut elements = base_elements();
    elements.push(json!({"id":"open","name":"Open","type":"joinedPath","activity":"visible","pathIds":["first","backward"],"closed":true}));
    let result = evaluate(elements);
    assert!(result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!("open"))
        .is_none());
    assert!(result
        .errors
        .iter()
        .any(|error| error.message.contains("closed: true")));
}
