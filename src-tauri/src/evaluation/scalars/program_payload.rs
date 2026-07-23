//! Inert Task 19 scalar-program envelope validation. It validates the JSON
//! boundary and delegates every initializer AST to Task 17's validator; it
//! does not evaluate declarations or resolve names.

use std::collections::HashSet;

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
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

fn validate_declaration(json: &Value) -> Result<(), ScalarPayloadIssue> {
    let object = as_object(json, "scalar program declaration")?;
    reject_unexpected_fields(
        object,
        &["bindingKind", "declaredType", "initializer"],
        "scalar program declaration",
    )?;
    match non_empty_string(
        require_field(object, "bindingKind", "scalar program declaration")?,
        "scalar program declaration bindingKind",
    )? {
        "const" | "let" => {}
        _ => {
            return Err(issue(
                Code::InvalidFieldType,
                "scalar program declaration bindingKind must be const or let",
            ))
        }
    }
    let _declared_type = decode_scalar_type(require_field(
        object,
        "declaredType",
        "scalar program declaration",
    )?)?;
    let _initializer = validate_typed_expression_payload(require_field(
        object,
        "initializer",
        "scalar program declaration",
    )?)?;
    Ok(())
}

fn validate_statement(
    json: &Value,
    binding_ids: &mut HashSet<String>,
) -> Result<(), ScalarPayloadIssue> {
    let object = as_object(json, "scalar program statement")?;
    reject_unexpected_fields(
        object,
        &["kind", "bindingId", "scopeId", "sourceOrder", "declaration"],
        "scalar program statement",
    )?;
    if non_empty_string(
        require_field(object, "kind", "scalar program statement")?,
        "scalar program statement kind",
    )? != "declare"
    {
        return Err(issue(
            Code::UnknownKind,
            "unknown scalar program statement kind",
        ));
    }
    let binding_id = non_empty_string(
        require_field(object, "bindingId", "scalar program statement")?,
        "scalar program statement bindingId",
    )?;
    if !binding_ids.insert(binding_id.to_owned()) {
        return Err(issue(
            Code::InvalidBindingId,
            "scalar program bindingId must be unique",
        ));
    }
    non_empty_string(
        require_field(object, "scopeId", "scalar program statement")?,
        "scalar program statement scopeId",
    )?;
    require_field(object, "sourceOrder", "scalar program statement")?
        .as_u64()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program sourceOrder must be a non-negative integer",
            )
        })?;
    validate_declaration(require_field(
        object,
        "declaration",
        "scalar program statement",
    )?)
}

pub(crate) fn validate_scalar_program_payload(json: &Value) -> Result<(), ScalarPayloadIssue> {
    let object = as_object(json, "scalar program")?;
    reject_unexpected_fields(
        object,
        &["statements", "evaluationLimitSourceOrder"],
        "scalar program",
    )?;
    let statements = require_field(object, "statements", "scalar program")?
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program statements must be an array",
            )
        })?;
    let mut binding_ids = HashSet::new();
    for statement in statements {
        validate_statement(statement, &mut binding_ids)?;
    }
    if let Some(limit) = object.get("evaluationLimitSourceOrder") {
        limit.as_u64().ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program evaluationLimitSourceOrder must be a non-negative integer",
            )
        })?;
    }
    Ok(())
}
