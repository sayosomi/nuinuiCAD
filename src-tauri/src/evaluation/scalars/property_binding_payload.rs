//! Task 23 IPC payload decode/validation for standard boolean/choice
//! property bindings. Mirrors `program_payload.rs`'s strict-allowlist decode
//! pattern, but unlike that module (which trusts Task 19's already-computed
//! program eligibility without re-deriving it), this module independently
//! validates *which* (element type, parameter key) pairs are legitimate
//! "standard" targets and what their canonical expected `ScalarType` is -
//! the IPC payload is untrusted input, so Rust does not simply take TS's own
//! claim about a pair's validity or expected type at face value.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::scalar_payload::decode_scalar_type;
use super::types::{BindingId, ScalarType};

#[derive(Debug)]
pub(crate) struct ValidatedPropertyBinding {
    pub(crate) element_id: String,
    pub(crate) parameter_key: String,
    pub(crate) binding_id: BindingId,
    pub(crate) expected_type: ScalarType,
}

/// The only (element type, parameter key) pairs Task 23 connects, and their
/// canonical `ScalarType` - kept in sync with TS's
/// `propertyBindingRuntime.ts`'s `STANDARD_PROPERTY_TARGETS` /
/// `parameterDefinitions.ts`'s `propertyBindingCapabilities`. This is a
/// deliberate, small (7-entry), stable duplication across the IPC boundary,
/// not a shortcut - extending it (e.g. for Task 24's `group.printEnabled`)
/// is that later task's own responsibility, not something to grow ahead of need.
fn canonical_expected_type(element_type: &str, parameter_key: &str) -> Option<ScalarType> {
    match (element_type, parameter_key) {
        ("offsetLine", "side") => Some(ScalarType::Choice {
            options: vec!["right".to_owned(), "left".to_owned()],
        }),
        ("offsetLine", "closed") => Some(ScalarType::Boolean),
        ("offsetLine", "suppressTrimWarnings") => Some(ScalarType::Boolean),
        ("intersectionPoint", "useExtensions") => Some(ScalarType::Boolean),
        ("copyLine", "mirrorX") => Some(ScalarType::Boolean),
        ("move", "mirrorX") => Some(ScalarType::Boolean),
        ("image", "mirrorX") => Some(ScalarType::Boolean),
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

fn decode_property_binding(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
    seen_pairs: &mut HashSet<(String, String)>,
) -> Result<ValidatedPropertyBinding, ScalarPayloadIssue> {
    let object = as_object(json, "property binding")?;
    reject_unexpected_fields(
        object,
        &["elementId", "parameterKey", "bindingId", "expectedType"],
        "property binding",
    )?;

    let element_id = non_empty_string(
        require_field(object, "elementId", "property binding")?,
        "property binding elementId",
    )?
    .to_owned();
    let parameter_key = non_empty_string(
        require_field(object, "parameterKey", "property binding")?,
        "property binding parameterKey",
    )?
    .to_owned();
    let binding_id = non_empty_string(
        require_field(object, "bindingId", "property binding")?,
        "property binding bindingId",
    )?
    .to_owned();
    let expected_type =
        decode_scalar_type(require_field(object, "expectedType", "property binding")?)?;

    let element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("property binding elementId \"{element_id}\" does not match any element"),
        )
    })?;

    let canonical = canonical_expected_type(element_type, &parameter_key).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("\"{element_type}.{parameter_key}\" is not a supported standard property binding target"),
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
            format!("duplicate property binding for \"{element_id}:{parameter_key}\""),
        ));
    }

    if !valid_binding_ids.contains(binding_id.as_str()) {
        return Err(issue(
            Code::InvalidBindingId,
            format!(
                "property binding bindingId \"{binding_id}\" does not exist in the scalar program"
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

/// Decodes and validates the whole `propertyBindings` array. `element_type_by_id`
/// must cover every real element in the document (built by the caller from
/// `input.elements`); `valid_binding_ids` must be exactly the `scalar_program`'s
/// own decoded statement binding ids (an empty set - i.e. no `scalar_program`
/// at all - fails every entry closed, matching the fixed spec: property
/// bindings without a scalar program are a caller-contract violation, never
/// a silent fallback to literal values).
pub(crate) fn validate_property_bindings_payload(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
) -> Result<Vec<ValidatedPropertyBinding>, ScalarPayloadIssue> {
    let array = json
        .as_array()
        .ok_or_else(|| issue(Code::InvalidFieldType, "property bindings must be an array"))?;
    let mut seen_pairs = HashSet::new();
    let mut decoded = Vec::with_capacity(array.len());
    for entry in array {
        decoded.push(decode_property_binding(
            entry,
            element_type_by_id,
            valid_binding_ids,
            &mut seen_pairs,
        )?);
    }
    Ok(decoded)
}
