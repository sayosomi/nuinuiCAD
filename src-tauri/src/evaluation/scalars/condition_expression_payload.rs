//! Task 25 IPC payload decode/validation for `conditionalGroup.condition`
//! typed boolean expressions. Unlike `control_boolean_payload.rs` (a single
//! `@name` binding reference, same shape as Task 23's property bindings),
//! `condition` is a full typed boolean *expression* - so this module
//! decodes each entry's `expression` field through Task 17's existing
//! `validate_typed_expression_payload` (reused, not duplicated: that
//! decoder's structural/semantic AST validation is already fully generic)
//! rather than a bindingId lookup.
//!
//! Every decode failure is a hard `Err` for the whole array - a malformed
//! entry is never silently skipped or allowed to shadow a valid one,
//! matching `property_binding_payload.rs`'s existing all-or-nothing
//! contract. Per entry, this module independently (never trusting that TS
//! already typechecked it) verifies: entry shape, that `elementId` matches
//! a real element, that the owning element's type is literally
//! `"conditionalGroup"`, that no `elementId` is duplicated across entries,
//! that the expression payload itself is well-formed, and that its root
//! node's own `type` is `Boolean`.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::types::{ScalarType, TypedScalarExpression};
use crate::evaluation::types::ElementId;

#[derive(Debug)]
pub(crate) struct ValidatedConditionExpression {
    pub(crate) element_id: ElementId,
    pub(crate) expression: TypedScalarExpression,
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

/// The decoded AST's own root `type` field - every `TypedScalarExpression`
/// variant carries one, mirroring TS's per-node `type`/`r#type`.
fn root_type(expression: &TypedScalarExpression) -> Option<ScalarType> {
    match expression {
        TypedScalarExpression::NumberLiteral { r#type, .. } => Some(r#type.clone()),
        TypedScalarExpression::StringLiteral { r#type, .. } => Some(r#type.clone()),
        TypedScalarExpression::BooleanLiteral { r#type, .. } => Some(r#type.clone()),
        TypedScalarExpression::ChoiceLiteral { r#type, .. } => r#type.clone(),
        TypedScalarExpression::Reference { r#type, .. } => r#type.clone(),
        TypedScalarExpression::GeometryProperty { r#type, .. } => Some(r#type.clone()),
        TypedScalarExpression::Unary { r#type, .. } => r#type.clone(),
        TypedScalarExpression::Binary { r#type, .. } => r#type.clone(),
        TypedScalarExpression::Group { r#type, .. } => r#type.clone(),
        TypedScalarExpression::Call { r#type, .. } => r#type.clone(),
    }
}

fn decode_condition_expression(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    seen_element_ids: &mut HashSet<String>,
) -> Result<ValidatedConditionExpression, ScalarPayloadIssue> {
    let object = as_object(json, "condition expression")?;
    reject_unexpected_fields(object, &["elementId", "expression"], "condition expression")?;

    let element_id = non_empty_string(
        require_field(object, "elementId", "condition expression")?,
        "condition expression elementId",
    )?
    .to_owned();

    let element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("condition expression elementId \"{element_id}\" does not match any element"),
        )
    })?;
    if *element_type != "conditionalGroup" {
        return Err(issue(
            Code::InvalidFieldType,
            format!(
                "condition expression elementId \"{element_id}\" is a \"{element_type}\", not a \"conditionalGroup\""
            ),
        ));
    }

    if !seen_element_ids.insert(element_id.clone()) {
        return Err(issue(
            Code::UnexpectedField,
            format!("duplicate condition expression for \"{element_id}\""),
        ));
    }

    let expression = validate_typed_expression_payload(require_field(
        object,
        "expression",
        "condition expression",
    )?)?;

    if root_type(&expression) != Some(ScalarType::Boolean) {
        return Err(issue(
            Code::InvalidFieldType,
            format!("condition expression for \"{element_id}\" must have a boolean root type"),
        ));
    }

    Ok(ValidatedConditionExpression {
        element_id,
        expression,
    })
}

/// Decodes and validates the whole `conditionExpressions` array. See the
/// module doc for the full fail-closed checklist; a malformed entry fails
/// the whole array rather than being silently skipped.
pub(crate) fn validate_condition_expressions_payload(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
) -> Result<Vec<ValidatedConditionExpression>, ScalarPayloadIssue> {
    let array = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            "condition expressions must be an array",
        )
    })?;
    let mut seen_element_ids = HashSet::new();
    let mut decoded = Vec::with_capacity(array.len());
    for entry in array {
        decoded.push(decode_condition_expression(
            entry,
            element_type_by_id,
            &mut seen_element_ids,
        )?);
    }
    Ok(decoded)
}
