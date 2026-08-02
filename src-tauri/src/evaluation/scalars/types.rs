//! Validated Rust mirrors of the TypeScript typed-scalar contracts. These are
//! plain data shapes only - construction happens exclusively through the
//! decoders in `scalar_payload.rs`/`expression_payload.rs`, which are the
//! only code allowed to build a value of these types from untrusted JSON.
//!
//! Mirrors (field-for-field): `src/scalars/types.ts` (`ScalarType`,
//! `ScalarValue`, `ScalarEvaluation`) and `src/scalars/typedExpressionAst.ts`
//! (`TypedScalarExpression` and its 8 node kinds). `BindingId` is an opaque
//! string (format `binding:<id>`, per `src/scalars/bindingCatalog.ts`) that
//! Rust never parses or resolves - see the module doc on
//! `expression_payload.rs` for why.

pub(crate) type BindingId = String;

/// A source-text offset range, `[start, end)`. Never read for evaluation
/// (Task 16's evaluator and Task 18's Rust counterpart don't use spans -
/// source-span re-association is a TS-adapter responsibility, per D17 in
/// docs/typed-variables/decisions.md), but still part of the real wire shape
/// TS produces, so still decoded and validated for shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ScalarSpan {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

/// Mirrors `src/scalars/types.ts`'s `ScalarType`. Choice identity is
/// options + order (D07 in decisions.md), so `options` here is a `Vec`, not
/// a set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ScalarType {
    Number,
    String,
    Boolean,
    Choice { options: Vec<String> },
}

/// Mirrors `src/scalars/types.ts`'s `ScalarValue`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ScalarValue {
    Number(f64),
    String(String),
    Boolean(bool),
    Choice { value: String, options: Vec<String> },
}

/// Mirrors `src/scalars/types.ts`'s `ScalarEvaluation`. `issue_code` is a
/// plain `String`, not a closed Rust enum: the TS type declares it as an
/// open `string`, and the shared fixture already exercises values (e.g.
/// `"poisoned-binding"`) that no TS module defines centrally - closing over
/// a fixed set here would reject valid environment-injected values.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ScalarEvaluation {
    Ok {
        r#type: ScalarType,
        value: ScalarValue,
    },
    Error {
        r#type: ScalarType,
        issue_code: String,
        binding_id: Option<String>,
    },
}

/// Mirrors `src/scalars/expressionAst.ts`'s `ScalarUnaryOperator`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScalarUnaryOperator {
    Not,
    Negate,
    Plus,
}

/// Mirrors `src/scalars/expressionAst.ts`'s `ScalarBinaryOperator`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScalarBinaryOperator {
    Or,
    And,
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    Add,
    Sub,
    Mul,
    Div,
}

/// Mirrors `src/scalars/typedExpressionAst.ts`'s `TypedScalarExpression`.
/// Every node kind except the three literal leaves carries a nullable
/// `type: Option<ScalarType>` - per that TS module's own documented
/// invariant, this nullability is the sole in-band "this node/subtree is
/// invalid" signal (no separate failure-case node kind exists).
///
/// Deliberately **not** `Clone`: the derived impl would recursively clone
/// every `Box` child, which risks a stack overflow for a deep tree in
/// exactly the way the custom `Drop` impl below exists to prevent for
/// destruction. Nothing in this crate clones a `TypedScalarExpression`
/// today; if a future task genuinely needs to, it should implement an
/// iterative `Clone` the same way `Drop` is implemented here, not rely on
/// `#[derive(Clone)]`.
#[derive(Debug, PartialEq)]
pub(crate) enum TypedScalarExpression {
    NumberLiteral {
        span: ScalarSpan,
        value: f64,
        r#type: ScalarType,
    },
    StringLiteral {
        span: ScalarSpan,
        value: String,
        r#type: ScalarType,
    },
    BooleanLiteral {
        span: ScalarSpan,
        value: bool,
        r#type: ScalarType,
    },
    ChoiceLiteral {
        span: ScalarSpan,
        value: String,
        r#type: Option<ScalarType>,
    },
    Reference {
        span: ScalarSpan,
        name_span: ScalarSpan,
        name: String,
        binding_id: Option<BindingId>,
        r#type: Option<ScalarType>,
    },
    GeometryProperty {
        span: ScalarSpan,
        element_name_span: ScalarSpan,
        property_span: ScalarSpan,
        element_name: String,
        element_id: String,
        property: String,
        target_source_order: usize,
        r#type: ScalarType,
    },
    Unary {
        span: ScalarSpan,
        operator: ScalarUnaryOperator,
        operand: Box<TypedScalarExpression>,
        r#type: Option<ScalarType>,
    },
    Binary {
        span: ScalarSpan,
        operator: ScalarBinaryOperator,
        left: Box<TypedScalarExpression>,
        right: Box<TypedScalarExpression>,
        r#type: Option<ScalarType>,
    },
    Group {
        span: ScalarSpan,
        expression: Box<TypedScalarExpression>,
        r#type: Option<ScalarType>,
    },
}

/// Decoding a `TypedScalarExpression` from JSON is iterative (see
/// `expression_payload.rs`) specifically so a long flat binary chain within
/// the node-count budget can never overflow the stack. That guarantee would
/// be undone if *destroying* the resulting value still used the default,
/// recursive `Drop` glue: dropping a deeply left-nested `Binary` chain would
/// recurse into `left`'s own drop, which recurses into *its* `left`, and so
/// on - the same class of stack overflow, just moved from construction time
/// to destruction time (which happens automatically, unlike a `.clone()`
/// call - see the enum's own doc comment - so this one isn't optional).
///
/// This flattens the tree into an explicit work list instead: each node's
/// direct children are swapped out for a cheap, childless placeholder
/// (`std::mem::replace`, not a partial move - `TypedScalarExpression`
/// implementing `Drop` means its fields can never be moved out by pattern
/// destructuring, only accessed by reference or swapped through a `&mut`),
/// and the real children are pushed onto a plain `Vec` to be dropped one at
/// a time in a loop. By the time any individual node's own (recursively
/// re-entrant, but now childless) drop fires, it has nothing deep left to
/// recurse into, so total stack depth stays O(1) regardless of the
/// original tree's depth.
impl Drop for TypedScalarExpression {
    fn drop(&mut self) {
        let mut pending = detach_children(self);
        while let Some(mut node) = pending.pop() {
            pending.extend(detach_children(&mut node));
            // `node` drops here, at the end of this iteration - its
            // `detach_children` call just above already emptied out any
            // real Box<TypedScalarExpression> children, so this is O(1).
        }
    }
}

fn childless_placeholder() -> TypedScalarExpression {
    TypedScalarExpression::NumberLiteral {
        span: ScalarSpan { start: 0, end: 0 },
        value: 0.0,
        r#type: ScalarType::Number,
    }
}

/// Replaces every direct `Box<TypedScalarExpression>` child of `node` with
/// [`childless_placeholder`], returning the real children that were there.
/// Used only by the iterative `Drop` impl above.
fn detach_children(node: &mut TypedScalarExpression) -> Vec<TypedScalarExpression> {
    match node {
        TypedScalarExpression::Unary { operand, .. } => {
            vec![std::mem::replace(operand.as_mut(), childless_placeholder())]
        }
        TypedScalarExpression::Binary { left, right, .. } => vec![
            std::mem::replace(left.as_mut(), childless_placeholder()),
            std::mem::replace(right.as_mut(), childless_placeholder()),
        ],
        TypedScalarExpression::Group { expression, .. } => {
            vec![std::mem::replace(
                expression.as_mut(),
                childless_placeholder(),
            )]
        }
        TypedScalarExpression::NumberLiteral { .. }
        | TypedScalarExpression::StringLiteral { .. }
        | TypedScalarExpression::BooleanLiteral { .. }
        | TypedScalarExpression::ChoiceLiteral { .. }
        | TypedScalarExpression::Reference { .. }
        | TypedScalarExpression::GeometryProperty { .. } => Vec::new(),
    }
}
