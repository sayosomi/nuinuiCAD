use super::*;
use serde_json::{json, Value};

fn input(elements: Vec<Value>, scalar_program: Option<Value>) -> EvaluationInput {
    EvaluationInput {
        path_mutations: None,
        elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn number(value: f64) -> Value {
    json!({ "kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "number"} })
}

fn string(value: &str) -> Value {
    json!({ "kind": "stringLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "string"} })
}

fn boolean(value: bool) -> Value {
    json!({ "kind": "booleanLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "boolean"} })
}

fn choice(value: &str) -> Value {
    json!({ "kind": "choiceLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "choice", "options": ["right", "left"]} })
}

fn reference(binding_id: &str, scalar_type: Value) -> Value {
    json!({ "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1}, "name": binding_id, "bindingId": binding_id, "type": scalar_type })
}

fn statement(
    binding_id: &str,
    source_order: usize,
    declared_type: Value,
    initializer: Value,
) -> Value {
    json!({
        "kind": "declare",
        "bindingId": binding_id,
        "scopeId": "root",
        "sourceOrder": source_order,
        "declaration": {"bindingKind": "const", "declaredType": declared_type, "initializer": initializer}
    })
}

fn program(statements: Vec<Value>) -> Value {
    json!({ "statements": statements })
}

fn point(id: &str, x: f64, y: f64) -> Value {
    json!({ "id": id, "name": id, "type": "freePoint", "activity": "visible", "x": x, "y": y })
}

#[test]
fn evaluates_all_scalar_literals_and_prior_binding_references_in_order() {
    let number_type = json!({"kind": "number"});
    let string_type = json!({"kind": "string"});
    let boolean_type = json!({"kind": "boolean"});
    let choice_type = json!({"kind": "choice", "options": ["right", "left"]});
    let result = evaluate_document_input(input(
        vec![],
        Some(program(vec![
            statement("binding:number", 0, number_type.clone(), number(12.0)),
            statement("binding:string", 1, string_type.clone(), string("front")),
            statement("binding:boolean", 2, boolean_type.clone(), boolean(true)),
            statement("binding:choice", 3, choice_type.clone(), choice("right")),
            statement(
                "binding:copy",
                4,
                number_type.clone(),
                reference("binding:number", number_type),
            ),
        ])),
    ));

    let bindings = result.computed_scalar_bindings.expect("program output");
    assert_eq!(bindings.len(), 5);
    assert_eq!(bindings[0]["bindingId"], "binding:number");
    assert_eq!(bindings[1]["evaluation"]["value"]["value"], "front");
    assert_eq!(bindings[2]["evaluation"]["value"]["value"], true);
    assert_eq!(
        bindings[3]["evaluation"]["value"]["options"],
        json!(["right", "left"])
    );
    assert_eq!(bindings[4]["evaluation"]["value"]["value"], 12.0);
}

#[test]
fn rejects_external_document_binding_references() {
    let number_type = json!({"kind": "number"});
    let scalar_program = program(vec![
        statement(
            "binding:dist",
            3,
            number_type.clone(),
            reference("binding:d", number_type.clone()),
        ),
        statement(
            "binding:next",
            4,
            number_type.clone(),
            reference("binding:dist", number_type),
        ),
    ]);
    let external = evaluate_document_input(input(vec![point("a", 0.0, 0.0)], Some(scalar_program)));
    let bindings = external.computed_scalar_bindings.unwrap();
    assert_eq!(
        bindings[0]["evaluation"]["issueCode"],
        "evaluation-binding-unavailable"
    );
    assert_eq!(
        bindings[1]["evaluation"]["issueCode"],
        "evaluation-binding-unavailable"
    );

    let missing_binding = evaluate_document_input(input(
        vec![],
        Some(program(vec![statement(
            "binding:missing-ref",
            0,
            json!({"kind": "number"}),
            reference("binding:missing", json!({"kind": "number"})),
        )])),
    ));
    assert_eq!(
        missing_binding.computed_scalar_bindings.unwrap()[0]["evaluation"]["issueCode"],
        "evaluation-binding-unavailable"
    );
}

#[test]
fn honors_stop_and_keeps_geometry_unchanged_for_empty_or_omitted_programs() {
    let number_type = json!({"kind": "number"});
    let stopped = json!({
        "statements": [
            statement("binding:first", 0, number_type.clone(), number(1.0)),
            statement("binding:after-stop", 1, number_type, number(2.0))
        ],
        "evaluationLimitSourceOrder": 1
    });
    let stopped_result = evaluate_document_input(input(vec![point("a", 1.0, 2.0)], Some(stopped)));
    assert_eq!(stopped_result.computed_scalar_bindings.unwrap().len(), 1);

    let omitted = evaluate_document_input(input(vec![point("a", 1.0, 2.0)], None));
    let empty = evaluate_document_input(input(vec![point("a", 1.0, 2.0)], Some(program(vec![]))));
    assert_eq!(omitted.computed_geometry, empty.computed_geometry);
    assert_eq!(omitted.errors.len(), empty.errors.len());
    assert_eq!(omitted.computed_scalar_bindings, None);
    assert_eq!(empty.computed_scalar_bindings, Some(vec![]));
}

#[test]
fn poisons_a_decodable_statement_with_a_malformed_initializer() {
    let result = evaluate_document_input(input(
        vec![],
        Some(program(vec![
            statement(
                "binding:broken",
                0,
                json!({"kind": "number"}),
                json!({"kind": "not-a-node"}),
            ),
            statement(
                "binding:after",
                1,
                json!({"kind": "number"}),
                reference("binding:broken", json!({"kind": "number"})),
            ),
        ])),
    ));
    let bindings = result.computed_scalar_bindings.unwrap();
    let evaluation = &bindings[0]["evaluation"];
    assert_eq!(evaluation["type"], json!({"kind": "number"}));
    assert_eq!(evaluation["issueCode"], "scalar-payload-unknown-kind");
    assert_eq!(evaluation["bindingId"], "binding:broken");
    assert_eq!(
        bindings[1]["evaluation"]["issueCode"],
        "scalar-payload-unknown-kind"
    );
}
