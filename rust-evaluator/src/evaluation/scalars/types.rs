//! Validated Rust mirrors of the TypeScript typed-scalar contracts. These are
//! plain data shapes only - construction happens exclusively through the
//! decoders in `scalar_payload.rs`/`expression_payload.rs`, which are the
//! only code allowed to build a value of these types from untrusted JSON.
//!
//! Mirrors (field-for-field): `src/scalars/types.ts` (`ScalarType`,
//! `ScalarValue`, `ScalarEvaluation`) and `src/scalars/typedExpressionAst.ts`
//! (`TypedScalarExpression` and its 9 node kinds). `BindingId` is an opaque
//! string (format `binding:<id>`, per `src/scalars/bindingCatalog.ts`) that
//! Rust never parses or resolves - see the module doc on
//! `expression_payload.rs` for why.

pub(crate) type BindingId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GeometryInterfaceType {
    Point,
    Line,
    Path,
}

impl GeometryInterfaceType {
    pub(crate) fn from_wire_name(name: &str) -> Option<Self> {
        match name {
            "point" => Some(Self::Point),
            "line" => Some(Self::Line),
            "path" => Some(Self::Path),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScalarExpressionResolvedGeometryTarget {
    pub(crate) statement_id: String,
    pub(crate) statement_index: usize,
    pub(crate) geometry_type: GeometryInterfaceType,
    pub(crate) point_key: Option<String>,
}

/// A source-text offset range, `[start, end)`. Never read for evaluation
/// (the evaluators don't use spans - source-span re-association is a
/// TypeScript-adapter responsibility, but the
/// span remains part of the wire shape and is decoded and validated here.
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ScalarEvaluationErrorContext {
    GeometryBuiltinTarget {
        target_element_id: String,
        point_key: Option<String>,
    },
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
        context: Option<ScalarEvaluationErrorContext>,
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
    Remainder,
    Pow,
}

/// Closed identity for the builtins that TypeScript has already resolved.
/// Rust never resolves a source-level function name; it only accepts one of
/// these identities at the payload boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BuiltinFunctionName {
    Abs,
    Min,
    Max,
    Sqrt,
    Round,
    Floor,
    Ceil,
    RoundTo,
    IsClose,
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    Atan2,
    SpreadAngle,
    String,
    Distance,
    Angle,
    LineDistance,
    LineAngle,
}

impl BuiltinFunctionName {
    pub(crate) fn from_wire_name(name: &str) -> Option<Self> {
        match name {
            "abs" => Some(Self::Abs),
            "min" => Some(Self::Min),
            "max" => Some(Self::Max),
            "sqrt" => Some(Self::Sqrt),
            "round" => Some(Self::Round),
            "floor" => Some(Self::Floor),
            "ceil" => Some(Self::Ceil),
            "roundTo" => Some(Self::RoundTo),
            "isClose" => Some(Self::IsClose),
            "sin" => Some(Self::Sin),
            "cos" => Some(Self::Cos),
            "tan" => Some(Self::Tan),
            "asin" => Some(Self::Asin),
            "acos" => Some(Self::Acos),
            "atan" => Some(Self::Atan),
            "atan2" => Some(Self::Atan2),
            "spreadAngle" => Some(Self::SpreadAngle),
            "string" => Some(Self::String),
            "distance" => Some(Self::Distance),
            "angle" => Some(Self::Angle),
            "lineDistance" => Some(Self::LineDistance),
            "lineAngle" => Some(Self::LineAngle),
            _ => None,
        }
    }

    pub(crate) fn argument_signatures(self) -> &'static [&'static [BuiltinArgumentType]] {
        match self {
            Self::Abs | Self::Sqrt | Self::String => &[&[BuiltinArgumentType::Scalar]],
            Self::Min | Self::Max | Self::RoundTo | Self::SpreadAngle => {
                &[&[BuiltinArgumentType::Scalar, BuiltinArgumentType::Scalar]]
            }
            Self::Round | Self::Floor | Self::Ceil => &[
                &[BuiltinArgumentType::Scalar],
                &[BuiltinArgumentType::Scalar, BuiltinArgumentType::Scalar],
            ],
            Self::IsClose => &[&[
                BuiltinArgumentType::Scalar,
                BuiltinArgumentType::Scalar,
                BuiltinArgumentType::Scalar,
            ]],
            Self::Sin | Self::Cos | Self::Tan | Self::Asin | Self::Acos | Self::Atan => {
                &[&[BuiltinArgumentType::Scalar]]
            }
            Self::Atan2 => &[&[BuiltinArgumentType::Scalar, BuiltinArgumentType::Scalar]],
            Self::Distance | Self::Angle => &[&[
                BuiltinArgumentType::Geometry(GeometryInterfaceType::Point),
                BuiltinArgumentType::Geometry(GeometryInterfaceType::Point),
            ]],
            Self::LineDistance => &[&[
                BuiltinArgumentType::Geometry(GeometryInterfaceType::Point),
                BuiltinArgumentType::Geometry(GeometryInterfaceType::Line),
            ]],
            Self::LineAngle => &[&[
                BuiltinArgumentType::Geometry(GeometryInterfaceType::Line),
                BuiltinArgumentType::Geometry(GeometryInterfaceType::Line),
            ]],
        }
    }

    pub(crate) fn is_geometry(self) -> bool {
        matches!(
            self,
            Self::Distance | Self::Angle | Self::LineDistance | Self::LineAngle
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BuiltinArgumentType {
    Scalar,
    Geometry(GeometryInterfaceType),
}

/// A call target is resolved before it crosses into Rust. Keeping this as a
/// closed type prevents the evaluator from re-resolving source names or
/// accepting an arbitrary callee shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TypedScalarCallTarget {
    Builtin(BuiltinFunctionName),
}

/// Mirrors `src/scalars/typedExpressionAst.ts`'s `TypedScalarExpression`.
/// Every node kind except the four literal leaves carries a nullable
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
    Call {
        span: ScalarSpan,
        name_span: ScalarSpan,
        name: String,
        target: TypedScalarCallTarget,
        args: Vec<TypedBuiltinArgument>,
        r#type: Option<ScalarType>,
    },
}

#[derive(Debug, PartialEq)]
pub(crate) enum TypedBuiltinArgument {
    Scalar {
        expression: TypedScalarExpression,
    },
    GeometryReference {
        expected_geometry_type: GeometryInterfaceType,
        target: Option<ScalarExpressionResolvedGeometryTarget>,
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
        TypedScalarExpression::Call { args, .. } => std::mem::take(args)
            .into_iter()
            .filter_map(|argument| match argument {
                TypedBuiltinArgument::Scalar { expression } => Some(expression),
                TypedBuiltinArgument::GeometryReference { .. } => None,
            })
            .collect(),
        TypedScalarExpression::NumberLiteral { .. }
        | TypedScalarExpression::StringLiteral { .. }
        | TypedScalarExpression::BooleanLiteral { .. }
        | TypedScalarExpression::ChoiceLiteral { .. }
        | TypedScalarExpression::Reference { .. }
        | TypedScalarExpression::GeometryProperty { .. } => Vec::new(),
    }
}
