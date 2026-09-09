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

fn boolean(value: bool) -> Value {
    json!({
        "kind": "booleanLiteral",
        "span": { "start": 0, "end": 1 },
        "value": value,
        "type": { "kind": "boolean" }
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

fn side_choice(value: &str) -> Value {
    json!({
        "kind": "choiceLiteral",
        "span": { "start": 0, "end": value.len() },
        "value": value,
        "type": { "kind": "choice", "options": ["right", "left"] }
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
fn polar_point_and_line_values_use_identity_free_geometry_and_defaults() {
    let point_occurrence = json!({
        "sourceStatementId": "value:polar-point",
        "instancePath": []
    });
    let default_point_occurrence = json!({
        "sourceStatementId": "value:polar-default-point",
        "instancePath": []
    });
    let line_occurrence = json!({
        "sourceStatementId": "value:polar-line",
        "instancePath": []
    });
    let point_target = json!({
        "kind": "geometryValue",
        "statementId": "value:polar-point",
        "statementIndex": 1,
        "geometryType": "point",
        "occurrence": point_occurrence.clone()
    });
    let program = vec![
        json!({
            "sourceStatementId": "value:polar-point",
            "sourceStatementIndex": 1,
            "declaredInterfaceType": "point",
            "occurrence": point_occurrence,
            "executionPosition": 1.0,
            "construction": {
                "kind": "polarPoint",
                "from": { "kind": "coordinate", "x": number(10.0), "y": number(20.0) },
                "angleDeg": number(90.0),
                "distance": number(20.0)
            }
        }),
        json!({
            "sourceStatementId": "value:polar-default-point",
            "sourceStatementIndex": 2,
            "declaredInterfaceType": "point",
            "occurrence": default_point_occurrence,
            "executionPosition": 2.0,
            "construction": {
                "kind": "polarPoint",
                "from": { "kind": "coordinate", "x": number(10.0), "y": number(20.0) },
                "angleDeg": number(0.0),
                "distance": number(0.0)
            }
        }),
        json!({
            "sourceStatementId": "value:polar-line",
            "sourceStatementIndex": 3,
            "declaredInterfaceType": "line",
            "occurrence": line_occurrence,
            "executionPosition": 3.0,
            "construction": {
                "kind": "polarLine",
                "start": { "kind": "target", "target": point_target },
                "angleDeg": number(30.0),
                "length": number(100.0)
            }
        }),
    ];

    let result = evaluate_document_input(input(Vec::new(), program));
    assert!(result.errors.is_empty());
    assert!(result.geometry_value_errors.is_empty());
    assert_eq!(result.computed_geometry.len(), 0);
    assert_eq!(result.computed_geometry_values.len(), 3);

    let point = &result.computed_geometry_values[0]["value"];
    assert_eq!(point["kind"], "point");
    assert!((point["x"].as_f64().unwrap() - 10.0).abs() < 1e-12);
    assert_eq!(point["y"], 40.0);
    assert!(point.get("elementId").is_none());
    assert!(point.get("name").is_none());

    let default_point = &result.computed_geometry_values[1]["value"];
    assert_eq!(
        default_point,
        &json!({ "kind": "point", "x": 10.0, "y": 20.0 })
    );

    let line = &result.computed_geometry_values[2]["value"];
    assert_eq!(line["kind"], "line");
    assert!((line["start"]["x"].as_f64().unwrap() - 10.0).abs() < 1e-12);
    assert_eq!(line["start"]["y"], 40.0);
    assert!(
        (line["end"]["x"].as_f64().unwrap() - (10.0 + 30_f64.to_radians().cos() * 100.0)).abs()
            < 1e-12
    );
    assert!(
        (line["end"]["y"].as_f64().unwrap() - (40.0 + 30_f64.to_radians().sin() * 100.0)).abs()
            < 1e-12
    );
    assert!((line["length"].as_f64().unwrap() - 100.0).abs() < 1e-12);
    assert!(line.get("elementId").is_none());
    assert!(line.get("name").is_none());
}

#[test]
fn offset_point_and_line_values_stay_identity_free_and_reuse_drawable_geometry() {
    let point_occurrence = json!({
        "sourceStatementId": "value:point",
        "instancePath": []
    });
    let path_occurrence = json!({
        "sourceStatementId": "value:path",
        "instancePath": []
    });
    let elements = vec![
        json!({
            "id": "drawable:point",
            "name": "P",
            "type": "freePoint",
            "activity": "visible",
            "x": 1,
            "y": 2
        }),
        json!({
            "id": "drawable:line",
            "name": "L",
            "type": "line",
            "activity": "visible",
            "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
            "endPoint": { "mode": "coordinate", "x": 10, "y": 0 }
        }),
    ];
    let program = vec![
        json!({
            "sourceStatementId": "value:point",
            "sourceStatementIndex": 2,
            "declaredInterfaceType": "point",
            "occurrence": point_occurrence,
            "executionPosition": 1.5,
            "construction": {
                "kind": "offsetPoint",
                "from": {
                    "kind": "target",
                    "target": { "kind": "drawable", "statementId": "drawable:point", "statementIndex": 0, "geometryType": "point" }
                },
                "dx": number(3.0),
                "dy": number(-4.0)
            }
        }),
        json!({
            "sourceStatementId": "value:path",
            "sourceStatementIndex": 3,
            "declaredInterfaceType": "path",
            "occurrence": path_occurrence,
            "executionPosition": 2.5,
            "construction": {
                "kind": "offsetPath",
                "sources": [{ "kind": "drawable", "statementId": "drawable:line", "statementIndex": 1, "geometryType": "line" }],
                "distance": number(2.0),
                "side": side_choice("right"),
                "closed": boolean(false),
                "suppressTrimWarnings": boolean(false)
            }
        }),
    ];

    let result = evaluate_document_input(input(elements, program));
    assert!(result.errors.is_empty());
    assert_eq!(result.computed_geometry.len(), 2);
    assert_eq!(result.computed_geometry_values.len(), 2);
    assert_eq!(
        result.computed_geometry_values[0]["value"],
        json!({ "kind": "point", "x": 4.0, "y": -2.0 })
    );
    let path = &result.computed_geometry_values[1]["value"];
    assert_eq!(path["kind"], "offsetLine");
    assert_eq!(path["start"], json!({ "x": 0.0, "y": -2.0 }));
    assert_eq!(path["end"], json!({ "x": 10.0, "y": -2.0 }));
    assert!(path.get("elementId").is_none());
    assert!(path.get("name").is_none());
    assert!(path["segments"][0].get("elementId").is_none());
    assert!(path["segments"][0]["start"].get("elementId").is_none());
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
fn through_value_shares_structural_arc_fields_with_drawable_three_point_arc() {
    let occurrence = json!({
        "sourceStatementId": "value:through",
        "instancePath": []
    });
    let drawable = json!({
        "id": "drawable:through",
        "name": "Arc",
        "type": "threePointArcLine",
        "activity": "visible",
        "point1": { "mode": "coordinate", "x": 10, "y": 0 },
        "point2": { "mode": "coordinate", "x": 0, "y": 10 },
        "point3": { "mode": "coordinate", "x": -10, "y": 0 },
        "startAngleDeg": 30,
        "endAngleDeg": 120
    });
    let program = json!({
        "sourceStatementId": "value:through",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "path",
        "occurrence": occurrence,
        "executionPosition": -0.5,
        "construction": {
            "kind": "through",
            "point1": { "kind": "coordinate", "x": number(10.0), "y": number(0.0) },
            "point2": { "kind": "coordinate", "x": number(0.0), "y": number(10.0) },
            "point3": { "kind": "coordinate", "x": number(-10.0), "y": number(0.0) },
            "startAngleDeg": number(30.0),
            "endAngleDeg": number(120.0)
        }
    });

    let result = evaluate_document_input(input(vec![drawable], vec![program]));

    assert!(result.errors.is_empty());
    assert_eq!(result.computed_geometry_values.len(), 1);
    let value = &result.computed_geometry_values[0]["value"];
    let drawable = &result.computed_geometry[0];
    for field in [
        "radius",
        "startAngleDeg",
        "endAngleDeg",
        "startTangentAngleDeg",
        "endTangentAngleDeg",
        "sweepAngleDeg",
        "length",
    ] {
        assert_eq!(
            drawable[field], value[field],
            "structural field {field} diverged"
        );
    }
    for field in ["center", "start", "end"] {
        assert_eq!(
            drawable[field]["x"], value[field]["x"],
            "structural field {field}.x diverged"
        );
        assert_eq!(
            drawable[field]["y"], value[field]["y"],
            "structural field {field}.y diverged"
        );
    }
    assert_eq!(drawable["elementId"], json!("drawable:through"));
    assert_eq!(drawable["name"], json!("Arc"));
    assert!(value.get("elementId").is_none());
    assert!(value.get("name").is_none());
}

#[test]
fn pure_polyline_values_preserve_open_closed_geometry_without_identity() {
    let open_occurrence = json!({
        "sourceStatementId": "value:polyline-open",
        "instancePath": []
    });
    let closed_occurrence = json!({
        "sourceStatementId": "value:polyline-closed",
        "instancePath": ["instance:one"]
    });
    let points = |closed: bool| {
        json!({
            "kind": "polyline",
            "points": [
                { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                { "kind": "coordinate", "x": number(3.0), "y": number(4.0) },
                { "kind": "coordinate", "x": number(3.0), "y": number(0.0) }
            ],
            "closed": boolean(closed)
        })
    };
    let program = vec![
        json!({
            "sourceStatementId": "value:polyline-open",
            "sourceStatementIndex": 0,
            "declaredInterfaceType": "path",
            "occurrence": open_occurrence,
            "executionPosition": 0.0,
            "construction": points(false)
        }),
        json!({
            "sourceStatementId": "value:polyline-closed",
            "sourceStatementIndex": 1,
            "declaredInterfaceType": "path",
            "occurrence": closed_occurrence,
            "executionPosition": 1.0,
            "construction": points(true)
        }),
    ];

    let result = evaluate_document_input(input(Vec::new(), program));

    assert!(result.errors.is_empty());
    assert!(result.geometry_value_errors.is_empty());
    assert_eq!(result.computed_geometry_values.len(), 2);
    let open = &result.computed_geometry_values[0]["value"];
    let closed = &result.computed_geometry_values[1]["value"];
    assert_eq!(open["kind"], "polyline");
    assert_eq!(open["closed"], false);
    assert_eq!(open["length"], 9.0);
    assert_eq!(open["segments"].as_array().map(Vec::len), Some(2));
    assert_eq!(open["end"], json!({ "x": 3.0, "y": 0.0 }));
    assert_eq!(closed["kind"], "polyline");
    assert_eq!(closed["closed"], true);
    assert_eq!(closed["length"], 12.0);
    assert_eq!(closed["segments"].as_array().map(Vec::len), Some(3));
    assert_eq!(closed["end"], json!({ "x": 0.0, "y": 0.0 }));
    assert!(open.get("elementId").is_none());
    assert!(open.get("name").is_none());
}

#[test]
fn invalid_pure_polyline_cardinality_uses_occurrence_owned_error() {
    let occurrence = json!({
        "sourceStatementId": "value:polyline-invalid",
        "instancePath": []
    });
    let program = vec![json!({
        "sourceStatementId": "value:polyline-invalid",
        "sourceStatementIndex": 0,
        "declaredInterfaceType": "path",
        "occurrence": occurrence,
        "executionPosition": 0.0,
        "construction": {
            "kind": "polyline",
            "points": [{ "kind": "coordinate", "x": number(0.0), "y": number(0.0) }],
            "closed": boolean(false)
        }
    })];

    let result = evaluate_document_input(input(Vec::new(), program));

    assert!(result.errors.is_empty());
    assert!(result.computed_geometry_values.is_empty());
    assert_eq!(result.geometry_value_errors.len(), 1);
    assert_eq!(
        result.geometry_value_errors[0].message,
        "Polyline geometry value construction requires at least 2 finite points."
    );
    assert!(!serde_json::to_string(&result.geometry_value_errors)
        .expect("geometry value errors serialize")
        .contains("elementId"));
}

#[test]
fn invalid_through_values_use_exact_occurrence_owned_errors_without_drawable_identity() {
    let program = [
        ("value:through-duplicate", Vec::<&str>::new(), 0.0, 0.0, 0.0, 0.0, 1.0, 1.0),
        ("value:through-collinear", vec!["instance:one"], 0.0, 0.0, 1.0, 1.0, 2.0, 2.0),
    ]
    .into_iter()
    .map(|(source_statement_id, instance_path, point1_x, point1_y, point2_x, point2_y, point3_x, point3_y)| {
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
                "kind": "through",
                "point1": { "kind": "coordinate", "x": number(point1_x), "y": number(point1_y) },
                "point2": { "kind": "coordinate", "x": number(point2_x), "y": number(point2_y) },
                "point3": { "kind": "coordinate", "x": number(point3_x), "y": number(point3_y) },
                "startAngleDeg": number(0.0),
                "endAngleDeg": number(90.0)
            }
        })
    })
    .collect();

    let result = evaluate_document_input(input(Vec::new(), program));

    assert!(result.errors.is_empty());
    assert!(result.computed_geometry_values.is_empty());
    assert_eq!(result.geometry_value_errors.len(), 2);
    assert_eq!(
        result.geometry_value_errors[0].occurrence,
        super::types::GeometryValueOccurrence {
            source_statement_id: "value:through-duplicate".to_owned(),
            instance_path: Vec::new()
        }
    );
    assert_eq!(
        result.geometry_value_errors[1].occurrence,
        super::types::GeometryValueOccurrence {
            source_statement_id: "value:through-collinear".to_owned(),
            instance_path: vec!["instance:one".to_owned()]
        }
    );
    assert!(result.geometry_value_errors.iter().all(|error| {
        error.message == "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。"
    }));
    let serialized = serde_json::to_value(&result).expect("EvaluationPayload must serialize");
    assert!(!serialized["geometryValueErrors"]
        .to_string()
        .contains("elementId"));
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

#[test]
fn pure_division_points_are_identity_free_and_feed_drawable_consumers() {
    let line_occurrence = json!({
        "sourceStatementId": "value:line",
        "instancePath": []
    });
    let between_ratio_occurrence = json!({
        "sourceStatementId": "value:between-ratio",
        "instancePath": []
    });
    let between_distance_occurrence = json!({
        "sourceStatementId": "value:between-distance",
        "instancePath": []
    });
    let on_line_ratio_occurrence = json!({
        "sourceStatementId": "value:on-line-ratio",
        "instancePath": []
    });
    let on_line_distance_occurrence = json!({
        "sourceStatementId": "value:on-line-distance",
        "instancePath": []
    });
    let line_target = json!({
        "kind": "geometryValue",
        "statementId": "value:line",
        "statementIndex": 0,
        "geometryType": "line",
        "occurrence": line_occurrence.clone()
    });
    let elements = vec![json!({
        "id": "drawable:consumer",
        "name": "Consumer",
        "type": "line",
        "activity": "visible",
        "startPoint": {
            "mode": "geometryValue",
            "occurrence": on_line_ratio_occurrence.clone()
        },
        "endPoint": {
            "mode": "geometryValue",
            "occurrence": between_distance_occurrence.clone()
        }
    })];
    let program = vec![
        json!({
            "sourceStatementId": "value:line",
            "sourceStatementIndex": 0,
            "declaredInterfaceType": "line",
            "occurrence": line_occurrence,
            "executionPosition": -5.0,
            "construction": {
                "kind": "segment",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(100.0), "y": number(0.0) }
            }
        }),
        json!({
            "sourceStatementId": "value:between-ratio",
            "sourceStatementIndex": 1,
            "declaredInterfaceType": "point",
            "occurrence": between_ratio_occurrence,
            "executionPosition": -4.0,
            "construction": {
                "kind": "between",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(100.0), "y": number(0.0) },
                "placement": { "kind": "ratio", "value": number(0.5) }
            }
        }),
        json!({
            "sourceStatementId": "value:between-distance",
            "sourceStatementIndex": 2,
            "declaredInterfaceType": "point",
            "occurrence": between_distance_occurrence,
            "executionPosition": -3.0,
            "construction": {
                "kind": "between",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(100.0), "y": number(0.0) },
                "placement": { "kind": "distance", "value": number(25.0) }
            }
        }),
        json!({
            "sourceStatementId": "value:on-line-ratio",
            "sourceStatementIndex": 3,
            "declaredInterfaceType": "point",
            "occurrence": on_line_ratio_occurrence,
            "executionPosition": -2.0,
            "construction": {
                "kind": "onLine",
                "line": { "kind": "target", "target": line_target.clone() },
                "endpointKey": "start",
                "placement": { "kind": "ratio", "value": number(0.5) }
            }
        }),
        json!({
            "sourceStatementId": "value:on-line-distance",
            "sourceStatementIndex": 4,
            "declaredInterfaceType": "point",
            "occurrence": on_line_distance_occurrence,
            "executionPosition": -1.0,
            "construction": {
                "kind": "onLine",
                "line": { "kind": "target", "target": line_target },
                "endpointKey": "end",
                "placement": { "kind": "distance", "value": number(25.0) }
            }
        }),
    ];
    let result = evaluate_document_input(input(elements, program));

    assert!(result.errors.is_empty());
    assert!(result.geometry_value_errors.is_empty());
    assert_eq!(result.computed_geometry.len(), 1);
    assert_eq!(result.computed_geometry_values.len(), 5);
    assert_eq!(result.computed_geometry[0]["start"]["x"], 50.0);
    assert_eq!(result.computed_geometry[0]["end"]["x"], 25.0);
    for entry in &result.computed_geometry_values {
        assert!(entry["value"].get("elementId").is_none());
        assert!(entry["value"].get("name").is_none());
    }
}

#[test]
fn pure_division_points_report_occurrence_owned_degenerate_errors() {
    let line_occurrence = json!({
        "sourceStatementId": "value:zero-line",
        "instancePath": []
    });
    let line_target = json!({
        "kind": "geometryValue",
        "statementId": "value:zero-line",
        "statementIndex": 0,
        "geometryType": "line",
        "occurrence": line_occurrence.clone()
    });
    let between_occurrence = json!({
        "sourceStatementId": "value:between-distance",
        "instancePath": ["instance:one"]
    });
    let on_line_occurrence = json!({
        "sourceStatementId": "value:on-line-distance",
        "instancePath": ["instance:one"]
    });
    let program = vec![
        json!({
            "sourceStatementId": "value:zero-line",
            "sourceStatementIndex": 0,
            "declaredInterfaceType": "line",
            "occurrence": line_occurrence,
            "executionPosition": -3.0,
            "construction": {
                "kind": "segment",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) }
            }
        }),
        json!({
            "sourceStatementId": "value:between-distance",
            "sourceStatementIndex": 1,
            "declaredInterfaceType": "point",
            "occurrence": between_occurrence,
            "executionPosition": -2.0,
            "construction": {
                "kind": "between",
                "start": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "end": { "kind": "coordinate", "x": number(0.0), "y": number(0.0) },
                "placement": { "kind": "distance", "value": number(1.0) }
            }
        }),
        json!({
            "sourceStatementId": "value:on-line-distance",
            "sourceStatementIndex": 2,
            "declaredInterfaceType": "point",
            "occurrence": on_line_occurrence,
            "executionPosition": -1.0,
            "construction": {
                "kind": "onLine",
                "line": { "kind": "target", "target": line_target },
                "endpointKey": "start",
                "placement": { "kind": "distance", "value": number(1.0) }
            }
        }),
    ];

    let result = evaluate_document_input(input(Vec::new(), program));

    assert!(result.errors.is_empty());
    assert_eq!(result.computed_geometry_values.len(), 1);
    assert_eq!(result.geometry_value_errors.len(), 2);
    assert_eq!(
        result.geometry_value_errors[0].message,
        "between construction cannot determine a distance direction because its endpoints coincide."
    );
    assert_eq!(
        result.geometry_value_errors[1].message,
        "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry."
    );
    assert_eq!(
        result.geometry_value_errors[0].occurrence.instance_path,
        vec!["instance:one"]
    );
    assert_eq!(
        result.geometry_value_errors[1].occurrence.instance_path,
        vec!["instance:one"]
    );
}
