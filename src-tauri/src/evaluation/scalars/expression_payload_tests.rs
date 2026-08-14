use serde_json::{json, Map, Value};

use super::expression_payload::{
    validate_typed_expression_payload, MAX_SCALAR_EXPRESSION_DEPTH, MAX_TYPED_EXPRESSION_NODE_COUNT,
};
use super::issue::ScalarPayloadIssueCode as Code;
use super::types::{ScalarType, TypedScalarExpression};

// --- golden decode: shared TS/Rust vectors -------------------------------
//
// Reuses test/fixtures/typed-expressions.json as-is (Task 16's shared
// vectors, also consumed by Task 18's Rust evaluator parity suite) rather
// than duplicating it in a Rust-only format. The fixture's own `_notes`
// document that `ast` nodes omit `span`/`nameSpan` because the evaluator
// never reads them; since Task 17's schema requires them (per the wire type
// TS actually produces), this test injects dummy {start:0,end:0} spans
// before decoding - the exact same thing TS's own test-only loader,
// src/scalars/testSupport/typedExpressionVectorFixture.ts, already does for
// the same reason.

const FIXTURE_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../test/fixtures/typed-expressions.json"
));

const AST_NODE_KINDS: [&str; 9] = [
    "numberLiteral",
    "stringLiteral",
    "booleanLiteral",
    "choiceLiteral",
    "reference",
    "unary",
    "binary",
    "group",
    "call",
];

/// Only injects into AST-node objects (`kind` is one of the 9 node kinds)
/// and only recurses through AST child fields (`operand`/`left`/`right`/
/// `expression`) - deliberately does *not* walk into `type` (a
/// `ScalarType`, whose objects also happen to have a `kind` field, e.g.
/// `{"kind":"number"}`, but never carry spans) or `value`/`bindingId`/`name`
/// leaf fields.
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
    if let Some(Value::Array(args)) = map.get_mut("args") {
        for argument in args {
            inject_dummy_spans(argument);
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

#[test]
fn decodes_every_shared_vector_ast_without_a_dedicated_rust_fixture() {
    let vectors = fixture_vectors();
    assert!(!vectors.is_empty(), "expected at least one shared vector");
    for vector in vectors {
        let name = vector["name"].as_str().unwrap_or("<unnamed>");
        let mut ast = vector["ast"].clone();
        inject_dummy_spans(&mut ast);
        let result = validate_typed_expression_payload(&ast);
        assert!(
            result.is_ok(),
            "vector \"{name}\" failed to decode: {:?}",
            result.err()
        );
    }
}

#[test]
fn golden_vector_choice_option_order_survives_decode_distinctly() {
    let vectors = fixture_vectors();
    let vector = vectors
        .into_iter()
        .find(|vector| vector["name"] == "choice-equality-mismatched-literal-option-order-is-false")
        .expect("expected the choice option-order vector in the shared fixture");
    let mut ast = vector["ast"].clone();
    inject_dummy_spans(&mut ast);
    let decoded = validate_typed_expression_payload(&ast).unwrap();
    // TypedScalarExpression implements Drop (see types.rs), so its fields
    // can never be moved out by pattern destructuring - match by reference
    // and clone out just the small pieces this assertion actually needs.
    match &decoded {
        TypedScalarExpression::Binary { left, right, .. } => {
            let left_options = match left.as_ref() {
                TypedScalarExpression::ChoiceLiteral {
                    r#type: Some(ScalarType::Choice { options }),
                    ..
                } => options.clone(),
                other => panic!("expected a resolved choiceLiteral, got {other:?}"),
            };
            let right_options = match right.as_ref() {
                TypedScalarExpression::ChoiceLiteral {
                    r#type: Some(ScalarType::Choice { options }),
                    ..
                } => options.clone(),
                other => panic!("expected a resolved choiceLiteral, got {other:?}"),
            };
            assert_ne!(
                left_options, right_options,
                "the vector's whole point is mismatched option order"
            );
        }
        other => panic!("expected a binary node, got {other:?}"),
    }
}

#[test]
fn golden_vector_unresolved_reference_decodes_with_null_binding_and_type() {
    let vectors = fixture_vectors();
    let vector = vectors
        .into_iter()
        .find(|vector| vector["name"] == "reference-null-binding-id-fails-closed")
        .expect("expected the unresolved-reference vector in the shared fixture");
    let mut ast = vector["ast"].clone();
    inject_dummy_spans(&mut ast);
    let decoded = validate_typed_expression_payload(&ast).unwrap();
    match &decoded {
        TypedScalarExpression::Reference {
            binding_id, r#type, ..
        } => {
            assert!(binding_id.is_none());
            assert!(r#type.is_none());
        }
        other => panic!("expected a reference node, got {other:?}"),
    }
}

// --- malformed payload table: Rust-only adversarial cases -----------------

fn number_literal() -> Value {
    json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "number"}})
}

fn reference_literal() -> Value {
    json!({
        "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": "x", "bindingId": "binding:x", "type": {"kind": "number"}
    })
}

fn geometry_property_literal() -> Value {
    json!({
        "kind": "geometryProperty", "span": {"start": 0, "end": 1},
        "elementNameSpan": {"start": 0, "end": 1}, "propertySpan": {"start": 0, "end": 1},
        "elementName": "line", "elementId": "element:line", "property": "length",
        "targetSourceOrder": 0, "type": {"kind": "number"}
    })
}

fn builtin_call(name: &str, args: Vec<Value>) -> Value {
    json!({
        "kind": "call", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": name, "target": {"kind": "builtin", "name": name}, "args": args,
        "type": {"kind": "number"}
    })
}

fn builtin_call_with_target_name(name: &str, target_name: &str, args: Vec<Value>) -> Value {
    json!({
        "kind": "call", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": name, "target": {"kind": "builtin", "name": target_name}, "args": args,
        "type": {"kind": "number"}
    })
}

#[test]
fn decodes_builtin_call_and_preserves_nested_argument_order_and_references() {
    let payload = builtin_call(
        "min",
        vec![
            builtin_call("abs", vec![reference_literal()]),
            geometry_property_literal(),
        ],
    );
    let decoded = validate_typed_expression_payload(&payload).unwrap();
    match &decoded {
        TypedScalarExpression::Call {
            name, args, target, ..
        } => {
            assert_eq!(name, "min");
            assert_eq!(args.len(), 2);
            assert!(matches!(
                target,
                super::types::TypedScalarCallTarget::Builtin(_)
            ));
            assert!(matches!(args[0], TypedScalarExpression::Call { .. }));
            assert!(matches!(
                args[1],
                TypedScalarExpression::GeometryProperty { .. }
            ));
        }
        other => panic!("expected a call node, got {other:?}"),
    }
}

#[test]
fn call_dispatch_identity_does_not_re_resolve_the_source_name() {
    let payload = builtin_call_with_target_name("not-a-builtin", "abs", vec![number_literal()]);
    assert!(validate_typed_expression_payload(&payload).is_ok());
}

#[test]
fn rejects_unknown_call_target_kind() {
    let mut payload = builtin_call("abs", vec![number_literal()]);
    payload["target"]["kind"] = json!("userFunction");
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::UnknownKind);
}

#[test]
fn rejects_unknown_builtin_target_name() {
    let payload = builtin_call_with_target_name("abs", "unknown", vec![number_literal()]);
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::UnknownKind);
}

#[test]
fn rejects_null_call_target() {
    let mut payload = builtin_call("abs", vec![number_literal()]);
    payload["target"] = Value::Null;
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::NotAnObject);
}

#[test]
fn rejects_malformed_call_target_and_unexpected_target_fields() {
    let mut missing_name = builtin_call("abs", vec![number_literal()]);
    missing_name["target"] = json!({"kind": "builtin"});
    assert_eq!(
        validate_typed_expression_payload(&missing_name)
            .unwrap_err()
            .code,
        Code::MissingField
    );

    let mut extra_field = builtin_call("abs", vec![number_literal()]);
    extra_field["target"]["extra"] = json!(true);
    assert_eq!(
        validate_typed_expression_payload(&extra_field)
            .unwrap_err()
            .code,
        Code::UnexpectedField
    );
}

#[test]
fn rejects_malformed_call_args_and_unexpected_call_fields() {
    let mut missing_args = builtin_call("abs", vec![number_literal()]);
    missing_args.as_object_mut().unwrap().remove("args");
    assert_eq!(
        validate_typed_expression_payload(&missing_args)
            .unwrap_err()
            .code,
        Code::MissingField
    );

    let mut non_array_args = builtin_call("abs", vec![number_literal()]);
    non_array_args["args"] = json!("not-an-array");
    assert_eq!(
        validate_typed_expression_payload(&non_array_args)
            .unwrap_err()
            .code,
        Code::InvalidFieldType
    );

    let mut extra_field = builtin_call("abs", vec![number_literal()]);
    extra_field["extra"] = json!(true);
    assert_eq!(
        validate_typed_expression_payload(&extra_field)
            .unwrap_err()
            .code,
        Code::UnexpectedField
    );
}

#[test]
fn rejects_unknown_node_kind() {
    let payload = json!({"kind": "mystery", "span": {"start": 0, "end": 1}});
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::UnknownKind);
}

#[test]
fn rejects_node_missing_a_required_field() {
    let payload = json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "type": {"kind": "number"}});
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::MissingField);
}

#[test]
fn rejects_node_with_an_unexpected_extra_field() {
    let mut payload = number_literal();
    payload
        .as_object_mut()
        .unwrap()
        .insert("extra".to_owned(), json!(true));
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::UnexpectedField);
}

#[test]
fn rejects_wrong_json_type_for_a_field() {
    let payload = json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": "not a number", "type": {"kind": "number"}});
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InvalidFieldType);
}

#[test]
fn rejects_literal_node_whose_declared_type_kind_does_not_match_its_own_kind() {
    let payload = json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "string"}});
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::LiteralTypeMismatch);
}

#[test]
fn rejects_reference_with_a_non_null_type_but_a_null_binding_id() {
    // TS can never produce this: `type` is only set after a *successful*
    // resolution, which always sets `bindingId` too.
    let payload = json!({
        "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": "x", "bindingId": null, "type": {"kind": "number"}
    });
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InconsistentReferenceBinding);
}

#[test]
fn accepts_reference_with_a_non_null_binding_id_and_a_null_type() {
    // Legal: a resolved binding with a malformed declared type (Task 10
    // already diagnosed it elsewhere) - the reverse combination is fine.
    let payload = json!({
        "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": "x", "bindingId": "binding:x", "type": null
    });
    assert!(validate_typed_expression_payload(&payload).is_ok());
}

#[test]
fn rejects_empty_string_binding_id() {
    let payload = json!({
        "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": "x", "bindingId": "", "type": null
    });
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InvalidBindingId);
}

#[test]
fn rejects_non_string_binding_id() {
    let payload = json!({
        "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
        "name": "x", "bindingId": 12345, "type": null
    });
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InvalidBindingId);
}

#[test]
fn rejects_invalid_binary_operator() {
    let payload = json!({
        "kind": "binary", "span": {"start": 0, "end": 1}, "operator": "%",
        "left": number_literal(), "right": number_literal(), "type": {"kind": "number"}
    });
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InvalidOperator);
}

#[test]
fn rejects_span_with_start_after_end() {
    let payload = json!({"kind": "numberLiteral", "span": {"start": 5, "end": 1}, "value": 1.0, "type": {"kind": "number"}});
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InvalidSpan);
}

// --- choice mismatch --------------------------------------------------

#[test]
fn rejects_choice_literal_value_not_a_member_of_its_declared_options() {
    let payload = json!({
        "kind": "choiceLiteral", "span": {"start": 0, "end": 1},
        "value": "up", "type": {"kind": "choice", "options": ["right", "left"]}
    });
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::InvalidChoiceMember);
}

#[test]
fn rejects_choice_literal_with_a_non_choice_declared_type() {
    let payload = json!({
        "kind": "choiceLiteral", "span": {"start": 0, "end": 1},
        "value": "right", "type": {"kind": "string"}
    });
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::LiteralTypeMismatch);
}

#[test]
fn accepts_choice_literal_with_a_null_type() {
    let payload = json!({"kind": "choiceLiteral", "span": {"start": 0, "end": 1}, "value": "right", "type": null});
    assert!(validate_typed_expression_payload(&payload).is_ok());
}

// --- guards: unary/group nesting depth (payload policy, mirrors a real TS
// wire contract) and node count (the only bound on flat binary chains) ---

/// Builds a flat left-deep `+` chain, `depth` levels deep, whose innermost
/// leaf is a `reference` node (exercising `nameSpan` decode, not just
/// `span`). A `binary` node never increments the unary/group nesting
/// counter (see `MAX_SCALAR_EXPRESSION_DEPTH`'s doc in
/// expression_payload.rs), so this is bounded only by the node-count guard.
///
/// Deliberately does **not** use the `json!({"left": node, ...})` macro
/// form to embed the accumulated `node` each iteration - discovered during
/// this task's implementation that `json!`'s embedding of an
/// already-`Value` expression routes through a `Serialize`-based
/// `to_value` conversion, which walks (and so recurses over) the *entire*
/// existing structure being embedded, not just the new fields. For a
/// `node` whose own depth grows every iteration, that makes each loop
/// iteration's cost - and stack use - scale with the current depth, i.e.
/// the same class of stack-overflow risk this whole test exists to rule
/// out, just hiding in the *test's own fixture construction* instead of in
/// `validate_typed_expression_payload`. Building the wrapping object via
/// direct `Map::insert` instead is a plain, non-recursive move - confirmed
/// safe at this depth by an isolated repro during implementation.
fn build_flat_binary_chain_with_reference_leaf(depth: usize) -> Value {
    let mut node = reference_literal();
    for _ in 0..depth {
        let mut object = Map::new();
        object.insert("kind".to_owned(), Value::String("binary".to_owned()));
        object.insert("span".to_owned(), json!({"start": 0, "end": 1}));
        object.insert("operator".to_owned(), Value::String("+".to_owned()));
        object.insert("type".to_owned(), json!({"kind": "number"}));
        object.insert("left".to_owned(), node);
        object.insert("right".to_owned(), number_literal());
        node = Value::Object(object);
    }
    node
}

/// Iteratively pairs leaves into a balanced tree (same technique as
/// src/scalars/expressionEvaluator.test.ts's buildBalancedSumTree) so this
/// helper itself never recurses deeply - only decode's bounded
/// O(log leafCount) work is exercised, letting the node-count guard be
/// tested independently of the nesting-depth guard.
fn wrap_binary(left: Value, right: Value) -> Value {
    let mut object = Map::new();
    object.insert("kind".to_owned(), Value::String("binary".to_owned()));
    object.insert("span".to_owned(), json!({"start": 0, "end": 1}));
    object.insert("operator".to_owned(), Value::String("+".to_owned()));
    object.insert("type".to_owned(), json!({"kind": "number"}));
    object.insert("left".to_owned(), left);
    object.insert("right".to_owned(), right);
    Value::Object(object)
}

fn build_balanced_tree(leaf_count: usize) -> Value {
    let mut level: Vec<Value> = (0..leaf_count).map(|_| number_literal()).collect();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut iter = level.into_iter();
        while let Some(left) = iter.next() {
            match iter.next() {
                Some(right) => next.push(wrap_binary(left, right)),
                None => next.push(left),
            }
        }
        level = next;
    }
    level.into_iter().next().unwrap()
}

/// See `build_flat_binary_chain_with_reference_leaf`'s doc comment for why
/// this uses direct `Map::insert` rather than `json!({"expression": node,
/// ...})` to wrap the accumulated `node` each iteration.
fn build_nested_group_chain(depth: usize) -> Value {
    let mut node = number_literal();
    for _ in 0..depth {
        let mut object = Map::new();
        object.insert("kind".to_owned(), Value::String("group".to_owned()));
        object.insert("span".to_owned(), json!({"start": 0, "end": 1}));
        object.insert("type".to_owned(), json!({"kind": "number"}));
        object.insert("expression".to_owned(), node);
        node = Value::Object(object);
    }
    node
}

fn build_nested_call_chain(depth: usize) -> Value {
    let mut node = number_literal();
    for _ in 0..depth {
        let mut object = Map::new();
        object.insert("kind".to_owned(), Value::String("call".to_owned()));
        object.insert("span".to_owned(), json!({"start": 0, "end": 1}));
        object.insert("nameSpan".to_owned(), json!({"start": 0, "end": 1}));
        object.insert("name".to_owned(), Value::String("abs".to_owned()));
        object.insert(
            "target".to_owned(),
            json!({"kind": "builtin", "name": "abs"}),
        );
        object.insert("args".to_owned(), Value::Array(vec![node]));
        object.insert("type".to_owned(), json!({"kind": "number"}));
        node = Value::Object(object);
    }
    node
}

fn build_wide_call_tree(call_count: usize) -> Value {
    let args = (0..call_count)
        .map(|_| builtin_call("abs", vec![number_literal()]))
        .collect();
    builtin_call("abs", args)
}

/// Spawns a worker thread with an explicit 2 MiB stack - the default size
/// for a spawned/worker thread, and the realistic conservative case for
/// where a Tauri command handler might actually run (deliberately not
/// relying on the generous ~8 MiB default main-thread stack a `cargo test`
/// process itself typically gets). Used only for the long-chain test below:
/// both decoding *and* dropping the result happen inside the closure, on
/// this bounded stack, so it proves both halves of the pipeline are safe.
fn run_on_bounded_stack<F: FnOnce() + Send + 'static>(work: F) {
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(work)
        .expect("failed to spawn bounded-stack worker thread")
        .join()
        .expect("bounded-stack worker thread panicked (would indicate an unsafe implementation)");
}

#[test]
fn accepts_a_long_flat_binary_chain_within_the_node_count_budget() {
    // This is the regression the redesign exists for: a flat binary chain
    // is bounded only by MAX_TYPED_EXPRESSION_NODE_COUNT, not by any
    // recursion-depth concern, because decoding
    // (validate_typed_expression_payload, expression_payload.rs) and
    // destruction of its *output* (TypedScalarExpression's custom Drop,
    // types.rs) are both iterative. Depth is chosen so the total node
    // count (2 * depth + 1, one binary + one new leaf per level, plus the
    // root leaf) stays within budget. Verified, not assumed, safe on a
    // deliberately conservative 2 MiB worker-thread stack.
    let depth = (MAX_TYPED_EXPRESSION_NODE_COUNT - 1) / 2;
    run_on_bounded_stack(move || {
        let payload = build_flat_binary_chain_with_reference_leaf(depth);
        let result = validate_typed_expression_payload(&payload);
        assert!(
            result.is_ok(),
            "a {depth}-level flat binary chain must decode: {:?}",
            result.err()
        );
        // The *input* `payload` is a plain serde_json::Value tree, and is
        // deliberately never dropped normally here. serde_json's own Value
        // enum has no custom iterative Drop, confirmed by an isolated
        // repro during this task's implementation: a bare deep Value
        // (built the same direct-Map::insert way as this test's own
        // fixture, to rule out the json!()-embedding issue described on
        // `build_flat_binary_chain_with_reference_leaf`) genuinely
        // overflows this exact 2 MiB stack on a normal drop at this depth,
        // even though building it does not. A deep Value tree is therefore
        // unsafe to drop by default *regardless of who holds it* - a
        // pre-existing serde_json characteristic shared by every other
        // Tauri command in this codebase that already accepts a raw Value
        // (e.g. EvaluationInput.elements), not something Task 17
        // introduces or is scoped to fix - validate_typed_expression_payload
        // only ever borrows its input, never owns or drops it. Forgetting
        // this test's own constructed payload (leaked, harmless for a
        // short-lived test process) isolates *this task's* actual claim -
        // that the validator and its output survive - from that unrelated,
        // out-of-scope limitation in the input type it was handed.
        std::mem::forget(payload);
        // `result` (and the TypedScalarExpression tree inside it, since
        // it's Ok) *is* this task's responsibility, and drops normally
        // here at the end of the closure - proving that half of the
        // pipeline is genuinely safe, not just the input-handling half.
    });
}

#[test]
fn accepts_unary_group_nesting_exactly_at_the_limit() {
    let payload = build_nested_group_chain(MAX_SCALAR_EXPRESSION_DEPTH);
    let result = validate_typed_expression_payload(&payload);
    assert!(
        result.is_ok(),
        "group nesting exactly at the limit must decode: {:?}",
        result.err()
    );
}

#[test]
fn rejects_unary_group_nesting_one_level_past_the_limit() {
    // Unlike a flat binary chain, TS's own parser genuinely cannot produce
    // a payload past this - see MAX_SCALAR_EXPRESSION_DEPTH's doc comment
    // in expression_payload.rs for the exact TS-side wire contract this
    // mirrors (verified against expressionParser.ts's `enterNesting` call
    // sites, not assumed).
    let payload = build_nested_group_chain(MAX_SCALAR_EXPRESSION_DEPTH + 1);
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::DepthExceeded);
}

#[test]
fn accepts_nested_calls_exactly_at_the_shared_expression_depth_limit() {
    let payload = build_nested_call_chain(MAX_SCALAR_EXPRESSION_DEPTH);
    assert!(validate_typed_expression_payload(&payload).is_ok());
}

#[test]
fn rejects_nested_calls_one_level_past_the_shared_expression_depth_limit() {
    let payload = build_nested_call_chain(MAX_SCALAR_EXPRESSION_DEPTH + 1);
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::DepthExceeded);
}

#[test]
fn call_nodes_count_toward_the_existing_node_count_limit() {
    let payload = build_wide_call_tree(MAX_TYPED_EXPRESSION_NODE_COUNT / 2);
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::NodeCountExceeded);
}

#[test]
fn rejects_a_wide_shallow_tree_past_the_node_count_limit_independent_of_depth() {
    // A balanced tree of enough leaves exceeds the node-count budget while
    // staying only ~log2(leaf_count) deep - proves the node-count guard
    // fires on its own, not as a side effect of the nesting-depth guard.
    let leaf_count = MAX_TYPED_EXPRESSION_NODE_COUNT;
    let payload = build_balanced_tree(leaf_count);
    let error = validate_typed_expression_payload(&payload).unwrap_err();
    assert_eq!(error.code, Code::NodeCountExceeded);
}

#[test]
fn accepts_a_wide_shallow_tree_within_the_node_count_limit() {
    let leaf_count = MAX_TYPED_EXPRESSION_NODE_COUNT / 4;
    let payload = build_balanced_tree(leaf_count);
    let result = validate_typed_expression_payload(&payload);
    assert!(
        result.is_ok(),
        "a balanced tree well under the node budget must decode: {:?}",
        result.err()
    );
}
