//! IPC payload decode/validation for text-property values. Bare references
//! and compound typed expressions arrive through the same schema-driven DTO;
//! quoted text templates remain a separate presentation feature.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::property_binding_payload::{
    validate_expression_expected_type, ValidatedPropertyBinding,
};
use super::scalar_payload::decode_scalar_type;
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
        &[
            "elementId",
            "parameterKey",
            "bindingId",
            "expression",
            "expectedType",
        ],
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
    let binding_id = object
        .get("bindingId")
        .map(|value| {
            non_empty_string(value, "text property binding bindingId").map(ToOwned::to_owned)
        })
        .transpose()?;
    let expression = object
        .get("expression")
        .map(validate_typed_expression_payload)
        .transpose()?;
    if binding_id.is_some() == expression.is_some() {
        return Err(issue(
            Code::InvalidFieldType,
            "text property binding must contain exactly one of bindingId or expression",
        ));
    }
    let expected_type = decode_scalar_type(require_field(
        object,
        "expectedType",
        "text property binding",
    )?)?;

    let _element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("text property binding elementId \"{element_id}\" does not match any element"),
        )
    })?;

    if !seen_pairs.insert((element_id.clone(), parameter_key.clone())) {
        return Err(issue(
            Code::UnexpectedField,
            format!("duplicate text property binding for \"{element_id}:{parameter_key}\""),
        ));
    }

    if let Some(binding_id) = &binding_id {
        if !valid_binding_ids.contains(binding_id.as_str()) {
            return Err(issue(
                Code::InvalidBindingId,
                format!(
                    "text property binding bindingId \"{binding_id}\" does not exist in the scalar runtime"
                ),
            ));
        }
    }
    if let Some(expression) = &expression {
        validate_expression_expected_type(expression, &expected_type, "text property binding")?;
    }

    Ok(ValidatedPropertyBinding {
        element_id,
        parameter_key,
        binding_id,
        expression,
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
