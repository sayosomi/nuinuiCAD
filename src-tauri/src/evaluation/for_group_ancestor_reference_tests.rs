//! Regression coverage for the specific danger this module exists to avoid:
//! `remap_json_ids` (`for_group.rs`) has previously rewritten an unrelated
//! literal (a `"type"` value) that happened to exactly equal an element id
//! used as a test fixture's element id, because it blindly rewrites every
//! matching string anywhere in the cloned JSON tree. Widening that same
//! blind mechanism with an *ancestor* map (which can plausibly contain
//! common short strings like element ids named after ordinary literals)
//! would reproduce that danger at a larger blast radius. These tests
//! construct exactly that kind of deliberate collision and assert the
//! reference field is still remapped correctly while every unrelated
//! literal field - `type`, `activity`, a `PointAnchor`'s `mode`, and a
//! `LineEndpointReference`'s `endpointKey` - stays untouched.

use super::*;
use crate::evaluation::for_group_ancestor_reference::{
    remap_ancestor_element_references, remap_current_invocation_numeric_references,
};
use serde_json::json;

#[test]
fn remaps_a_reference_field_without_touching_unrelated_literals_that_collide_with_the_ancestor_id()
{
    let mut ancestor_element_id_map = HashMap::new();
    // Deliberately collide ancestor ids with common literal string values
    // this element's own JSON also carries, unrelated to any reference:
    // "line" collides with the type tag, "reference" collides with the
    // PointAnchor mode, "visible" collides with the activity value.
    ancestor_element_id_map.insert("line".to_owned(), "line@outer:0".to_owned());
    ancestor_element_id_map.insert("reference".to_owned(), "reference@outer:0".to_owned());
    ancestor_element_id_map.insert("visible".to_owned(), "visible@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-l",
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": "line" },
        "endPoint": { "mode": "reference", "pointId": "b" }
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    // The actual reference field is remapped.
    assert_eq!(
        element
            .get("startPoint")
            .and_then(|anchor| anchor.get("pointId"))
            .and_then(Value::as_str),
        Some("line@outer:0")
    );
    // Every unrelated literal that happens to collide with an ancestor id
    // stays exactly as it was.
    assert_eq!(element.get("type").and_then(Value::as_str), Some("line"));
    assert_eq!(
        element.get("activity").and_then(Value::as_str),
        Some("visible")
    );
    assert_eq!(
        element
            .get("startPoint")
            .and_then(|anchor| anchor.get("mode"))
            .and_then(Value::as_str),
        Some("reference")
    );
    // A pointId with no ancestor entry (a document-level, never-cloned
    // sibling) is left untouched too.
    assert_eq!(
        element
            .get("endPoint")
            .and_then(|anchor| anchor.get("pointId"))
            .and_then(Value::as_str),
        Some("b")
    );
}

#[test]
fn remaps_an_endpoint_line_id_without_touching_its_endpoint_key_literal() {
    let mut ancestor_element_id_map = HashMap::new();
    // "start" collides with the endpointKey literal every LineEndpointReference
    // using the start endpoint carries.
    ancestor_element_id_map.insert("start".to_owned(), "start@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-edge",
        "type": "edge",
        "activity": "visible",
        "endpoint1": { "lineId": "start", "endpointKey": "start" },
        "endpoint2": { "lineId": "cd", "endpointKey": "end" },
        "intersectionIndex": 0
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    assert_eq!(
        element
            .get("endpoint1")
            .and_then(|endpoint| endpoint.get("lineId"))
            .and_then(Value::as_str),
        Some("start@outer:0")
    );
    // The sibling endpointKey literal - which happens to equal the exact
    // same string as the remapped ancestor id - must stay untouched.
    assert_eq!(
        element
            .get("endpoint1")
            .and_then(|endpoint| endpoint.get("endpointKey"))
            .and_then(Value::as_str),
        Some("start")
    );
    assert_eq!(
        element
            .get("endpoint2")
            .and_then(|endpoint| endpoint.get("lineId"))
            .and_then(Value::as_str),
        Some("cd")
    );
}

#[test]
fn does_nothing_when_the_ancestor_map_is_empty() {
    let mut element = json!({
        "id": "generated-l",
        "type": "line",
        "startPoint": { "mode": "reference", "pointId": "a" },
        "endPoint": { "mode": "reference", "pointId": "b" }
    });
    let before = element.clone();

    remap_ancestor_element_references(&mut element, &HashMap::new());

    assert_eq!(element, before);
}

#[test]
fn remaps_a_property_reference_element_id_inside_a_numeric_expression() {
    let mut ancestor_element_id_map = HashMap::new();
    ancestor_element_id_map.insert("a".to_owned(), "a@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-p",
        "type": "freePoint",
        "activity": "visible",
        "x": { "kind": "expression", "expression": "a.x + 10" },
        "y": { "kind": "expression", "expression": "@j" }
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    assert_eq!(
        element
            .get("x")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("a@outer:0.x + 10")
    );
    // The loop variable `@j` must never be touched by the ancestor element
    // id map, even though it's a token inside the same element's expressions.
    assert_eq!(
        element
            .get("y")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("@j")
    );
}

#[test]
fn remaps_a_bare_element_token_used_as_a_measurement_function_argument() {
    let mut ancestor_element_id_map = HashMap::new();
    ancestor_element_id_map.insert("a".to_owned(), "a@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-q",
        "type": "freePoint",
        "activity": "visible",
        "x": { "kind": "expression", "expression": "distance(a, b)" },
        "y": 0
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    // "a" (ancestor-owned, function argument position) is remapped; "b"
    // (no ancestor entry - a document-level, never-cloned sibling) is left
    // untouched, and the function name itself is untouched.
    assert_eq!(
        element
            .get("x")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("distance(a@outer:0, b)")
    );
}

#[test]
fn does_not_remap_a_loop_variable_token_even_if_its_bare_name_collides_with_an_ancestor_id() {
    let mut ancestor_element_id_map = HashMap::new();
    // Deliberately collide the ancestor id with the *name* of a loop
    // variable/typed binding - "@i" tokenizes as a LocalVariable, which
    // must never be touched regardless of what happens to be in the map.
    ancestor_element_id_map.insert("i".to_owned(), "i@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-p",
        "type": "freePoint",
        "activity": "visible",
        "x": { "kind": "expression", "expression": "@i + 10" },
        "y": 0
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    assert_eq!(
        element
            .get("x")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("@i + 10")
    );
}

#[test]
fn leaves_a_numeric_expression_unchanged_when_it_references_nothing_in_the_ancestor_map() {
    let mut ancestor_element_id_map = HashMap::new();
    ancestor_element_id_map.insert("a".to_owned(), "a@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-p",
        "type": "freePoint",
        "activity": "visible",
        "x": { "kind": "expression", "expression": "5 + 3" },
        "y": 0
    });
    let before = element.clone();

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    // No reformatting churn when nothing needed to change.
    assert_eq!(element, before);
}

#[test]
fn remaps_bezier_extreme_point_source_and_numeric_references() {
    let mut ancestor_element_id_map = HashMap::new();
    ancestor_element_id_map.insert("curve".to_owned(), "curve@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-extreme",
        "type": "bezierExtremePoint",
        "activity": "visible",
        "baseLineId": "curve",
        "segmentIndex": { "kind": "expression", "expression": "curve.length + 1" },
        "directionDeg": { "kind": "expression", "expression": "curve.startAngleDeg + 90" }
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    assert_eq!(
        element.get("baseLineId").and_then(Value::as_str),
        Some("curve@outer:0")
    );
    assert_eq!(
        element
            .get("segmentIndex")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("curve@outer:0.length + 1")
    );
    assert_eq!(
        element
            .get("directionDeg")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("curve@outer:0.startAngleDeg + 90")
    );
}

#[test]
fn remaps_bezier_bulge_point_source_and_segment_index_reference() {
    let mut ancestor_element_id_map = HashMap::new();
    ancestor_element_id_map.insert("curve".to_owned(), "curve@outer:0".to_owned());

    let mut element = json!({
        "id": "generated-bulge",
        "type": "bezierBulgePoint",
        "activity": "visible",
        "baseLineId": "curve",
        "segmentIndex": { "kind": "expression", "expression": "curve.length + 1" }
    });

    remap_ancestor_element_references(&mut element, &ancestor_element_id_map);

    assert_eq!(
        element.get("baseLineId").and_then(Value::as_str),
        Some("curve@outer:0")
    );
    assert_eq!(
        element
            .get("segmentIndex")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("curve@outer:0.length + 1")
    );
}

// remap_current_invocation_numeric_references: coverage for the Blocking-1
// gap - a current forGroup invocation's own id_map (as opposed to an
// ancestor's) previously only reached structural fields via for_group.rs's
// blind remap_json_ids, never numeric-expression tokens.

#[test]
fn remaps_a_property_reference_element_id_inside_a_numeric_expression_for_the_current_invocation() {
    let mut id_map = HashMap::new();
    id_map.insert("a".to_owned(), "a@loop:0".to_owned());

    let mut element = json!({
        "id": "generated-b",
        "type": "freePoint",
        "activity": "visible",
        "x": { "kind": "expression", "expression": "a.x + 10" },
        "y": { "kind": "expression", "expression": "@i" }
    });

    remap_current_invocation_numeric_references(&mut element, &id_map);

    assert_eq!(
        element
            .get("x")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("a@loop:0.x + 10")
    );
    // The loop variable `@i` must never be touched by the id map, even
    // though it's a token inside the same element's expressions.
    assert_eq!(
        element
            .get("y")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("@i")
    );
}

#[test]
fn remaps_a_bare_element_token_used_as_a_measurement_function_argument_for_the_current_invocation()
{
    let mut id_map = HashMap::new();
    id_map.insert("a".to_owned(), "a@loop:0".to_owned());
    id_map.insert("b".to_owned(), "b@loop:0".to_owned());

    let mut element = json!({
        "id": "generated-q",
        "type": "freePoint",
        "activity": "visible",
        "x": { "kind": "expression", "expression": "distance(a, b)" },
        "y": 0
    });

    remap_current_invocation_numeric_references(&mut element, &id_map);

    assert_eq!(
        element
            .get("x")
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str),
        Some("distance(a@loop:0, b@loop:0)")
    );
}

#[test]
fn leaves_structural_reference_fields_untouched_since_remap_json_ids_already_handles_them() {
    // remap_json_ids (for_group.rs) already remaps structural fields for
    // the current invocation before this runs, so by the time this sees
    // the element, pointId already holds the *generated* id, not a key in
    // id_map - this test simulates that ordering directly to confirm the
    // numeric-only scope never re-touches (or corrupts) it.
    let mut id_map = HashMap::new();
    id_map.insert("a".to_owned(), "a@loop:0".to_owned());

    let mut element = json!({
        "id": "generated-l",
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": "a@loop:0" },
        "endPoint": { "mode": "reference", "pointId": "b" }
    });

    remap_current_invocation_numeric_references(&mut element, &id_map);

    assert_eq!(
        element
            .get("startPoint")
            .and_then(|anchor| anchor.get("pointId"))
            .and_then(Value::as_str),
        Some("a@loop:0")
    );
    assert_eq!(
        element
            .get("endPoint")
            .and_then(|anchor| anchor.get("pointId"))
            .and_then(Value::as_str),
        Some("b")
    );
}

#[test]
fn does_nothing_when_the_current_invocation_map_is_empty() {
    let mut element = json!({
        "id": "generated-p",
        "type": "freePoint",
        "x": { "kind": "expression", "expression": "a.x + 10" },
        "y": 0
    });
    let before = element.clone();

    remap_current_invocation_numeric_references(&mut element, &HashMap::new());

    assert_eq!(element, before);
}
