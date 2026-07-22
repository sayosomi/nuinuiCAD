//! Decoders for the leaf/non-recursive parts of a `TypedScalarExpression`
//! node: spans, operators, and the four leaf node kinds (`numberLiteral`/
//! `stringLiteral`/`booleanLiteral`/`choiceLiteral`) plus `reference`
//! (which carries no child nodes either). Shape validation for the three
//! recursive node kinds (`unary`/`binary`/`group` - their own fields, not
//! their children) lives in `expression_shape_payload.rs`, which reuses
//! the span/operator/nullable-type decoders defined here. Split out of
//! `expression_payload.rs` to keep that file focused on the iterative
//! traversal itself (the depth/node-count guards and the explicit work
//! stack) - see that module's doc comment for the overall scope.

use serde_json::{Map, Value};

use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::scalar_payload::decode_scalar_type;
use super::types::{
    ScalarBinaryOperator, ScalarSpan, ScalarType, ScalarUnaryOperator, TypedScalarExpression,
};

pub(crate) fn decode_span(json: &Value, context: &str) -> Result<ScalarSpan, ScalarPayloadIssue> {
    let object = as_object(json, context)?;
    reject_unexpected_fields(object, &["start", "end"], context)?;
    let start = require_field(object, "start", context)?
        .as_u64()
        .ok_or_else(|| {
            issue(
                Code::InvalidSpan,
                format!("{context} \"start\" must be a non-negative integer"),
            )
        })? as usize;
    let end = require_field(object, "end", context)?
        .as_u64()
        .ok_or_else(|| {
            issue(
                Code::InvalidSpan,
                format!("{context} \"end\" must be a non-negative integer"),
            )
        })? as usize;
    if start > end {
        return Err(issue(
            Code::InvalidSpan,
            format!("{context} start ({start}) must not exceed end ({end})"),
        ));
    }
    Ok(ScalarSpan { start, end })
}

/// A node's `type` field is `ScalarType | null` in TS - unlike
/// `ScalarEvaluation.bindingId` (see `scalar_payload.rs`), an explicit JSON
/// `null` here is a meaningful, valid value (not a shorthand for "absent"),
/// so this always requires the key to be present and only branches on
/// whether its *value* is `null`.
pub(crate) fn decode_nullable_scalar_type(
    json: &Value,
) -> Result<Option<ScalarType>, ScalarPayloadIssue> {
    if json.is_null() {
        Ok(None)
    } else {
        decode_scalar_type(json).map(Some)
    }
}

pub(crate) fn decode_unary_operator(
    json: &Value,
    context: &str,
) -> Result<ScalarUnaryOperator, ScalarPayloadIssue> {
    match json.as_str() {
        Some("!") => Ok(ScalarUnaryOperator::Not),
        Some("-") => Ok(ScalarUnaryOperator::Negate),
        Some("+") => Ok(ScalarUnaryOperator::Plus),
        _ => Err(issue(
            Code::InvalidOperator,
            format!("{context} has an invalid unary operator"),
        )),
    }
}

pub(crate) fn decode_binary_operator(
    json: &Value,
    context: &str,
) -> Result<ScalarBinaryOperator, ScalarPayloadIssue> {
    match json.as_str() {
        Some("||") => Ok(ScalarBinaryOperator::Or),
        Some("&&") => Ok(ScalarBinaryOperator::And),
        Some("==") => Ok(ScalarBinaryOperator::Eq),
        Some("!=") => Ok(ScalarBinaryOperator::NotEq),
        Some("<") => Ok(ScalarBinaryOperator::Lt),
        Some("<=") => Ok(ScalarBinaryOperator::LtEq),
        Some(">") => Ok(ScalarBinaryOperator::Gt),
        Some(">=") => Ok(ScalarBinaryOperator::GtEq),
        Some("+") => Ok(ScalarBinaryOperator::Add),
        Some("-") => Ok(ScalarBinaryOperator::Sub),
        Some("*") => Ok(ScalarBinaryOperator::Mul),
        Some("/") => Ok(ScalarBinaryOperator::Div),
        _ => Err(issue(
            Code::InvalidOperator,
            format!("{context} has an invalid binary operator"),
        )),
    }
}

pub(crate) fn decode_number_literal(
    object: &Map<String, Value>,
) -> Result<TypedScalarExpression, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "value", "type"],
        "numberLiteral node",
    )?;
    let span = decode_span(
        require_field(object, "span", "numberLiteral node")?,
        "numberLiteral node span",
    )?;
    let value = require_field(object, "value", "numberLiteral node")?
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "numberLiteral node \"value\" must be a finite number",
            )
        })?;
    let scalar_type = decode_scalar_type(require_field(object, "type", "numberLiteral node")?)?;
    if scalar_type != ScalarType::Number {
        return Err(issue(
            Code::LiteralTypeMismatch,
            "numberLiteral node \"type\" must be {\"kind\":\"number\"}",
        ));
    }
    Ok(TypedScalarExpression::NumberLiteral {
        span,
        value,
        r#type: scalar_type,
    })
}

pub(crate) fn decode_string_literal(
    object: &Map<String, Value>,
) -> Result<TypedScalarExpression, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "value", "type"],
        "stringLiteral node",
    )?;
    let span = decode_span(
        require_field(object, "span", "stringLiteral node")?,
        "stringLiteral node span",
    )?;
    let value = require_field(object, "value", "stringLiteral node")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "stringLiteral node \"value\" must be a string",
            )
        })?
        .to_owned();
    let scalar_type = decode_scalar_type(require_field(object, "type", "stringLiteral node")?)?;
    if scalar_type != ScalarType::String {
        return Err(issue(
            Code::LiteralTypeMismatch,
            "stringLiteral node \"type\" must be {\"kind\":\"string\"}",
        ));
    }
    Ok(TypedScalarExpression::StringLiteral {
        span,
        value,
        r#type: scalar_type,
    })
}

pub(crate) fn decode_boolean_literal(
    object: &Map<String, Value>,
) -> Result<TypedScalarExpression, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "value", "type"],
        "booleanLiteral node",
    )?;
    let span = decode_span(
        require_field(object, "span", "booleanLiteral node")?,
        "booleanLiteral node span",
    )?;
    let value = require_field(object, "value", "booleanLiteral node")?
        .as_bool()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "booleanLiteral node \"value\" must be a boolean",
            )
        })?;
    let scalar_type = decode_scalar_type(require_field(object, "type", "booleanLiteral node")?)?;
    if scalar_type != ScalarType::Boolean {
        return Err(issue(
            Code::LiteralTypeMismatch,
            "booleanLiteral node \"type\" must be {\"kind\":\"boolean\"}",
        ));
    }
    Ok(TypedScalarExpression::BooleanLiteral {
        span,
        value,
        r#type: scalar_type,
    })
}

pub(crate) fn decode_choice_literal(
    object: &Map<String, Value>,
) -> Result<TypedScalarExpression, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "value", "type"],
        "choiceLiteral node",
    )?;
    let span = decode_span(
        require_field(object, "span", "choiceLiteral node")?,
        "choiceLiteral node span",
    )?;
    let value = require_field(object, "value", "choiceLiteral node")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "choiceLiteral node \"value\" must be a string",
            )
        })?
        .to_owned();
    let type_json = require_field(object, "type", "choiceLiteral node")?;
    let scalar_type = if type_json.is_null() {
        None
    } else {
        let decoded = decode_scalar_type(type_json)?;
        match &decoded {
            ScalarType::Choice { options } => {
                if !options.contains(&value) {
                    return Err(issue(
                        Code::InvalidChoiceMember,
                        format!("choiceLiteral value \"{value}\" is not a member of its declared type's options"),
                    ));
                }
            }
            _ => {
                return Err(issue(
                    Code::LiteralTypeMismatch,
                    "choiceLiteral node \"type\" must be a choice scalar type or null",
                ))
            }
        }
        Some(decoded)
    };
    Ok(TypedScalarExpression::ChoiceLiteral {
        span,
        value,
        r#type: scalar_type,
    })
}

pub(crate) fn decode_reference(
    object: &Map<String, Value>,
) -> Result<TypedScalarExpression, ScalarPayloadIssue> {
    reject_unexpected_fields(
        object,
        &["kind", "span", "nameSpan", "name", "bindingId", "type"],
        "reference node",
    )?;
    let span = decode_span(
        require_field(object, "span", "reference node")?,
        "reference node span",
    )?;
    let name_span = decode_span(
        require_field(object, "nameSpan", "reference node")?,
        "reference node nameSpan",
    )?;
    let name = require_field(object, "name", "reference node")?
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "reference node \"name\" must be a non-empty string",
            )
        })?
        .to_owned();
    let binding_id_json = require_field(object, "bindingId", "reference node")?;
    let binding_id = if binding_id_json.is_null() {
        None
    } else {
        Some(
            binding_id_json
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    issue(
                        Code::InvalidBindingId,
                        "reference node \"bindingId\", when present, must be a non-empty string",
                    )
                })?
                .to_owned(),
        )
    };
    let scalar_type =
        decode_nullable_scalar_type(require_field(object, "type", "reference node")?)?;
    // TS never produces a non-null `type` from a `null` bindingId: `type` is
    // only set after a *successful* resolution, which always sets
    // `bindingId` too (see typedExpressionAst.ts's own documented
    // invariant). The reverse (bindingId set, type null - a resolved
    // binding with a malformed declared type) is legal and not rejected.
    if scalar_type.is_some() && binding_id.is_none() {
        return Err(issue(
            Code::InconsistentReferenceBinding,
            "reference node has a non-null \"type\" but a null \"bindingId\", which a valid typecheck can never produce",
        ));
    }
    Ok(TypedScalarExpression::Reference {
        span,
        name_span,
        name,
        binding_id,
        r#type: scalar_type,
    })
}
