//! Task 28: connects Task 26/27's compiled `TextTemplateAst` (validated by
//! `scalars::text_template_payload`) to the document's existing
//! `ScalarBindingResolver` and the numeric-expression
//! pipeline, at evaluation time. Mirrors `src/geometry/textTemplateRuntime.ts`'s
//! `evaluateElementTextTemplate` - see that file's module comment for the
//! full design rationale - and reuses `scalars::text`'s pure segment walker
//! rather than re-implementing segment iteration here.
//!
//! `TextTemplateRuntimeContext` is the one place a text element's per-hole
//! evaluation touches `EvaluationState`: it holds a single `&mut
//! EvaluationState` field and exposes it through two non-overlapping-borrow
//! methods (`ScalarEvaluationEnvironment::lookup_binding`, shared;
//! `NumericExpressionHoleEvaluator::evaluate_numeric_expression_hole`, exclusive) - see
//! `scalars::text`'s module doc for why this shape, rather than a
//! long-lived `environment` parameter plus a separate closure, is required
//! here.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::numeric_expression::numeric_value;
use super::scalars::{
    evaluate_text_template_segments, NumericExpressionHoleEvaluator, ScalarDocumentBindingResolver,
    ScalarEvaluation, ScalarEvaluationEnvironment, TextTemplateHoleOrigin, ValidatedTextTemplate,
};
use super::text_evaluator::{normalize_text_expression, text_number};
use super::types::{element_id, element_name, find_element_name, DependencyError, EvaluationState};

/// Text-specific message wrapping matching `src/geometry/textEvaluator.ts`'s
/// own `${element.name} のテキストを評価できません。...` prefix exactly -
/// distinct from `errors.rs`'s `numeric_error`, which wraps as
/// `の数値式を評価できません` for every other numeric-expression consumer.
/// A numeric-expression hole's underlying failure (`NumericEvalError`) is produced by
/// `numeric_value`; this
/// function only owns the *text*-specific wrapping/push, so the message a
/// text element's failing numeric-expression hole reports "のテキストを評価できません".
fn push_numeric_expression_hole_error(
    state: &mut EvaluationState,
    element: &Value,
    error: super::types::NumericEvalError,
) {
    let disabled_group_name = state
        .group_states
        .get(&error.dependency_id)
        .and_then(|group_state| group_state.disabled_by_group_id.clone())
        .and_then(|group_id| find_element_name(state, &group_id));
    let name = element_name(element);
    let message = match disabled_group_name {
        Some(group_name) => format!(
            "{name} のテキストを評価できません。参照先はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、テキストを変更してください。"
        ),
        None => format!("{name} のテキストを評価できません。{}", error.message),
    };
    state.errors.push(DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: name,
        missing_dependency_id: error.dependency_id,
        missing_dependency_name: error.dependency_name,
        message,
    });
}

struct TextTemplateRuntimeContext<'a> {
    /// `None` is valid whenever the template's typed expressions do not contain
    /// a resolved scalar reference that needs binding lookup. Reference-free
    /// typed expressions, including boolean literals and comparisons, use the
    /// existing evaluator without a resolver. The payload decoder rejects a
    /// template with such a reference when no scalar runtime is present. The
    /// expect below therefore protects the narrower invariant that evaluation
    /// reaches a binding reference only with a resolver available.
    resolver: Option<&'a dyn ScalarDocumentBindingResolver>,
    element: &'a Value,
    local_variables: &'a (HashMap<String, f64>, HashMap<String, String>),
    state: &'a mut EvaluationState,
}

impl ScalarEvaluationEnvironment for TextTemplateRuntimeContext<'_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        let resolver = self
            .resolver
            .expect("scalar binding resolver must exist when typed text evaluation reaches a binding reference");
        resolver.resolve_binding(binding_id, self.state)
    }
}

impl NumericExpressionHoleEvaluator for TextTemplateRuntimeContext<'_> {
    /// Same normalization/evaluation/formatting as the existing
    /// `resolve_text`/`text_evaluator.rs` per-hole pipeline (trim,
    /// `normalize_text_expression`, wrap as a numeric `expression` value,
    /// evaluate, format via `text_number`) - unchanged, just scoped to one
    /// already-delimited hole's raw content instead of a whole-string char
    /// scan. Calls the non-pushing `numeric_value` (not
    /// `evaluate_numeric_or_push`) so failure is wrapped and pushed exactly
    /// once, with text's own message wording (`push_numeric_expression_hole_error`),
    /// never the generic numeric-expression wording `evaluate_numeric_or_push`'s
    /// own `numeric_error` would otherwise produce - and never a second,
    /// duplicate error.
    fn evaluate_numeric_expression_hole(&mut self, raw: &str) -> Option<String> {
        let normalized = normalize_text_expression(raw.trim(), self.state);
        let value = json!({ "kind": "expression", "expression": normalized });
        match numeric_value(
            &value,
            self.state,
            self.element,
            &self.local_variables.0,
            &self.local_variables.1,
        ) {
            Ok(numeric) => Some(text_number(numeric)),
            Err(error) => {
                push_numeric_expression_hole_error(self.state, self.element, error);
                None
            }
        }
    }
}

/// Resolves one text element's compiled template. Returns `Some(text)` on
/// success. On failure, pushes exactly one `DependencyError` onto `state`
/// (for a typed-hole failure - self-referential to `element`, matching Task
/// 27's TS convention of always attributing a typed-origin error to the
/// text element itself, never to the specific failed binding, and matching
/// `textEvaluator.ts`'s own `${element.name} のテキストを評価できません。`
/// message prefix) and returns `None`; a numeric-expression-hole failure has already had
/// its own `DependencyError` pushed by `push_numeric_expression_hole_error` above, so
/// nothing further is pushed here.
pub(crate) fn resolve_text_template(
    template: &ValidatedTextTemplate,
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    resolver: Option<&dyn ScalarDocumentBindingResolver>,
    state: &mut EvaluationState,
) -> Option<String> {
    let mut context = TextTemplateRuntimeContext {
        resolver,
        element,
        local_variables,
        state,
    };
    match evaluate_text_template_segments(&template.segments, &mut context, text_number) {
        Ok(text) => Some(text),
        Err(error) => {
            if error.origin == TextTemplateHoleOrigin::Typed {
                let name = element_name(element);
                let message = format!(
                    "{name} のテキストを評価できません。{}",
                    error.message.unwrap_or_default()
                );
                context.state.errors.push(DependencyError {
                    element_id: element_id(element).unwrap_or_default(),
                    element_name: name,
                    missing_dependency_id: element_id(element).unwrap_or_default(),
                    missing_dependency_name: Some(element_name(element)),
                    message,
                });
            }
            None
        }
    }
}
