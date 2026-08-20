use serde_json::json;

use super::activity::{
    activity_allows_drawing, activity_allows_evaluation, activity_from_element,
    effective_activity_by_element_id, effective_drawing_modifier_stroke_by_element_id,
    ElementActivity,
};
use super::evaluate_document_input;
use super::groups::group_state_by_element_id;

#[test]
fn activity_values_use_the_shared_three_state_truth_table() {
    let cases = [
        (json!({ "activity": "visible" }), ElementActivity::Visible),
        (json!({ "activity": "hidden" }), ElementActivity::Hidden),
        (json!({ "activity": "disabled" }), ElementActivity::Disabled),
    ];

    for (element, activity) in cases {
        assert_eq!(activity_from_element(&element), activity);
        assert_eq!(
            activity_allows_evaluation(activity),
            activity != ElementActivity::Disabled
        );
        assert_eq!(
            activity_allows_drawing(activity),
            activity == ElementActivity::Visible
        );
    }
}

#[test]
fn parent_disabled_takes_precedence_over_hidden() {
    let activities = effective_activity_by_element_id(
        &[
            json!({ "id": "hidden", "type": "group", "activity": "hidden" }),
            json!({ "id": "nested", "type": "group", "parentGroupId": "hidden", "activity": "disabled" }),
            json!({ "id": "child", "type": "freePoint", "parentGroupId": "nested", "activity": "visible" }),
        ],
        None,
    );

    assert_eq!(activities["child"].activity, ElementActivity::Disabled);
    assert_eq!(
        activities["child"].disabled_by_element_id.as_deref(),
        Some("nested")
    );
}

#[test]
fn module_instance_is_an_activity_container_and_a_geometry_noop() {
    let elements = vec![
        json!({ "id": "outer", "type": "group", "activity": "hidden" }),
        json!({ "id": "module", "name": "module", "type": "moduleInstance", "parentGroupId": "outer", "activity": "visible" }),
        json!({ "id": "child", "name": "child", "type": "freePoint", "parentGroupId": "module", "activity": "visible", "x": 10, "y": 20 }),
    ];
    let activities = effective_activity_by_element_id(&elements, None);
    assert_eq!(activities["child"].activity, ElementActivity::Hidden);

    let result = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });
    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("module")));
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("child")));
}

#[test]
fn module_instance_is_preserved_as_the_disabled_activity_source() {
    let elements = vec![
        json!({ "id": "module", "name": "module", "type": "moduleInstance", "activity": "disabled" }),
        json!({ "id": "child", "name": "child", "type": "freePoint", "parentGroupId": "module", "activity": "visible", "x": 0, "y": 0 }),
    ];
    let activities = effective_activity_by_element_id(&elements, None);
    let states = group_state_by_element_id(&elements, &activities);

    assert_eq!(
        states["child"].disabled_by_group_id.as_deref(),
        Some("module")
    );
}

#[test]
fn bake_sandbox_can_evaluate_disabled_geometry_without_changing_normal_evaluation() {
    let elements = vec![json!({
        "id": "disabled",
        "name": "Disabled",
        "type": "freePoint",
        "activity": "disabled",
        "x": 3,
        "y": 4
    })];
    let normal = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements: elements.clone(),
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });
    let sandbox = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: Some(vec!["disabled".to_owned()]),
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });

    assert!(normal.computed_geometry.is_empty());
    assert!(!normal
        .effective_enabled_element_ids
        .iter()
        .any(|id| id == "disabled"));
    assert_eq!(sandbox.computed_geometry.len(), 1);
    assert!(sandbox
        .effective_enabled_element_ids
        .iter()
        .any(|id| id == "disabled"));
}

#[test]
fn bake_sandbox_does_not_enable_a_disabled_dependency_that_is_not_a_target() {
    let elements = vec![
        json!({
            "id": "dependency", "name": "Dependency", "type": "freePoint",
            "activity": "disabled", "x": 0, "y": 0
        }),
        json!({
            "id": "target", "name": "Target", "type": "line", "activity": "disabled",
            "startPoint": { "mode": "reference", "pointId": "dependency" },
            "endPoint": { "mode": "coordinate", "x": 10, "y": 0 }
        }),
    ];
    let result = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: Some(vec!["target".to_owned()]),
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });

    assert!(result.computed_geometry.is_empty());
    let error = result
        .errors
        .iter()
        .find(|error| error.element_id == "target")
        .expect("target should retain the unavailable dependency error");
    assert_eq!(error.missing_dependency_id, "dependency");
}

#[test]
fn drawing_modifiers_resolve_outer_to_inner_to_element_with_last_wins() {
    let modifiers = json!([
        { "name": "Hide", "state": "hidden" },
        { "name": "Disable", "state": "disabled" },
        { "name": "Show", "state": "visible" }
    ]);
    let elements = vec![
        json!({ "id": "outer", "type": "group", "activity": "visible", "modifierNames": ["Hide"] }),
        json!({ "id": "inner", "type": "group", "parentGroupId": "outer", "activity": "visible", "modifierNames": ["Disable", "Show"] }),
        json!({ "id": "child", "type": "freePoint", "parentGroupId": "inner", "activity": "visible" }),
    ];

    let activities = effective_activity_by_element_id(&elements, Some(&modifiers));
    assert_eq!(activities["child"].activity, ElementActivity::Visible);
    assert_eq!(activities["child"].hidden_by_element_id, None);
    assert_eq!(activities["child"].disabled_by_element_id, None);

    let mut direct_gate_elements = elements;
    direct_gate_elements[0]["activity"] = json!("hidden");
    direct_gate_elements[2]["modifierNames"] = json!(["Show"]);
    let gated = effective_activity_by_element_id(&direct_gate_elements, Some(&modifiers));
    assert_eq!(gated["child"].activity, ElementActivity::Hidden);
    assert_eq!(
        gated["child"].hidden_by_element_id.as_deref(),
        Some("outer")
    );

    direct_gate_elements[0]["activity"] = json!("disabled");
    let disabled = effective_activity_by_element_id(&direct_gate_elements, Some(&modifiers));
    assert_eq!(disabled["child"].activity, ElementActivity::Disabled);
    assert_eq!(
        disabled["child"].disabled_by_element_id.as_deref(),
        Some("outer")
    );
}

#[test]
fn drawing_modifier_strokes_resolve_atomically_and_independently_from_state() {
    let modifiers = json!([
        { "name": "Outer", "stroke": { "widthPx": 1.0, "style": "solid", "color": { "kind": "fixed", "hex": "#111111" } } },
        { "name": "Inner", "stroke": { "widthPx": 2.0, "style": "dashed", "color": { "kind": "fixed", "hex": "#222222" } } },
        { "name": "StateOnly", "state": "hidden" },
        { "name": "Later", "stroke": { "widthPx": 3.0, "style": "dotted", "color": { "kind": "themeRole", "role": "accent" } } }
    ]);
    let elements = vec![
        json!({ "id": "outer", "type": "group", "activity": "visible", "modifierNames": ["Outer"] }),
        json!({ "id": "inner", "type": "group", "parentGroupId": "outer", "activity": "visible", "modifierNames": ["Inner"] }),
        json!({ "id": "child", "type": "freePoint", "parentGroupId": "inner", "activity": "visible", "modifierNames": ["StateOnly", "Later"], "x": 0, "y": 0 }),
    ];

    let strokes = effective_drawing_modifier_stroke_by_element_id(&elements, Some(&modifiers));
    assert_eq!(
        strokes["child"],
        json!({ "widthPx": 3.0, "style": "dotted", "color": { "kind": "themeRole", "role": "accent" } })
    );
    assert_eq!(
        strokes["outer"]["color"],
        json!({ "kind": "fixed", "hex": "#111111" })
    );
    assert_eq!(
        strokes["inner"]["color"],
        json!({ "kind": "fixed", "hex": "#222222" })
    );
    assert_eq!(
        effective_activity_by_element_id(&elements, Some(&modifiers))["child"].activity,
        ElementActivity::Hidden
    );
}

#[test]
fn generated_rows_receive_the_template_stroke_without_id_parsing() {
    let result = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements: vec![
            json!({
                "id": "loop", "name": "Loop", "type": "forGroup", "activity": "visible",
                "modifierNames": ["Guide"], "variableName": "i", "start": 0, "count": 2,
                "step": 1, "showGenerated": true
            }),
            json!({
                "id": "point", "name": "Point", "type": "freePoint", "activity": "visible",
                "parentGroupId": "loop", "x": 0, "y": 0
            }),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: Some(json!([
            { "name": "Guide", "stroke": { "widthPx": 1.25, "style": "dashed", "color": { "kind": "themeRole", "role": "info" } } }
        ])),
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });

    assert_eq!(result.for_group_generated_rows.len(), 2);
    assert_eq!(
        result
            .effective_drawing_modifier_strokes
            .iter()
            .find(|entry| entry.element_id == "point@loop:0")
            .map(|entry| &entry.stroke),
        Some(
            &json!({ "widthPx": 1.25, "style": "dashed", "color": { "kind": "themeRole", "role": "info" } })
        )
    );
}

#[test]
fn drawing_modifier_activity_uses_compiled_definitions_for_evaluation() {
    let result = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements: vec![
            json!({ "id": "hidden", "type": "freePoint", "activity": "visible", "modifierNames": ["Hide"], "x": 0, "y": 0 }),
            json!({ "id": "disabled", "type": "freePoint", "activity": "visible", "modifierNames": ["Disable"], "x": 1, "y": 0 }),
            json!({ "id": "shown", "type": "freePoint", "activity": "visible", "modifierNames": ["Show"], "x": 2, "y": 0 }),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: Some(json!([
            { "name": "Hide", "state": "hidden" },
            { "name": "Disable", "state": "disabled" },
            { "name": "Show", "state": "visible" }
        ])),
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });

    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("hidden")));
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("disabled")));
    assert!(result
        .computed_geometry
        .iter()
        .any(|geometry| geometry["elementId"] == json!("shown")));
    assert!(!result
        .effective_visible_element_ids
        .contains(&"hidden".to_owned()));
    assert!(!result
        .effective_enabled_element_ids
        .contains(&"disabled".to_owned()));
    assert!(result
        .effective_visible_element_ids
        .contains(&"shown".to_owned()));
}

#[test]
fn directly_disabled_dependency_reports_evaluation_off() {
    let result = evaluate_document_input(super::types::EvaluationInput {
        module_materialization: None,
        elements: vec![
            json!({
                "id": "source", "name": "無効点", "type": "freePoint",
                "activity": "disabled", "x": 0, "y": 0
            }),
            json!({
                "id": "consumer", "name": "参照線", "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "source" },
                "endPoint": { "mode": "coordinate", "x": 10, "y": 0 }
            }),
        ],
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    });

    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("source")));
    assert!(result
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("consumer")));
    let error = result
        .errors
        .iter()
        .find(|error| error.element_id == "consumer")
        .expect("expected directly disabled dependency error");
    assert_eq!(error.missing_dependency_id, "source");
    assert_eq!(error.missing_dependency_name.as_deref(), Some("無効点"));
    assert_eq!(
        error.message,
        "参照線 は 無効点 を参照していますが、無効点 は評価OFFです。無効点 を評価ONにするか、参照先を変更してください。"
    );
    assert!(!error.message.contains("後にあるか、存在しません"));
}
