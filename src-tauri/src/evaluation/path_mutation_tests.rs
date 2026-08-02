use super::*;
use serde_json::{json, Value};

fn input(elements: &[Value], path_mutations: Value) -> EvaluationInput {
    EvaluationInput {
        path_mutations: Some(path_mutations),
        elements: elements.to_vec(),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn path_mutations(elements: &[Value], reversals: Vec<Value>) -> Value {
    json!({
        "elementSourceOrders": elements.iter().enumerate().map(|(source_order, element)| json!({
            "elementId": element["id"],
            "sourceOrder": source_order
        })).collect::<Vec<_>>(),
        "reversals": reversals
    })
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == id)
        .expect("expected computed geometry")
}

fn point(id: &str, x: f64, y: f64) -> Value {
    json!({ "id": id, "name": id, "type": "freePoint", "visible": true, "enabled": true, "x": x, "y": y })
}

fn line(id: &str, start: &str, end: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "line", "visible": true, "enabled": true,
        "startPoint": { "mode": "reference", "pointId": start },
        "endPoint": { "mode": "reference", "pointId": end }
    })
}

#[test]
fn reverse_changes_later_offset_source_direction_and_preserves_document_order() {
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        point("c", 10.0, 10.0),
        line("ab", "a", "b"),
        line("cb", "c", "b"),
        json!({
            "id": "seam", "name": "seam", "type": "offsetLine", "visible": true, "enabled": true,
            "baseLineIds": ["ab", "cb"], "offset": 1, "side": "right", "closed": false
        }),
    ];
    let mut mutations = path_mutations(
        &elements,
        vec![json!({
            "statementId": "reverse:cb", "sourceOrder": 5, "targetElementId": "cb"
        })],
    );
    mutations["elementSourceOrders"][5]["sourceOrder"] = json!(6);
    let result = evaluate_document_input(input(&elements, mutations));

    assert!(
        result.errors.is_empty(),
        "{:?}",
        result
            .errors
            .iter()
            .map(|error| &error.message)
            .collect::<Vec<_>>()
    );
    assert_eq!(geometry(&result, "cb")["start"]["x"], 10.0);
    assert_eq!(geometry(&result, "cb")["start"]["y"], 0.0);
    assert_eq!(geometry(&result, "cb")["end"]["y"], 10.0);
    assert_eq!(geometry(&result, "seam")["kind"], "offsetLine");
}

#[test]
fn reverse_twice_restores_an_arc_and_reverses_its_sweep() {
    let elements = vec![
        point("center", 0.0, 0.0),
        json!({
            "id": "arc", "name": "arc", "type": "arcLine", "visible": true, "enabled": true,
            "centerPoint": { "mode": "reference", "pointId": "center" }, "radius": 10,
            "startAngleDeg": 0, "endAngleDeg": 90
        }),
    ];
    let once = evaluate_document_input(input(
        &elements,
        path_mutations(
            &elements,
            vec![json!({
                "statementId": "reverse:arc", "sourceOrder": 2, "targetElementId": "arc"
            })],
        ),
    ));
    assert!(geometry(&once, "arc")["start"]["x"].as_f64().unwrap().abs() < 1e-9);
    assert_eq!(geometry(&once, "arc")["start"]["y"], 10.0);
    assert_eq!(geometry(&once, "arc")["sweepAngleDeg"], -90.0);

    let twice = evaluate_document_input(input(
        &elements,
        path_mutations(
            &elements,
            vec![
                json!({ "statementId": "reverse:arc:1", "sourceOrder": 2, "targetElementId": "arc" }),
                json!({ "statementId": "reverse:arc:2", "sourceOrder": 3, "targetElementId": "arc" }),
            ],
        ),
    ));
    assert_eq!(geometry(&twice, "arc")["start"]["x"], 10.0);
    assert_eq!(geometry(&twice, "arc")["start"]["y"], 0.0);
    assert_eq!(geometry(&twice, "arc")["sweepAngleDeg"], 90.0);
}

#[test]
fn conditional_reverse_only_applies_for_the_selected_branch() {
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        line("ab", "a", "b"),
        json!({ "id": "if", "name": "if", "type": "conditionalGroup", "visible": true, "enabled": true, "condition": 0 }),
        point("after", 20.0, 0.0),
    ];
    let result = evaluate_document_input(input(
        &elements,
        path_mutations(
            &elements,
            vec![json!({
                "statementId": "reverse:then", "sourceOrder": 4, "targetElementId": "ab",
                "conditionalOwnerElementId": "if", "conditionalBranch": "then"
            })],
        ),
    ));
    assert!(result.errors.is_empty());
    assert_eq!(geometry(&result, "ab")["start"]["x"], 0.0);
    assert_eq!(geometry(&result, "ab")["end"]["x"], 10.0);

    let mut selected_elements = elements.clone();
    selected_elements[3]["condition"] = json!(1);
    let selected = evaluate_document_input(input(
        &selected_elements,
        path_mutations(
            &selected_elements,
            vec![json!({
                "statementId": "reverse:then", "sourceOrder": 4, "targetElementId": "ab",
                "conditionalOwnerElementId": "if", "conditionalBranch": "then"
            })],
        ),
    ));
    assert_eq!(geometry(&selected, "ab")["start"]["x"], 10.0);
    assert_eq!(geometry(&selected, "ab")["end"]["x"], 0.0);
}

#[test]
fn invalid_path_mutation_payload_is_rejected_at_the_command_boundary() {
    let elements = vec![point("a", 0.0, 0.0)];
    let error = evaluate_document(input(
        &elements,
        path_mutations(
            &elements,
            vec![json!({
                "statementId": "reverse:point", "sourceOrder": 1, "targetElementId": "a"
            })],
        ),
    ))
    .expect_err("point targets must be rejected before evaluation");
    assert_eq!(error.code, "path-mutation-invalid-target");
}

#[test]
fn reverse_bezier_reverses_segments_controls_and_endpoints() {
    let elements = vec![
        point("a", 0.0, 0.0),
        point("mid", 10.0, 10.0),
        point("b", 20.0, 0.0),
        json!({
            "id": "curve", "name": "curve", "type": "bezierCurve", "visible": true, "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" }, "startHandleAngleDeg": 0, "startHandleLength": 5,
            "intermediatePoints": [{ "id": "m", "point": { "mode": "reference", "pointId": "mid" }, "handleAngleDeg": 90, "incomingHandleLength": 4, "outgoingHandleLength": 4 }],
            "endPoint": { "mode": "reference", "pointId": "b" }, "endHandleAngleDeg": 180, "endHandleLength": 5
        }),
    ];
    let result = evaluate_document_input(input(
        &elements,
        path_mutations(
            &elements,
            vec![json!({
                "statementId": "reverse:curve", "sourceOrder": 4, "targetElementId": "curve"
            })],
        ),
    ));
    let curve = geometry(&result, "curve");
    assert_eq!(curve["startPointId"], "b");
    assert_eq!(curve["endPointId"], "a");
    assert_eq!(curve["segments"][0]["startPointId"], "b");
    assert_eq!(curve["segments"][1]["endPointId"], "a");
}
