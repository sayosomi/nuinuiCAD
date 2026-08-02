//! Task 28 IPC payload decode/validation for `text_templates`: one compiled
//! `TextTemplateAst` per `text` element that has a quoted `"...{...}..."`
//! `label(text:...)` value (Task 26/27's TS-side compilation). Unlike the
//! bare `text.text` binding case (`text_property_binding_payload.rs`), this
//! carries a reduced, evaluation-only projection of the TS AST - no
//! `span`/`contentSpan`/`cookedInsertOffset`/`cookedRange`/`quote`/
//! `dependencies`, none of which Rust evaluation needs (those are TS
//! editor/dependency-graph concerns) - only `cooked` literal text, `raw`
//! legacy-hole content, and a typed hole's `expression` AST.
//!
//! This module does not re-scan source or re-resolve names: a legacy hole's
//! `raw` content is handed unchanged to the existing, unmodified legacy
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
use super::types::{ScalarType, TypedScalarExpression};
use crate::evaluation::types::ElementId;

#[derive(Debug)]
pub(crate) enum ValidatedTextTemplateSegment {
    Literal { cooked: String },
    LegacyHole { raw: String },
    StringHole { expression: TypedScalarExpression },
    NumberHole { expression: TypedScalarExpression },
}

impl ValidatedTextTemplateSegment {
    pub(crate) fn is_typed_hole(&self) -> bool {
        matches!(self, Self::StringHole { .. } | Self::NumberHole { .. })
    }
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
        "legacy" => {
            reject_unexpected_fields(
                object,
                &["kind", "holeKind", "raw"],
                "text template legacy hole segment",
            )?;
            let raw = require_field(object, "raw", "text template legacy hole segment")?
                .as_str()
                .ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "text template legacy hole segment raw must be a string",
                    )
                })?
                .to_owned();
            Ok(ValidatedTextTemplateSegment::LegacyHole { raw })
        }
        "string" | "number" => {
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
            let expected_root = if hole_kind == "string" {
                ScalarType::String
            } else {
                ScalarType::Number
            };
            if root_type(&expression) != Some(expected_root) {
                return Err(issue(
                    Code::InvalidFieldType,
                    format!(
                        "text template hole with holeKind \"{hole_kind}\" must have a matching root type"
                    ),
                ));
            }
            Ok(if hole_kind == "string" {
                ValidatedTextTemplateSegment::StringHole { expression }
            } else {
                ValidatedTextTemplateSegment::NumberHole { expression }
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
/// gates the one cross-cutting invariant this module enforces beyond
/// per-entry shape: a typed (`string`/`number`) hole can only ever exist
/// because a typed declaration exists, which implies either `scalar_program`
/// or Task 32's `binding_versions` - if neither runtime payload is present
/// but a typed hole is present
/// anywhere in the payload, that is a caller-contract violation and the
/// whole call fails closed (never a silent fallback to legacy evaluation).
/// A payload containing only `"legacy"` holes and literals is valid with no
/// `scalar_program` - Task 26 compiles a template for every nui 3
/// `label(text:...)` occurrence regardless of whether the document has any
/// typed declaration at all.
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
                .any(ValidatedTextTemplateSegment::is_typed_hole)
        })
    {
        return Err(issue(
            Code::TypedHoleRequiresScalarRuntime,
            "a typed text template hole requires a scalar program or binding versions to be present",
        ));
    }
    Ok(decoded)
}
