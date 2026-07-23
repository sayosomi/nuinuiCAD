//! Task 25 IPC payload decode/validation for `forGroup.showGenerated`
//! typed-boolean property bindings. Mirrors `property_binding_payload.rs`'s
//! strict-allowlist decode pattern exactly (that file's own doc comment
//! calls this kind of small, stable per-task duplication deliberate, not a
//! shortcut), but with its own 1-entry `canonical_expected_type` allowlist -
//! this is Task 25's own runtime scope boundary, not an extension of Task
//! 23's `("offsetLine","side")`-style 7-entry list, which explicitly says
//! extending it is each later task's own responsibility.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::property_binding_payload::ValidatedPropertyBinding;
use super::scalar_payload::decode_scalar_type;
use super::types::ScalarType;

/// The only (element type, parameter key) pair Task 25 connects through this
/// module, and its canonical `ScalarType` - kept in sync with TS's
/// `controlBooleanRuntime.ts`'s `CONTROL_BOOLEAN_PROPERTY_TARGETS`.
fn canonical_expected_type(element_type: &str, parameter_key: &str) -> Option<ScalarType> {
    match (element_type, parameter_key) {
        ("forGroup", "showGenerated") => Some(ScalarType::Boolean),
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

fn decode_control_boolean_binding(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
    seen_pairs: &mut HashSet<(String, String)>,
) -> Result<ValidatedPropertyBinding, ScalarPayloadIssue> {
    let object = as_object(json, "control boolean binding")?;
    reject_unexpected_fields(
        object,
        &["elementId", "parameterKey", "bindingId", "expectedType"],
        "control boolean binding",
    )?;

    let element_id = non_empty_string(
        require_field(object, "elementId", "control boolean binding")?,
        "control boolean binding elementId",
    )?
    .to_owned();
    let parameter_key = non_empty_string(
        require_field(object, "parameterKey", "control boolean binding")?,
        "control boolean binding parameterKey",
    )?
    .to_owned();
    let binding_id = non_empty_string(
        require_field(object, "bindingId", "control boolean binding")?,
        "control boolean binding bindingId",
    )?
    .to_owned();
    let expected_type = decode_scalar_type(require_field(
        object,
        "expectedType",
        "control boolean binding",
    )?)?;

    let element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!(
                "control boolean binding elementId \"{element_id}\" does not match any element"
            ),
        )
    })?;

    let canonical = canonical_expected_type(element_type, &parameter_key).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("\"{element_type}.{parameter_key}\" is not a supported control boolean binding target"),
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
            format!("duplicate control boolean binding for \"{element_id}:{parameter_key}\""),
        ));
    }

    if !valid_binding_ids.contains(binding_id.as_str()) {
        return Err(issue(
            Code::InvalidBindingId,
            format!(
                "control boolean binding bindingId \"{binding_id}\" does not exist in the scalar program"
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

/// Decodes and validates the whole `controlBooleanBindings` array. Same
/// all-or-nothing, fail-closed contract as
/// `validate_property_bindings_payload`: a malformed entry fails the whole
/// array rather than being silently skipped or allowed to shadow a valid one.
pub(crate) fn validate_control_boolean_bindings_payload(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
) -> Result<Vec<ValidatedPropertyBinding>, ScalarPayloadIssue> {
    let array = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            "control boolean bindings must be an array",
        )
    })?;
    let mut seen_pairs = HashSet::new();
    let mut decoded = Vec::with_capacity(array.len());
    for entry in array {
        decoded.push(decode_control_boolean_binding(
            entry,
            element_type_by_id,
            valid_binding_ids,
            &mut seen_pairs,
        )?);
    }
    Ok(decoded)
}
