//! Small shared helpers for the hand-rolled, fail-closed `serde_json::Value`
//! decoders in `scalar_payload.rs`/`expression_payload.rs`. A derive-based
//! `#[serde(tag = "...")]` decode can't produce our own stable issue codes
//! per failure category, and can't interleave a depth/size guard mid-walk -
//! so this module mirrors `src/scalars/scalarJson.ts`'s own hand-rolled
//! approach instead, one level up (adding the AST tree on top of
//! type/value/evaluation).

use serde_json::{Map, Value};

use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};

pub(crate) fn issue(code: Code, message: impl Into<String>) -> ScalarPayloadIssue {
    ScalarPayloadIssue::new(code, message)
}

pub(crate) fn as_object<'a>(
    json: &'a Value,
    context: &str,
) -> Result<&'a Map<String, Value>, ScalarPayloadIssue> {
    json.as_object().ok_or_else(|| {
        issue(
            Code::NotAnObject,
            format!("{context} must be a JSON object"),
        )
    })
}

pub(crate) fn require_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<&'a Value, ScalarPayloadIssue> {
    object.get(key).ok_or_else(|| {
        issue(
            Code::MissingField,
            format!("{context} is missing required field \"{key}\""),
        )
    })
}

/// Rejects any key in `object` that is not in `allowed` - this is the
/// "surplus field" half of fail-closed shape validation (missing/wrong-type
/// fields are rejected individually by each field's own decode call).
pub(crate) fn reject_unexpected_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
    context: &str,
) -> Result<(), ScalarPayloadIssue> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(issue(
                Code::UnexpectedField,
                format!("{context} has unexpected field \"{key}\""),
            ));
        }
    }
    Ok(())
}
