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
use crate::evaluation::for_group_ancestor_reference::remap_ancestor_element_references;
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
