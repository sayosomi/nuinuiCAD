use super::{evaluate_document_input, EvaluationInput, EvaluationPayload};
use serde_json::{json, Value};

fn input(elements: Vec<Value>, geometry_input_targets: Value) -> EvaluationInput {
    EvaluationInput {
        evaluation_order: None,
        geometry_input_targets: Some(geometry_input_targets),
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

fn input_with_geometry_value_program(
    elements: Vec<Value>,
    geometry_input_targets: Value,
    program: Vec<Value>,
) -> EvaluationInput {
    let mut input = input(elements, geometry_input_targets);
    input.geometry_value_program = Some(Value::Array(program));
    input
}

fn number(value: f64) -> Value {
    json!({
        "kind": "numberLiteral",
        "span": { "start": 0, "end": 1 },
        "value": value,
        "type": { "kind": "number" }
    })
}

fn point(id: &str, name: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "name": name,
        "type": "freePoint",
        "activity": "visible",
        "x": x,
        "y": y
    })
}

fn materialized_target(element_id: &str, source_id: &str, geometry_type: &str) -> Value {
    json!({
        "elementId": element_id,
        "parameters": [{
            "parameterKey": "source",
            "target": {
                "kind": "drawable",
                "elementId": source_id,
                "geometryType": geometry_type
            }
        }]
    })
}

fn materialized_point_target(element_id: &str, source: Value) -> Value {
    json!({
        "elementId": element_id,
        "parameters": [{
            "parameterKey": "source",
            "target": source
        }]
    })
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|value| value["elementId"] == json!(id))
        .expect("expected computed geometry")
}

#[test]
fn materialized_line_gets_a_distinct_identity_without_mutating_source() {
    let result = evaluate_document_input(input(
        vec![
            point("start", "始点", 0.0, 0.0),
            point("end", "終点", 10.0, 0.0),
            json!({
                "id": "source",
                "name": "元線",
                "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "start" },
                "endPoint": { "mode": "reference", "pointId": "end" }
            }),
            json!({
                "id": "copy",
                "name": "複製線",
                "type": "materializedLine",
                "activity": "visible"
            }),
        ],
        json!([materialized_target("copy", "source", "line")]),
    ));

    assert!(result.errors.is_empty());
    let source = geometry(&result, "source");
    let copy = geometry(&result, "copy");
    assert_eq!(source["elementId"], json!("source"));
    assert_eq!(source["name"], json!("元線"));
    assert_eq!(copy["elementId"], json!("copy"));
    assert_eq!(copy["name"], json!("複製線"));
    assert_eq!(copy["kind"], source["kind"]);
    assert_eq!(copy["start"]["x"], source["start"]["x"]);
    assert_eq!(copy["end"]["x"], source["end"]["x"]);
}

#[test]
fn materialized_path_preserves_an_arc_family() {
    let result = evaluate_document_input(input(
        vec![
            point("center", "中心", 0.0, 0.0),
            json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "activity": "visible",
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10.0,
                "startAngleDeg": 0.0,
                "endAngleDeg": 90.0
            }),
            json!({
                "id": "path-copy",
                "name": "円弧のパス",
                "type": "materializedPath",
                "activity": "visible"
            }),
        ],
        json!([materialized_target("path-copy", "arc", "path")]),
    ));

    assert!(result.errors.is_empty());
    let source = geometry(&result, "arc");
    let copy = geometry(&result, "path-copy");
    assert_eq!(source["kind"], json!("arcLine"));
    assert_eq!(copy["kind"], json!("arcLine"));
    assert_eq!(copy["elementId"], json!("path-copy"));
    assert_eq!(copy["radius"], source["radius"]);
}

#[test]
fn materialized_path_gets_geometry_value_identity_without_aliasing_the_value() {
    let occurrence = json!({
        "sourceStatementId": "value:line",
        "instancePath": []
    });
    let result = evaluate_document_input(input_with_geometry_value_program(
        vec![json!({
            "id": "path-copy",
            "name": "値のパス",
            "type": "materializedPath",
            "activity": "visible"
        })],
        json!([{
            "elementId": "path-copy",
            "parameters": [{
                "parameterKey": "source",
                "target": {
                    "kind": "geometryValue",
                    "geometryType": "path",
                    "occurrence": occurrence.clone()
                }
            }]
        }]),
        vec![json!({
            "sourceStatementId": "value:line",
            "sourceStatementIndex": 0,
            "declaredInterfaceType": "path",
            "occurrence": occurrence,
            "executionPosition": 0.0,
            "construction": {
                "kind": "segment",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(10.0), "y": number(0.0) }
            }
        })],
    ));

    assert!(result.errors.is_empty());
    assert_eq!(result.computed_geometry_values.len(), 1);
    let copy = geometry(&result, "path-copy");
    assert_eq!(copy["kind"], json!("line"));
    assert_eq!(copy["elementId"], json!("path-copy"));
    assert_eq!(copy["start"]["x"], json!(0.0));
    assert_eq!(copy["end"]["x"], json!(10.0));
    assert!(result.computed_geometry_values[0]["value"]
        .get("elementId")
        .is_none());
}

#[test]
fn materialized_drawable_endpoint_is_projected_to_an_independent_point() {
    let result = evaluate_document_input(input(
        vec![
            point("start", "始点", 2.0, 3.0),
            point("end", "終点", 12.0, 15.0),
            json!({
                "id": "source",
                "name": "元線",
                "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "start" },
                "endPoint": { "mode": "reference", "pointId": "end" }
            }),
            json!({
                "id": "copy",
                "name": "終点の複製",
                "type": "materializedPoint",
                "activity": "visible"
            }),
        ],
        json!([materialized_point_target(
            "copy",
            json!({
                "kind": "drawable",
                "elementId": "source",
                "geometryType": "line",
                "pointKey": "end"
            })
        )]),
    ));

    assert!(result.errors.is_empty());
    let source = geometry(&result, "source");
    let copy = geometry(&result, "copy");
    assert_eq!(source["kind"], json!("line"));
    assert_eq!(source["end"]["x"], json!(12.0));
    assert_eq!(copy["kind"], json!("point"));
    assert_eq!(copy["elementId"], json!("copy"));
    assert_eq!(copy["name"], json!("終点の複製"));
    assert_eq!(copy["x"], json!(12.0));
    assert_eq!(copy["y"], json!(15.0));
}

#[test]
fn materialized_geometry_value_endpoint_is_projected_before_value_materialization() {
    let occurrence = json!({
        "sourceStatementId": "value:line",
        "instancePath": []
    });
    let result = evaluate_document_input(input_with_geometry_value_program(
        vec![json!({
            "id": "point-copy",
            "name": "値の終点",
            "type": "materializedPoint",
            "activity": "visible"
        })],
        json!([materialized_point_target(
            "point-copy",
            json!({
                "kind": "geometryValue",
                "geometryType": "line",
                "pointKey": "end",
                "occurrence": occurrence.clone()
            })
        )]),
        vec![json!({
            "sourceStatementId": "value:line",
            "sourceStatementIndex": 0,
            "declaredInterfaceType": "line",
            "occurrence": occurrence,
            "executionPosition": 0.0,
            "construction": {
                "kind": "segment",
                "start": { "kind": "coordinate", "x": number(2.0), "y": number(3.0) },
                "end": { "kind": "coordinate", "x": number(32.0), "y": number(15.0) }
            }
        })],
    ));

    assert!(result.errors.is_empty());
    let value = &result.computed_geometry_values[0]["value"];
    assert_eq!(value["kind"], json!("line"));
    assert!(value.get("elementId").is_none());
    let copy = geometry(&result, "point-copy");
    assert_eq!(copy["kind"], json!("point"));
    assert_eq!(copy["elementId"], json!("point-copy"));
    assert_eq!(copy["x"], json!(32.0));
    assert_eq!(copy["y"], json!(15.0));
}
