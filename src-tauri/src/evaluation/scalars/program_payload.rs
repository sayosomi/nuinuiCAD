//! Task 19 scalar-program boundary decoding. The compiler has already
//! resolved names; this module only turns its JSON IR into validated Rust
//! values for Task 21's document-context evaluator.

use std::collections::HashSet;

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::scalar_payload::decode_scalar_type;
use super::types::{BindingId, ScalarType, TypedScalarExpression};

#[derive(Debug)]
pub(crate) struct ValidatedScalarProgram {
    pub(crate) statements: Vec<ValidatedScalarProgramStatement>,
    pub(crate) evaluation_limit_source_order: Option<usize>,
}

#[derive(Debug)]
pub(crate) struct ValidatedScalarProgramStatement {
    pub(crate) binding_id: BindingId,
    pub(crate) source_order: usize,
    pub(crate) declared_type: ScalarType,
    /// An initializer error becomes a typed poison only after the statement's
    /// identity, declared type, and source position have been decoded.
    pub(crate) initializer: Result<TypedScalarExpression, String>,
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

fn decode_declaration(
    json: &Value,
) -> Result<(ScalarType, Result<TypedScalarExpression, String>), ScalarPayloadIssue> {
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
    let declared_type = decode_scalar_type(require_field(
        object,
        "declaredType",
        "scalar program declaration",
    )?)?;
    let initializer = validate_typed_expression_payload(require_field(
        object,
        "initializer",
        "scalar program declaration",
    )?)
    .map_err(|error| error.code.as_str().to_owned());
    Ok((declared_type, initializer))
}

fn decode_statement(
    json: &Value,
    binding_ids: &mut HashSet<String>,
) -> Result<ValidatedScalarProgramStatement, ScalarPayloadIssue> {
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
    let source_order = require_field(object, "sourceOrder", "scalar program statement")?
        .as_u64()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program sourceOrder must be a non-negative integer",
            )
        })? as usize;
    let (declared_type, initializer) = decode_declaration(require_field(
        object,
        "declaration",
        "scalar program statement",
    )?)?;
    Ok(ValidatedScalarProgramStatement {
        binding_id: binding_id.to_owned(),
        source_order,
        declared_type,
        initializer,
    })
}

pub(crate) fn validate_scalar_program_payload(
    json: &Value,
) -> Result<ValidatedScalarProgram, ScalarPayloadIssue> {
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
    let mut decoded = Vec::with_capacity(statements.len());
    for statement in statements {
        decoded.push(decode_statement(statement, &mut binding_ids)?);
    }
    let evaluation_limit_source_order = match object.get("evaluationLimitSourceOrder") {
        Some(limit) => Some(limit.as_u64().ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program evaluationLimitSourceOrder must be a non-negative integer",
            )
        })? as usize),
        None => None,
    };
    Ok(ValidatedScalarProgram {
        statements: decoded,
        evaluation_limit_source_order,
    })
}
