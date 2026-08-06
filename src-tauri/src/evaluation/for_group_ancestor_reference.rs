//! Remaps only the known `ElementId`-reference-bearing fields for a
//! generated forGroup body element, using an *ancestor* invocation's
//! template-id -> generated-id mapping (e.g. an Outer-owned point referenced
//! by an Inner-owned line, or an Outer-owned point's property read inside an
//! Inner-owned numeric expression like `A.x + 10`). This deliberately never
//! goes through `remap_json_ids` (`for_group.rs`), which blindly rewrites
//! every matching string anywhere in the cloned JSON value - fine for the
//! current invocation's own `id_map`, which is scoped to this element's own
//! subtree, but unsafe to widen with an ancestor map: `remap_json_ids` has
//! previously rewritten an unrelated literal (e.g. a `"type"` value) that
//! happened to equal an id used as a test fixture's element id, and an
//! ancestor id is far more likely to coincidentally collide with an
//! ordinary literal (a `"mode"`, endpoint key, or choice value) than an
//! id scoped to one element's own subtree.
//!
//! This mirrors `remapElementReferences`/`remapNumericValue`
//! (`src/model/elementDuplication.ts`) field-for-field and token-for-token:
//! structural `ElementId` fields are remapped directly; numeric-expression
//! fields (`{"kind": "expression", "expression": "..."}`) are tokenized with
//! `numeric_expression::tokenize` (the exact tokenizer evaluation itself
//! uses, so remapping can never diverge from how the expression is later
//! parsed) and only `Reference`/`Element` tokens - the only token kinds that
//! hold an `ElementId` - are remapped; a `LocalVariable` token (`@i`, `@j`,
//! a typed `@name` binding) is left untouched, matching the task's explicit
//! requirement that loop variables and typed bindings must not change.

use serde_json::Value;
use std::collections::HashMap;

use super::numeric_expression::tokenize;
use super::types::{element_type, ElementId, Token};

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

/// Renders one token back to expression text. Only `Reference`/`Element`
/// carry an `ElementId` and get remapped; every other token is reproduced
/// exactly as `numeric_expression::tokenize` would re-read it (operators
/// padded with spaces the same way `src/model/elementDuplication.ts`'s
/// `tokenText` pads them, so the reconstructed text re-tokenizes to the
/// same token stream).
fn token_text(token: &Token, ancestor_element_id_map: &HashMap<ElementId, ElementId>) -> String {
    match token {
        Token::Number(value) => format!("{value}"),
        Token::Reference {
            element_id,
            property,
        } => {
            let mapped = ancestor_element_id_map
                .get(element_id)
                .map(String::as_str)
                .unwrap_or(element_id.as_str());
            format!("{mapped}.{property}")
        }
        Token::Element(element_id) => ancestor_element_id_map
            .get(element_id)
            .cloned()
            .unwrap_or_else(|| element_id.clone()),
        Token::LocalVariable(name) => format!("@{name}"),
        Token::Function(name) => name.clone(),
        Token::Operator(operator) => format!(" {operator} "),
        Token::ComparisonOperator(operator) => format!(" {operator} "),
        Token::LogicalOperator(operator) => format!(" {operator} "),
        Token::Comma => ", ".to_owned(),
        Token::LeftParen => "(".to_owned(),
        Token::RightParen => ")".to_owned(),
    }
}

/// Remaps a `NumericValue` in place: a plain number is left untouched; an
/// expression is only rewritten (and only its `Reference`/`Element` tokens'
/// ids) when it actually references an ancestor-owned id, mirroring
/// `remapNumericValue`'s early return when nothing changed - this avoids
/// needless text-formatting churn (and keeps TS/Rust parity byte-identical)
/// for the overwhelming majority of expressions that reference nothing in
/// the ancestor map. An expression the tokenizer itself cannot parse is left
/// exactly as-is; evaluation will surface its own error for it later.
fn remap_ancestor_numeric_value(
    value: &mut Value,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let Some(expression) = object.get("expression").and_then(Value::as_str) else {
        return;
    };
    let Ok(tokens) = tokenize(expression) else {
        return;
    };
    let references_ancestor = tokens.iter().any(|token| {
        matches!(
            token,
            Token::Reference { element_id, .. } | Token::Element(element_id)
                if ancestor_element_id_map.contains_key(element_id)
        )
    });
    if !references_ancestor {
        return;
    }
    let remapped_expression = tokens
        .iter()
        .map(|token| token_text(token, ancestor_element_id_map))
        .collect::<String>();
    object.insert("expression".to_owned(), Value::String(remapped_expression));
}

fn remap_ancestor_numeric_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    if let Some(value) = object.get_mut(field) {
        remap_ancestor_numeric_value(value, ancestor_element_id_map);
    }
}

/// A `PointAnchor`: `mode: "reference"` (`pointId`) and `mode: "derived"`
/// (`elementId`) hold a structural `ElementId`; `mode: "coordinate"` holds
/// plain `NumericValue` x/y, which may themselves be expressions
/// referencing an ancestor element's property (`x: A.x + 10`).
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
        Some("coordinate") => {
            remap_ancestor_numeric_field(anchor_object, "x", ancestor_element_id_map);
            remap_ancestor_numeric_field(anchor_object, "y", ancestor_element_id_map);
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

/// Remaps `element`'s reference fields (structural ids and numeric
/// expressions) in place, widened to also resolve ids owned by enclosing
/// forGroup invocations. `element` must already have its own
/// `id`/`parentGroupId`/current-invocation reference remap applied (via
/// `remap_json_ids` + the explicit `parentGroupId` fix in
/// `expand_for_group_iteration_from_template`) - this function only adds
/// the ancestor-scoped resolution on top, per element type, mirroring
/// `remapElementReferences`'s switch exactly.
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
    // Every element-local `let`/loop-variable declaration's own value may
    // itself be an expression referencing an ancestor element - applies
    // uniformly regardless of type, mirroring remapNumericFields.
    if let Some(variables) = object
        .get_mut("numericVariables")
        .and_then(Value::as_array_mut)
    {
        for variable in variables {
            if let Some(variable_object) = variable.as_object_mut() {
                remap_ancestor_numeric_field(variable_object, "value", ancestor_element_id_map);
            }
        }
    }
    match element_type_name.as_deref() {
        Some("conditionalGroup") => {
            remap_ancestor_numeric_field(object, "condition", ancestor_element_id_map);
        }
        Some("forGroup") => {
            remap_ancestor_numeric_field(object, "start", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "count", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "step", ancestor_element_id_map);
        }
        Some("freePoint") => {
            remap_ancestor_numeric_field(object, "x", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "y", ancestor_element_id_map);
        }
        Some("offsetPoint") => {
            remap_ancestor_point_anchor_field(object, "fromPoint", ancestor_element_id_map);
            map_ancestor_id_field(object, "fromPointId", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "dx", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "dy", ancestor_element_id_map);
        }
        Some("polarOffsetPoint") => {
            remap_ancestor_point_anchor_field(object, "fromPoint", ancestor_element_id_map);
            map_ancestor_id_field(object, "fromPointId", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "angleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "distance", ancestor_element_id_map);
        }
        Some("divisionPoint") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
            if let Some(placement) = object.get_mut("placement").and_then(Value::as_object_mut) {
                remap_ancestor_numeric_field(placement, "value", ancestor_element_id_map);
            }
        }
        Some("lineDivisionPoint") => {
            remap_ancestor_endpoint_field(object, "endpoint", ancestor_element_id_map);
            if let Some(placement) = object.get_mut("placement").and_then(Value::as_object_mut) {
                remap_ancestor_numeric_field(placement, "value", ancestor_element_id_map);
            }
        }
        Some("intersectionPoint") => {
            map_ancestor_id_field(object, "line1Id", ancestor_element_id_map);
            map_ancestor_id_field(object, "line2Id", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "intersectionIndex", ancestor_element_id_map);
        }
        Some("lineTangentOffsetPoint") => {
            map_ancestor_id_field(object, "baseLineId", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "basePoint", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "tangentAngleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "distance", ancestor_element_id_map);
        }
        Some("line") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
        }
        Some("angleLengthLine") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "angleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "length", ancestor_element_id_map);
        }
        Some("arcLine") => {
            remap_ancestor_point_anchor_field(object, "centerPoint", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "radius", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "startAngleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "endAngleDeg", ancestor_element_id_map);
        }
        Some("threePointArcLine") => {
            remap_ancestor_point_anchor_field(object, "point1", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "point2", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "point3", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "startAngleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "endAngleDeg", ancestor_element_id_map);
        }
        Some("cornerRadiusArcLine") | Some("edge") => {
            remap_ancestor_endpoint_field(object, "endpoint1", ancestor_element_id_map);
            remap_ancestor_endpoint_field(object, "endpoint2", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "intersectionIndex", ancestor_element_id_map);
            if object.contains_key("radius") {
                remap_ancestor_numeric_field(object, "radius", ancestor_element_id_map);
            }
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
            remap_ancestor_numeric_field(object, "startHandleAngleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "startHandleLength", ancestor_element_id_map);
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
                        remap_ancestor_numeric_field(
                            point_object,
                            "handleAngleDeg",
                            ancestor_element_id_map,
                        );
                        remap_ancestor_numeric_field(
                            point_object,
                            "incomingHandleLength",
                            ancestor_element_id_map,
                        );
                        remap_ancestor_numeric_field(
                            point_object,
                            "outgoingHandleLength",
                            ancestor_element_id_map,
                        );
                    }
                }
            }
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "endHandleAngleDeg", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "endHandleLength", ancestor_element_id_map);
        }
        Some("offsetLine") => {
            map_ancestor_id_array_field(object, "baseLineIds", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "offset", ancestor_element_id_map);
        }
        Some("splitLine") => {
            map_ancestor_id_field(object, "baseLineId", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "splitPoint", ancestor_element_id_map);
        }
        Some("copyLine") | Some("move") => {
            remap_ancestor_point_anchor_field(object, "startPoint", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "endPoint", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "scale", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "angleDeg", ancestor_element_id_map);
            map_ancestor_id_array_field(object, "baseLineIds", ancestor_element_id_map);
        }
        Some("symmetricCopyLine") | Some("symmetricMove") => {
            remap_ancestor_point_anchor_field(object, "axisPoint1", ancestor_element_id_map);
            remap_ancestor_point_anchor_field(object, "axisPoint2", ancestor_element_id_map);
            map_ancestor_id_array_field(object, "baseLineIds", ancestor_element_id_map);
        }
        Some("image") => {
            remap_ancestor_point_anchor_field(object, "originPoint", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "scale", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "angleDeg", ancestor_element_id_map);
        }
        Some("text") => {
            // `anchor` may be `null` (no anchor) - remap_ancestor_point_anchor_field
            // already no-ops on a non-object value, so no extra guard is needed.
            remap_ancestor_point_anchor_field(object, "anchor", ancestor_element_id_map);
            remap_ancestor_numeric_field(object, "fontSize", ancestor_element_id_map);
        }
        _ => {}
    }
}
