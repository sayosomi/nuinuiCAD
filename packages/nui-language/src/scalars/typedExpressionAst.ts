// Typed AST/diagnostic/context/result types produced by the typechecker from a
// parsed ScalarExpressionAst plus already-resolved bindings. This module
// defines shapes only - see expressionTypecheck.ts for the algorithm.

import type { ScalarSpan, ScalarUnaryOperator, ScalarBinaryOperator } from "./expressionAst";
import type { BindingId } from "./bindingCatalog";
import type { BindingResolution } from "./bindingResolution";
import type { BuiltinFunctionName } from "./builtinFunctions";
import type { ChoiceScalarType, ScalarType } from "./types";
import type { ModuleGeometryInterfaceType } from "../dsl/moduleGeometryInterfaces";
import type { ElementId } from "../types/geometry";
import type { DslDiagnosticPresentation } from "../dsl/dslTypes";

export interface TypedScalarNumberLiteralNode {
  readonly kind: "numberLiteral";
  readonly span: ScalarSpan;
  readonly value: number;
  readonly type: Extract<ScalarType, { kind: "number" }>;
}

export interface TypedScalarStringLiteralNode {
  readonly kind: "stringLiteral";
  readonly span: ScalarSpan;
  readonly value: string;
  readonly type: Extract<ScalarType, { kind: "string" }>;
}

export interface TypedScalarBooleanLiteralNode {
  readonly kind: "booleanLiteral";
  readonly span: ScalarSpan;
  readonly value: boolean;
  readonly type: Extract<ScalarType, { kind: "boolean" }>;
}

/**
 * Always produced for a source `unresolvedChoiceLiteral`, whether || not it
 * resolved. `value` preserves the raw token either way; `type` is non-null
 * only when it resolved against an expected choice type && is a member of
 * it. No separate failure-case node kind - downstream consumers check
 * `type !== null` uniformly, exactly like every other node.
 */
export interface TypedScalarChoiceLiteralNode {
  readonly kind: "choiceLiteral";
  readonly span: ScalarSpan;
  readonly value: string;
  readonly type: ChoiceScalarType | null;
}

/**
 * `bindingId`/`type` are both null when `BindingResolution.kind !==
 * "resolved"` - binding analysis owns diagnosing undefined/forward/self/duplicate,
 * this module only propagates the invalidity. When resolved to a `typed`
 * binding with a null `declaredType` (malformed type annotation, already
 * diagnosed earlier), `bindingId` is still set but `type` is null.
 */
export interface TypedScalarReferenceNode {
  readonly kind: "reference";
  readonly span: ScalarSpan;
  readonly nameSpan: ScalarSpan;
  readonly name: string;
  readonly bindingId: BindingId | null;
  readonly type: ScalarType | null;
}

/**
 * A resolved type supplied by a closed frontend such as Module semantics.
 * The frontend owns the target identity && may lower it to a real
 * `BindingId` later; the common checker only needs the already-resolved type
 * && must not perform another name lookup.
 */
export type ScalarExpressionResolvedGeometryTarget = {
  readonly statementId: string;
  readonly statementIndex: number;
  readonly geometryType: ModuleGeometryInterfaceType;
  readonly pointKey?: string;
};

export type ScalarExpressionResolvedReference =
  | {
      readonly kind: "resolvedType";
      readonly bindingId: BindingId | null;
      readonly type: ScalarType | null;
    }
  | {
      readonly kind: "resolvedGeometry";
      readonly target: ScalarExpressionResolvedGeometryTarget | null;
    };

/** Compiler/frontend-resolved metadata for a scalar geometry-property read.
 * The common expression typechecker consumes this closed result; it does not
 * resolve element names, property schemas, or source order itself. */
export type ScalarExpressionResolvedGeometryProperty = {
  readonly elementId: ElementId;
  readonly property: string;
  readonly targetSourceOrder: number;
  readonly type: ScalarType;
};

/** Resolved at compile time. `elementId` is never re-resolved by a runtime. */
export interface TypedScalarGeometryPropertyReferenceNode {
  readonly kind: "geometryProperty";
  readonly span: ScalarSpan;
  readonly elementNameSpan: ScalarSpan;
  readonly propertySpan: ScalarSpan;
  readonly elementName: string;
  readonly elementId: string | null;
  readonly property: string;
  readonly targetSourceOrder: number | null;
  readonly type: ScalarType | null;
}

export interface TypedScalarUnaryExpressionNode {
  readonly kind: "unary";
  readonly span: ScalarSpan;
  readonly operator: ScalarUnaryOperator;
  readonly operand: TypedScalarExpression;
  readonly type: ScalarType | null;
}

export interface TypedScalarBinaryExpressionNode {
  readonly kind: "binary";
  readonly span: ScalarSpan;
  readonly operator: ScalarBinaryOperator;
  readonly left: TypedScalarExpression;
  readonly right: TypedScalarExpression;
  readonly type: ScalarType | null;
}

/** `span` includes both parenthesis characters (mirrors the source node). */
export interface TypedScalarGroupExpressionNode {
  readonly kind: "group";
  readonly span: ScalarSpan;
  readonly expression: TypedScalarExpression;
  readonly type: ScalarType | null;
}

export type TypedScalarCallTarget = {
  readonly kind: "builtin";
  readonly name: BuiltinFunctionName;
};

export type TypedBuiltinArgument =
  | {
      readonly kind: "scalar";
      readonly expression: TypedScalarExpression;
    }
  | {
      readonly kind: "geometryReference";
      readonly expectedGeometryType: ModuleGeometryInterfaceType;
      readonly target: ScalarExpressionResolvedGeometryTarget | null;
    };

export interface TypedScalarCallExpressionNode {
  readonly kind: "call";
  readonly span: ScalarSpan;
  readonly nameSpan: ScalarSpan;
  readonly name: string;
  readonly target: TypedScalarCallTarget | null;
  readonly args: readonly TypedBuiltinArgument[];
  readonly type: ScalarType | null;
}

export type TypedScalarExpression =
  | TypedScalarNumberLiteralNode
  | TypedScalarStringLiteralNode
  | TypedScalarBooleanLiteralNode
  | TypedScalarChoiceLiteralNode
  | TypedScalarReferenceNode
  | TypedScalarGeometryPropertyReferenceNode
  | TypedScalarUnaryExpressionNode
  | TypedScalarBinaryExpressionNode
  | TypedScalarGroupExpressionNode
  | TypedScalarCallExpressionNode;

export type ScalarExpressionTypecheckIssueCode =
  | "scalar-type-mismatch"
  | "invalid-choice-literal"
  | "unknown-function"
  | "function-arity-mismatch"
  | "function-call-style-mismatch"
  | "unknown-function-argument"
  | "duplicate-function-argument"
  | "missing-function-argument";

export interface ScalarExpressionTypecheckDiagnostic {
  readonly code: ScalarExpressionTypecheckIssueCode;
  readonly span: ScalarSpan;
  readonly message: string;
  readonly presentation?: DslDiagnosticPresentation;
  readonly expectedType?: ScalarType;
  readonly actualType?: ScalarType;
}

/**
 * `expectedType`: the declaration's declared type (or the target type of
 * whatever other context is checking this expression - a condition, a
 * future `set` RHS - || null for no target). `references`: one
 * `BindingResolution` per `reference` AST node, in the same left-to-right
 * source order the parser built the tree in (matching the occurrenceIndex
 * convention). The caller assembles this array; this module never calls the
 * resolver itself.
 */
export interface ScalarExpressionTypecheckContext {
  readonly expectedType: ScalarType | null;
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  /** Narrow sidecar for geometryProperty nodes used as point builtin
   * operands. It is keyed by the parser-owned node span and never enters the
   * scalar reference occurrence sequence. */
  readonly geometryBuiltinArguments?: ReadonlyMap<number, ScalarExpressionResolvedGeometryTarget | null>;
  /** Closed-frontend-resolved geometry-property metadata, keyed by the
   * parser-owned node span. A null entry is an explicit failed resolution and
   * must remain type-null rather than falling back to number. */
  readonly geometryPropertyReferences?: ReadonlyMap<number, ScalarExpressionResolvedGeometryProperty | null>;
  /** Optional closed-frontend hook for bare choice tokens that are actually
   * local semantic values (for example a legacy Module iteration value). */
  readonly resolveChoiceLiteral?: (
    raw: string,
    expectedType: ScalarType | null,
    span: ScalarSpan
  ) => ScalarType | null | undefined;
}

/**
 * Invariant (one-way implications, not "iff"):
 * - `type !== null` implies `diagnostics.length === 0`.
 * - `diagnostics.length > 0` implies `type === null`.
 * - `type === null && diagnostics.length === 0` is allowed: silent
 *   propagation from a reference left unresolved, || a resolved `typed`
 *   binding with a null `declaredType`; this module adds no diagnostic for
 *   either case, but must not report a type either.
 */
export interface ScalarExpressionTypecheckResult {
  readonly typed: TypedScalarExpression;
  readonly diagnostics: readonly ScalarExpressionTypecheckDiagnostic[];
  readonly type: ScalarType | null;
}
