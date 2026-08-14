//! Fail-closed decoder for a `TypedScalarExpression` JSON AST (the shape
//! produced by TS Task 15's typechecker, `src/scalars/typedExpressionAst.ts`)
//! into the validated `TypedScalarExpression` enum in `types.rs`. This is
//! the module Task 18's operator evaluator will consume - by the time a
//! value of `TypedScalarExpression` exists, every node/tag/field, declared
//! type, choice option/member, and reference binding ID shape has already
//! been checked; Task 18 should never need to branch on a raw
//! `serde_json::Value` again.
//!
//! Out of scope here (see docs/typed-variables/tasks/17-rust-expression-payload-validation.md):
//! operator evaluation, binding environments, document integration, and
//! re-deriving Task 15's operator/operand type-inference results - a node's
//! own declared `type` is validated for being *well-formed*, not for being
//! the *semantically correct* result of its operator/operands (that would
//! duplicate the TS typechecker, which is explicitly out of scope). Rust
//! also never resolves `bindingId` against anything - it only checks it is
//! a non-empty, opaque string.
//!
//! **Traversal is iterative, not recursive**, using an explicit `Vec`-backed
//! work stack (`WorkItem`) instead of Rust call-stack recursion. An earlier
//! version of this module used a recursive `decode_node`, guarded by a
//! structural-depth cap chosen by empirically bisecting the recursive
//! implementation's own stack-overflow boundary. That was the wrong fix:
//! Task 14's parser bounds *its own* recursion for `unary`/`group`/`call`
//! nesting (see `MAX_SCALAR_EXPRESSION_DEPTH` below) - it places no limit at
//! all on a flat `binary` chain's length, since same-tier operator chains are
//! parsed with a loop, not recursion. A sufficiently long flat binary chain
//! is therefore a legitimate payload TS's parser can produce, and a Rust
//! guard whose real purpose was protecting Rust's own recursive call stack
//! would reject it - an artifact of the recursive implementation, not a real
//! payload-policy decision. Making traversal iterative removes that
//! constraint instead of papering over it with a "high enough" guess.
//!
//! Leaf decoding lives in `expression_leaf_payload.rs`; shape validation
//! for `unary`/`binary`/`group`/`call` (their own fields, not their children)
//! lives in `expression_shape_payload.rs`; this file owns the explicit
//! work stack, the two guards, and the entry point.

use serde_json::Value;

use super::expression_leaf_payload::{
    decode_boolean_literal, decode_choice_literal, decode_geometry_property, decode_number_literal,
    decode_reference, decode_string_literal,
};
use super::expression_shape_payload::{
    validate_binary_shape, validate_call_shape, validate_group_shape, validate_unary_shape,
};
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, require_field};
use super::types::{
    ScalarBinaryOperator, ScalarSpan, ScalarType, ScalarUnaryOperator, TypedScalarCallTarget,
    TypedScalarExpression,
};

/// Bounds `unary`/`group`/`call` nesting specifically - **not** overall tree
/// depth, and **not** a stack-safety margin (traversal is iterative, so
/// Rust's own call stack is never at risk regardless of how this is set).
/// This is a payload-policy mirror of a real TS-side wire contract: Task
/// 14's parser increments its own recursion-depth counter (`enterNesting`)
/// only when descending into a unary-prefix operand, a parenthesized group,
/// or a call argument, and hard-caps that counter at
/// `MAX_SCALAR_EXPRESSION_DEPTH = 128` (`src/scalars/expressionParser.ts`).
/// A source-text expression needing a 129th level of nested
/// `!`/`-`/`+`/`(...)`/call argument fails to parse on the TS side entirely
/// (`ast: null`, `expression-depth-exceeded`), so no wire payload TS ever
/// sends can have more than 128 levels of that nesting. 128 is therefore not
/// a guess or a margin - it is exactly the bound TS itself enforces.
/// `binary` nodes do not increment this counter at all (see the module doc)
/// and are
/// bounded only by [`MAX_TYPED_EXPRESSION_NODE_COUNT`] below.
pub(crate) const MAX_SCALAR_EXPRESSION_DEPTH: usize = 128;

/// Total node count guard, independent of the nesting-depth guard above:
/// bounds a wide-but-shallow adversarial payload the depth counter alone
/// wouldn't catch, and - since traversal is iterative and `unary`/`group`
/// nesting is the only thing depth-limited - is now also the sole bound on
/// how long a flat `binary` chain may be. Realistic expressions are dozens
/// to low hundreds of nodes; this only bounds adversarial input. Checked
/// and decremented once per node visited, before any further work on that
/// node.
pub(crate) const MAX_TYPED_EXPRESSION_NODE_COUNT: usize = 20_000;

/// One entry in the explicit work stack. `Visit` still needs decoding;
/// `Build*` means its child/children have already been decoded and pushed
/// onto the output stack, and are ready to be assembled into the parent
/// node.
enum WorkItem<'a> {
    Visit {
        json: &'a Value,
        expression_depth: usize,
    },
    BuildUnary {
        span: ScalarSpan,
        operator: ScalarUnaryOperator,
        r#type: Option<ScalarType>,
    },
    BuildBinary {
        span: ScalarSpan,
        operator: ScalarBinaryOperator,
        r#type: Option<ScalarType>,
    },
    BuildGroup {
        span: ScalarSpan,
        r#type: Option<ScalarType>,
    },
    BuildCall {
        span: ScalarSpan,
        name_span: ScalarSpan,
        name: String,
        target: TypedScalarCallTarget,
        argument_count: usize,
        r#type: Option<ScalarType>,
    },
}

/// Processes one `Visit` work item: applies both guards, decodes the node's
/// own shape, and either pushes a fully-decoded leaf straight onto
/// `output`, or pushes a `Build*` marker followed by that node's children
/// (as new `Visit` items) onto `work` - `unary`/`group`/`call` children get
/// `expression_depth + 1`; `binary` children keep the same depth, since
/// binary chains are not depth-limited (see the module doc).
///
/// Work-stack push order matters: pushing `Build*` first and then a node's
/// children (rightmost child first, for `binary`) means the leftmost child
/// is popped and fully resolved - including any of *its own* nested
/// children, via the same loop - before its sibling, so by the time the
/// `Build*` marker is popped, `output`'s top items are exactly that node's
/// children, in the right order to pop back off (`Binary` pops `right`
/// then `left`, since `right` was pushed to `output` second).
fn visit_node<'a>(
    json: &'a Value,
    expression_depth: usize,
    remaining_nodes: &mut usize,
    work: &mut Vec<WorkItem<'a>>,
    output: &mut Vec<TypedScalarExpression>,
) -> Result<(), ScalarPayloadIssue> {
    if expression_depth > MAX_SCALAR_EXPRESSION_DEPTH {
        return Err(issue(
            Code::DepthExceeded,
            format!(
                "typed expression exceeds the {MAX_SCALAR_EXPRESSION_DEPTH}-level unary/group/call nesting limit"
            ),
        ));
    }
    if *remaining_nodes == 0 {
        return Err(issue(
            Code::NodeCountExceeded,
            format!("typed expression exceeds the {MAX_TYPED_EXPRESSION_NODE_COUNT}-node limit"),
        ));
    }
    *remaining_nodes -= 1;

    let object = as_object(json, "typed expression node")?;
    let kind = require_field(object, "kind", "typed expression node")?
        .as_str()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "typed expression node \"kind\" must be a string",
            )
        })?;

    match kind {
        "numberLiteral" => output.push(decode_number_literal(object)?),
        "stringLiteral" => output.push(decode_string_literal(object)?),
        "booleanLiteral" => output.push(decode_boolean_literal(object)?),
        "choiceLiteral" => output.push(decode_choice_literal(object)?),
        "reference" => output.push(decode_reference(object)?),
        "geometryProperty" => output.push(decode_geometry_property(object)?),
        "unary" => {
            let shape = validate_unary_shape(object)?;
            work.push(WorkItem::BuildUnary {
                span: shape.span,
                operator: shape.operator,
                r#type: shape.r#type,
            });
            work.push(WorkItem::Visit {
                json: shape.operand,
                expression_depth: expression_depth + 1,
            });
        }
        "binary" => {
            let shape = validate_binary_shape(object)?;
            work.push(WorkItem::BuildBinary {
                span: shape.span,
                operator: shape.operator,
                r#type: shape.r#type,
            });
            work.push(WorkItem::Visit {
                json: shape.right,
                expression_depth,
            });
            work.push(WorkItem::Visit {
                json: shape.left,
                expression_depth,
            });
        }
        "group" => {
            let shape = validate_group_shape(object)?;
            work.push(WorkItem::BuildGroup {
                span: shape.span,
                r#type: shape.r#type,
            });
            work.push(WorkItem::Visit {
                json: shape.expression,
                expression_depth: expression_depth + 1,
            });
        }
        "call" => {
            let shape = validate_call_shape(object)?;
            let argument_count = shape.args.len();
            work.push(WorkItem::BuildCall {
                span: shape.span,
                name_span: shape.name_span,
                name: shape.name,
                target: shape.target,
                argument_count,
                r#type: shape.r#type,
            });
            for argument in shape.args.iter().rev() {
                work.push(WorkItem::Visit {
                    json: argument,
                    expression_depth: expression_depth + 1,
                });
            }
        }
        other => {
            return Err(issue(
                Code::UnknownKind,
                format!("unknown typed expression node kind \"{other}\""),
            ))
        }
    }
    Ok(())
}

/// Entry point: validates and decodes a single typed-scalar-expression JSON
/// payload into a trusted `TypedScalarExpression`. Fails closed on any
/// structural or semantic inconsistency - see the module doc for what is
/// and isn't checked, and for why traversal is iterative.
pub(crate) fn validate_typed_expression_payload(
    json: &Value,
) -> Result<TypedScalarExpression, ScalarPayloadIssue> {
    let mut work = vec![WorkItem::Visit {
        json,
        expression_depth: 0,
    }];
    let mut output: Vec<TypedScalarExpression> = Vec::new();
    let mut remaining_nodes = MAX_TYPED_EXPRESSION_NODE_COUNT;

    while let Some(item) = work.pop() {
        match item {
            WorkItem::Visit {
                json,
                expression_depth,
            } => visit_node(
                json,
                expression_depth,
                &mut remaining_nodes,
                &mut work,
                &mut output,
            )?,
            WorkItem::BuildUnary {
                span,
                operator,
                r#type,
            } => {
                let operand = output
                    .pop()
                    .expect("unary operand must already be decoded (post-order build invariant)");
                output.push(TypedScalarExpression::Unary {
                    span,
                    operator,
                    operand: Box::new(operand),
                    r#type,
                });
            }
            WorkItem::BuildBinary {
                span,
                operator,
                r#type,
            } => {
                let right = output
                    .pop()
                    .expect("binary right must already be decoded (post-order build invariant)");
                let left = output
                    .pop()
                    .expect("binary left must already be decoded (post-order build invariant)");
                output.push(TypedScalarExpression::Binary {
                    span,
                    operator,
                    left: Box::new(left),
                    right: Box::new(right),
                    r#type,
                });
            }
            WorkItem::BuildGroup { span, r#type } => {
                let expression = output.pop().expect(
                    "group expression must already be decoded (post-order build invariant)",
                );
                output.push(TypedScalarExpression::Group {
                    span,
                    expression: Box::new(expression),
                    r#type,
                });
            }
            WorkItem::BuildCall {
                span,
                name_span,
                name,
                target,
                argument_count,
                r#type,
            } => {
                let mut args = Vec::with_capacity(argument_count);
                for _ in 0..argument_count {
                    args.push(output.pop().expect(
                        "call argument must already be decoded (post-order build invariant)",
                    ));
                }
                args.reverse();
                output.push(TypedScalarExpression::Call {
                    span,
                    name_span,
                    name,
                    target,
                    args,
                    r#type,
                });
            }
        }
    }

    Ok(output
        .pop()
        .expect("root node must have been decoded by the time the work stack is empty"))
}
