//! Task 28 IPC payload decode/validation for the bare `@binding` `text.text`
//! property (a plain string-typed property binding, distinct from a quoted
//! `"...{...}..."` compiled template - see `text_template_payload.rs`).
//! Mirrors `control_boolean_payload.rs`'s strict-allowlist decode pattern
//! exactly - its own doc comment calls this kind of small, stable per-task
//! duplication deliberate, not a shortcut - but with its own 1-entry
//! `canonical_expected_type` allowlist: `("text", "text") => String`. This is
//! Task 28's own runtime scope boundary, not an extension of Task 23's
//! 7-entry `("offsetLine","side")`-style list.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::property_binding_payload::ValidatedPropertyBinding;
use super::scalar_payload::decode_scalar_type;
use super::types::ScalarType;

/// The only (element type, parameter key) pair this module connects, and its
/// canonical `ScalarType` - kept in sync with TS's `textTemplateRuntime.ts`'s
/// `TEXT_PROPERTY_TARGETS`.
fn canonical_expected_type(element_type: &str, parameter_key: &str) -> Option<ScalarType> {
    match (element_type, parameter_key) {
        ("text", "text") => Some(ScalarType::String),
        _ => None,
    }
}

fn non_empty_string<'a>(json: &'a Value, context: &str) -> Result<&'a str, ScalarPayloadIssue> {
    json.as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                format!("{context} must be a non-empty string"),
            )
        })
}

fn decode_text_property_binding(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
    seen_pairs: &mut HashSet<(String, String)>,
) -> Result<ValidatedPropertyBinding, ScalarPayloadIssue> {
    let object = as_object(json, "text property binding")?;
    reject_unexpected_fields(
        object,
        &["elementId", "parameterKey", "bindingId", "expectedType"],
        "text property binding",
    )?;

    let element_id = non_empty_string(
        require_field(object, "elementId", "text property binding")?,
        "text property binding elementId",
    )?
    .to_owned();
    let parameter_key = non_empty_string(
        require_field(object, "parameterKey", "text property binding")?,
        "text property binding parameterKey",
    )?
    .to_owned();
    let binding_id = non_empty_string(
        require_field(object, "bindingId", "text property binding")?,
        "text property binding bindingId",
    )?
    .to_owned();
    let expected_type = decode_scalar_type(require_field(
        object,
        "expectedType",
        "text property binding",
    )?)?;

    let element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("text property binding elementId \"{element_id}\" does not match any element"),
        )
    })?;

    let canonical = canonical_expected_type(element_type, &parameter_key).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("\"{element_type}.{parameter_key}\" is not a supported text property binding target"),
        )
    })?;
    if canonical != expected_type {
        return Err(issue(
            Code::InvalidFieldType,
            format!(
                "\"{element_type}.{parameter_key}\" expectedType does not match its canonical type"
            ),
        ));
    }

    if !seen_pairs.insert((element_id.clone(), parameter_key.clone())) {
        return Err(issue(
            Code::UnexpectedField,
            format!("duplicate text property binding for \"{element_id}:{parameter_key}\""),
        ));
    }

    if !valid_binding_ids.contains(binding_id.as_str()) {
        return Err(issue(
            Code::InvalidBindingId,
            format!(
                "text property binding bindingId \"{binding_id}\" does not exist in the scalar runtime"
            ),
        ));
    }

    Ok(ValidatedPropertyBinding {
        element_id,
        parameter_key,
        binding_id,
        expected_type,
    })
}

/// Decodes and validates the whole `textPropertyBindings` array. Same
/// all-or-nothing, fail-closed contract as `validate_property_bindings_payload`:
/// a malformed entry fails the whole array rather than being silently
/// skipped, and an empty/absent `valid_binding_ids` (no scalar runtime)
/// fails every entry closed rather than falling back to a literal value - a
/// bare `text.text` binding is always typed content, so it requires either a
/// scalar program or binding versions.
pub(crate) fn validate_text_property_bindings_payload(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
) -> Result<Vec<ValidatedPropertyBinding>, ScalarPayloadIssue> {
    let array = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            "text property bindings must be an array",
        )
    })?;
    let mut seen_pairs = HashSet::new();
    let mut decoded = Vec::with_capacity(array.len());
    for entry in array {
        decoded.push(decode_text_property_binding(
            entry,
            element_type_by_id,
            valid_binding_ids,
            &mut seen_pairs,
        )?);
    }
    Ok(decoded)
}
