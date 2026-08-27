//! End-to-end coverage for Task 23, through the full `evaluate_document_input`
//! pipeline (hand-built JSON fixtures, mirroring
//! `scalar_program_integration_tests.rs`'s style). Focused unit coverage for
//! the payload decoder itself lives in
//! `scalars/property_binding_payload_tests.rs`; these tests exercise the
//! whole materialize-then-evaluate path against real element evaluators.

use super::scalar_expression_runtime::lookup_geometry_property;
use super::scalars::{ScalarEvaluation, ScalarType};
use super::types::EvaluationState;
use super::*;
use serde_json::{json, Value};
use std::collections::HashMap;

fn input(
    elements: Vec<Value>,
    scalar_program: Option<Value>,
    property_bindings: Option<Value>,
) -> EvaluationInput {
    EvaluationInput {
        module_materialization: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program,
        binding_versions: None,
        property_bindings,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn boolean_literal(value: bool) -> Value {
    json!({ "kind": "booleanLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "boolean"} })
}

fn choice_literal(value: &str, options: &[&str]) -> Value {
    json!({ "kind": "choiceLiteral", "span": {"start": 0, "end": 1}, "value": value, "type": {"kind": "choice", "options": options} })
}

fn reference(binding_id: &str, scalar_type: Value) -> Value {
    json!({ "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1}, "name": binding_id, "bindingId": binding_id, "type": scalar_type })
}

fn statement(
    binding_id: &str,
    source_order: usize,
    binding_kind: &str,
    declared_type: Value,
    initializer: Value,
) -> Value {
    json!({
        "kind": "declare",
        "bindingId": binding_id,
        "scopeId": "root",
        "sourceOrder": source_order,
        "declaration": {"bindingKind": binding_kind, "declaredType": declared_type, "initializer": initializer}
    })
}

fn program(statements: Vec<Value>) -> Value {
    json!({ "statements": statements })
}

fn property_binding(
    element_id: &str,
    parameter_key: &str,
    binding_id: &str,
    expected_type: Value,
) -> Value {
    json!({ "elementId": element_id, "parameterKey": parameter_key, "bindingId": binding_id, "expectedType": expected_type })
}

fn point(id: &str, x: f64, y: f64) -> Value {
    json!({ "id": id, "name": id, "type": "freePoint", "activity": "visible", "x": x, "y": y })
}

fn line(id: &str, start: &str, end: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "line", "activity": "visible",
        "startPoint": {"mode": "reference", "pointId": start},
        "endPoint": {"mode": "reference", "pointId": end}
    })
}

fn arc(id: &str, start_angle_deg: f64, end_angle_deg: f64, direction: Option<&str>) -> Value {
    let mut element = json!({
        "id": id, "name": id, "type": "arcLine", "activity": "visible",
        "centerPoint": {"mode": "coordinate", "x": 0, "y": 0},
        "radius": 10, "startAngleDeg": start_angle_deg, "endAngleDeg": end_angle_deg
    });
    if let Some(direction) = direction {
        element["direction"] = json!(direction);
    }
    element
}

fn state_with_element(id: &str, element: Value) -> EvaluationState {
    EvaluationState {
        elements: vec![element],
        elements_by_id: HashMap::from([(id.to_owned(), 0)]),
        drawing_modifiers: json!([]),
        selected_drawing_profile_id: None,
        group_states: HashMap::new(),
        computed_geometry: HashMap::new(),
        computed_geometry_order: Vec::new(),
        pre_mutation_geometry: HashMap::new(),
        geometry_mutation_executions: Vec::new(),
        condition_evaluation_traces: Vec::new(),
        instance_base_geometry: HashMap::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn geometry_direction_expression(
    element_id: &str,
    target_source_order: usize,
    options: &[&str],
) -> Value {
    json!({
        "kind": "geometryProperty",
        "span": {"start": 0, "end": 1},
        "elementNameSpan": {"start": 0, "end": 1},
        "propertySpan": {"start": 0, "end": 1},
        "elementName": element_id,
        "elementId": element_id,
        "property": "direction",
        "targetSourceOrder": target_source_order,
        "type": {"kind": "choice", "options": options}
    })
}

fn expression_property_binding(
    element_id: &str,
    parameter_key: &str,
    expression: Value,
    expected_type: Value,
) -> Value {
    json!({
        "elementId": element_id,
        "parameterKey": parameter_key,
        "expression": expression,
        "expectedType": expected_type
    })
}

fn geometry_length_positive_expression(element_id: &str, target_source_order: usize) -> Value {
    json!({
        "kind": "binary",
        "span": {"start": 0, "end": 16},
        "operator": ">",
        "left": {
            "kind": "geometryProperty",
            "span": {"start": 0, "end": 11},
            "elementNameSpan": {"start": 1, "end": 3},
            "propertySpan": {"start": 4, "end": 10},
            "elementName": "ab",
            "elementId": element_id,
            "property": "length",
            "targetSourceOrder": target_source_order,
            "type": {"kind": "number"}
        },
        "right": {"kind": "numberLiteral", "span": {"start": 14, "end": 15}, "value": 0, "type": {"kind": "number"}},
        "type": {"kind": "boolean"}
    })
}

fn offset_line(id: &str, base_line_id: &str, side: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "offsetLine", "activity": "visible",
        "baseLineIds": [base_line_id], "offset": 5, "side": side, "closed": false, "suppressTrimWarnings": false
    })
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> Option<&'a Value> {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
}

const CHOICE_RIGHT_LEFT: [&str; 2] = ["right", "left"];

#[test]
fn evaluates_a_resolved_geometry_property_expression_on_a_common_property() {
    let result = evaluate_document_input(input(
        vec![
            point("a", 0.0, 0.0),
            point("b", 10.0, 0.0),
            line("ab", "a", "b"),
            offset_line("off", "ab", "right"),
        ],
        Some(program(vec![])),
        Some(json!([{
            "elementId": "off",
            "parameterKey": "closed",
            "expression": geometry_length_positive_expression("ab", 2),
            "expectedType": {"kind": "boolean"}
        }])),
    ));

    assert!(result.errors.is_empty());
    assert!(geometry(&result, "off").is_some());
}

#[test]
fn offset_line_side_bound_to_a_choice_binding_flips_the_offset_direction() {
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        line("ab", "a", "b"),
        offset_line("off", "ab", "right"),
    ];
    let scalar_program = program(vec![statement(
        "binding:dir",
        0,
        "const",
        json!({"kind": "choice", "options": CHOICE_RIGHT_LEFT}),
        choice_literal("left", &CHOICE_RIGHT_LEFT),
    )]);
    let property_bindings = json!([property_binding(
        "off",
        "side",
        "binding:dir",
        json!({"kind": "choice", "options": CHOICE_RIGHT_LEFT})
    )]);

    let bound = evaluate_document_input(input(
        elements.clone(),
        Some(scalar_program),
        Some(property_bindings),
    ));
    let literal_left = evaluate_document_input(input(
        vec![
            point("a", 0.0, 0.0),
            point("b", 10.0, 0.0),
            line("ab", "a", "b"),
            offset_line("off", "ab", "left"),
        ],
        None,
        None,
    ));
    let literal_right = evaluate_document_input(input(elements, None, None));

    assert!(bound.errors.is_empty());
    let bound_geometry = geometry(&bound, "off").expect("bound offset must be computed");
    assert_eq!(bound_geometry, geometry(&literal_left, "off").unwrap());
    assert_ne!(bound_geometry, geometry(&literal_right, "off").unwrap());
}

#[test]
fn geometry_property_choice_runtime_preserves_type_options_and_value() {
    let options = ["counterclockwise", "clockwise"];
    let result = evaluate_document_input(input(
        vec![arc("source", 0.0, 90.0, None)],
        Some(program(vec![statement(
            "binding:direction",
            1,
            "const",
            json!({"kind": "choice", "options": options}),
            geometry_direction_expression("source", 0, &options),
        )])),
        None,
    ));

    let evaluation = &result
        .computed_scalar_bindings
        .expect("scalar program output")[0]["evaluation"];
    assert_eq!(evaluation["status"], json!("ok"));
    assert_eq!(
        evaluation["type"],
        json!({"kind": "choice", "options": options})
    );
    assert_eq!(
        evaluation["value"],
        json!({
            "kind": "choice",
            "value": "counterclockwise",
            "options": options
        })
    );
}

#[test]
fn choice_geometry_property_requires_current_geometry_even_without_source_order() {
    let options = vec!["counterclockwise".to_owned(), "clockwise".to_owned()];
    let state = state_with_element("source", arc("source", 0.0, 90.0, None));
    let property_type = ScalarType::Choice {
        options: options.clone(),
    };

    assert_eq!(
        lookup_geometry_property(&state, "source", "direction", 0, None, &property_type,),
        ScalarEvaluation::Error {
            r#type: property_type,
            issue_code: "evaluation-geometry-property-unavailable".to_owned(),
            binding_id: None,
            context: None,
        }
    );
}

#[test]
fn choice_geometry_property_cannot_leak_disabled_or_failed_targets_but_hidden_targets_remain_readable(
) {
    let options = ["counterclockwise", "clockwise"];
    let property_type = json!({"kind": "choice", "options": options});
    let read = |element: Value| {
        let element_id = element["id"].as_str().unwrap().to_owned();
        let result = evaluate_document_input(input(
            vec![element],
            Some(program(vec![statement(
                "binding:direction",
                1,
                "const",
                property_type.clone(),
                geometry_direction_expression(&element_id, 0, &options),
            )])),
            None,
        ));
        result
            .computed_scalar_bindings
            .expect("scalar program output")[0]["evaluation"]
            .clone()
    };

    let mut disabled = arc("disabled", 0.0, 90.0, None);
    disabled["activity"] = json!("disabled");
    let disabled_evaluation = read(disabled);
    assert_eq!(disabled_evaluation["status"], json!("error"));
    assert_eq!(disabled_evaluation["type"], property_type);
    assert_eq!(
        disabled_evaluation["issueCode"],
        json!("evaluation-geometry-property-unavailable")
    );

    let mut failed = arc("failed", 0.0, 90.0, None);
    failed.as_object_mut().unwrap().remove("centerPoint");
    let failed_evaluation = read(failed);
    assert_eq!(failed_evaluation["status"], json!("error"));
    assert_eq!(failed_evaluation["type"], property_type);
    assert_eq!(
        failed_evaluation["issueCode"],
        json!("evaluation-geometry-property-unavailable")
    );

    let mut hidden = arc("hidden", 0.0, 90.0, None);
    hidden["activity"] = json!("hidden");
    let hidden_evaluation = read(hidden);
    assert_eq!(hidden_evaluation["status"], json!("ok"));
    assert_eq!(hidden_evaluation["type"], property_type);
    assert_eq!(
        hidden_evaluation["value"],
        json!({
            "kind": "choice",
            "value": "counterclockwise",
            "options": options
        })
    );
}

#[test]
fn geometry_property_choice_runtime_fails_closed_with_concrete_type_for_invalid_and_too_late_reads()
{
    let invalid_options = ["clockwise"];
    let invalid = evaluate_document_input(input(
        vec![arc("source", 0.0, 90.0, None)],
        Some(program(vec![statement(
            "binding:invalid",
            1,
            "const",
            json!({"kind": "choice", "options": invalid_options}),
            geometry_direction_expression("source", 0, &invalid_options),
        )])),
        None,
    ));
    let invalid_evaluation = &invalid
        .computed_scalar_bindings
        .expect("scalar program output")[0]["evaluation"];
    assert_eq!(invalid_evaluation["status"], json!("error"));
    assert_eq!(
        invalid_evaluation["type"],
        json!({"kind": "choice", "options": invalid_options})
    );
    assert_eq!(
        invalid_evaluation["issueCode"],
        json!("evaluation-geometry-property-unavailable")
    );

    let too_late_options = ["counterclockwise", "clockwise"];
    let too_late = evaluate_document_input(input(
        vec![arc("source", 0.0, 90.0, None)],
        Some(program(vec![statement(
            "binding:too-late",
            1,
            "const",
            json!({"kind": "choice", "options": too_late_options}),
            geometry_direction_expression("source", 1, &too_late_options),
        )])),
        None,
    ));
    let too_late_evaluation = &too_late
        .computed_scalar_bindings
        .expect("scalar program output")[0]["evaluation"];
    assert_eq!(too_late_evaluation["status"], json!("error"));
    assert_eq!(
        too_late_evaluation["type"],
        json!({"kind": "choice", "options": too_late_options})
    );
    assert_eq!(
        too_late_evaluation["issueCode"],
        json!("evaluation-geometry-property-unavailable")
    );
}

#[test]
fn arc_direction_choice_runtime_matches_sweep_sign_zero_fallback_and_reverse_order() {
    let options = ["counterclockwise", "clockwise"];
    let direction_type = json!({"kind": "choice", "options": options});
    let target = |id: &str, expression: Value| {
        expression_property_binding(id, "direction", expression, direction_type.clone())
    };
    let target_arc = |id: &str| arc(id, 0.0, 90.0, None);

    let positive = evaluate_document_input(input(
        vec![arc("source", 0.0, 90.0, None), target_arc("target")],
        Some(program(vec![])),
        Some(json!([target(
            "target",
            geometry_direction_expression("source", 0, &options)
        )])),
    ));
    assert!(positive.errors.is_empty());
    assert_eq!(
        geometry(&positive, "target").unwrap()["sweepAngleDeg"],
        json!(90.0)
    );

    let negative = evaluate_document_input(input(
        vec![
            arc("source", 0.0, 90.0, Some("clockwise")),
            target_arc("target"),
        ],
        Some(program(vec![])),
        Some(json!([target(
            "target",
            geometry_direction_expression("source", 0, &options)
        )])),
    ));
    assert!(negative.errors.is_empty());
    assert_eq!(
        geometry(&negative, "target").unwrap()["sweepAngleDeg"],
        json!(-270.0)
    );

    for direction in ["counterclockwise", "clockwise"] {
        let source_direction = choice_literal(direction, &options);
        let zero_effective = evaluate_document_input(input(
            vec![arc("source", 0.0, 0.0, None), target_arc("target")],
            Some(program(vec![])),
            Some(json!([
                expression_property_binding(
                    "source",
                    "direction",
                    source_direction,
                    direction_type.clone()
                ),
                target(
                    "target",
                    geometry_direction_expression("source", 0, &options)
                )
            ])),
        ));
        assert!(zero_effective.errors.is_empty());
        let expected_sweep = if direction == "clockwise" {
            -270.0
        } else {
            90.0
        };
        assert_eq!(
            geometry(&zero_effective, "target").unwrap()["sweepAngleDeg"],
            json!(expected_sweep)
        );
    }

    let reverse_before = evaluate_document_input(input(
        vec![
            arc("source", 0.0, 90.0, None),
            json!({"id": "reverse", "name": "", "type": "pathReverse", "activity": "visible", "targetLineId": "source"}),
            target_arc("target"),
        ],
        Some(program(vec![])),
        Some(json!([target(
            "target",
            geometry_direction_expression("source", 0, &options)
        )])),
    ));
    assert!(reverse_before.errors.is_empty());
    assert_eq!(
        geometry(&reverse_before, "target").unwrap()["sweepAngleDeg"],
        json!(-270.0)
    );

    let reverse_after = evaluate_document_input(input(
        vec![
            arc("source", 0.0, 90.0, None),
            target_arc("target"),
            json!({"id": "reverse", "name": "", "type": "pathReverse", "activity": "visible", "targetLineId": "source"}),
        ],
        Some(program(vec![])),
        Some(json!([target(
            "target",
            geometry_direction_expression("source", 0, &options)
        )])),
    ));
    assert!(reverse_after.errors.is_empty());
    assert_eq!(
        geometry(&reverse_after, "target").unwrap()["sweepAngleDeg"],
        json!(90.0)
    );
}

#[test]
fn fails_closed_when_the_bound_binding_is_poisoned() {
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        line("ab", "a", "b"),
        offset_line("off", "ab", "right"),
    ];
    // References a legacy-var binding id with no matching "variable" element
    // anywhere in the document - resolution fails closed with
    // "evaluation-binding-unavailable", exactly like a disabled
    // legacy var would (scalar_program_integration_tests.rs's own poison
    // fixture uses the same mechanism).
    let scalar_program = program(vec![statement(
        "binding:closed-flag",
        0,
        "let",
        json!({"kind": "boolean"}),
        reference("binding:no-such-legacy-var", json!({"kind": "boolean"})),
    )]);
    let property_bindings = json!([property_binding(
        "off",
        "closed",
        "binding:closed-flag",
        json!({"kind": "boolean"})
    )]);

    let result = evaluate_document_input(input(
        elements,
        Some(scalar_program),
        Some(property_bindings),
    ));

    assert!(geometry(&result, "off").is_none());
    assert!(result.errors.iter().any(|error| error.element_id == "off"));
}

#[test]
fn fails_closed_on_a_runtime_type_mismatch_even_though_the_payloads_own_expected_type_was_valid() {
    // The payload's expectedType (boolean, for offsetLine.closed) is supplied
    // by the compiled frontend - but the binding it points to is
    // declared (and evaluates as) a *choice*, not boolean. Rust must catch
    // this live, not just trust that TS always pairs bindings/properties
    // consistently.
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        line("ab", "a", "b"),
        offset_line("off", "ab", "right"),
    ];
    let scalar_program = program(vec![statement(
        "binding:mismatched",
        0,
        "const",
        json!({"kind": "choice", "options": CHOICE_RIGHT_LEFT}),
        choice_literal("right", &CHOICE_RIGHT_LEFT),
    )]);
    let property_bindings = json!([property_binding(
        "off",
        "closed",
        "binding:mismatched",
        json!({"kind": "boolean"})
    )]);

    let result = evaluate_document_input(input(
        elements,
        Some(scalar_program),
        Some(property_bindings),
    ));

    assert!(geometry(&result, "off").is_none());
    assert!(result.errors.iter().any(|error| error.element_id == "off"));
}

#[test]
fn fails_closed_when_the_resolved_choice_value_is_not_one_of_the_propertys_own_options() {
    // Same idea as above, for the choice-membership check specifically: the
    // binding's own declared choice type is wider than the compiled
    // property's options (a D07 violation TS's compile-time check would
    // normally prevent) - Rust must still catch it live.
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        line("ab", "a", "b"),
        offset_line("off", "ab", "right"),
    ];
    let wide_options = ["right", "left", "center"];
    let scalar_program = program(vec![statement(
        "binding:wide",
        0,
        "const",
        json!({"kind": "choice", "options": wide_options}),
        choice_literal("center", &wide_options),
    )]);
    let property_bindings = json!([property_binding(
        "off",
        "side",
        "binding:wide",
        json!({"kind": "choice", "options": CHOICE_RIGHT_LEFT})
    )]);

    let result = evaluate_document_input(input(
        elements,
        Some(scalar_program),
        Some(property_bindings),
    ));

    assert!(geometry(&result, "off").is_none());
    assert!(result.errors.iter().any(|error| error.element_id == "off"));
}

#[test]
fn materializes_a_bound_boolean_property_uniformly_across_every_forgroup_generated_instance() {
    let for_group_body = |mirror_x: Value| {
        vec![
            point("a", 0.0, 0.0),
            point("b", 10.0, 0.0),
            line("ab", "a", "b"),
            json!({
                "id": "for", "name": "for", "type": "forGroup", "activity": "visible",
                "variableName": "i", "start": 0, "count": 3, "step": 1
            }),
            json!({
                "id": "copy", "name": "copy", "type": "copyLine", "activity": "visible",
                "parentGroupId": "for",
                "startPoint": {"mode": "reference", "pointId": "a"},
                "endPoint": {"mode": "reference", "pointId": "b"},
                "angleDeg": 0, "mirrorX": mirror_x, "baseLineIds": ["ab"]
            }),
        ]
    };

    let scalar_program = program(vec![statement(
        "binding:mirror",
        0,
        "let",
        json!({"kind": "boolean"}),
        boolean_literal(true),
    )]);
    let property_bindings = json!([property_binding(
        "copy",
        "mirrorX",
        "binding:mirror",
        json!({"kind": "boolean"})
    )]);

    let bound = evaluate_document_input(input(
        for_group_body(json!("@mirror")),
        Some(scalar_program),
        Some(property_bindings),
    ));
    let literal_false = evaluate_document_input(input(for_group_body(json!(false)), None, None));

    assert!(bound.errors.is_empty());
    assert_eq!(bound.for_group_generated_rows.len(), 3);
    assert_eq!(literal_false.for_group_generated_rows.len(), 3);

    let bound_geometries: Vec<&Value> = bound
        .for_group_generated_rows
        .iter()
        .map(|row| {
            geometry(&bound, &row.generated_element_id).expect("generated copy must be computed")
        })
        .collect();
    let literal_geometries: Vec<&Value> = literal_false
        .for_group_generated_rows
        .iter()
        .map(|row| {
            geometry(&literal_false, &row.generated_element_id)
                .expect("generated copy must be computed")
        })
        .collect();

    // Every generated instance must reflect the bound value uniformly - not
    // just the template - and must differ from the literal-false run.
    for window in bound_geometries.windows(2) {
        assert_eq!(window[0]["closed"], window[1]["closed"]);
    }
    assert_ne!(bound_geometries[0], literal_geometries[0]);
}

#[test]
fn evaluate_document_accepts_a_schema_driven_property_key_and_fails_closed_at_runtime() {
    let elements = vec![
        point("a", 0.0, 0.0),
        point("b", 10.0, 0.0),
        line("ab", "a", "b"),
        offset_line("off", "ab", "right"),
    ];
    let scalar_program = program(vec![statement(
        "binding:dir",
        0,
        "const",
        json!({"kind": "choice", "options": CHOICE_RIGHT_LEFT}),
        choice_literal("left", &CHOICE_RIGHT_LEFT),
    )]);
    // Rust does not duplicate the frontend parameter schema or maintain a
    // property allowlist. The compiled contract is accepted, then the
    // runtime type mismatch fails closed before the geometry evaluator runs.
    let property_bindings = json!([property_binding(
        "off",
        "offset",
        "binding:dir",
        json!({"kind": "number"})
    )]);

    let result = evaluate_document(input(
        elements,
        Some(scalar_program),
        Some(property_bindings),
    ));

    assert!(result.is_ok());
    let payload = result.unwrap();
    assert!(geometry(&payload, "off").is_none());
    assert!(payload.errors.iter().any(|error| error.element_id == "off"));
}
