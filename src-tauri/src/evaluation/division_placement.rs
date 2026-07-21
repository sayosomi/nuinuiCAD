use serde_json::Value;

/// A divisionPoint/lineDivisionPoint's resolved placement kind. This is the only
/// place a missing or unrecognized `placement.kind` is treated as ratio -- every
/// evaluator that reads a division element's placement goes through
/// `decode_division_placement` instead of re-checking the raw JSON string itself.
pub(crate) enum DivisionPlacementKind {
    Distance,
    Ratio,
}

/// Reads `element.placement` and returns its kind (defaulting anything other than
/// `"distance"` to `Ratio`, matching the TypeScript reference evaluator's identical
/// fallback) alongside the raw `value` node for the caller to evaluate numerically.
pub(crate) fn decode_division_placement(element: &Value) -> (DivisionPlacementKind, &Value) {
    let placement = element.get("placement");
    let kind = if placement
        .and_then(|p| p.get("kind"))
        .and_then(Value::as_str)
        == Some("distance")
    {
        DivisionPlacementKind::Distance
    } else {
        DivisionPlacementKind::Ratio
    };
    let value = placement
        .and_then(|p| p.get("value"))
        .unwrap_or(&Value::Null);
    (kind, value)
}
