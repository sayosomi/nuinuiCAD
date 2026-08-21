//! Task 28 IPC payload decode/validation for `text_templates`: one compiled
//! `TextTemplateAst` per `text` element that has a quoted `"...{...}..."`
//! `label(text:...)` value (Task 26/27's TS-side compilation). Unlike the
//! bare `text.text` binding case (`text_property_binding_payload.rs`), this
//! carries a reduced, evaluation-only projection of the TS AST - no
//! `span`/`contentSpan`/`cookedInsertOffset`/`cookedRange`/`quote`/
//! `dependencies`, none of which Rust evaluation needs (those are TS
//! editor/dependency-graph concerns) - only `cooked` literal text, `raw`
//! numeric-expression-hole content, and a typed hole's `expression` AST.
//!
//! This module does not re-scan source or re-resolve names: a numeric hole's
//! `raw` content is handed unchanged to the existing numeric
//! numeric-expression pipeline at runtime (`text_template_runtime.rs`); a
//! typed hole's `expression` is decoded via the existing, reused Task 17
//! `validate_typed_expression_payload` - this module never re-implements
//! that decoder's structural/semantic AST validation.
//!
//! Every decode failure is a hard `Err` for the whole array - a malformed
//! entry is never silently skipped or allowed to shadow a valid one, and a
//! duplicate `elementId` is rejected rather than silently overwritten when
//! building the elementId-keyed lookup, matching every other payload
//! module's established fail-closed contract.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::types::{ScalarType, TypedBuiltinArgument, TypedScalarExpression};
use crate::evaluation::types::ElementId;

#[derive(Debug)]
pub(crate) enum ValidatedTextTemplateSegment {
    Literal { cooked: String },
    NumericExpressionHole { raw: String },
    StringHole { expression: TypedScalarExpression },
    NumberHole { expression: TypedScalarExpression },
    BooleanHole { expression: TypedScalarExpression },
}

#[derive(Debug)]
pub(crate) struct ValidatedTextTemplate {
    pub(crate) element_id: ElementId,
    pub(crate) segments: Vec<ValidatedTextTemplateSegment>,
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
/// variant carries one, mirroring TS's per-node `type`/`r#type`. Duplicated
/// from `condition_expression_payload.rs`'s own `root_type()` rather than
/// shared, matching this codebase's established small-per-module-duplication
/// convention for these validators.
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

/// Returns whether evaluating this typed expression can require a scalar
/// binding lookup. The expression decoder and evaluator are intentionally
/// iterative for deep-tree stack safety; keep this inspection iterative too.
/// Geometry-reference call arguments are already resolved geometry targets and
/// never consult the scalar binding resolver, so only scalar call arguments are
/// added to the work list.
fn requires_scalar_runtime(expression: &TypedScalarExpression) -> bool {
    let mut work = vec![expression];
    while let Some(node) = work.pop() {
        match node {
            TypedScalarExpression::Reference {
                binding_id: Some(_),
                r#type: Some(_),
                ..
            } => return true,
            TypedScalarExpression::Unary { operand, .. } => work.push(operand),
            TypedScalarExpression::Binary { left, right, .. } => {
                work.push(left);
                work.push(right);
            }
            TypedScalarExpression::Group { expression, .. } => work.push(expression),
            TypedScalarExpression::Call { args, .. } => {
                for argument in args {
                    if let TypedBuiltinArgument::Scalar { expression } = argument {
                        work.push(expression);
                    }
                }
            }
            TypedScalarExpression::NumberLiteral { .. }
            | TypedScalarExpression::StringLiteral { .. }
            | TypedScalarExpression::BooleanLiteral { .. }
            | TypedScalarExpression::ChoiceLiteral { .. }
            | TypedScalarExpression::Reference { .. }
            | TypedScalarExpression::GeometryProperty { .. } => {}
        }
    }
    false
}

fn segment_requires_scalar_runtime(segment: &ValidatedTextTemplateSegment) -> bool {
    match segment {
        ValidatedTextTemplateSegment::StringHole { expression }
        | ValidatedTextTemplateSegment::NumberHole { expression }
        | ValidatedTextTemplateSegment::BooleanHole { expression } => {
            requires_scalar_runtime(expression)
        }
        ValidatedTextTemplateSegment::Literal { .. }
        | ValidatedTextTemplateSegment::NumericExpressionHole { .. } => false,
    }
}

fn decode_literal_segment(
    object: &Map<String, Value>,
) -> Result<ValidatedTextTemplateSegment, ScalarPayloadIssue> {
    reject_unexpected_fields(object, &["kind", "cooked"], "text template literal segment")?;
    let cooked = require_field(object, "cooked", "text template literal segment")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "text template literal segment cooked must be a string",
            )
        })?
        .to_owned();
    Ok(ValidatedTextTemplateSegment::Literal { cooked })
}

fn decode_hole_segment(
    object: &Map<String, Value>,
) -> Result<ValidatedTextTemplateSegment, ScalarPayloadIssue> {
    let hole_kind = non_empty_string(
        require_field(object, "holeKind", "text template hole segment")?,
        "text template hole segment holeKind",
    )?;
    match hole_kind {
        "numeric" => {
            reject_unexpected_fields(
                object,
                &["kind", "holeKind", "raw"],
                "text template numeric-expression hole segment",
            )?;
            let raw = require_field(
                object,
                "raw",
                "text template numeric-expression hole segment",
            )?
            .as_str()
            .ok_or_else(|| {
                issue(
                    Code::InvalidFieldType,
                    "text template numeric-expression hole segment raw must be a string",
                )
            })?
            .to_owned();
            Ok(ValidatedTextTemplateSegment::NumericExpressionHole { raw })
        }
        "string" | "number" | "boolean" => {
            reject_unexpected_fields(
                object,
                &["kind", "holeKind", "expression"],
                "text template typed hole segment",
            )?;
            let expression = validate_typed_expression_payload(require_field(
                object,
                "expression",
                "text template typed hole segment",
            )?)?;
            let expected_root = match hole_kind {
                "string" => ScalarType::String,
                "number" => ScalarType::Number,
                "boolean" => ScalarType::Boolean,
                _ => unreachable!("hole kind was matched above"),
            };
            if root_type(&expression) != Some(expected_root) {
                return Err(issue(
                    Code::InvalidFieldType,
                    format!(
                        "text template hole with holeKind \"{hole_kind}\" must have a matching root type"
                    ),
                ));
            }
            Ok(match hole_kind {
                "string" => ValidatedTextTemplateSegment::StringHole { expression },
                "number" => ValidatedTextTemplateSegment::NumberHole { expression },
                "boolean" => ValidatedTextTemplateSegment::BooleanHole { expression },
                _ => unreachable!("hole kind was matched above"),
            })
        }
        _ => Err(issue(
            Code::UnknownKind,
            format!("unknown text template hole kind \"{hole_kind}\""),
        )),
    }
}

fn decode_segment(json: &Value) -> Result<ValidatedTextTemplateSegment, ScalarPayloadIssue> {
    let object = as_object(json, "text template segment")?;
    let kind = non_empty_string(
        require_field(object, "kind", "text template segment")?,
        "text template segment kind",
    )?;
    match kind {
        "literal" => decode_literal_segment(object),
        "hole" => decode_hole_segment(object),
        _ => Err(issue(
            Code::UnknownKind,
            format!("unknown text template segment kind \"{kind}\""),
        )),
    }
}

fn decode_text_template(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    seen_element_ids: &mut HashSet<String>,
) -> Result<ValidatedTextTemplate, ScalarPayloadIssue> {
    let object = as_object(json, "text template")?;
    reject_unexpected_fields(object, &["elementId", "segments"], "text template")?;

    let element_id = non_empty_string(
        require_field(object, "elementId", "text template")?,
        "text template elementId",
    )?
    .to_owned();

    let element_type = element_type_by_id.get(element_id.as_str()).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("text template elementId \"{element_id}\" does not match any element"),
        )
    })?;
    if *element_type != "text" {
        return Err(issue(
            Code::InvalidFieldType,
            format!(
                "text template elementId \"{element_id}\" is a \"{element_type}\", not a \"text\""
            ),
        ));
    }

    if !seen_element_ids.insert(element_id.clone()) {
        return Err(issue(
            Code::UnexpectedField,
            format!("duplicate text template for \"{element_id}\""),
        ));
    }

    let segments_json = require_field(object, "segments", "text template")?
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "text template segments must be an array",
            )
        })?;
    let mut segments = Vec::with_capacity(segments_json.len());
    for segment_json in segments_json {
        segments.push(decode_segment(segment_json)?);
    }

    Ok(ValidatedTextTemplate {
        element_id,
        segments,
    })
}

/// Decodes and validates the whole `text_templates` array. `scalar_runtime_present`
/// gates the cross-cutting invariant this module enforces beyond per-entry
/// shape: a typed expression requires a scalar runtime only when it contains a
/// resolved scalar reference that the evaluator may need to bind. Reference-free
/// typed expressions (including boolean literals/comparisons) are safe without
/// `scalar_program` or `binding_versions`; a typed expression containing a
/// binding reference without either runtime payload fails closed.
pub(crate) fn validate_text_templates_payload(
    json: &Value,
    element_type_by_id: &HashMap<&str, &str>,
    scalar_runtime_present: bool,
) -> Result<Vec<ValidatedTextTemplate>, ScalarPayloadIssue> {
    let array = json
        .as_array()
        .ok_or_else(|| issue(Code::InvalidFieldType, "text templates must be an array"))?;
    let mut seen_element_ids = HashSet::new();
    let mut decoded = Vec::with_capacity(array.len());
    for entry in array {
        decoded.push(decode_text_template(
            entry,
            element_type_by_id,
            &mut seen_element_ids,
        )?);
    }
    if !scalar_runtime_present
        && decoded.iter().any(|template| {
            template
                .segments
                .iter()
                .any(segment_requires_scalar_runtime)
        })
    {
        return Err(issue(
            Code::TypedHoleRequiresScalarRuntime,
            "a text template typed expression with a scalar binding reference requires a scalar program or binding versions to be present",
        ));
    }
    Ok(decoded)
}
