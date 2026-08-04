//! Task 28: Rust counterpart to TypeScript's pure text template evaluator
//! (`src/scalars/textTemplateEvaluator.ts`, Task 27). Consumes only
//! `text_template_payload.rs`'s validated segments and a caller-supplied
//! context implementing [`ScalarEvaluationEnvironment`] (Task 18's
//! evaluator) + [`NumericExpressionHoleEvaluator`] - it never touches `serde_json::Value`
//! or `EvaluationState` directly.
//!
//! The two traits are combined on one caller-supplied `&mut C` (rather than
//! a `&environment` plus a separate `FnMut` closure) deliberately: the real
//! production context (`text_template_runtime.rs`) holds one
//! `&mut EvaluationState` field that a numeric-expression hole must borrow mutably
//! (`evaluate_numeric_or_push` can push a `DependencyError`) while a typed
//! hole must borrow it immutably (`ScalarBindingResolver::resolve` only
//! reads state) - within one interleaved walk. Two separate long-lived
//! borrows (one `&EvaluationState` held by an `environment` parameter for
//! the whole call, one `&mut EvaluationState` captured by a sibling closure)
//! would alias and fail to borrow-check. A single `&mut C` that each match
//! arm reborrows fresh - immutably for `&self` methods, exclusively for
//! `&mut self` methods - never holds two conflicting borrows alive at once.
//!
//! Fails closed on the **first** failing hole in source order (a single
//! linear walk, one segment at a time) - the same deliberate simplification
//! Task 27's TS evaluator documents relative to the old regex evaluator's
//! "last error wins" quirk.

use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::text_template_payload::ValidatedTextTemplateSegment;
use super::types::{ScalarEvaluation, ScalarValue};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextTemplateHoleOrigin {
    NumericExpression,
    Typed,
}

#[derive(Debug)]
pub(crate) struct TextTemplateEvalError {
    pub(crate) origin: TextTemplateHoleOrigin,
    /// Only ever set for a `Typed` origin. A numeric-expression origin carries no
    /// message: the numeric-expression-hole evaluator's own caller
    /// (`evaluate_numeric_or_push`, called from `text_template_runtime.rs`)
    /// has already pushed the correct `DependencyError` onto `state.errors`
    /// before signalling failure here by returning `None` - nothing in this
    /// struct should be used to build a second, duplicate error for that
    /// case.
    pub(crate) message: Option<String>,
}

/// Evaluates one numeric-expression hole's already-extracted raw content. Mirrors
/// `evaluate_numeric_or_push`'s own `Option`-returning, push-then-`None`
/// convention: `None` means the implementor already recorded the failure
/// (e.g. onto `state.errors`) and this module must not record a second one.
pub(crate) trait NumericExpressionHoleEvaluator {
    fn evaluate_numeric_expression_hole(&mut self, raw: &str) -> Option<String>;
}

fn typed_error(message: String) -> TextTemplateEvalError {
    TextTemplateEvalError {
        origin: TextTemplateHoleOrigin::Typed,
        message: Some(message),
    }
}

/// Evaluates a validated template's segments in source order against
/// `context`, which must resolve typed-hole references (via
/// [`ScalarEvaluationEnvironment::lookup_binding`], reused as-is from Task
/// 18/21's `ScalarBindingResolver`) and evaluate numeric-expression holes (via
/// [`NumericExpressionHoleEvaluator::evaluate_numeric_expression_hole`], reusing the
/// numeric-expression pipeline). `format_number` is the shared `text_number`
/// formatter, used for both numeric-expression and typed number
/// holes.
pub(crate) fn evaluate_text_template_segments<C>(
    segments: &[ValidatedTextTemplateSegment],
    context: &mut C,
    format_number: impl Fn(f64) -> String,
) -> Result<String, TextTemplateEvalError>
where
    C: ScalarEvaluationEnvironment + NumericExpressionHoleEvaluator,
{
    let mut text = String::new();

    for segment in segments {
        match segment {
            ValidatedTextTemplateSegment::Literal { cooked } => text.push_str(cooked),
            ValidatedTextTemplateSegment::NumericExpressionHole { raw } => {
                match context.evaluate_numeric_expression_hole(raw) {
                    Some(value) => text.push_str(&value),
                    None => {
                        return Err(TextTemplateEvalError {
                            origin: TextTemplateHoleOrigin::NumericExpression,
                            message: None,
                        })
                    }
                }
            }
            ValidatedTextTemplateSegment::StringHole { expression } => {
                match evaluate_typed_expression(expression, &*context) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::String(value),
                        ..
                    } => text.push_str(&value),
                    ScalarEvaluation::Ok { .. } => {
                        return Err(typed_error(
                            "テキスト埋め込みの値がstring型ではありません。".to_owned(),
                        ))
                    }
                    ScalarEvaluation::Error { issue_code, .. } => {
                        return Err(typed_error(format!(
                            "テキスト埋め込みに紐づく変数の評価に失敗しました({issue_code})。"
                        )))
                    }
                }
            }
            ValidatedTextTemplateSegment::NumberHole { expression } => {
                match evaluate_typed_expression(expression, &*context) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Number(value),
                        ..
                    } => text.push_str(&format_number(value)),
                    ScalarEvaluation::Ok { .. } => {
                        return Err(typed_error(
                            "テキスト埋め込みの値がnumber型ではありません。".to_owned(),
                        ))
                    }
                    ScalarEvaluation::Error { issue_code, .. } => {
                        return Err(typed_error(format!(
                            "テキスト埋め込みに紐づく変数の評価に失敗しました({issue_code})。"
                        )))
                    }
                }
            }
        }
    }

    Ok(text)
}
