//! Tests for `expression_evaluator.rs`/`expression_evaluator_ops.rs`.
//!
//! Reuses `test/fixtures/typed-expressions.json` (Task 16's shared vectors,
//! already partially exercised by `expression_payload_tests.rs`'s
//! decode-only checks) as the primary parity proof, following that file's
//! own `include_str!`/`inject_dummy_spans` pattern rather than exporting new
//! cross-test-module surface for it.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use serde_json::{json, Value};

use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::expression_payload::{
    validate_typed_expression_payload, MAX_TYPED_EXPRESSION_NODE_COUNT,
};
use super::scalar_payload::decode_scalar_evaluation;
use super::types::{
    BindingId, ScalarBinaryOperator, ScalarEvaluation, ScalarSpan, ScalarType, ScalarUnaryOperator,
    ScalarValue, TypedScalarExpression,
};

// --- shared-vector parity loop --------------------------------------------

const FIXTURE_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../test/fixtures/typed-expressions.json"
));

const AST_NODE_KINDS: [&str; 8] = [
    "numberLiteral",
    "stringLiteral",
    "booleanLiteral",
    "choiceLiteral",
    "reference",
    "unary",
    "binary",
    "group",
];

/// Same dummy-span injection `expression_payload_tests.rs` already does for
/// the same reason (this fixture's `ast` nodes omit `span`/`nameSpan` since
/// no evaluator - TS's or this one's - ever reads them).
fn inject_dummy_spans(value: &mut Value) {
    let Value::Object(map) = value else { return };
    let kind = map.get("kind").and_then(Value::as_str).map(str::to_owned);
    if let Some(kind) = kind.as_deref() {
        if AST_NODE_KINDS.contains(&kind) {
            map.entry("span".to_owned())
                .or_insert_with(|| json!({"start": 0, "end": 0}));
            if kind == "reference" {
                map.entry("nameSpan".to_owned())
                    .or_insert_with(|| json!({"start": 0, "end": 0}));
            }
        }
    }
    for key in ["operand", "left", "right", "expression"] {
        if let Some(child) = map.get_mut(key) {
            inject_dummy_spans(child);
        }
    }
}

fn fixture_vectors() -> Vec<Value> {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON).expect("fixture must be valid JSON");
    fixture["vectors"]
        .as_array()
        .expect("fixture must have a vectors array")
        .clone()
}

/// Built from a vector's `bindings`/`tripwireBindingIds`. `lookup_binding`
/// panics on a tripwire id (the short-circuit proof, mirroring TS's own
/// `buildMockEnvironment`) or on any id the vector didn't register.
struct FixtureEnvironment {
    bindings: HashMap<String, ScalarEvaluation>,
    tripwire_ids: HashSet<String>,
}

impl ScalarEvaluationEnvironment for FixtureEnvironment {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        assert!(
            !self.tripwire_ids.contains(binding_id),
            "must not look up {binding_id} - short-circuit tripwire"
        );
        self.bindings
            .get(binding_id)
            .cloned()
            .unwrap_or_else(|| panic!("vector has no binding registered for {binding_id}"))
    }
}

#[test]
fn evaluates_every_shared_vector_matching_its_expected_result() {
    let vectors = fixture_vectors();
    assert!(!vectors.is_empty(), "expected at least one shared vector");

    for vector in vectors {
        let name = vector["name"].as_str().unwrap_or("<unnamed>").to_owned();

        let mut ast = vector["ast"].clone();
        inject_dummy_spans(&mut ast);
        let node = validate_typed_expression_payload(&ast)
            .unwrap_or_else(|error| panic!("vector \"{name}\" ast failed to decode: {error:?}"));

        let bindings_json = vector["bindings"]
            .as_object()
            .unwrap_or_else(|| panic!("vector \"{name}\" bindings must be an object"));
        let mut bindings = HashMap::new();
        for (binding_id, evaluation_json) in bindings_json {
            let evaluation = decode_scalar_evaluation(evaluation_json).unwrap_or_else(|error| {
                panic!("vector \"{name}\" binding \"{binding_id}\" failed to decode: {error:?}")
            });
            bindings.insert(binding_id.clone(), evaluation);
        }

        let tripwire_ids: HashSet<String> = vector["tripwireBindingIds"]
            .as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| id.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();

        let expected = decode_scalar_evaluation(&vector["expected"]).unwrap_or_else(|error| {
            panic!("vector \"{name}\" expected failed to decode: {error:?}")
        });

        let environment = FixtureEnvironment {
            bindings,
            tripwire_ids,
        };
        let actual = evaluate_typed_expression(&node, &environment);
        assert_eq!(actual, expected, "vector \"{name}\" mismatch");
    }
}

// --- direct-construction tests (mirroring expressionEvaluator.test.ts) ---

fn span() -> ScalarSpan {
    ScalarSpan { start: 0, end: 0 }
}

fn number_literal(value: f64) -> TypedScalarExpression {
    TypedScalarExpression::NumberLiteral {
        span: span(),
        value,
        r#type: ScalarType::Number,
    }
}

fn boolean_literal(value: bool) -> TypedScalarExpression {
    TypedScalarExpression::BooleanLiteral {
        span: span(),
        value,
        r#type: ScalarType::Boolean,
    }
}

fn reference(name: &str, binding_id: &str, r#type: ScalarType) -> TypedScalarExpression {
    TypedScalarExpression::Reference {
        span: span(),
        name_span: span(),
        name: name.to_owned(),
        binding_id: Some(binding_id.to_owned()),
        r#type: Some(r#type),
    }
}

struct PanicEnvironment;

impl ScalarEvaluationEnvironment for PanicEnvironment {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        panic!("must not look up {binding_id} - short-circuit tripwire");
    }
}

#[test]
fn and_with_a_false_left_never_evaluates_a_right_side_unary_operand() {
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::And,
        left: Box::new(boolean_literal(false)),
        right: Box::new(TypedScalarExpression::Unary {
            span: span(),
            operator: ScalarUnaryOperator::Not,
            operand: Box::new(reference("x", "binding:x", ScalarType::Boolean)),
            r#type: Some(ScalarType::Boolean),
        }),
        r#type: Some(ScalarType::Boolean),
    };
    let result = evaluate_typed_expression(&node, &PanicEnvironment);
    assert_eq!(
        result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: ScalarValue::Boolean(false),
        }
    );
}

#[test]
fn or_with_a_true_left_never_evaluates_a_right_side_unary_operand() {
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Or,
        left: Box::new(boolean_literal(true)),
        right: Box::new(TypedScalarExpression::Unary {
            span: span(),
            operator: ScalarUnaryOperator::Not,
            operand: Box::new(reference("x", "binding:x", ScalarType::Boolean)),
            r#type: Some(ScalarType::Boolean),
        }),
        r#type: Some(ScalarType::Boolean),
    };
    let result = evaluate_typed_expression(&node, &PanicEnvironment);
    assert_eq!(
        result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: ScalarValue::Boolean(true),
        }
    );
}

struct PoisonedEnvironment;

impl ScalarEvaluationEnvironment for PoisonedEnvironment {
    fn lookup_binding(&self, _binding_id: &str) -> ScalarEvaluation {
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "poisoned-binding".to_owned(),
            binding_id: Some("binding:poisoned".to_owned()),
        }
    }
}

#[test]
fn carries_the_original_issue_code_and_binding_id_through_nested_group_unary_binary_reference() {
    let reference_node = reference("poisoned", "binding:poisoned", ScalarType::Number);
    let binary = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Add,
        left: Box::new(reference_node),
        right: Box::new(number_literal(1.0)),
        r#type: Some(ScalarType::Number),
    };
    let unary = TypedScalarExpression::Unary {
        span: span(),
        operator: ScalarUnaryOperator::Negate,
        operand: Box::new(binary),
        r#type: Some(ScalarType::Number),
    };
    let group = TypedScalarExpression::Group {
        span: span(),
        expression: Box::new(unary),
        r#type: Some(ScalarType::Number),
    };

    let result = evaluate_typed_expression(&group, &PoisonedEnvironment);
    assert_eq!(
        result,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "poisoned-binding".to_owned(),
            binding_id: Some("binding:poisoned".to_owned()),
        }
    );
}

struct FixedEnvironment {
    bindings: HashMap<BindingId, ScalarEvaluation>,
}

impl ScalarEvaluationEnvironment for FixedEnvironment {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.bindings
            .get(binding_id)
            .cloned()
            .unwrap_or_else(|| panic!("no binding registered for {binding_id}"))
    }
}

#[test]
fn choice_equality_different_value_same_options_is_false() {
    let options = vec!["right".to_owned(), "left".to_owned()];
    let a = ScalarEvaluation::Ok {
        r#type: ScalarType::Choice {
            options: options.clone(),
        },
        value: ScalarValue::Choice {
            value: "right".to_owned(),
            options: options.clone(),
        },
    };
    let b = ScalarEvaluation::Ok {
        r#type: ScalarType::Choice {
            options: options.clone(),
        },
        value: ScalarValue::Choice {
            value: "left".to_owned(),
            options: options.clone(),
        },
    };
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Eq,
        left: Box::new(reference(
            "a",
            "binding:a",
            ScalarType::Choice {
                options: options.clone(),
            },
        )),
        right: Box::new(reference(
            "b",
            "binding:b",
            ScalarType::Choice {
                options: options.clone(),
            },
        )),
        r#type: Some(ScalarType::Boolean),
    };
    let environment = FixedEnvironment {
        bindings: HashMap::from([("binding:a".to_owned(), a), ("binding:b".to_owned(), b)]),
    };
    let result = evaluate_typed_expression(&node, &environment);
    assert_eq!(
        result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: ScalarValue::Boolean(false),
        }
    );
}

#[test]
fn compares_multi_byte_and_emoji_strings_by_exact_equality() {
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Eq,
        left: Box::new(TypedScalarExpression::StringLiteral {
            span: span(),
            value: "前身頃🧵".to_owned(),
            r#type: ScalarType::String,
        }),
        right: Box::new(TypedScalarExpression::StringLiteral {
            span: span(),
            value: "前身頃🧵".to_owned(),
            r#type: ScalarType::String,
        }),
        r#type: Some(ScalarType::Boolean),
    };
    let result = evaluate_typed_expression(&node, &PanicEnvironment);
    assert_eq!(
        result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Boolean,
            value: ScalarValue::Boolean(true),
        }
    );
}

#[test]
fn does_not_round_float_arithmetic() {
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Add,
        left: Box::new(number_literal(0.1)),
        right: Box::new(number_literal(0.2)),
        r#type: Some(ScalarType::Number),
    };
    let result = evaluate_typed_expression(&node, &PanicEnvironment);
    assert_eq!(
        result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(0.1 + 0.2),
        }
    );
}

#[test]
fn reference_as_an_arithmetic_operand_is_checked_and_stops_the_whole_expression() {
    let mismatched = FixedEnvironment {
        bindings: HashMap::from([(
            "binding:x".to_owned(),
            ScalarEvaluation::Ok {
                r#type: ScalarType::String,
                value: ScalarValue::String("not a number".to_owned()),
            },
        )]),
    };
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Add,
        left: Box::new(reference("x", "binding:x", ScalarType::Number)),
        right: Box::new(number_literal(1.0)),
        r#type: Some(ScalarType::Number),
    };
    let result = evaluate_typed_expression(&node, &mismatched);
    assert_eq!(
        result,
        ScalarEvaluation::Error {
            r#type: ScalarType::Number,
            issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
            binding_id: Some("binding:x".to_owned()),
        }
    );
}

#[test]
fn reference_as_an_equality_operand_is_checked() {
    let mismatched = FixedEnvironment {
        bindings: HashMap::from([(
            "binding:x".to_owned(),
            ScalarEvaluation::Ok {
                r#type: ScalarType::String,
                value: ScalarValue::String("not a number".to_owned()),
            },
        )]),
    };
    let node = TypedScalarExpression::Binary {
        span: span(),
        operator: ScalarBinaryOperator::Eq,
        left: Box::new(reference("x", "binding:x", ScalarType::Number)),
        right: Box::new(number_literal(1.0)),
        r#type: Some(ScalarType::Boolean),
    };
    let result = evaluate_typed_expression(&node, &mismatched);
    assert_eq!(
        result,
        ScalarEvaluation::Error {
            r#type: ScalarType::Boolean,
            issue_code: "evaluation-runtime-value-type-mismatch".to_owned(),
            binding_id: Some("binding:x".to_owned()),
        }
    );
}

// --- long flat binary chain: stack safety (Rust-only) ---------------------

struct UnreachableEnvironment;

impl ScalarEvaluationEnvironment for UnreachableEnvironment {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        panic!("no reference should be reached while evaluating a pure-literal tree: {binding_id}");
    }
}

/// Builds a flat left-deep `+` chain, `depth` levels deep, via a `for` loop
/// (no recursion in the builder either). Total node count is `2 * depth + 1`
/// (one binary + one new leaf per level, plus the root leaf).
fn build_flat_plus_chain(depth: usize) -> TypedScalarExpression {
    let mut node = number_literal(0.0);
    for _ in 0..depth {
        node = TypedScalarExpression::Binary {
            span: span(),
            operator: ScalarBinaryOperator::Add,
            left: Box::new(node),
            right: Box::new(number_literal(1.0)),
            r#type: Some(ScalarType::Number),
        };
    }
    node
}

/// Spawns a worker thread with an explicit 2 MiB stack - the same
/// deliberately conservative choice `expression_payload_tests.rs` already
/// uses for its own analogous decode-time stack-safety proof.
fn run_on_bounded_stack<F: FnOnce() + Send + 'static>(work: F) {
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(work)
        .expect("failed to spawn bounded-stack worker thread")
        .join()
        .expect("bounded-stack worker thread panicked (would indicate an unsafe implementation)");
}

#[test]
fn evaluates_a_long_flat_binary_chain_without_overflowing_a_bounded_stack() {
    // This is the regression this task exists to prevent: a naive recursive
    // `fn eval(node) { ... eval(node.left) ... }` would overflow this exact
    // stack at this exact depth. Depth is chosen so the total node count
    // stays within Task 17's own MAX_TYPED_EXPRESSION_NODE_COUNT budget -
    // the same budget its own decode-time stack-safety test already proves
    // safe to *decode*; this proves *evaluating* the result is safe too.
    let depth = (MAX_TYPED_EXPRESSION_NODE_COUNT - 1) / 2;
    run_on_bounded_stack(move || {
        let node = build_flat_plus_chain(depth);
        let result = evaluate_typed_expression(&node, &UnreachableEnvironment);
        assert_eq!(
            result,
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(depth as f64),
            }
        );
        // `node` and `result` both drop normally here, at the end of the
        // closure, on this bounded stack - `node`'s custom iterative `Drop`
        // (types.rs) already proves the *tree*'s destruction is safe; this
        // proves *evaluating* it is too.
    });
}

// --- ignored performance baseline -----------------------------------------

const WARM_UP_RUNS: usize = 5;
const TRIALS: usize = 21;

struct TimingStats {
    median_ms: f64,
    p95_ms: f64,
}

fn timing_stats(samples: &mut [f64]) -> TimingStats {
    samples.sort_by(f64::total_cmp);
    TimingStats {
        median_ms: samples[samples.len() / 2],
        p95_ms: samples[(samples.len() * 95).div_ceil(100).saturating_sub(1)],
    }
}

/// Iteratively pairs leaves into a balanced tree (same technique as
/// `src/scalars/expressionEvaluator.test.ts`'s own `buildBalancedSumTree`
/// and `expression_payload_tests.rs`'s `build_balanced_tree`), so this stays
/// linear-in-node-count rather than linear-in-stack-depth.
fn build_balanced_sum_tree(leaf_count: usize) -> TypedScalarExpression {
    let mut level: Vec<TypedScalarExpression> =
        (0..leaf_count).map(|_| number_literal(1.0)).collect();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut iter = level.into_iter();
        while let Some(left) = iter.next() {
            match iter.next() {
                Some(right) => next.push(TypedScalarExpression::Binary {
                    span: span(),
                    operator: ScalarBinaryOperator::Add,
                    left: Box::new(left),
                    right: Box::new(right),
                    r#type: Some(ScalarType::Number),
                }),
                None => next.push(left),
            }
        }
        level = next;
    }
    level.into_iter().next().unwrap()
}

fn measure_wall_time(leaf_count: usize) -> (ScalarEvaluation, TimingStats) {
    let node = build_balanced_sum_tree(leaf_count);
    let environment = UnreachableEnvironment;

    let correctness = evaluate_typed_expression(&node, &environment);
    for _ in 0..WARM_UP_RUNS {
        let _ = evaluate_typed_expression(&node, &environment);
    }

    let mut samples = Vec::with_capacity(TRIALS);
    for _ in 0..TRIALS {
        let started = Instant::now();
        let _ = evaluate_typed_expression(&node, &environment);
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    (correctness, timing_stats(&mut samples))
}

#[test]
#[ignore]
fn performance_typed_expression_evaluator_baseline() {
    let (small_result, small_stats) = measure_wall_time(250);
    let (large_result, large_stats) = measure_wall_time(1_000);

    assert_eq!(
        small_result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(250.0),
        }
    );
    assert_eq!(
        large_result,
        ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(1_000.0),
        }
    );

    let scaling_ratio = large_stats.median_ms / small_stats.median_ms.max(f64::EPSILON);
    eprintln!(
        "[typedExpressionEvaluator baseline] {}",
        json!({
            "area": "typedExpressionEvaluator",
            "metric": "wallTimeMs",
            "warmUpRuns": WARM_UP_RUNS,
            "trials": TRIALS,
            "small": { "nodeCount": 250, "medianMs": small_stats.median_ms, "p95Ms": small_stats.p95_ms },
            "large": { "nodeCount": 1_000, "medianMs": large_stats.median_ms, "p95Ms": large_stats.p95_ms },
            "scalingRatio": scaling_ratio,
        })
    );
    assert!(small_stats.median_ms.is_finite() && small_stats.p95_ms.is_finite());
    assert!(large_stats.median_ms.is_finite() && large_stats.p95_ms.is_finite());
    assert!(scaling_ratio.is_finite());
}
