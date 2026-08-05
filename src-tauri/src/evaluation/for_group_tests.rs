//! Low-level unit coverage for `expand_for_group_iteration_from_template`'s
//! nested-forGroup ownership: parentGroupId remap to the runtime instance
//! chain (not a source template id) and explicit ancestor-iteration-variable
//! threading (not the whole `numericVariables` array). Runtime-level
//! (`evaluate_document_input`) coverage of the same scenario lives in
//! `for_group_generic_runtime_tests.rs`.

use super::*;
use crate::evaluation::for_group::expand_for_group_iteration_from_template;
use serde_json::json;

fn for_group(id: &str, parent: Option<&str>, variable_name: &str, count: f64) -> Value {
    let mut value = json!({
        "id": id,
        "name": id,
        "type": "forGroup",
        "activity": "visible",
        "variableName": variable_name,
        "start": 0,
        "count": count,
        "step": 1,
        "showGenerated": false
    });
    if let Some(parent) = parent {
        value["parentGroupId"] = json!(parent);
    }
    value
}

fn expression(expression: &str) -> Value {
    json!({ "kind": "expression", "expression": expression })
}

fn point_referencing(id: &str, parent: &str, x_ref: &str, y_ref: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "freePoint", "activity": "visible",
        "parentGroupId": parent, "x": expression(x_ref), "y": expression(y_ref)
    })
}

#[test]
fn remaps_a_direct_childs_parent_group_id_to_the_runtime_forgroup_instance() {
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        for_group("inner", Some("outer"), "j", 3.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];

    let (outer_generated, _outer_rows, outer_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &elements[0],
            Some("outer"),
            0,
            0.0,
            &[],
        );
    let (generated_inner, _) = outer_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("forGroup"))
        .expect("outer must generate a nested Inner instance");
    let generated_inner_id = element_id(&generated_inner).unwrap();
    assert_eq!(generated_inner_id, "inner@outer:0");
    // A direct child's parentGroupId equals the template forGroup's own id
    // ("outer"), which is never a member of id_map (only descendants are) -
    // it must be remapped to the runtime instance id, not left dangling.
    assert_eq!(
        generated_inner.get("parentGroupId").and_then(Value::as_str),
        Some("outer")
    );

    let (inner_generated, _inner_rows, _inner_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &generated_inner,
            Some("inner"),
            0,
            0.0,
            std::slice::from_ref(&outer_iteration_variable),
        );
    let (generated_p, _) = inner_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("freePoint"))
        .expect("inner must generate P");
    // The generated P is a direct child of the generated Inner *instance* -
    // its parentGroupId must be the runtime instance id, never the
    // source-authored "inner" template id.
    assert_eq!(
        generated_p.get("parentGroupId").and_then(Value::as_str),
        Some(generated_inner_id.as_str())
    );
    assert_ne!(
        generated_p.get("parentGroupId").and_then(Value::as_str),
        Some("inner")
    );
}

#[test]
fn does_not_mix_parent_chains_across_two_outer_iterations() {
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        for_group("inner", Some("outer"), "j", 1.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];

    let mut generated_p_parents = Vec::new();
    for outer_iteration_index in 0..2usize {
        let (outer_generated, _rows, outer_iteration_variable) =
            expand_for_group_iteration_from_template(
                &elements,
                &elements[0],
                Some("outer"),
                outer_iteration_index,
                outer_iteration_index as f64,
                &[],
            );
        let (generated_inner, _) = outer_generated
            .into_iter()
            .find(|(element, _)| element_type(element) == Some("forGroup"))
            .unwrap();
        let generated_inner_id = element_id(&generated_inner).unwrap();
        let (inner_generated, _rows, _iv) = expand_for_group_iteration_from_template(
            &elements,
            &generated_inner,
            Some("inner"),
            0,
            0.0,
            std::slice::from_ref(&outer_iteration_variable),
        );
        let (generated_p, _) = inner_generated
            .into_iter()
            .find(|(element, _)| element_type(element) == Some("freePoint"))
            .unwrap();
        assert_eq!(
            generated_p.get("parentGroupId").and_then(Value::as_str),
            Some(generated_inner_id.as_str())
        );
        generated_p_parents.push(generated_p.get("parentGroupId").cloned());
    }

    assert_ne!(generated_p_parents[0], generated_p_parents[1]);
}

#[test]
fn threads_both_outer_and_inner_ancestor_iteration_variables_into_the_nested_body() {
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        for_group("inner", Some("outer"), "j", 3.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];

    let (outer_generated, _rows, outer_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &elements[0],
            Some("outer"),
            1,
            1.0,
            &[],
        );
    let (generated_inner, _) = outer_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("forGroup"))
        .unwrap();
    let (inner_generated, _rows, _iv) = expand_for_group_iteration_from_template(
        &elements,
        &generated_inner,
        Some("inner"),
        2,
        2.0,
        std::slice::from_ref(&outer_iteration_variable),
    );
    let (generated_p, _) = inner_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("freePoint"))
        .unwrap();
    let variables = generated_p
        .get("numericVariables")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let names: Vec<Option<&str>> = variables
        .iter()
        .map(|v| v.get("name").and_then(Value::as_str))
        .collect();
    assert_eq!(names, vec![Some("i"), Some("j")]);
    assert_eq!(variables[0].get("value").and_then(Value::as_f64), Some(1.0));
    assert_eq!(variables[1].get("value").and_then(Value::as_f64), Some(2.0));
}

#[test]
fn an_inner_loop_variable_shadows_an_outer_loop_variable_of_the_same_name() {
    let elements = vec![
        for_group("outer", None, "i", 1.0),
        for_group("inner", Some("outer"), "i", 1.0),
        point_referencing("p", "inner", "@i", "0"),
    ];

    let (outer_generated, _rows, outer_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &elements[0],
            Some("outer"),
            0,
            100.0,
            &[],
        );
    let (generated_inner, _) = outer_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("forGroup"))
        .unwrap();
    let (inner_generated, _rows, _iv) = expand_for_group_iteration_from_template(
        &elements,
        &generated_inner,
        Some("inner"),
        0,
        5.0,
        std::slice::from_ref(&outer_iteration_variable),
    );
    let (generated_p, _) = inner_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("freePoint"))
        .unwrap();
    let variables = generated_p
        .get("numericVariables")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // Both "i" bindings are present (outer=100, inner=5) - evaluate_local_variables
    // resolves by name with last-write-wins, so the inner (later) value must
    // win. This mirrors last_or_default resolution in local_variables.rs.
    let values: Vec<f64> = variables
        .iter()
        .filter(|v| v.get("name").and_then(Value::as_str) == Some("i"))
        .map(|v| v.get("value").and_then(Value::as_f64).unwrap())
        .collect();
    assert_eq!(values, vec![100.0, 5.0]);
    assert_eq!(values.last().copied(), Some(5.0));
}

#[test]
fn does_not_forward_the_for_groups_own_numeric_variables_only_the_explicit_ancestor_parameter() {
    let mut outer = for_group("outer", None, "i", 1.0);
    outer["numericVariables"] = json!([{ "id": "outer:own", "name": "ownVar", "value": 999 }]);
    let elements = vec![outer.clone(), point_referencing("p", "outer", "0", "0")];

    let (generated, _rows, _iv) =
        expand_for_group_iteration_from_template(&elements, &outer, Some("outer"), 0, 0.0, &[]);
    let (generated_p, _) = generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("freePoint"))
        .unwrap();
    let variables = generated_p
        .get("numericVariables")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    assert!(!variables
        .iter()
        .any(|v| v.get("name").and_then(Value::as_str) == Some("ownVar")));
}
