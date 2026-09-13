// Typed AST/diagnostic/context/result types produced by the typechecker from a
// parsed ScalarExpressionAst plus already-resolved bindings. This module
// defines shapes only - see expressionTypecheck.ts for the algorithm.

import type { ScalarSpan, ScalarUnaryOperator, ScalarBinaryOperator } from "./expressionAst";
import type { BindingId } from "./bindingCatalog";
import type { BindingResolution } from "./bindingResolution";
import type { BuiltinFunctionName } from "./builtinFunctions";
import type { ChoiceScalarType, ScalarExpressionType, ScalarType } from "./types";
import type { DslOptionalValueType } from "../dsl/dslValueTypes";
import type { ModuleGeometryInterfaceType } from "../dsl/moduleGeometryInterfaces";
import type { ElementId } from "../types/geometry";
import type { GeometryValueOccurrence } from "../types/geometry";
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

export interface TypedScalarNoneLiteralNode {
  readonly kind: "noneLiteral";
  readonly span: ScalarSpan;
  readonly type: DslOptionalValueType | null;
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
  readonly type: ScalarExpressionType | null;
}

export type ScalarExpressionResolvedCollectionIndex = {
  readonly kind: "resolvedCollectionIndex";
  readonly collectionValueId: string;
  readonly collectionLength: number | null;
  readonly targetSourceOrder: number;
  readonly type: ScalarExpressionType | null;
};

export interface TypedScalarCollectionIndexNode {
  readonly kind: "collectionIndex";
  readonly span: ScalarSpan;
  readonly nameSpan: ScalarSpan;
  readonly name: string;
  readonly collectionValueId: string | null;
  readonly collectionLength: number | null;
  readonly targetSourceOrder: number | null;
  readonly index: TypedScalarExpression;
  readonly type: ScalarExpressionType | null;
}

/**
 * A resolved type supplied by a closed frontend such as Module semantics.
 * The frontend owns the target identity && may lower it to a real
 * `BindingId` later; the common checker only needs the already-resolved type
 * && must not perform another name lookup.
 */
export type ScalarExpressionResolvedGeometryTarget = {
  readonly kind?: "drawable";
  readonly statementId: string;
  readonly statementIndex: number;
  readonly geometryType: ModuleGeometryInterfaceType;
  readonly pointKey?: string;
} | {
  readonly kind: "forGroupOccurrence";
  readonly templateElementId: ElementId;
  /** Compatibility projection for consumers that only understand authored
   * drawable targets; runtime resolution uses the explicit template field. */
  readonly statementId: ElementId;
  readonly statementIndex: number;
  readonly targetSourceOrder: number;
  readonly index: TypedScalarExpression | null;
  readonly geometryType: ModuleGeometryInterfaceType;
  readonly pointKey?: string;
} | {
  readonly kind: "geometryValueForBinder";
  readonly binderId: BindingId;
  readonly statementId: string;
  readonly statementIndex: number;
  readonly geometryType: ModuleGeometryInterfaceType;
  readonly pointKey?: string;
} | {
  readonly kind: "geometryValue";
  readonly occurrence: GeometryValueOccurrence;
  readonly statementId: string;
  readonly statementIndex: number;
  readonly geometryType: ModuleGeometryInterfaceType;
  readonly pointKey?: string;
};

export type ScalarExpressionResolvedReference =
  | {
      readonly kind: "resolvedType";
      readonly bindingId: BindingId | null;
      readonly type: ScalarExpressionType | null;
    }
  | {
      readonly kind: "resolvedGeometry";
      readonly target: ScalarExpressionResolvedGeometryTarget | null;
    }
  | ScalarExpressionResolvedCollectionIndex;

/** Compiler/frontend-resolved metadata for a scalar geometry-property read.
 * The common expression typechecker consumes this closed result; it does not
 * resolve element names, property schemas, or source order itself. */
export type ScalarExpressionResolvedGeometryProperty = {
  readonly kind?: "drawable";
  readonly elementId: ElementId;
  readonly property: string;
  readonly targetSourceOrder: number;
  readonly type: ScalarExpressionType;
} | {
  readonly kind: "forGroupOccurrence";
  readonly templateElementId: ElementId;
  readonly property: string;
  readonly targetSourceOrder: number;
  readonly index: TypedScalarExpression | null;
  readonly pointKey?: string;
  readonly type: ScalarExpressionType;
} | {
  readonly kind: "geometryValueForBinder";
  readonly binderId: BindingId;
  readonly property: string;
  readonly pointKey?: string;
  readonly targetSourceOrder: number;
  readonly type: ScalarExpressionType;
} | {
  readonly kind: "geometryValue";
  readonly occurrence: GeometryValueOccurrence;
  readonly property: string;
  readonly pointKey?: string;
  readonly targetSourceOrder: number;
  readonly type: ScalarExpressionType;
} | {
  readonly kind: "collection";
  readonly collectionValueId: string;
  readonly collectionLength: number | null;
  readonly targetSourceOrder: number;
  readonly type: Extract<ScalarType, { kind: "number" }>;
};

/** Compiler-resolved target for a general optional member read. Runtime code
 * consumes only these stable identities; it never re-resolves source names. */
export type ScalarExpressionResolvedOptionalMemberTarget =
  | {
      readonly kind: "collectionLength";
      readonly collectionValueId: string;
      readonly collectionLength: number | null;
      readonly targetSourceOrder: number;
    }
  | {
      readonly kind: "recordField";
      readonly collectionValueId: string;
      readonly collectionLength: number | null;
      readonly targetSourceOrder: number;
      readonly field: {
        readonly recordStatementId: string;
        readonly fieldIndex: number;
        readonly type: ScalarExpressionType;
        readonly fieldPath?: readonly { recordStatementId: string; fieldIndex: number }[];
      };
    }
  | {
      readonly kind: "geometryProperty";
      readonly reference: ScalarExpressionResolvedGeometryProperty;
      readonly receiver: {
        readonly kind: "geometryValue";
        readonly target: ScalarExpressionResolvedGeometryTarget;
      } | {
        readonly kind: "collection";
        readonly collectionValueId: string;
        readonly collectionLength: number | null;
        readonly targetSourceOrder: number;
      };
    };

/** Resolved at compile time. `elementId` is never re-resolved by a runtime. */
export interface TypedScalarGeometryPropertyReferenceNode {
  readonly kind: "geometryProperty";
  readonly span: ScalarSpan;
  readonly elementNameSpan: ScalarSpan;
  readonly propertySpan: ScalarSpan;
  readonly elementName: string;
  readonly elementId: string | null;
  /** Collection cardinality is a source-semantic property, not a drawable
   * identity. These fields are mutually exclusive with geometry targets. */
  readonly collectionValueId?: string;
  readonly collectionLength?: number | null;
  readonly geometryValueOccurrence?: GeometryValueOccurrence;
  readonly geometryValuePointKey?: string;
  readonly geometryValueBinderId?: BindingId;
  readonly forGroupOccurrenceTemplateElementId?: ElementId;
  readonly forGroupOccurrenceIndex?: TypedScalarExpression | null;
  readonly forGroupOccurrencePointKey?: string;
  readonly property: string;
  readonly targetSourceOrder: number | null;
  readonly type: ScalarExpressionType | null;
}

export interface TypedScalarOptionalMemberExpressionNode {
  readonly kind: "optionalMember";
  readonly span: ScalarSpan;
  readonly receiverSpan: ScalarSpan;
  readonly operatorSpan: ScalarSpan;
  readonly memberSpan: ScalarSpan;
  readonly member: string;
  readonly target: ScalarExpressionResolvedOptionalMemberTarget | null;
  readonly type: ScalarExpressionType | null;
}

export interface TypedScalarUnaryExpressionNode {
  readonly kind: "unary";
  readonly span: ScalarSpan;
  readonly operator: ScalarUnaryOperator;
  readonly operand: TypedScalarExpression;
  readonly type: ScalarExpressionType | null;
}

export interface TypedScalarBinaryExpressionNode {
  readonly kind: "binary";
  readonly span: ScalarSpan;
  readonly operator: ScalarBinaryOperator;
  readonly left: TypedScalarExpression;
  readonly right: TypedScalarExpression;
  readonly type: ScalarExpressionType | null;
}

/** `span` includes both parenthesis characters (mirrors the source node). */
export interface TypedScalarGroupExpressionNode {
  readonly kind: "group";
  readonly span: ScalarSpan;
  readonly expression: TypedScalarExpression;
  readonly type: ScalarExpressionType | null;
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
  readonly type: ScalarExpressionType | null;
}

export interface TypedScalarValueIfExpressionNode {
  readonly kind: "valueIf";
  readonly span: ScalarSpan;
  readonly condition: TypedScalarExpression;
  readonly thenBranch: TypedScalarExpression;
  readonly elseBranch: TypedScalarExpression;
  readonly type: ScalarExpressionType | null;
}

export interface TypedScalarValueMatchArmNode {
  readonly label: string;
  readonly labelSpan: ScalarSpan;
  readonly binder?: string;
  readonly binderSpan?: ScalarSpan;
  /** Stable local identity used by the evaluator; it is not an ordinary source binding. */
  readonly binderId?: BindingId;
  readonly binderType?: ScalarType;
  readonly expression: TypedScalarExpression;
}

export interface TypedScalarValueMatchExpressionNode {
  readonly kind: "valueMatch";
  readonly span: ScalarSpan;
  readonly scrutinee: TypedScalarExpression;
  readonly arms: readonly TypedScalarValueMatchArmNode[];
  readonly type: ScalarExpressionType | null;
}

export type TypedScalarExpression =
  | TypedScalarNumberLiteralNode
  | TypedScalarStringLiteralNode
  | TypedScalarBooleanLiteralNode
  | TypedScalarNoneLiteralNode
  | TypedScalarChoiceLiteralNode
  | TypedScalarReferenceNode
  | TypedScalarCollectionIndexNode
  | TypedScalarGeometryPropertyReferenceNode
  | TypedScalarOptionalMemberExpressionNode
  | TypedScalarUnaryExpressionNode
  | TypedScalarBinaryExpressionNode
  | TypedScalarGroupExpressionNode
  | TypedScalarCallExpressionNode
  | TypedScalarValueIfExpressionNode
  | TypedScalarValueMatchExpressionNode;

export type ScalarExpressionTypecheckIssueCode =
  | "scalar-type-mismatch"
  | "none-requires-optional-type"
  | "coalesce-left-not-optional"
  | "coalesce-rhs-type-mismatch"
  | "non-choice-match-scrutinee"
  | "impossible-match-case"
  | "duplicate-match-case"
  | "missing-match-case"
  | "optional-match-non-optional-scrutinee"
  | "optional-match-missing-none"
  | "optional-match-missing-some"
  | "optional-match-duplicate-none"
  | "optional-match-duplicate-some"
  | "optional-match-impossible-case"
  | "optional-match-missing-binder"
  | "optional-match-unexpected-binder"
  | "optional-match-non-optional-scrutinee"
  | "optional-match-missing-none"
  | "optional-match-missing-some"
  | "optional-match-duplicate-none"
  | "optional-match-duplicate-some"
  | "optional-match-impossible-case"
  | "optional-match-missing-binder"
  | "optional-match-unexpected-binder"
  | "invalid-choice-literal"
  | "unknown-function"
  | "function-arity-mismatch"
  | "function-call-style-mismatch"
  | "unknown-function-argument"
  | "duplicate-function-argument"
  | "missing-function-argument"
  | "optional-member-non-optional-receiver";

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
  readonly expectedType: ScalarExpressionType | null;
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  /** Narrow sidecar for geometryProperty nodes used as point builtin
   * operands. It is keyed by the parser-owned node span and never enters the
   * scalar reference occurrence sequence. */
  readonly geometryBuiltinArguments?: ReadonlyMap<number, ScalarExpressionResolvedGeometryTarget | null>;
  /** Closed-frontend-resolved geometry-property metadata, keyed by the
   * parser-owned node span. A null entry is an explicit failed resolution and
   * must remain type-null rather than falling back to number. */
  readonly geometryPropertyReferences?: ReadonlyMap<number, ScalarExpressionResolvedGeometryProperty | null>;
  /** Closed frontend metadata for `receiver?.member`. */
  readonly optionalMemberReferences?: ReadonlyMap<number, ScalarExpressionResolvedOptionalMember | null>;
  /** Optional closed-frontend hook for bare choice tokens that are actually
   * local semantic values (for example a legacy Module iteration value). */
  readonly resolveChoiceLiteral?: (
    raw: string,
    expectedType: ScalarExpressionType | null,
    span: ScalarSpan
  ) => ScalarType | null | undefined;
}

export type ScalarExpressionResolvedOptionalMember = {
  readonly receiverType: import("../dsl/dslValueTypes").DslValueType | null;
  /** The ordinary member result before optional propagation. */
  readonly memberType: ScalarExpressionType | null;
  readonly target: ScalarExpressionResolvedOptionalMemberTarget | null;
};

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
  readonly type: ScalarExpressionType | null;
}
