//! Shape validation (own fields only, not children) for the four
//! recursive `TypedScalarExpression` node kinds - `unary`/`binary`/
//! `group`/`call`. Split out of `expression_leaf_payload.rs` to keep both files
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
use super::issue::ScalarPayloadIssueCode as Code;
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::types::{
    BuiltinFunctionName, ScalarBinaryOperator, ScalarSpan, ScalarType, ScalarUnaryOperator,
    TypedScalarCallTarget,
};

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

/// A `call` target is already resolved by TypeScript. Rust validates its
/// closed wire shape and stores the resolved builtin identity without using
/// the call node's source `name` to dispatch anything.
fn decode_call_target(json: &Value) -> Result<TypedScalarCallTarget, ScalarPayloadIssue> {
    let object = as_object(json, "call target")?;
    reject_unexpected_fields(object, &["kind", "name"], "call target")?;
    let kind = require_field(object, "kind", "call target")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "call target \"kind\" must be a string",
            )
        })?;
    if kind != "builtin" {
        return Err(issue(
            Code::UnknownKind,
            format!("unknown call target kind \"{kind}\""),
        ));
    }
    let name = require_field(object, "name", "call target")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "call target \"name\" must be a string",
            )
        })?;
    let builtin = BuiltinFunctionName::from_wire_name(name).ok_or_else(|| {
        issue(
            Code::UnknownKind,
            format!("unknown builtin function name \"{name}\""),
        )
    })?;
    Ok(TypedScalarCallTarget::Builtin(builtin))
}

/// A `call` node's own fields, validated - `args` are borrowed references to
/// still-undecoded child JSON values for the iterative expression decoder.
pub(crate) struct CallShape<'a> {
    pub(crate) span: ScalarSpan,
    pub(crate) name_span: ScalarSpan,
    pub(crate) name: String,
    pub(crate) target: TypedScalarCallTarget,
    pub(crate) args: &'a [Value],
    pub(crate) r#type: Option<ScalarType>,
}

pub(crate) fn validate_call_shape(
    object: &Map<String, Value>,
) -> Result<CallShape<'_>, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "nameSpan", "name", "target", "args", "type"],
        "call node",
    )?;
    let span = decode_span(
        require_field(object, "span", "call node")?,
        "call node span",
    )?;
    let name_span = decode_span(
        require_field(object, "nameSpan", "call node")?,
        "call node nameSpan",
    )?;
    let name = require_field(object, "name", "call node")?
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "call node \"name\" must be a non-empty string",
            )
        })?
        .to_owned();
    let target = decode_call_target(require_field(object, "target", "call node")?)?;
    let args = require_field(object, "args", "call node")?
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "call node \"args\" must be an array",
            )
        })?;
    let r#type = decode_nullable_scalar_type(require_field(object, "type", "call node")?)?;
    Ok(CallShape {
        span,
        name_span,
        name,
        target,
        args,
        r#type,
    })
}
