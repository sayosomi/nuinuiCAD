//! Remaps only the known `ElementId`-reference-bearing fields for a
//! generated forGroup body element, using an *ancestor* invocation's
//! template-id -> generated-id mapping (e.g. an Outer-owned point referenced
//! by an Inner-owned line). This deliberately never goes through
//! `remap_json_ids` (`for_group.rs`), which blindly rewrites every matching
//! string anywhere in the cloned JSON value - fine for the current
//! invocation's own `id_map`, which is scoped to this element's own
//! subtree, but unsafe to widen with an ancestor map: `remap_json_ids` has
//! previously rewritten an unrelated literal (e.g. a `"type"` value) that
//! happened to equal an id used as a test fixture's element id, and an
//! ancestor id is far more likely to coincidentally collide with an
//! ordinary literal (a `"mode"`, endpoint key, or choice value) than an
//! id scoped to one element's own subtree.
//!
//! This mirrors `remapElementReferences` (`src/model/elementDuplication.ts`)
//! field-for-field, but intentionally excludes numeric-expression content:
//! numeric expressions (`{"kind": "expression", "expression": "..."}`) are
//! tokenized and resolved dynamically by name at evaluation time
//! (`numeric_expression.rs`), never rewritten ahead of time by either
//! `remap_json_ids` or this function - only the structural, single-value
//! `ElementId` fields below need remapping ahead of evaluation.

use serde_json::Value;
use std::collections::HashMap;

use super::types::{element_type, ElementId};

fn map_ancestor_id(value: &mut Value, ancestor_element_id_map: &HashMap<ElementId, ElementId>) {
    if let Some(text) = value.as_str() {
        if let Some(mapped) = ancestor_element_id_map.get(text) {
            *value = Value::String(mapped.clone());
        }
    }
}

fn map_ancestor_id_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    if let Some(value) = object.get_mut(field) {
        map_ancestor_id(value, ancestor_element_id_map);
    }
}

fn map_ancestor_id_array_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    if let Some(items) = object.get_mut(field).and_then(Value::as_array_mut) {
        for item in items {
            map_ancestor_id(item, ancestor_element_id_map);
        }
    }
}

/// A `PointAnchor`: only `mode: "reference"` (`pointId`) and
/// `mode: "derived"` (`elementId`) hold an `ElementId`; `mode: "literal"`
/// holds plain numeric x/y and needs no remap.
fn remap_ancestor_point_anchor_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    let Some(anchor) = object.get_mut(field) else {
        return;
    };
    let Some(anchor_object) = anchor.as_object_mut() else {
        return;
    };
    match anchor_object.get("mode").and_then(Value::as_str) {
        Some("reference") => {
            map_ancestor_id_field(anchor_object, "pointId", ancestor_element_id_map)
        }
        Some("derived") => {
            map_ancestor_id_field(anchor_object, "elementId", ancestor_element_id_map)
        }
        _ => {}
    }
}

/// A `LineEndpointReference`: `{ lineId, endpointKey }` - only `lineId`
/// holds an `ElementId`; `endpointKey` is a fixed `"start" | "end"` literal.
fn remap_ancestor_endpoint_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    let Some(endpoint) = object.get_mut(field) else {
        return;
    };
    let Some(endpoint_object) = endpoint.as_object_mut() else {
        return;
    };
    map_ancestor_id_field(endpoint_object, "lineId", ancestor_element_id_map);
}

/// Remaps `element`'s reference fields in place, widened to also resolve
/// ids owned by enclosing forGroup invocations. `element` must already have
/// its own `id`/`parentGroupId`/current-invocation reference remap applied
/// (via `remap_json_ids` + the explicit `parentGroupId` fix in
/// `expand_for_group_iteration_from_template`) - this function only adds
/// the ancestor-scoped resolution on top, per element type, mirroring
/// `remapElementReferences`'s switch exactly (minus numeric-expression
/// content, see module doc).
pub(crate) fn remap_ancestor_element_references(
    element: &mut Value,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    if ancestor_element_id_map.is_empty() {
        return;
    }
    let element_type_name = element_type(element).map(ToOwned::to_owned);
    let Some(object) = element.as_object_mut() else {
        return;
    };
    match element_type_name.as_deref() {
        Some("offsetPoint") | Some("polarOffsetPoint") => {
            remap_ancestor_point_anchor_field(object, "fromPoint", ancestor_element_id_map);
            map_ancestor_id_field(object, "fromPointId", ancestor_element_id_map);
        }
        Some("divisionPoint") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
        }
        Some("lineDivisionPoint") => {
            remap_ancestor_endpoint_field(object, "endpoint", ancestor_element_id_map);
        }
        Some("intersectionPoint") => {
            map_ancestor_id_field(object, "line1Id", ancestor_element_id_map);
            map_ancestor_id_field(object, "line2Id", ancestor_element_id_map);
        }
        Some("lineTangentOffsetPoint") => {
            map_ancestor_id_field(object, "baseLineId", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "basePoint", ancestor_element_id_map);
        }
        Some("line") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
        }
        Some("angleLengthLine") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
        }
        Some("arcLine") => {
            remap_ancestor_point_anchor_field(object, "centerPoint", ancestor_element_id_map);
        }
        Some("threePointArcLine") => {
            remap_ancestor_point_anchor_field(object, "point1", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "point2", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "point3", ancestor_element_id_map);
        }
        Some("cornerRadiusArcLine") | Some("edge") => {
            remap_ancestor_endpoint_field(object, "endpoint1", ancestor_element_id_map);
            remap_ancestor_endpoint_field(object, "endpoint2", ancestor_element_id_map);
        }
        Some("extendTrim") => {
            remap_ancestor_endpoint_field(object, "endpoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "point", ancestor_element_id_map);
        }
        Some("pathReverse") => {
            map_ancestor_id_field(object, "targetLineId", ancestor_element_id_map);
        }
        Some("bezierCurve") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
            if let Some(points) = object
                .get_mut("intermediatePoints")
                .and_then(Value::as_array_mut)
            {
                for point_entry in points {
                    if let Some(point_object) = point_entry.as_object_mut() {
                        remap_ancestor_point_anchor_field(
                            point_object,
                            "point",
                            ancestor_element_id_map,
                        );
                    }
                }
            }
        }
        Some("offsetLine") => {
            map_ancestor_id_array_field(object, "baseLineIds", ancestor_element_id_map);
        }
        Some("splitLine") => {
            map_ancestor_id_field(object, "baseLineId", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "splitPoint", ancestor_element_id_map);
        }
        Some("copyLine") | Some("move") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
            map_ancestor_id_array_field(object, "baseLineIds", ancestor_element_id_map);
        }
        Some("symmetricCopyLine") | Some("symmetricMove") => {
            remap_ancestor_point_anchor_field(object, "axisPoint1", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "axisPoint2", ancestor_element_id_map);
            map_ancestor_id_array_field(object, "baseLineIds", ancestor_element_id_map);
        }
        Some("image") => {
            remap_ancestor_point_anchor_field(object, "originPoint", ancestor_element_id_map);
        }
        Some("text") => {
            // `anchor` may be `null` (no anchor) - remap_ancestor_point_anchor_field
            // already no-ops on a non-object value, so no extra guard is needed.
            remap_ancestor_point_anchor_field(object, "anchor", ancestor_element_id_map);
        }
        _ => {}
    }
}
