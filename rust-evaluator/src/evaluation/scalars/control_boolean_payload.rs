//! IPC payload decode/validation for control-property values. The frontend
//! supplies the schema-derived expected type and either a stable binding ID
//! or a typed expression; Rust does not maintain a property allowlist or
//! parse source text.

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

fn decode_control_boolean_binding(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    valid_binding_ids: &HashSet<&str>,
    seen_pairs: &mut HashSet<(String, String)>,
) -> Result<ValidatedPropertyBinding, ScalarPayloadIssue> {
    let object = as_object(json, "control boolean binding")?;
    reject_unexpected_fields(
        object,
        &[
            "elementId",
            "parameterKey",
            "bindingId",
            "expression",
            "expectedType",
        ],
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
    let binding_id = object
        .get("bindingId")
        .map(|value| {
            non_empty_string(value, "control boolean binding bindingId").map(ToOwned::to_owned)
        })
        .transpose()?;
    let expression = object
        .get("expression")
        .map(validate_typed_expression_payload)
        .transpose()?;
    if binding_id.is_some() == expression.is_some() {
        return Err(issue(
            Code::InvalidFieldType,
            "control boolean binding must contain exactly one of bindingId or expression",
        ));
    }
    let expected_type = decode_scalar_type(require_field(
        object,
        "expectedType",
        "control boolean binding",
    )?)?;

    let _element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!(
                "control boolean binding elementId \"{element_id}\" does not match any element"
            ),
        )
    })?;

    if !seen_pairs.insert((element_id.clone(), parameter_key.clone())) {
        return Err(issue(
            Code::UnexpectedField,
            format!("duplicate control boolean binding for \"{element_id}:{parameter_key}\""),
        ));
    }

    if let Some(binding_id) = &binding_id {
        if !valid_binding_ids.contains(binding_id.as_str()) {
            return Err(issue(
                Code::InvalidBindingId,
                format!(
                    "control boolean binding bindingId \"{binding_id}\" does not exist in the scalar program"
                ),
            ));
        }
    }
    if let Some(expression) = &expression {
        validate_expression_expected_type(expression, &expected_type, "control boolean binding")?;
    }

    Ok(ValidatedPropertyBinding {
        element_id,
        parameter_key,
        binding_id,
        expression,
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
