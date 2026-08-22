//! Fail-closed decoders for `ScalarType`/`ScalarValue`/`ScalarEvaluation`
//! JSON payloads. Rust mirror of `src/scalars/scalarJson.ts`'s
//! `parseScalarTypeJson`/`parseScalarValueJson`/`parseScalarEvaluationJson`,
//! which that TS module's own doc comment already frames as "the TS-side
//! equivalent of the defensive validation the Rust evaluation core owns for
//! its own payloads (D17)" - this module is that Rust side.

use serde_json::Value;

use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::types::{ScalarEvaluation, ScalarEvaluationErrorContext, ScalarType, ScalarValue};

/// A single node's `options` array is bounded independently of AST depth or
/// node count: it needs no tree recursion to be made arbitrarily large, so
/// it gets its own guard (task instruction: "choice option数などpayload全体の
/// size guard"). 256 is generous headroom over any realistic garment-drafting
/// choice enum (these are typically single-digit option counts).
pub(crate) const MAX_CHOICE_OPTIONS: usize = 256;

pub(crate) fn decode_options_array(
    json: &Value,
    context: &str,
) -> Result<Vec<String>, ScalarPayloadIssue> {
    let array = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidChoiceOptions,
            format!("{context} options must be an array"),
        )
    })?;
    if array.len() > MAX_CHOICE_OPTIONS {
        return Err(issue(
            Code::ChoiceOptionsLimitExceeded,
            format!("{context} options exceed the {MAX_CHOICE_OPTIONS}-option limit"),
        ));
    }
    array
        .iter()
        .enumerate()
        .map(|(index, option)| {
            option
                .as_str()
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| {
                    issue(
                        Code::InvalidChoiceOptions,
                        format!("{context} option at index {index} must be a non-empty string"),
                    )
                })
        })
        .collect()
}

pub(crate) fn decode_scalar_type(json: &Value) -> Result<ScalarType, ScalarPayloadIssue> {
    let object = as_object(json, "scalar type")?;
    let kind = require_field(object, "kind", "scalar type")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar type \"kind\" must be a string",
            )
        })?;
    match kind {
        "number" => {
            reject_unexpected_fields(object, &["kind"], "number scalar type")?;
            Ok(ScalarType::Number)
        }
        "string" => {
            reject_unexpected_fields(object, &["kind"], "string scalar type")?;
            Ok(ScalarType::String)
        }
        "boolean" => {
            reject_unexpected_fields(object, &["kind"], "boolean scalar type")?;
            Ok(ScalarType::Boolean)
        }
        "choice" => {
            reject_unexpected_fields(object, &["kind", "options"], "choice scalar type")?;
            let options = decode_options_array(
                require_field(object, "options", "choice scalar type")?,
                "choice scalar type",
            )?;
            Ok(ScalarType::Choice { options })
        }
        other => Err(issue(
            Code::UnknownKind,
            format!("unknown scalar type kind \"{other}\""),
        )),
    }
}

/// Also reused by `expression_evaluator_ops.rs`'s reference trust-boundary
/// check (Task 18) - one implementation of "does this runtime value actually
/// match its declared type", not two.
pub(crate) fn scalar_value_matches_type(scalar_type: &ScalarType, value: &ScalarValue) -> bool {
    match (scalar_type, value) {
        (ScalarType::Number, ScalarValue::Number(_)) => true,
        (ScalarType::String, ScalarValue::String(_)) => true,
        (ScalarType::Boolean, ScalarValue::Boolean(_)) => true,
        (
            ScalarType::Choice {
                options: type_options,
            },
            ScalarValue::Choice {
                value,
                options: value_options,
            },
        ) => type_options == value_options && value_options.contains(value),
        _ => false,
    }
}

fn decode_scalar_evaluation_error_context(
    json: &Value,
) -> Result<ScalarEvaluationErrorContext, ScalarPayloadIssue> {
    let object = as_object(json, "scalar evaluation error context")?;
    let kind = require_field(object, "kind", "scalar evaluation error context")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar evaluation error context \"kind\" must be a string",
            )
        })?;
    match kind {
        "geometryBuiltinTarget" => {
            reject_unexpected_fields(
                object,
                &["kind", "targetElementId", "pointKey"],
                "geometry builtin target context",
            )?;
            let target_element_id =
                require_field(object, "targetElementId", "geometry builtin target context")?
                    .as_str()
                    .ok_or_else(|| {
                        issue(
                            Code::InvalidFieldType,
                            "geometry builtin target context \"targetElementId\" must be a string",
                        )
                    })?
                    .to_owned();
            let point_key = match object.get("pointKey") {
                None => None,
                Some(value) => Some(
                    value
                        .as_str()
                        .ok_or_else(|| {
                            issue(
                                Code::InvalidFieldType,
                                "geometry builtin target context \"pointKey\", when present, must be a string",
                            )
                        })?
                        .to_owned(),
                ),
            };
            Ok(ScalarEvaluationErrorContext::GeometryBuiltinTarget {
                target_element_id,
                point_key,
            })
        }
        other => Err(issue(
            Code::UnknownKind,
            format!("unknown scalar evaluation error context kind \"{other}\""),
        )),
    }
}

// `decode_scalar_value`/`decode_scalar_evaluation` have no production caller
// yet: Task 17's own scope is decoding `ScalarType`/`ScalarValue`/
// `ScalarEvaluation` payloads (per its "前提API・型"), but nothing consumes a
// standalone `ScalarValue`/`ScalarEvaluation` until Task 18/21 wire up a
// binding environment. They're exercised directly by this module's own
// tests today - not literal dead code, just not yet called from production.
#[allow(dead_code)]
pub(crate) fn decode_scalar_value(json: &Value) -> Result<ScalarValue, ScalarPayloadIssue> {
    let object = as_object(json, "scalar value")?;
    let kind = require_field(object, "kind", "scalar value")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar value \"kind\" must be a string",
            )
        })?;
    match kind {
        "number" => {
            reject_unexpected_fields(object, &["kind", "value"], "number scalar value")?;
            let value = require_field(object, "value", "number scalar value")?
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "number scalar value \"value\" must be a finite number",
                    )
                })?;
            Ok(ScalarValue::Number(value))
        }
        "string" => {
            reject_unexpected_fields(object, &["kind", "value"], "string scalar value")?;
            let value = require_field(object, "value", "string scalar value")?
                .as_str()
                .ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "string scalar value \"value\" must be a string",
                    )
                })?
                .to_owned();
            Ok(ScalarValue::String(value))
        }
        "boolean" => {
            reject_unexpected_fields(object, &["kind", "value"], "boolean scalar value")?;
            let value = require_field(object, "value", "boolean scalar value")?
                .as_bool()
                .ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "boolean scalar value \"value\" must be a boolean",
                    )
                })?;
            Ok(ScalarValue::Boolean(value))
        }
        "choice" => {
            reject_unexpected_fields(object, &["kind", "value", "options"], "choice scalar value")?;
            let options = decode_options_array(
                require_field(object, "options", "choice scalar value")?,
                "choice scalar value",
            )?;
            let value = require_field(object, "value", "choice scalar value")?
                .as_str()
                .ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "choice scalar value \"value\" must be a string",
                    )
                })?
                .to_owned();
            if !options.contains(&value) {
                return Err(issue(
                    Code::InvalidChoiceMember,
                    format!("choice value \"{value}\" is not a member of its declared options"),
                ));
            }
            Ok(ScalarValue::Choice { value, options })
        }
        other => Err(issue(
            Code::UnknownKind,
            format!("unknown scalar value kind \"{other}\""),
        )),
    }
}

#[allow(dead_code)]
pub(crate) fn decode_scalar_evaluation(
    json: &Value,
) -> Result<ScalarEvaluation, ScalarPayloadIssue> {
    let object = as_object(json, "scalar evaluation")?;
    let scalar_type = decode_scalar_type(require_field(object, "type", "scalar evaluation")?)?;
    let status = require_field(object, "status", "scalar evaluation")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar evaluation \"status\" must be a string",
            )
        })?;
    match status {
        "ok" => {
            reject_unexpected_fields(object, &["type", "status", "value"], "ok scalar evaluation")?;
            let value =
                decode_scalar_value(require_field(object, "value", "ok scalar evaluation")?)?;
            if !scalar_value_matches_type(&scalar_type, &value) {
                return Err(issue(
                    Code::InvalidEvaluationValue,
                    "evaluation value does not match its declared type",
                ));
            }
            Ok(ScalarEvaluation::Ok {
                r#type: scalar_type,
                value,
            })
        }
        "error" => {
            reject_unexpected_fields(
                object,
                &["type", "status", "issueCode", "bindingId", "context"],
                "error scalar evaluation",
            )?;
            let issue_code = require_field(object, "issueCode", "error scalar evaluation")?
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    issue(
                        Code::InvalidIssueCode,
                        "error scalar evaluation requires a non-empty issueCode",
                    )
                })?
                .to_owned();
            // Mirrors scalarJson.ts exactly: only an *absent* key means "no
            // bindingId" - an explicit `null` is not treated the same as
            // absence and is rejected below by the non-string check.
            let binding_id = match object.get("bindingId") {
                None => None,
                Some(value) => Some(
                    value
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| {
                            issue(
                                Code::InvalidBindingId,
                                "bindingId, when present, must be a non-empty string",
                            )
                        })?
                        .to_owned(),
                ),
            };
            let context = match object.get("context") {
                None => None,
                Some(value) => Some(decode_scalar_evaluation_error_context(value)?),
            };
            Ok(ScalarEvaluation::Error {
                r#type: scalar_type,
                issue_code,
                binding_id,
                context,
            })
        }
        other => Err(issue(
            Code::InvalidEvaluationStatus,
            format!("unknown scalar evaluation status \"{other}\""),
        )),
    }
}
