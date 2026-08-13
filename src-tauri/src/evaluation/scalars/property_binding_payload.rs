//! IPC payload decode/validation for schema-driven property values. Type and
//! name resolution already happened in the TypeScript frontend; Rust only
//! validates the JSON shape, stable IDs, and the typed AST contract before
//! evaluating an already-compiled source.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::scalar_payload::decode_scalar_type;
use super::types::{BindingId, ScalarType, TypedScalarExpression};

#[derive(Debug)]
pub(crate) struct ValidatedPropertyBinding {
    pub(crate) element_id: String,
    pub(crate) parameter_key: String,
    pub(crate) binding_id: Option<BindingId>,
    pub(crate) expression: Option<TypedScalarExpression>,
    pub(crate) expected_type: ScalarType,
}

pub(crate) fn declared_type(expression: &TypedScalarExpression) -> Option<ScalarType> {
    match expression {
        TypedScalarExpression::NumberLiteral { r#type, .. }
        | TypedScalarExpression::StringLiteral { r#type, .. }
        | TypedScalarExpression::BooleanLiteral { r#type, .. }
        | TypedScalarExpression::GeometryProperty { r#type, .. } => Some(r#type.clone()),
        TypedScalarExpression::ChoiceLiteral { r#type, .. }
        | TypedScalarExpression::Reference { r#type, .. }
        | TypedScalarExpression::Unary { r#type, .. }
        | TypedScalarExpression::Binary { r#type, .. }
        | TypedScalarExpression::Group { r#type, .. } => r#type.clone(),
    }
}

pub(crate) fn validate_expression_expected_type(
    expression: &TypedScalarExpression,
    expected_type: &ScalarType,
    context: &str,
) -> Result<(), ScalarPayloadIssue> {
    let Some(actual_type) = declared_type(expression) else {
        return Err(issue(
            Code::InvalidFieldType,
            format!("{context} expression must have a non-null declared type"),
        ));
    };
    if &actual_type != expected_type {
        return Err(issue(
            Code::InvalidFieldType,
            format!("{context} expression type does not match expectedType"),
        ));
    }
    Ok(())
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
        &[
            "elementId",
            "parameterKey",
            "bindingId",
            "expression",
            "expectedType",
        ],
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
    let binding_id = object
        .get("bindingId")
        .map(|value| non_empty_string(value, "property binding bindingId").map(ToOwned::to_owned))
        .transpose()?;
    let expression = object
        .get("expression")
        .map(validate_typed_expression_payload)
        .transpose()?;
    if binding_id.is_some() == expression.is_some() {
        return Err(issue(
            Code::InvalidFieldType,
            "property binding must contain exactly one of bindingId or expression",
        ));
    }
    let expected_type =
        decode_scalar_type(require_field(object, "expectedType", "property binding")?)?;

    let _element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("property binding elementId \"{element_id}\" does not match any element"),
        )
    })?;

    if !seen_pairs.insert((element_id.clone(), parameter_key.clone())) {
        return Err(issue(
            Code::UnexpectedField,
            format!("duplicate property binding for \"{element_id}:{parameter_key}\""),
        ));
    }

    if let Some(binding_id) = &binding_id {
        if !valid_binding_ids.contains(binding_id.as_str()) {
            return Err(issue(
                Code::InvalidBindingId,
                format!(
                    "property binding bindingId \"{binding_id}\" does not exist in the scalar program"
                ),
            ));
        }
    }
    if let Some(expression) = &expression {
        validate_expression_expected_type(expression, &expected_type, "property binding")?;
    }

    Ok(ValidatedPropertyBinding {
        element_id,
        parameter_key,
        binding_id,
        expression,
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
