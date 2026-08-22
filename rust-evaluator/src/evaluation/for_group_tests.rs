//! Low-level unit coverage for `expand_for_group_iteration_from_template`'s
//! nested-forGroup ownership: parentGroupId remap to the runtime instance
//! chain (not a source template id) and explicit ancestor-iteration-variable
//! threading (not generated element JSON). Runtime-level
//! (`evaluate_document_input`) coverage of the same scenario lives in
//! `for_group_generic_runtime_tests.rs`.

use super::*;
use crate::evaluation::for_group::{
    expand_for_group_iteration_from_template, iteration_local_variables,
};
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

fn line_referencing(id: &str, parent: &str, start_point_id: &str, end_point_id: &str) -> Value {
    json!({
        "id": id, "name": id, "type": "line", "activity": "visible",
        "parentGroupId": parent,
        "startPoint": { "mode": "reference", "pointId": start_point_id },
        "endPoint": { "mode": "reference", "pointId": end_point_id }
    })
}

#[test]
fn remaps_a_direct_childs_parent_group_id_to_the_runtime_forgroup_instance() {
    let elements = vec![
        for_group("outer", None, "i", 2.0),
        for_group("inner", Some("outer"), "j", 3.0),
        point_referencing("p", "inner", "@i", "@j"),
    ];

    let (outer_generated, _outer_rows, _outer_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &elements[0],
            Some("outer"),
            0,
            0.0,
            &std::collections::HashMap::new(),
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
            &std::collections::HashMap::new(),
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
        let (outer_generated, _rows, _outer_iteration_variable) =
            expand_for_group_iteration_from_template(
                &elements,
                &elements[0],
                Some("outer"),
                outer_iteration_index,
                outer_iteration_index as f64,
                &std::collections::HashMap::new(),
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
            &std::collections::HashMap::new(),
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
            &std::collections::HashMap::new(),
        );
    let (generated_inner, _) = outer_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("forGroup"))
        .unwrap();
    let (inner_generated, _rows, inner_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &generated_inner,
            Some("inner"),
            2,
            2.0,
            &std::collections::HashMap::new(),
        );
    let (_generated_p, _) = inner_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("freePoint"))
        .unwrap();
    let (values, names) =
        iteration_local_variables(&[outer_iteration_variable, inner_iteration_variable]);
    assert_eq!(names.get("i").map(String::as_str), Some("i"));
    assert_eq!(names.get("j").map(String::as_str), Some("j"));
    assert_eq!(values.get("i"), Some(&1.0));
    assert_eq!(values.get("j"), Some(&2.0));
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
            &std::collections::HashMap::new(),
        );
    let (generated_inner, _) = outer_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("forGroup"))
        .unwrap();
    let (inner_generated, _rows, inner_iteration_variable) =
        expand_for_group_iteration_from_template(
            &elements,
            &generated_inner,
            Some("inner"),
            0,
            5.0,
            &std::collections::HashMap::new(),
        );
    let (_generated_p, _) = inner_generated
        .into_iter()
        .find(|(element, _)| element_type(element) == Some("freePoint"))
        .unwrap();
    let (values, _) =
        iteration_local_variables(&[outer_iteration_variable, inner_iteration_variable]);
    assert_eq!(values.get("i"), Some(&5.0));
}

#[test]
fn a_nested_body_element_resolves_a_reference_to_an_element_generated_by_an_outer_iteration() {
    // Outer owns A and the Inner opener; Inner owns L, which references A
    // (Outer-owned) and B (a document-level, stable sibling never cloned).
    let b = json!({ "id": "b", "name": "b", "type": "freePoint", "activity": "visible", "x": 0, "y": 0 });
    let elements = vec![
        b,
        for_group("outer", None, "i", 2.0),
        point_referencing("a", "outer", "@i", "0"),
        for_group("inner", Some("outer"), "j", 2.0),
        line_referencing("l", "inner", "a", "b"),
    ];

    for outer_iteration_index in 0..2usize {
        let (outer_generated, _rows, _outer_iteration_variable) =
            expand_for_group_iteration_from_template(
                &elements,
                &elements[1],
                Some("outer"),
                outer_iteration_index,
                outer_iteration_index as f64,
                &std::collections::HashMap::new(),
            );
        let generated_a = outer_generated
            .iter()
            .find(|(element, template_id)| {
                template_id == "a" && element_type(element) == Some("freePoint")
            })
            .map(|(element, _)| element.clone())
            .expect("outer must generate A");
        let generated_a_id = element_id(&generated_a).unwrap();
        let generated_inner = outer_generated
            .into_iter()
            .find(|(element, _)| element_type(element) == Some("forGroup"))
            .map(|(element, _)| element)
            .expect("outer must generate a nested Inner instance");

        // Only A is owned by Outer and passed down - a bogus flattened clone
        // of L (Inner's own descendant, over-cloned internally by this same
        // expand call before ownership filtering) must never leak into the
        // ancestor map passed to Inner.
        let mut ancestor_element_id_map = std::collections::HashMap::new();
        ancestor_element_id_map.insert("a".to_owned(), generated_a_id.clone());

        let (inner_generated, _rows, _iv) = expand_for_group_iteration_from_template(
            &elements,
            &generated_inner,
            Some("inner"),
            0,
            0.0,
            &ancestor_element_id_map,
        );
        let generated_l = inner_generated
            .into_iter()
            .find(|(element, _)| element_type(element) == Some("line"))
            .map(|(element, _)| element)
            .expect("inner must generate L");

        assert_eq!(
            generated_l
                .get("startPoint")
                .and_then(|anchor| anchor.get("pointId"))
                .and_then(Value::as_str),
            Some(generated_a_id.as_str())
        );
        // B is never owned by any forGroup, so it is never in the ancestor
        // map and stays a stable, unmapped reference.
        assert_eq!(
            generated_l
                .get("endPoint")
                .and_then(|anchor| anchor.get("pointId"))
                .and_then(Value::as_str),
            Some("b")
        );
    }
}
