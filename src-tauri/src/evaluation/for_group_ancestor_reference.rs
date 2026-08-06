//! Remaps the known `ElementId`-reference-bearing fields for a generated
//! forGroup body element, using a template-id -> generated-id mapping. Two
//! entry points share one implementation, distinguished by
//! [`ReferenceRemapScope`]:
//!
//! - [`remap_ancestor_element_references`] - an *ancestor* invocation's map
//!   (e.g. an Outer-owned point referenced by an Inner-owned line, or an
//!   Outer-owned point's property read inside an Inner-owned numeric
//!   expression like `A.x + 10`). This deliberately never goes through
//!   `remap_json_ids` (`for_group.rs`), which blindly rewrites every
//!   matching string anywhere in the cloned JSON value - fine for the
//!   current invocation's own `id_map`, which is scoped to this element's
//!   own subtree, but unsafe to widen with an ancestor map:
//!   `remap_json_ids` has previously rewritten an unrelated literal (e.g. a
//!   `"type"` value) that happened to equal an id used as a test fixture's
//!   element id, and an ancestor id is far more likely to coincidentally
//!   collide with an ordinary literal (a `"mode"`, endpoint key, or choice
//!   value) than an id scoped to one element's own subtree. So this applies
//!   every reference-bearing field - structural and numeric-expression -
//!   through the same safe, field-specific mechanism.
//! - [`remap_current_invocation_numeric_references`] - a *current*
//!   invocation's own `id_map`. Structural `ElementId` fields (`pointId`,
//!   `lineId`, `baseLineIds[]`, ...) are already remapped by
//!   `remap_json_ids`'s blind exact-string match in `for_group.rs`, which
//!   is safe there because the map is scoped to this element's own
//!   subtree. But `remap_json_ids` only rewrites a JSON string that
//!   *equals* a map key, and a numeric-expression field holds a compound
//!   string like `"<id>.x + 10"` - the id never appears as a whole-string
//!   match, so a sibling reference inside the same forGroup invocation
//!   (e.g. `point B = coordinate(x: @A.x + 10, ...)`) was left pointing at
//!   the original template id. This entry point reuses the exact same
//!   token-aware remap, restricted (via [`ReferenceRemapScope`]) to
//!   numeric-expression tokens only, so it never re-touches the structural
//!   fields `remap_json_ids` already handled.
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
//! (TS applies one merged ancestor+current map through a single remap call
//! instead of splitting the two scopes across two mechanisms; Rust's split
//! is preserved here rather than restructured, since it exists for the
//! blast-radius reason above.)

use serde_json::Value;
use std::collections::HashMap;

use super::numeric_expression::tokenize;
use super::types::{element_type, ElementId, Token};

/// Which reference-bearing fields a remap pass should touch.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReferenceRemapScope {
    /// Every reference-bearing field: structural `ElementId` fields and
    /// numeric-expression `Reference`/`Element` tokens.
    Full,
    /// Only numeric-expression `Reference`/`Element` tokens - structural
    /// `ElementId` fields are assumed already handled by another pass
    /// (`remap_json_ids`) and are left untouched here.
    NumericExpressionsOnly,
}

fn map_id(value: &mut Value, id_map: &HashMap<ElementId, ElementId>) {
    if let Some(text) = value.as_str() {
        if let Some(mapped) = id_map.get(text) {
            *value = Value::String(mapped.clone());
        }
    }
}

fn map_id_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    id_map: &HashMap<ElementId, ElementId>,
    scope: ReferenceRemapScope,
) {
    if scope == ReferenceRemapScope::NumericExpressionsOnly {
        return;
    }
    if let Some(value) = object.get_mut(field) {
        map_id(value, id_map);
    }
}

fn map_id_array_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    id_map: &HashMap<ElementId, ElementId>,
    scope: ReferenceRemapScope,
) {
    if scope == ReferenceRemapScope::NumericExpressionsOnly {
        return;
    }
    if let Some(items) = object.get_mut(field).and_then(Value::as_array_mut) {
        for item in items {
            map_id(item, id_map);
        }
    }
}

/// Renders one token back to expression text. Only `Reference`/`Element`
/// carry an `ElementId` and get remapped; every other token is reproduced
/// exactly as `numeric_expression::tokenize` would re-read it (operators
/// padded with spaces the same way `src/model/elementDuplication.ts`'s
/// `tokenText` pads them, so the reconstructed text re-tokenizes to the
/// same token stream).
fn token_text(token: &Token, id_map: &HashMap<ElementId, ElementId>) -> String {
    match token {
        Token::Number(value) => format!("{value}"),
        Token::Reference {
            element_id,
            property,
        } => {
            let mapped = id_map
                .get(element_id)
                .map(String::as_str)
                .unwrap_or(element_id.as_str());
            format!("{mapped}.{property}")
        }
        Token::Element(element_id) => id_map
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
/// ids) when it actually references a mapped id, mirroring
/// `remapNumericValue`'s early return when nothing changed - this avoids
/// needless text-formatting churn (and keeps TS/Rust parity byte-identical)
/// for the overwhelming majority of expressions that reference nothing in
/// the map. An expression the tokenizer itself cannot parse is left
/// exactly as-is; evaluation will surface its own error for it later.
fn remap_numeric_value(value: &mut Value, id_map: &HashMap<ElementId, ElementId>) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let Some(expression) = object.get("expression").and_then(Value::as_str) else {
        return;
    };
    let Ok(tokens) = tokenize(expression) else {
        return;
    };
    let references_mapped_id = tokens.iter().any(|token| {
        matches!(
            token,
            Token::Reference { element_id, .. } | Token::Element(element_id)
                if id_map.contains_key(element_id)
        )
    });
    if !references_mapped_id {
        return;
    }
    let remapped_expression = tokens
        .iter()
        .map(|token| token_text(token, id_map))
        .collect::<String>();
    object.insert("expression".to_owned(), Value::String(remapped_expression));
}

fn remap_numeric_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    id_map: &HashMap<ElementId, ElementId>,
) {
    if let Some(value) = object.get_mut(field) {
        remap_numeric_value(value, id_map);
    }
}

/// A `PointAnchor`: `mode: "reference"` (`pointId`) and `mode: "derived"`
/// (`elementId`) hold a structural `ElementId`; `mode: "coordinate"` holds
/// plain `NumericValue` x/y, which may themselves be expressions
/// referencing a mapped element's property (`x: A.x + 10`).
fn remap_point_anchor_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    id_map: &HashMap<ElementId, ElementId>,
    scope: ReferenceRemapScope,
) {
    let Some(anchor) = object.get_mut(field) else {
        return;
    };
    let Some(anchor_object) = anchor.as_object_mut() else {
        return;
    };
    match anchor_object.get("mode").and_then(Value::as_str) {
        Some("reference") => map_id_field(anchor_object, "pointId", id_map, scope),
        Some("derived") => map_id_field(anchor_object, "elementId", id_map, scope),
        Some("coordinate") => {
            remap_numeric_field(anchor_object, "x", id_map);
            remap_numeric_field(anchor_object, "y", id_map);
        }
        _ => {}
    }
}

/// A `LineEndpointReference`: `{ lineId, endpointKey }` - only `lineId`
/// holds an `ElementId`; `endpointKey` is a fixed `"start" | "end"` literal.
fn remap_endpoint_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    id_map: &HashMap<ElementId, ElementId>,
    scope: ReferenceRemapScope,
) {
    let Some(endpoint) = object.get_mut(field) else {
        return;
    };
    let Some(endpoint_object) = endpoint.as_object_mut() else {
        return;
    };
    map_id_field(endpoint_object, "lineId", id_map, scope);
}

/// Remaps `element`'s reference fields in place, per `scope`, mirroring
/// `remapElementReferences`'s switch exactly (see module docs for how the
/// two public entry points below use this).
fn remap_element_references(
    element: &mut Value,
    id_map: &HashMap<ElementId, ElementId>,
    scope: ReferenceRemapScope,
) {
    if id_map.is_empty() {
        return;
    }
    let element_type_name = element_type(element).map(ToOwned::to_owned);
    let Some(object) = element.as_object_mut() else {
        return;
    };
    // Every element-local `let`/loop-variable declaration's own value may
    // itself be an expression referencing a mapped element - applies
    // uniformly regardless of type, mirroring remapNumericFields.
    if let Some(variables) = object
        .get_mut("numericVariables")
        .and_then(Value::as_array_mut)
    {
        for variable in variables {
            if let Some(variable_object) = variable.as_object_mut() {
                remap_numeric_field(variable_object, "value", id_map);
            }
        }
    }
    match element_type_name.as_deref() {
        Some("conditionalGroup") => {
            remap_numeric_field(object, "condition", id_map);
        }
        Some("forGroup") => {
            remap_numeric_field(object, "start", id_map);
            remap_numeric_field(object, "count", id_map);
            remap_numeric_field(object, "step", id_map);
        }
        Some("freePoint") => {
            remap_numeric_field(object, "x", id_map);
            remap_numeric_field(object, "y", id_map);
        }
        Some("offsetPoint") => {
            remap_point_anchor_field(object, "fromPoint", id_map, scope);
            map_id_field(object, "fromPointId", id_map, scope);
            remap_numeric_field(object, "dx", id_map);
            remap_numeric_field(object, "dy", id_map);
        }
        Some("polarOffsetPoint") => {
            remap_point_anchor_field(object, "fromPoint", id_map, scope);
            map_id_field(object, "fromPointId", id_map, scope);
            remap_numeric_field(object, "angleDeg", id_map);
            remap_numeric_field(object, "distance", id_map);
        }
        Some("divisionPoint") => {
            remap_point_anchor_field(object, "startPoint", id_map, scope);
            remap_point_anchor_field(object, "endPoint", id_map, scope);
            if let Some(placement) = object.get_mut("placement").and_then(Value::as_object_mut) {
                remap_numeric_field(placement, "value", id_map);
            }
        }
        Some("lineDivisionPoint") => {
            remap_endpoint_field(object, "endpoint", id_map, scope);
            if let Some(placement) = object.get_mut("placement").and_then(Value::as_object_mut) {
                remap_numeric_field(placement, "value", id_map);
            }
        }
        Some("intersectionPoint") => {
            map_id_field(object, "line1Id", id_map, scope);
            map_id_field(object, "line2Id", id_map, scope);
            remap_numeric_field(object, "intersectionIndex", id_map);
        }
        Some("lineTangentOffsetPoint") => {
            map_id_field(object, "baseLineId", id_map, scope);
            remap_point_anchor_field(object, "basePoint", id_map, scope);
            remap_numeric_field(object, "tangentAngleDeg", id_map);
            remap_numeric_field(object, "distance", id_map);
        }
        Some("line") => {
            remap_point_anchor_field(object, "startPoint", id_map, scope);
            remap_point_anchor_field(object, "endPoint", id_map, scope);
        }
        Some("angleLengthLine") => {
            remap_point_anchor_field(object, "startPoint", id_map, scope);
            remap_numeric_field(object, "angleDeg", id_map);
            remap_numeric_field(object, "length", id_map);
        }
        Some("arcLine") => {
            remap_point_anchor_field(object, "centerPoint", id_map, scope);
            remap_numeric_field(object, "radius", id_map);
            remap_numeric_field(object, "startAngleDeg", id_map);
            remap_numeric_field(object, "endAngleDeg", id_map);
        }
        Some("threePointArcLine") => {
            remap_point_anchor_field(object, "point1", id_map, scope);
            remap_point_anchor_field(object, "point2", id_map, scope);
            remap_point_anchor_field(object, "point3", id_map, scope);
            remap_numeric_field(object, "startAngleDeg", id_map);
            remap_numeric_field(object, "endAngleDeg", id_map);
        }
        Some("cornerRadiusArcLine") | Some("edge") => {
            remap_endpoint_field(object, "endpoint1", id_map, scope);
            remap_endpoint_field(object, "endpoint2", id_map, scope);
            remap_numeric_field(object, "intersectionIndex", id_map);
            if object.contains_key("radius") {
                remap_numeric_field(object, "radius", id_map);
            }
        }
        Some("extendTrim") => {
            remap_endpoint_field(object, "endpoint", id_map, scope);
            remap_point_anchor_field(object, "point", id_map, scope);
        }
        Some("pathReverse") => {
            map_id_field(object, "targetLineId", id_map, scope);
        }
        Some("bezierCurve") => {
            remap_point_anchor_field(object, "startPoint", id_map, scope);
            remap_numeric_field(object, "startHandleAngleDeg", id_map);
            remap_numeric_field(object, "startHandleLength", id_map);
            if let Some(points) = object
                .get_mut("intermediatePoints")
                .and_then(Value::as_array_mut)
            {
                for point_entry in points {
                    if let Some(point_object) = point_entry.as_object_mut() {
                        remap_point_anchor_field(point_object, "point", id_map, scope);
                        remap_numeric_field(point_object, "handleAngleDeg", id_map);
                        remap_numeric_field(point_object, "incomingHandleLength", id_map);
                        remap_numeric_field(point_object, "outgoingHandleLength", id_map);
                    }
                }
            }
            remap_point_anchor_field(object, "endPoint", id_map, scope);
            remap_numeric_field(object, "endHandleAngleDeg", id_map);
            remap_numeric_field(object, "endHandleLength", id_map);
        }
        Some("offsetLine") => {
            map_id_array_field(object, "baseLineIds", id_map, scope);
            remap_numeric_field(object, "offset", id_map);
        }
        Some("splitLine") => {
            map_id_field(object, "baseLineId", id_map, scope);
            remap_point_anchor_field(object, "splitPoint", id_map, scope);
        }
        Some("copyLine") | Some("move") => {
            remap_point_anchor_field(object, "startPoint", id_map, scope);
            remap_point_anchor_field(object, "endPoint", id_map, scope);
            remap_numeric_field(object, "scale", id_map);
            remap_numeric_field(object, "angleDeg", id_map);
            map_id_array_field(object, "baseLineIds", id_map, scope);
        }
        Some("symmetricCopyLine") | Some("symmetricMove") => {
            remap_point_anchor_field(object, "axisPoint1", id_map, scope);
            remap_point_anchor_field(object, "axisPoint2", id_map, scope);
            map_id_array_field(object, "baseLineIds", id_map, scope);
        }
        Some("image") => {
            remap_point_anchor_field(object, "originPoint", id_map, scope);
            remap_numeric_field(object, "scale", id_map);
            remap_numeric_field(object, "angleDeg", id_map);
        }
        Some("text") => {
            // `anchor` may be `null` (no anchor) - remap_point_anchor_field
            // already no-ops on a non-object value, so no extra guard is needed.
            remap_point_anchor_field(object, "anchor", id_map, scope);
            remap_numeric_field(object, "fontSize", id_map);
        }
        _ => {}
    }
}

/// Remaps `element`'s reference fields (structural ids and numeric
/// expressions) in place, widened to also resolve ids owned by enclosing
/// forGroup invocations. `element` must already have its own
/// `id`/`parentGroupId`/current-invocation reference remap applied (via
/// `remap_json_ids` + the explicit `parentGroupId` fix in
/// `expand_for_group_iteration_from_template`) - this function only adds
/// the ancestor-scoped resolution on top.
pub(crate) fn remap_ancestor_element_references(
    element: &mut Value,
    ancestor_element_id_map: &HashMap<ElementId, ElementId>,
) {
    remap_element_references(element, ancestor_element_id_map, ReferenceRemapScope::Full);
}

/// Extends a current forGroup invocation's own structural id remap
/// (`remap_json_ids` in `for_group.rs`, a blind whole-string match) to also
/// cover numeric-expression tokens, which that blind match can never reach
/// because the id is embedded inside a larger expression string (e.g.
/// `"<id>.x + 10"`). Structural fields are intentionally left untouched
/// here - `remap_json_ids` already remapped them to generated ids by the
/// time this runs, so re-running the structural half of
/// `remap_element_references` over the same `id_map` would only be a
/// redundant no-op walk, not a correctness fix; skipping it keeps this
/// pass's effect limited to exactly the gap `remap_json_ids` leaves.
pub(crate) fn remap_current_invocation_numeric_references(
    element: &mut Value,
    id_map: &HashMap<ElementId, ElementId>,
) {
    remap_element_references(element, id_map, ReferenceRemapScope::NumericExpressionsOnly);
}
