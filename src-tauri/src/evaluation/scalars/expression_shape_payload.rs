//! Shape validation (own fields only, not children) for the three
//! recursive `TypedScalarExpression` node kinds - `unary`/`binary`/
//! `group`. Split out of `expression_leaf_payload.rs` to keep both files
//! under this project's file-size guidance; conceptually still the same
//! "non-recursive per-node-kind field validation" role described there.
//! None of these functions recurse or touch child JSON values beyond
//! returning a borrowed reference to them for the caller (the iterative
//! traversal in `expression_payload.rs`) to visit next.

use serde_json::{Map, Value};

use super::expression_leaf_payload::{
    decode_binary_operator, decode_nullable_scalar_type, decode_span, decode_unary_operator,
};
use super::issue::ScalarPayloadIssue;
use super::json_helpers::{reject_unexpected_fields, require_field};
use super::types::{ScalarBinaryOperator, ScalarSpan, ScalarType, ScalarUnaryOperator};

/// A `unary` node's own fields, validated - `operand` is a borrowed
/// reference to its still-undecoded child JSON.
pub(crate) struct UnaryShape<'a> {
    pub(crate) span: ScalarSpan,
    pub(crate) operator: ScalarUnaryOperator,
    pub(crate) r#type: Option<ScalarType>,
    pub(crate) operand: &'a Value,
}

pub(crate) fn validate_unary_shape(
    object: &Map<String, Value>,
) -> Result<UnaryShape<'_>, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "operator", "operand", "type"],
        "unary node",
    )?;
    let span = decode_span(
        require_field(object, "span", "unary node")?,
        "unary node span",
    )?;
    let operator = decode_unary_operator(
        require_field(object, "operator", "unary node")?,
        "unary node operator",
    )?;
    let r#type = decode_nullable_scalar_type(require_field(object, "type", "unary node")?)?;
    let operand = require_field(object, "operand", "unary node")?;
    Ok(UnaryShape {
        span,
        operator,
        r#type,
        operand,
    })
}

/// A `binary` node's own fields, validated - `left`/`right` are borrowed
/// references to their still-undecoded child JSON.
pub(crate) struct BinaryShape<'a> {
    pub(crate) span: ScalarSpan,
    pub(crate) operator: ScalarBinaryOperator,
    pub(crate) r#type: Option<ScalarType>,
    pub(crate) left: &'a Value,
    pub(crate) right: &'a Value,
}

pub(crate) fn validate_binary_shape(
    object: &Map<String, Value>,
) -> Result<BinaryShape<'_>, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "operator", "left", "right", "type"],
        "binary node",
    )?;
    let span = decode_span(
        require_field(object, "span", "binary node")?,
        "binary node span",
    )?;
    let operator = decode_binary_operator(
        require_field(object, "operator", "binary node")?,
        "binary node operator",
    )?;
    let r#type = decode_nullable_scalar_type(require_field(object, "type", "binary node")?)?;
    let left = require_field(object, "left", "binary node")?;
    let right = require_field(object, "right", "binary node")?;
    Ok(BinaryShape {
        span,
        operator,
        r#type,
        left,
        right,
    })
}

/// A `group` node's own fields, validated - `expression` is a borrowed
/// reference to its still-undecoded child JSON.
pub(crate) struct GroupShape<'a> {
    pub(crate) span: ScalarSpan,
    pub(crate) r#type: Option<ScalarType>,
    pub(crate) expression: &'a Value,
}

pub(crate) fn validate_group_shape(
    object: &Map<String, Value>,
) -> Result<GroupShape<'_>, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "expression", "type"],
        "group node",
    )?;
    let span = decode_span(
        require_field(object, "span", "group node")?,
        "group node span",
    )?;
    let r#type = decode_nullable_scalar_type(require_field(object, "type", "group node")?)?;
    let expression = require_field(object, "expression", "group node")?;
    Ok(GroupShape {
        span,
        r#type,
        expression,
    })
}
