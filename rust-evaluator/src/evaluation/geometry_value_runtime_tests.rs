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

fn choice(value: &str) -> Value {
    json!({
        "kind": "choiceLiteral",
        "span": { "start": 0, "end": value.len() },
        "value": value,
        "type": { "kind": "choice", "options": ["counterclockwise", "clockwise"] }
    })
}

#[test]
fn incompatible_geometry_value_constructions_emit_occurrence_owned_errors() {
    let coordinate_occurrence = json!({
        "sourceStatementId": "value:point",
        "instancePath": ["instance:one"]
    });
    let segment_occurrence = json!({
        "sourceStatementId": "value:line",
        "instancePath": ["instance:two", "instance:nested"]
    });
    let program = vec![
        json!({
            "sourceStatementId": "value:point",
            "sourceStatementIndex": 1,
            "declaredInterfaceType": "line",
            "occurrence": coordinate_occurrence,
            "executionPosition": 1.0,
            "construction": {
                "kind": "coordinate",
                "x": number(1.0),
                "y": number(2.0)
            }
        }),
        json!({
            "sourceStatementId": "value:line",
            "sourceStatementIndex": 2,
            "declaredInterfaceType": "point",
            "occurrence": segment_occurrence,
            "executionPosition": 2.0,
            "construction": {
                "kind": "segment",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(10.0), "y": number(0.0) }
            }
        }),
    ];

    let result = evaluate_document_input(input(Vec::new(), program));

    assert!(result.errors.is_empty());
    assert!(result.computed_geometry_values.is_empty());
    assert_eq!(result.geometry_value_errors.len(), 2);
    assert_eq!(
        result.geometry_value_errors[0]
            .occurrence
            .source_statement_id,
        "value:point"
    );
    assert_eq!(
        result.geometry_value_errors[0].occurrence.instance_path,
        vec!["instance:one"]
    );
    assert_eq!(
        result.geometry_value_errors[1]
            .occurrence
            .source_statement_id,
        "value:line"
    );
    assert_eq!(
        result.geometry_value_errors[1].occurrence.instance_path,
        vec!["instance:two", "instance:nested"]
    );
    assert_eq!(
        result.geometry_value_errors[0].message,
        "Geometry value construction is incompatible with its declared interface type."
    );

    let serialized = serde_json::to_value(&result).expect("EvaluationPayload must serialize");
    assert_eq!(
        serialized["geometryValueErrors"],
        json!([
            {
                "occurrence": {
                    "sourceStatementId": "value:point",
                    "instancePath": ["instance:one"]
                },
                "message": "Geometry value construction is incompatible with its declared interface type."
            },
            {
                "occurrence": {
                    "sourceStatementId": "value:line",
                    "instancePath": ["instance:two", "instance:nested"]
                },
                "message": "Geometry value construction is incompatible with its declared interface type."
            }
        ])
    );
}

#[test]
fn empty_geometry_value_error_channel_is_omitted_from_payload() {
    let result = evaluate_document_input(input(Vec::new(), Vec::new()));
    let serialized = serde_json::to_value(&result).expect("EvaluationPayload must serialize");
    assert!(serialized.get("geometryValueErrors").is_none());
}

fn input(elements: Vec<Value>, program: Vec<Value>) -> EvaluationInput {
    EvaluationInput {
        geometry_input_targets: None,
        elements,
        evaluation_limit_index: None,
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

#[test]
fn drawable_free_point_and_immutable_coordinate_share_the_coordinate_kernel() {
    let occurrence = json!({
        "sourceStatementId": "value:p",
        "instancePath": []
    });
    let drawable = json!({
        "id": "drawable:point",
        "name": "P",
        "type": "freePoint",
        "activity": "visible",
        "x": 10,
        "y": 20
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

    let result = evaluate_document_input(input(vec![drawable], vec![program]));
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry[0]["x"], 10.0);
    assert_eq!(result.computed_geometry[0]["y"], 20.0);
    assert_eq!(result.computed_geometry_values[0]["value"]["x"], 10.0);
    assert_eq!(result.computed_geometry_values[0]["value"]["y"], 20.0);
    assert!(result.computed_geometry_values[0]["value"]
        .get("elementId")
        .is_none());
}

#[test]
fn drawable_and_value_segments_share_the_same_structural_numeric_fields() {
    let occurrence = json!({
        "sourceStatementId": "value:line",
        "instancePath": []
    });
    let element = json!({
        "id": "drawable:line",
        "name": "L",
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
        "endPoint": { "mode": "coordinate", "x": 3, "y": 4 }
    });
    let program = json!({
        "sourceStatementId": "value:line",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "line",
        "occurrence": occurrence,
        "executionPosition": -0.5,
        "construction": {
            "kind": "segment",
            "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
            "end": { "kind": "coordinate", "x": number(3.0), "y": number(4.0) }
        }
    });

    let result = evaluate_document_input(input(vec![element], vec![program]));
    assert!(result.errors.is_empty());
    let drawable = &result.computed_geometry[0];
    let value = &result.computed_geometry_values[0]["value"];
    for field in ["length", "startAngleDeg", "endAngleDeg"] {
        assert_eq!(
            drawable[field], value[field],
            "structural field {field} diverged"
        );
    }
    for field in ["start", "end"] {
        assert_eq!(
            drawable[field]["x"], value[field]["x"],
            "structural field {field}.x diverged"
        );
        assert_eq!(
            drawable[field]["y"], value[field]["y"],
            "structural field {field}.y diverged"
        );
    }
    assert_eq!(drawable["start"]["elementId"], json!("drawable:line:start"));
    assert!(value["start"].get("elementId").is_none());
}

#[test]
fn direct_arc_value_uses_identity_free_arc_geometry_and_feeds_endpoint_anchor() {
    let occurrence = json!({
        "sourceStatementId": "value:arc",
        "instancePath": []
    });
    let element = json!({
        "id": "drawable:line",
        "name": "L",
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "geometryValue", "occurrence": occurrence.clone(), "pointKey": "start" },
        "endPoint": { "mode": "coordinate", "x": 0, "y": 10 }
    });
    let program = json!({
        "sourceStatementId": "value:arc",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "path",
        "occurrence": occurrence,
        "executionPosition": -0.5,
        "construction": {
            "kind": "arc",
            "center": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
            "radius": number(10.0),
            "startAngleDeg": number(0.0),
            "endAngleDeg": number(90.0),
            "direction": choice("counterclockwise")
        }
    });

    let result = evaluate_document_input(input(vec![element], vec![program]));
    assert!(result.errors.is_empty());
    let value = &result.computed_geometry_values[0]["value"];
    assert_eq!(value["kind"], "arcLine");
    assert_eq!(value["center"], json!({ "x": 0.0, "y": 0.0 }));
    assert_eq!(value["start"], json!({ "x": 10.0, "y": 0.0 }));
    assert_eq!(value["radius"], 10.0);
    assert_eq!(value["sweepAngleDeg"], 90.0);
    assert!(value.get("elementId").is_none());
    assert!(value.get("name").is_none());
    assert!(value.get("centerPointId").is_none());
    assert_eq!(result.computed_geometry[0]["start"]["x"], 10.0);
    assert_eq!(result.computed_geometry[0]["start"]["y"], 0.0);
}

#[test]
fn invalid_direct_arc_radius_uses_occurrence_owned_errors_without_computed_values() {
    let program = [
        ("value:arc-zero", Vec::<&str>::new(), 0.0),
        ("value:arc-negative", vec!["instance:one"], -5.0),
    ]
    .into_iter()
    .map(|(source_statement_id, instance_path, radius)| {
        json!({
            "sourceStatementId": source_statement_id,
            "sourceStatementIndex": 0,
            "declaredInterfaceType": "path",
            "occurrence": {
                "sourceStatementId": source_statement_id,
                "instancePath": instance_path
            },
            "executionPosition": 0.0,
            "construction": {
                "kind": "arc",
                "center": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "radius": number(radius),
                "startAngleDeg": number(0.0),
                "endAngleDeg": number(90.0),
                "direction": choice("counterclockwise")
            }
        })
    })
    .collect();

    let result = evaluate_document_input(input(Vec::new(), program));

    assert!(result.errors.is_empty());
    assert!(result.computed_geometry_values.is_empty());
    assert_eq!(result.geometry_value_errors.len(), 2);
    assert_eq!(
        result.geometry_value_errors[0]
            .occurrence
            .source_statement_id,
        "value:arc-zero"
    );
    assert!(result.geometry_value_errors[0]
        .occurrence
        .instance_path
        .is_empty());
    assert_eq!(
        result.geometry_value_errors[1]
            .occurrence
            .source_statement_id,
        "value:arc-negative"
    );
    assert_eq!(
        result.geometry_value_errors[1].occurrence.instance_path,
        vec!["instance:one"]
    );
    assert!(result
        .geometry_value_errors
        .iter()
        .all(|error| error.message == "円弧の半径は0より大きい値で指定してください。"));

    let serialized = serde_json::to_value(&result).expect("EvaluationPayload must serialize");
    assert_eq!(
        serialized["geometryValueErrors"][1],
        json!({
            "occurrence": {
                "sourceStatementId": "value:arc-negative",
                "instancePath": ["instance:one"]
            },
            "message": "円弧の半径は0より大きい値で指定してください。"
        })
    );
    assert!(!serialized["geometryValueErrors"]
        .to_string()
        .contains("elementId"));
}

#[test]
fn discriminated_geometry_value_target_reaches_a_read_only_intersection_consumer() {
    let occurrence = json!({
        "sourceStatementId": "value:line",
        "instancePath": []
    });
    let drawable_line = json!({
        "id": "vertical",
        "name": "vertical",
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "coordinate", "x": 5, "y": -5 },
        "endPoint": { "mode": "coordinate", "x": 5, "y": 5 }
    });
    let intersection = json!({
        "id": "hit",
        "name": "hit",
        "type": "intersectionPoint",
        "activity": "visible",
        "line1Id": "missing-authored-id",
        "line2Id": "vertical",
        "intersectionIndex": 0,
        "useExtensions": false
    });
    let program = json!({
        "sourceStatementId": "value:line",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "line",
        "occurrence": occurrence,
        "executionPosition": -0.5,
        "construction": {
            "kind": "segment",
            "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
            "end": { "kind": "coordinate", "x": number(10.0), "y": number(0.0) }
        }
    });
    let mut evaluation_input = input(vec![drawable_line, intersection], vec![program]);
    evaluation_input.geometry_input_targets = Some(json!([
        {
            "elementId": "hit",
            "parameters": [
                {
                    "parameterKey": "line1Id",
                    "target": {
                        "kind": "geometryValue",
                        "occurrence": occurrence,
                        "geometryType": "line"
                    }
                }
            ]
        }
    ]));

    let result = evaluate_document_input(evaluation_input);
    assert!(result.errors.is_empty());
    assert_eq!(result.computed_geometry[1]["x"], 5.0);
    assert_eq!(result.computed_geometry[1]["y"], 0.0);
}

#[test]
fn module_runtime_position_allows_geometry_property_read_after_backing_drawable() {
    let source = json!({
        "id": "source",
        "name": "source",
        "type": "freePoint",
        "activity": "visible",
        "x": 0,
        "y": 42
    });
    let property = json!({
        "kind": "geometryProperty",
        "span": { "start": 0, "end": 1 },
        "elementNameSpan": { "start": 0, "end": 1 },
        "propertySpan": { "start": 0, "end": 1 },
        "elementName": "source",
        "elementId": "source",
        "property": "y",
        "targetSourceOrder": 3.0,
        "type": { "kind": "number" }
    });
    let program = json!({
        "sourceStatementId": "value:module-point",
        "sourceStatementIndex": 1,
        "declaredInterfaceType": "point",
        "occurrence": { "sourceStatementId": "value:module-point", "instancePath": ["instance"] },
        "executionPosition": 4.5,
        "construction": { "kind": "coordinate", "x": number(0.0), "y": property }
    });
    let elements = vec![
        json!({ "id": "earlier-0", "name": "earlier-0", "type": "freePoint", "activity": "visible", "x": 0, "y": 0 }),
        json!({ "id": "earlier-1", "name": "earlier-1", "type": "freePoint", "activity": "visible", "x": 0, "y": 0 }),
        json!({ "id": "earlier-2", "name": "earlier-2", "type": "freePoint", "activity": "visible", "x": 0, "y": 0 }),
        source,
    ];
    let result = evaluate_document_input(input(elements, vec![program]));

    assert!(result.errors.is_empty());
    assert_eq!(
        result.computed_geometry_values[0]["value"],
        json!({ "kind": "point", "x": 0.0, "y": 42.0 })
    );
}
