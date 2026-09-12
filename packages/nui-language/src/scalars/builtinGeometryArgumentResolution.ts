import type { ScalarExpressionAst, ScalarSpan } from "./expressionAst";
import type { DslDiagnosticPresentation } from "../dsl/dslTypes";
import type { BindingResolution } from "./bindingResolution";
import { getBuiltinFunctionDefinition } from "./builtinFunctions";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "../dsl/moduleGeometryInterfaces";
import { isDerivedPointKeyForGeometryCategory } from "../model/pointAnchors";
import { isGeometryDeclarationCategory } from "../dsl/dslConstructions";
import type { SourceLexicalDeclaration } from "../dsl/sourceLexicalNamespaceIndex";
import type { SourceLexicalLookup } from "../dsl/sourceLexicalNamespaceIndex";
import type {
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedReference
} from "./typedExpressionAst";

export type BuiltinGeometryArgumentResolutionIssueCode =
  | "builtin-geometry-argument-invalid"
  | "builtin-geometry-type-mismatch";

export type BuiltinGeometryArgumentResolutionIssue = {
  readonly code: BuiltinGeometryArgumentResolutionIssueCode;
  readonly span: ScalarSpan;
  readonly message: string;
  readonly presentation?: DslDiagnosticPresentation;
  readonly occurrenceIndex: number | null;
  readonly expectedGeometryType?: ModuleGeometryInterfaceType;
  readonly actualGeometryType?: ModuleGeometryInterfaceType;
};

export type ResolveBuiltinGeometryArgumentsInput = {
  readonly ast: ScalarExpressionAst;
  readonly statementIndex: number;
  readonly scalarReferenceResolutions: readonly BindingResolution[];
  /** Collection-index base references are ordinary resolutions only when
   * collection resolution failed. They are consumed for cursor alignment,
   * but are not geometry arguments themselves. */
  readonly collectionIndexBaseReferenceOccurrenceIndexes?: ReadonlySet<number>;
  readonly sourceDeclarationsByStatementId: ReadonlyMap<string, SourceLexicalDeclaration>;
  /** Root source lexical lookup for a geometry property base name. This is
   * deliberately separate from scalar reference occurrences: a
   * geometryProperty never becomes a fake scalar reference. */
  readonly resolveSourceGeometryPath?: (elementName: string) => SourceLexicalLookup;
  /** Module semantic analysis may claim an already-resolved qualified geometry
   * occurrence before the ordinary source namespace lookup runs. */
  readonly additionalGeometryResolver?: (input: {
      readonly node: Extract<ScalarExpressionAst, { kind: "reference" | "collectionIndex" | "geometryProperty" }>;
    readonly occurrenceIndex: number | null;
    readonly expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">;
  }) => ScalarExpressionResolvedGeometryTarget | undefined;
};

export type ResolveBuiltinGeometryArgumentsResult = {
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  readonly claimedReferenceOccurrenceIndexes: ReadonlySet<number>;
  readonly geometryPropertyTargets: ReadonlyMap<number, ScalarExpressionResolvedGeometryTarget | null>;
  readonly issues: readonly BuiltinGeometryArgumentResolutionIssue[];
};

const invalidDirectArgumentMessage = (name: string, expected: ModuleGeometryInterfaceType): string =>
  `組み込み関数「${name}」のgeometry引数は、${expected}の直接参照である必要があります。`;

const invalidReferencePresentation = (name: string): DslDiagnosticPresentation => ({
  key: "diagnostic.builtin-geometry-argument-invalid-reference",
  parameters: { reference: `@${name}` }
});

const invalidDirectArgumentPresentation = (name: string, expected: ModuleGeometryInterfaceType): DslDiagnosticPresentation => ({
  key: "diagnostic.builtin-geometry-argument-invalid-direct",
  parameters: { function: name, expected }
});

const invalidGeometryPropertyPresentation = (name: string, property: string, expected: ModuleGeometryInterfaceType): DslDiagnosticPresentation => ({
  key: "diagnostic.builtin-geometry-argument-invalid-property",
  parameters: { reference: `@${name}.${property}`, expected }
});

const invalidReferenceMessage = (name: string, resolution: BindingResolution): string => {
  if (resolution.kind === "undefined") return `geometry引数の参照「@${name}」は未定義です。`;
  if (resolution.kind === "forward") return `geometry引数の参照「@${name}」はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution.kind === "self") return `geometry引数の参照「@${name}」は自身の宣言を参照しています。`;
  if (resolution.kind === "duplicate") return `geometry引数の参照「@${name}」は複数の宣言と一致するため一意に解決できません。`;
  if (resolution.kind === "resolved") return `geometry引数の参照「@${name}」はgeometryではありません。`;
  if (resolution.reason === "forward") return `geometry引数の参照「@${name}」はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution.reason === "ambiguous") return `geometry引数の参照「@${name}」は複数の宣言と一致するため一意に解決できません。`;
  if (resolution.reason === "invalidTraversal") return `geometry引数の参照「@${name}」のqualified pathを解決できません。`;
  if (resolution.reason === "private") return `geometry引数の参照「@${name}」はprivateなmodule memberです。`;
  return `geometry引数の参照「@${name}」はgeometryではありません。`;
};

const typeMismatchMessage = (
  expected: ModuleGeometryInterfaceType,
  actual: ModuleGeometryInterfaceType
): string => `geometry引数の型が一致しません(期待: ${expected}, 実際: ${actual})。`;

const invalidGeometryPropertyMessage = (name: string, property: string, expected: ModuleGeometryInterfaceType): string =>
  `組み込み関数のgeometry引数「@${name}.${property}」は、${expected}として利用できるderived pointではありません。`;

const sourceLookupMessage = (name: string, lookup: SourceLexicalLookup): string => {
  if (lookup.kind === "forward") return `geometry引数の参照「@${name}」はこの位置より後で宣言されているため、まだ参照できません。`;
  if (lookup.kind === "ambiguous") return `geometry引数の参照「@${name}」は複数の宣言と一致するため一意に解決できません。`;
  if (lookup.kind === "invalidTraversal") return `geometry引数の参照「@${name}」のqualified pathを解決できません。`;
  return `geometry引数の参照「@${name}」は未定義です。`;
};

export const resolveBuiltinGeometryArguments = ({
  ast,
  statementIndex,
  scalarReferenceResolutions,
  collectionIndexBaseReferenceOccurrenceIndexes,
  sourceDeclarationsByStatementId,
  additionalGeometryResolver,
  resolveSourceGeometryPath
}: ResolveBuiltinGeometryArgumentsInput): ResolveBuiltinGeometryArgumentsResult => {
  const references: (BindingResolution | ScalarExpressionResolvedReference)[] = [...scalarReferenceResolutions];
  const claimedReferenceOccurrenceIndexes = new Set<number>();
  const geometryPropertyTargets = new Map<number, ScalarExpressionResolvedGeometryTarget | null>();
  const issues: BuiltinGeometryArgumentResolutionIssue[] = [];
  let referenceCursor = 0;

  const nextReference = (name: string, span: ScalarSpan): { occurrenceIndex: number; resolution: BindingResolution } => {
    if (referenceCursor >= scalarReferenceResolutions.length) {
      throw new Error(`builtinGeometryArgumentResolution: no BindingResolution supplied for reference "@${name}" at offset ${span.start}`);
    }
    const occurrenceIndex = referenceCursor;
    referenceCursor += 1;
    return { occurrenceIndex, resolution: scalarReferenceResolutions[occurrenceIndex] };
  };

  const resolveDirectGeometryReference = (
    node: Extract<ScalarExpressionAst, { kind: "reference" }>,
    expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">
  ): void => {
    const { occurrenceIndex, resolution } = nextReference(node.name, node.span);
    claimedReferenceOccurrenceIndexes.add(occurrenceIndex);

    let target: ScalarExpressionResolvedGeometryTarget | null = null;
    const additionalTarget = additionalGeometryResolver?.({
      node,
      occurrenceIndex,
      expectedGeometryType
    });
    if (additionalTarget !== undefined) {
      target = additionalTarget;
    } else if (
      resolution.kind === "namespace" &&
      resolution.reason === "incompatible" &&
      resolution.declarationKind === "geometry" &&
      resolution.statementId !== undefined
    ) {
      const declaration = sourceDeclarationsByStatementId.get(resolution.statementId);
      const geometryType = moduleGeometryInterfaceTypeOfElement(declaration?.statement);
      if (declaration?.kind === "geometry" && geometryType !== null && declaration.statementIndex < statementIndex) {
        target = {
          statementId: declaration.statementId,
          statementIndex: declaration.statementIndex,
          geometryType
        };
      }
    }

    references[occurrenceIndex] = { kind: "resolvedGeometry", target };
    if (target === null) {
      issues.push({
        code: "builtin-geometry-argument-invalid",
        span: node.span,
        message: invalidReferenceMessage(node.name, resolution),
        occurrenceIndex,
        presentation: invalidReferencePresentation(node.name)
      });
      return;
    }
    if (!isModuleGeometryInterfaceAssignable(target.geometryType, expectedGeometryType)) {
      issues.push({
        code: "builtin-geometry-type-mismatch",
        span: node.span,
        message: typeMismatchMessage(expectedGeometryType, target.geometryType),
        occurrenceIndex,
        expectedGeometryType,
        actualGeometryType: target.geometryType,
        presentation: {
          key: "diagnostic.builtin-geometry-type-mismatch",
          parameters: { expected: expectedGeometryType, actual: target.geometryType }
        }
      });
    }
  };

  const resolveDirectGeometryCollectionIndex = (
    node: Extract<ScalarExpressionAst, { kind: "collectionIndex" }>,
    expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">
  ): void => {
    const { occurrenceIndex, resolution } = nextReference(node.name, node.span);
    claimedReferenceOccurrenceIndexes.add(occurrenceIndex);
    const target = additionalGeometryResolver?.({
      node,
      occurrenceIndex,
      expectedGeometryType
    }) ?? null;
    references[occurrenceIndex] = { kind: "resolvedGeometry", target };
    if (target === null) {
      issues.push({
        code: "builtin-geometry-argument-invalid",
        span: node.span,
        message: invalidReferenceMessage(node.name, resolution),
        occurrenceIndex,
        presentation: invalidReferencePresentation(node.name)
      });
      return;
    }
    if (!isModuleGeometryInterfaceAssignable(target.geometryType, expectedGeometryType)) {
      issues.push({
        code: "builtin-geometry-type-mismatch",
        span: node.span,
        message: typeMismatchMessage(expectedGeometryType, target.geometryType),
        occurrenceIndex,
        expectedGeometryType,
        actualGeometryType: target.geometryType,
        presentation: {
          key: "diagnostic.builtin-geometry-type-mismatch",
          parameters: { expected: expectedGeometryType, actual: target.geometryType }
        }
      });
    }
  };

  const resolveGeometryPropertyArgument = (
    node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>,
    expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">
  ): void => {
    const issue = (message: string, presentation: DslDiagnosticPresentation): void => {
      geometryPropertyTargets.set(node.span.start, null);
      issues.push({
        code: "builtin-geometry-argument-invalid",
        span: node.span,
        message,
        occurrenceIndex: null,
        presentation
      });
    };
    const additionalTarget = additionalGeometryResolver?.({ node, occurrenceIndex: null, expectedGeometryType });
    if (additionalTarget !== undefined) {
      // The shared parser represents both a derived geometry property
      // (`@line.start`) and a direct member reference (`@record.edge`) as a
      // geometryProperty node. A closed semantic owner may claim the latter
      // without a pointKey; preserve the existing pointKey requirement for
      // ordinary geometry-derived point accessors below.
      if (
        isModuleGeometryInterfaceAssignable(additionalTarget.geometryType, expectedGeometryType) &&
        (additionalTarget.pointKey || additionalTarget.geometryType === expectedGeometryType)
      ) {
        geometryPropertyTargets.set(node.span.start, additionalTarget);
        return;
      }
      issue(
        invalidGeometryPropertyMessage(node.elementName, node.property, "point"),
        invalidGeometryPropertyPresentation(node.elementName, node.property, "point")
      );
      return;
    }
    if (expectedGeometryType !== "point") {
      issue(
        invalidGeometryPropertyMessage(node.elementName, node.property, expectedGeometryType),
        invalidGeometryPropertyPresentation(node.elementName, node.property, expectedGeometryType)
      );
      return;
    }
    const lookup = resolveSourceGeometryPath?.(node.elementName);
    if (!lookup || lookup.kind !== "resolved") {
      issue(
        lookup ? sourceLookupMessage(node.elementName, lookup) : invalidGeometryPropertyMessage(node.elementName, node.property, "point"),
        lookup
          ? invalidReferencePresentation(node.elementName)
          : invalidGeometryPropertyPresentation(node.elementName, node.property, "point")
      );
      return;
    }
    const declaration = lookup.declaration;
    const category = declaration.kind === "geometry" && declaration.statement.kind === "element" && isGeometryDeclarationCategory(declaration.statement.category)
      ? declaration.statement.category
      : null;
    if (!category || !isDerivedPointKeyForGeometryCategory(category, node.property)) {
      issue(
        invalidGeometryPropertyMessage(node.elementName, node.property, "point"),
        invalidGeometryPropertyPresentation(node.elementName, node.property, "point")
      );
      return;
    }
    if (moduleGeometryInterfaceTypeOfElement(declaration.statement) === null) {
      issue(
        invalidGeometryPropertyMessage(node.elementName, node.property, "point"),
        invalidGeometryPropertyPresentation(node.elementName, node.property, "point")
      );
      return;
    }
    geometryPropertyTargets.set(node.span.start, {
      statementId: declaration.statementId,
      statementIndex: declaration.statementIndex,
      geometryType: "point",
      pointKey: node.property
    });
  };

  const visit = (node: ScalarExpressionAst, boundNames: ReadonlySet<string> = new Set()): void => {
    switch (node.kind) {
      case "reference":
        if (!boundNames.has(node.name)) nextReference(node.name, node.span);
        return;
      case "collectionIndex":
        if (!boundNames.has(node.name) && collectionIndexBaseReferenceOccurrenceIndexes?.has(referenceCursor)) {
          nextReference(node.name, node.span);
        }
        visit(node.index, boundNames);
        return;
      case "geometryProperty":
      case "numberLiteral":
      case "stringLiteral":
      case "booleanLiteral":
      case "unresolvedChoiceLiteral":
        return;
      case "unary":
        visit(node.operand, boundNames);
        return;
      case "binary":
        visit(node.left, boundNames);
        visit(node.right, boundNames);
        return;
      case "group":
        visit(node.expression, boundNames);
        return;
      case "valueIf":
        visit(node.condition, boundNames);
        visit(node.thenBranch, boundNames);
        if (node.elseBranch) visit(node.elseBranch, boundNames);
        return;
      case "valueMatch":
        visit(node.scrutinee, boundNames);
        node.arms.forEach((arm) => visit(arm.expression, arm.binder ? new Set([...boundNames, arm.binder]) : boundNames));
        return;
      case "call": {
        const definition = getBuiltinFunctionDefinition(node.name);
        const signature = definition?.signatures.find((candidate) =>
          candidate.callingStyle === "positional" &&
          candidate.parameters.length === node.args.length &&
          node.args.every((argument) => argument.kind === "positional")
        );
        if (signature === undefined) {
          const recoverySignature = definition?.signatures.find((candidate) => candidate.callingStyle === "positional");
          node.args.forEach((argument, index) => {
            const nodeArgument = argument.expression;
            const parameterType = recoverySignature?.parameters[index]?.type;
            if (
              argument.kind === "positional" &&
              (parameterType === "point" || parameterType === "line")
            ) {
              if (nodeArgument.kind === "reference") {
                resolveDirectGeometryReference(nodeArgument, parameterType);
              } else if (nodeArgument.kind === "collectionIndex") {
                resolveDirectGeometryCollectionIndex(nodeArgument, parameterType);
                visit(nodeArgument.index, boundNames);
              } else if (nodeArgument.kind === "geometryProperty") {
                resolveGeometryPropertyArgument(nodeArgument, parameterType);
              } else {
                visit(nodeArgument, boundNames);
                issues.push({
                  code: "builtin-geometry-argument-invalid",
                  span: nodeArgument.span,
                  message: invalidDirectArgumentMessage(node.name, parameterType),
                  occurrenceIndex: null,
                  presentation: invalidDirectArgumentPresentation(node.name, parameterType)
                });
              }
              return;
            }
            visit(nodeArgument, boundNames);
          });
          return;
        }
        node.args.forEach((argument, index) => {
          const nodeArgument = argument.expression;
          const parameterType = signature.parameters[index]?.type;
          if (parameterType === "point" || parameterType === "line") {
            if (nodeArgument.kind === "reference") {
              resolveDirectGeometryReference(nodeArgument, parameterType);
            } else if (nodeArgument.kind === "collectionIndex") {
              resolveDirectGeometryCollectionIndex(nodeArgument, parameterType);
              visit(nodeArgument.index, boundNames);
            } else if (nodeArgument.kind === "geometryProperty") {
              resolveGeometryPropertyArgument(nodeArgument, parameterType);
            } else {
              visit(nodeArgument, boundNames);
              issues.push({
                code: "builtin-geometry-argument-invalid",
                span: nodeArgument.span,
                message: invalidDirectArgumentMessage(node.name, parameterType),
                occurrenceIndex: null,
                presentation: invalidDirectArgumentPresentation(node.name, parameterType)
              });
            }
            return;
          }
          visit(nodeArgument, boundNames);
        });
        return;
      }
    }
  };

  visit(ast);
  if (referenceCursor !== scalarReferenceResolutions.length) {
    throw new Error(
      `builtinGeometryArgumentResolution: ${scalarReferenceResolutions.length - referenceCursor} unconsumed reference resolution(s)`
    );
  }
  return { references, claimedReferenceOccurrenceIndexes, geometryPropertyTargets, issues };
};
