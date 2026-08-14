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
    BuiltinArgumentType, BuiltinFunctionName, GeometryInterfaceType, ScalarBinaryOperator,
    ScalarExpressionResolvedGeometryTarget, ScalarSpan, ScalarType, ScalarUnaryOperator,
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

pub(crate) enum CallArgumentShape<'a> {
    Scalar {
        expression: &'a Value,
    },
    GeometryReference {
        expected_geometry_type: GeometryInterfaceType,
        target: Option<ScalarExpressionResolvedGeometryTarget>,
    },
}

fn decode_geometry_interface_type(
    json: &Value,
    context: &str,
) -> Result<GeometryInterfaceType, ScalarPayloadIssue> {
    let name = json.as_str().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("{context} must be a string"),
        )
    })?;
    GeometryInterfaceType::from_wire_name(name).ok_or_else(|| {
        issue(
            Code::UnknownKind,
            format!("unknown geometry interface type \"{name}\""),
        )
    })
}

fn decode_geometry_target(
    json: &Value,
) -> Result<Option<ScalarExpressionResolvedGeometryTarget>, ScalarPayloadIssue> {
    if json.is_null() {
        return Ok(None);
    }
    let object = as_object(json, "geometry reference target")?;
    reject_unexpected_fields(
        object,
        &["statementId", "statementIndex", "geometryType", "pointKey"],
        "geometry reference target",
    )?;
    let statement_id = require_field(object, "statementId", "geometry reference target")?
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "geometry reference target \"statementId\" must be a non-empty string",
            )
        })?
        .to_owned();
    let statement_index = require_field(object, "statementIndex", "geometry reference target")?
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "geometry reference target \"statementIndex\" must be a non-negative integer",
            )
        })?;
    let geometry_type = decode_geometry_interface_type(
        require_field(object, "geometryType", "geometry reference target")?,
        "geometry reference target \"geometryType\"",
    )?;
    let point_key = match object.get("pointKey") {
        None => None,
        Some(value) => {
            let point_key = value.as_str().ok_or_else(|| {
                issue(
                    Code::InvalidFieldType,
                    "geometry reference target \"pointKey\" must be a non-empty string",
                )
            })?;
            if point_key.is_empty()
                || point_key == "intermediate:"
                || point_key.chars().any(char::is_whitespace)
            {
                return Err(issue(
                    Code::InvalidFieldType,
                    "geometry reference target \"pointKey\" is malformed",
                ));
            }
            Some(point_key.to_owned())
        }
    };
    Ok(Some(ScalarExpressionResolvedGeometryTarget {
        statement_id,
        statement_index,
        geometry_type,
        point_key,
    }))
}

pub(crate) fn decode_call_argument_shape(
    json: &Value,
) -> Result<CallArgumentShape<'_>, ScalarPayloadIssue> {
    let object = as_object(json, "builtin call argument")?;
    let kind = require_field(object, "kind", "builtin call argument")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "builtin call argument \"kind\" must be a string",
            )
        })?;
    match kind {
        "scalar" => {
            reject_unexpected_fields(object, &["kind", "expression"], "scalar call argument")?;
            Ok(CallArgumentShape::Scalar {
                expression: require_field(object, "expression", "scalar call argument")?,
            })
        }
        "geometryReference" => {
            reject_unexpected_fields(
                object,
                &["kind", "expectedGeometryType", "target"],
                "geometry call argument",
            )?;
            let expected_geometry_type = decode_geometry_interface_type(
                require_field(object, "expectedGeometryType", "geometry call argument")?,
                "geometry call argument \"expectedGeometryType\"",
            )?;
            let target =
                decode_geometry_target(require_field(object, "target", "geometry call argument")?)?;
            Ok(CallArgumentShape::GeometryReference {
                expected_geometry_type,
                target,
            })
        }
        other => Err(issue(
            Code::UnknownKind,
            format!("unknown builtin call argument kind \"{other}\""),
        )),
    }
}

pub(crate) fn validate_call_argument_shapes(
    target: TypedScalarCallTarget,
    arguments: &[CallArgumentShape<'_>],
    r#type: Option<&ScalarType>,
) -> Result<(), ScalarPayloadIssue> {
    let Some(_) = r#type else {
        return Ok(());
    };
    let TypedScalarCallTarget::Builtin(name) = target;
    let signatures = name.argument_signatures();
    let signature = signatures
        .iter()
        .find(|signature| signature.len() == arguments.len())
        .copied();
    let Some(signature) = signature else {
        return Err(issue(
            Code::InvalidBuiltinArgument,
            format!("builtin {name:?} received an invalid argument count"),
        ));
    };
    for (expected, argument) in signature.iter().zip(arguments) {
        match (expected, argument) {
            (BuiltinArgumentType::Scalar, CallArgumentShape::Scalar { .. }) => {}
            (
                BuiltinArgumentType::Geometry(expected_geometry_type),
                CallArgumentShape::GeometryReference {
                    expected_geometry_type: argument_expected_geometry_type,
                    target: Some(target),
                },
            ) if expected_geometry_type == argument_expected_geometry_type
                && target.geometry_type == *expected_geometry_type
                && (target.point_key.is_none()
                    || target.geometry_type == GeometryInterfaceType::Point) => {}
            _ => {
                return Err(issue(
                    Code::InvalidBuiltinArgument,
                    format!("builtin {name:?} received an invalid argument shape"),
                ))
            }
        }
    }
    Ok(())
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
