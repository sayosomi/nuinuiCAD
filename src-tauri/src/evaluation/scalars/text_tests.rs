//! Tests for `text.rs`'s pure `evaluate_text_template_segments` - literal
//! assembly, numeric-expression/typed hole dispatch, number formatting, and first-
//! failing-hole-wins ordering. Mirrors `src/scalars/textTemplateEvaluator.test.ts`'s
//! scenarios at the Rust layer.

use std::collections::HashMap;

use super::text::{
    evaluate_text_template_segments, NumericExpressionHoleEvaluator, TextTemplateHoleOrigin,
};
use super::text_template_payload::ValidatedTextTemplateSegment;
use super::types::{ScalarEvaluation, ScalarSpan, ScalarType, ScalarValue, TypedScalarExpression};
use super::ScalarEvaluationEnvironment;

const SPAN: ScalarSpan = ScalarSpan { start: 0, end: 0 };

/// Stub context implementing both traits `evaluate_text_template_segments`
/// requires - `lookup_binding` for typed holes, `evaluate_numeric_expression_hole` for
/// numeric-expression holes - exactly mirroring how the real `text_template_runtime.rs`
/// context holds one `&mut EvaluationState` field but exposes it through
/// two separate, non-overlapping-borrow methods.
struct StubContext {
    bindings: HashMap<String, ScalarEvaluation>,
    numeric_results: HashMap<String, Option<String>>,
}

impl ScalarEvaluationEnvironment for StubContext {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.bindings
            .get(binding_id)
            .cloned()
            .unwrap_or(ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "test-binding-not-registered".to_owned(),
                binding_id: Some(binding_id.to_owned()),
            })
    }
}

impl NumericExpressionHoleEvaluator for StubContext {
    fn evaluate_numeric_expression_hole(&mut self, raw: &str) -> Option<String> {
        self.numeric_results.get(raw).cloned().flatten()
    }
}

fn empty_context() -> StubContext {
    StubContext {
        bindings: HashMap::new(),
        numeric_results: HashMap::new(),
    }
}

fn literal(cooked: &str) -> ValidatedTextTemplateSegment {
    ValidatedTextTemplateSegment::Literal {
        cooked: cooked.to_owned(),
    }
}

fn numeric_expression_hole(raw: &str) -> ValidatedTextTemplateSegment {
    ValidatedTextTemplateSegment::NumericExpressionHole {
        raw: raw.to_owned(),
    }
}

fn string_reference_hole(binding_id: &str) -> ValidatedTextTemplateSegment {
    ValidatedTextTemplateSegment::StringHole {
        expression: TypedScalarExpression::Reference {
            span: SPAN,
            name_span: SPAN,
            name: "name".to_owned(),
            binding_id: Some(binding_id.to_owned()),
            r#type: Some(ScalarType::String),
        },
    }
}

fn number_reference_hole(binding_id: &str) -> ValidatedTextTemplateSegment {
    ValidatedTextTemplateSegment::NumberHole {
        expression: TypedScalarExpression::Reference {
            span: SPAN,
            name_span: SPAN,
            name: "name".to_owned(),
            binding_id: Some(binding_id.to_owned()),
            r#type: Some(ScalarType::Number),
        },
    }
}

fn ok_string(value: &str) -> ScalarEvaluation {
    ScalarEvaluation::Ok {
        r#type: ScalarType::String,
        value: ScalarValue::String(value.to_owned()),
    }
}

fn ok_number(value: f64) -> ScalarEvaluation {
    ScalarEvaluation::Ok {
        r#type: ScalarType::Number,
        value: ScalarValue::Number(value),
    }
}

fn format_number(value: f64) -> String {
    if (value - value.round()).abs() < 0.000_000_001 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

#[test]
fn assembles_literal_only_segments() {
    let segments = vec![literal("前身頃を2枚カット")];
    let result = evaluate_text_template_segments(&segments, &mut empty_context(), format_number);
    assert_eq!(result.unwrap(), "前身頃を2枚カット");
}

#[test]
fn substitutes_a_typed_string_hole() {
    let mut context = empty_context();
    context
        .bindings
        .insert("binding:label".to_owned(), ok_string("前身頃"));
    let segments = vec![
        string_reference_hole("binding:label"),
        literal("を2枚カット"),
    ];
    let result = evaluate_text_template_segments(&segments, &mut context, format_number);
    assert_eq!(result.unwrap(), "前身頃を2枚カット");
}

#[test]
fn formats_an_integer_typed_number_hole_without_a_decimal_point() {
    let mut context = empty_context();
    context
        .bindings
        .insert("binding:count".to_owned(), ok_number(12.0));
    let segments = vec![number_reference_hole("binding:count")];
    let result = evaluate_text_template_segments(&segments, &mut context, format_number);
    assert_eq!(result.unwrap(), "12");
}

#[test]
fn formats_a_non_integer_typed_number_hole_to_three_decimals_trimmed() {
    let mut context = empty_context();
    context
        .bindings
        .insert("binding:count".to_owned(), ok_number(1.5));
    let segments = vec![number_reference_hole("binding:count")];
    let result = evaluate_text_template_segments(&segments, &mut context, format_number);
    assert_eq!(result.unwrap(), "1.5");
}

#[test]
fn delegates_a_numeric_expression_hole_to_the_injected_evaluator() {
    let mut context = empty_context();
    context
        .numeric_results
        .insert("line.length".to_owned(), Some("42".to_owned()));
    let segments = vec![literal("長さ: "), numeric_expression_hole("line.length")];
    let result = evaluate_text_template_segments(&segments, &mut context, format_number);
    assert_eq!(result.unwrap(), "長さ: 42");
}

#[test]
fn interleaves_numeric_expression_and_typed_holes_in_source_order() {
    let mut context = empty_context();
    context
        .bindings
        .insert("binding:label".to_owned(), ok_string("前身頃"));
    context
        .numeric_results
        .insert("line.length".to_owned(), Some("10".to_owned()));
    let segments = vec![
        string_reference_hole("binding:label"),
        literal(" 長さ:"),
        numeric_expression_hole("line.length"),
    ];
    let result = evaluate_text_template_segments(&segments, &mut context, format_number);
    assert_eq!(result.unwrap(), "前身頃 長さ:10");
}

#[test]
fn fails_closed_on_a_numeric_expression_hole_failure_without_a_message_the_caller_already_pushed_one(
) {
    let segments = vec![literal("a"), numeric_expression_hole("bad"), literal("b")];
    let error = evaluate_text_template_segments(&segments, &mut empty_context(), format_number)
        .unwrap_err();
    assert_eq!(error.origin, TextTemplateHoleOrigin::NumericExpression);
    assert!(error.message.is_none());
}

#[test]
fn fails_closed_on_a_typed_hole_evaluation_error() {
    let segments = vec![string_reference_hole("binding:missing")];
    let error = evaluate_text_template_segments(&segments, &mut empty_context(), format_number)
        .unwrap_err();
    assert_eq!(error.origin, TextTemplateHoleOrigin::Typed);
    assert!(error
        .message
        .unwrap()
        .contains("test-binding-not-registered"));
}

// Note: a `string`/`number` hole whose expression evaluates `Ok` with a
// mismatched `ScalarValue` kind is unreachable through a `Reference` node
// specifically, because `expression_evaluator_ops.rs`'s `evaluate_reference`
// already compares the environment's runtime type against the reference's
// own declared static type and returns an `Error` (not `Ok`) on any
// mismatch - and every other node kind's static type is guaranteed
// consistent with its own `ScalarValue` kind by construction (literals
// are directly typed; `text_template_payload.rs`'s decode also independently
// checks the hole's declared root type against `holeKind`). The `Ok { .. }`
// wrong-kind arms in `text.rs` exist only for match-exhaustiveness/defense-
// in-depth, mirroring this codebase's existing "should never happen but
// checked anyway" branches (e.g. `expression_evaluator.rs`'s `choiceLiteral`
// catch-all) - not a scenario this pure-function test suite can exercise
// without hand-building an invalid `TypedScalarExpression`.

#[test]
fn stops_at_the_first_failing_hole_in_source_order_never_evaluating_later_segments() {
    let segments = vec![
        numeric_expression_hole("first-bad"),
        string_reference_hole("binding:should-not-be-reached"),
    ];
    let error = evaluate_text_template_segments(&segments, &mut empty_context(), format_number)
        .unwrap_err();
    assert_eq!(error.origin, TextTemplateHoleOrigin::NumericExpression);
}
