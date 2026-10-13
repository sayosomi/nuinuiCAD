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
import type { TransformationStageSelection } from "../dsl/transformationRecipes";

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
  /** Whole optional collection match scrutinees are resolved through the
   * collection semantic path and therefore do not consume scalar-reference
   * resolutions. Keep this traversal aligned with that ordinary stream. */
  readonly optionalCollectionMatchReferenceStarts?: ReadonlySet<number>;
  /** Collection-index base references are ordinary resolutions only when
   * collection resolution failed. They are consumed for cursor alignment,
   * but are not geometry arguments themselves. */
  readonly collectionIndexBaseReferenceOccurrenceIndexes?: ReadonlySet<number>;
  readonly sourceDeclarationsByStatementId: ReadonlyMap<string, SourceLexicalDeclaration>;
  /** Root source lexical lookup for a geometry property base name. This is
   * deliberately separate from scalar reference occurrences: a
   * geometryProperty never becomes a fake scalar reference. */
  readonly resolveSourceGeometryPath?: (elementName: string) => SourceLexicalLookup;
  readonly resolveGeometryStageSelection?: (input: {
    readonly statementId: string;
    readonly members: readonly string[];
  }) => TransformationStageSelection;
  /** Module semantic analysis may claim an already-resolved qualified geometry
   * occurrence before the ordinary source namespace lookup runs. */
  readonly additionalGeometryResolver?: (input: {
      readonly node: Extract<ScalarExpressionAst, { kind: "reference" | "collectionIndex" | "geometryProperty" }>;
    readonly occurrenceIndex: number | null;
      readonly expectedGeometryType: ModuleGeometryInterfaceType;
  }) => ScalarExpressionResolvedGeometryTarget | undefined;
};

export type ResolveBuiltinGeometryArgumentsResult = {
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  readonly claimedReferenceOccurrenceIndexes: ReadonlySet<number>;
  readonly geometryPropertyTargets: ReadonlyMap<number, ScalarExpressionResolvedGeometryTarget | null>;
  readonly geometryEndpointTargets: ReadonlyMap<number, {
    readonly endpointKey: "start" | "end";
    readonly target: ScalarExpressionResolvedGeometryTarget | null;
  }>;
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
  scalarReferenceResolutions,
  collectionIndexBaseReferenceOccurrenceIndexes,
  optionalCollectionMatchReferenceStarts,
  sourceDeclarationsByStatementId,
  additionalGeometryResolver,
  resolveSourceGeometryPath,
  resolveGeometryStageSelection
}: ResolveBuiltinGeometryArgumentsInput): ResolveBuiltinGeometryArgumentsResult => {
  const references: (BindingResolution | ScalarExpressionResolvedReference)[] = [...scalarReferenceResolutions];
  const claimedReferenceOccurrenceIndexes = new Set<number>();
  const geometryPropertyTargets = new Map<number, ScalarExpressionResolvedGeometryTarget | null>();
  const geometryEndpointTargets = new Map<number, { endpointKey: "start" | "end"; target: ScalarExpressionResolvedGeometryTarget | null }>();
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
    expectedGeometryType: ModuleGeometryInterfaceType
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
      if (declaration?.kind === "geometry" && geometryType !== null) {
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
    expectedGeometryType: ModuleGeometryInterfaceType
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
    expectedGeometryType: ModuleGeometryInterfaceType
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
    const stageSelection = resolveGeometryStageSelection?.({
      statementId: declaration.statementId,
      members: node.property.split(".")
    }) ?? { stagePath: ["final"], propertyPath: node.property.split(".") };
    const property = stageSelection.propertyPath.join(".");
    if (!property) {
      const geometryType = moduleGeometryInterfaceTypeOfElement(declaration.statement);
      if (!geometryType || !isModuleGeometryInterfaceAssignable(geometryType, expectedGeometryType)) {
        issue(
          invalidGeometryPropertyMessage(node.elementName, node.property, expectedGeometryType),
          invalidGeometryPropertyPresentation(node.elementName, node.property, expectedGeometryType)
        );
        return;
      }
      geometryPropertyTargets.set(node.span.start, {
        statementId: declaration.statementId,
        statementIndex: declaration.statementIndex,
        geometryType,
        stagePath: stageSelection.stagePath
      });
      return;
    }
    if (!category || !isDerivedPointKeyForGeometryCategory(category, property)) {
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
      pointKey: property,
      stagePath: stageSelection.stagePath
    });
  };

  const resolveGeometryEndpointArgument = (
    node: ScalarExpressionAst,
    builtinName: string
  ): void => {
    const invalidEndpoint = (span: ScalarSpan, reference: string): void => {
      geometryEndpointTargets.set(node.span.start, { endpointKey: "start", target: null });
      issues.push({
        code: "builtin-geometry-argument-invalid",
        span,
        message: `組み込み関数「${builtinName}」の引数は、geometryの .start または .end endpointである必要があります。`,
        occurrenceIndex: null,
        presentation: {
          key: "diagnostic.builtin-geometry-argument-invalid-endpoint",
          parameters: { function: builtinName, reference }
        }
      });
    };
    if (node.kind !== "reference" && node.kind !== "collectionIndex" && node.kind !== "geometryProperty") {
      visit(node);
      invalidEndpoint(node.span, "argument");
      return;
    }
    if (node.kind !== "geometryProperty") {
      visit(node);
      invalidEndpoint(node.span, node.kind === "reference" ? `@${node.name}` : `@${node.name}[…]`);
      return;
    }

    const members = node.property.split(".");
    const endpointKey = members.at(-1);
    const isEndpoint = endpointKey === "start" || endpointKey === "end";
    if (!isEndpoint) {
      if (node.occurrenceIndex) visit(node.occurrenceIndex);
      invalidEndpoint(node.span, `@${node.elementName}.${node.property}`);
      return;
    }

    const stageMembers = members.slice(0, -1);
    let target: ScalarExpressionResolvedGeometryTarget | null = null;
    const additionalTarget = additionalGeometryResolver?.({ node, occurrenceIndex: null, expectedGeometryType: "path" });
    if (additionalTarget !== undefined) {
      if (isModuleGeometryInterfaceAssignable(additionalTarget.geometryType, "path") && !additionalTarget.pointKey) {
        target = additionalTarget;
      }
    } else {
      const lookup = resolveSourceGeometryPath?.(node.elementName);
      if (lookup?.kind === "resolved") {
        const declaration = lookup.declaration;
        const geometryType = declaration.kind === "geometry"
          ? moduleGeometryInterfaceTypeOfElement(declaration.statement)
          : null;
        if (geometryType && isModuleGeometryInterfaceAssignable(geometryType, "path")) {
          const selectedStage = resolveGeometryStageSelection?.({
            statementId: declaration.statementId,
            members: stageMembers
          }) ?? { stagePath: ["final"], propertyPath: stageMembers };
          if (selectedStage.propertyPath.length === 0) {
            target = {
              statementId: declaration.statementId,
              statementIndex: declaration.statementIndex,
              geometryType,
              stagePath: selectedStage.stagePath
            };
          }
        }
      }
    }
    if (target === null) {
      geometryEndpointTargets.set(node.span.start, { endpointKey, target: null });
      const lookup = resolveSourceGeometryPath?.(node.elementName);
      issues.push({
        code: "builtin-geometry-argument-invalid",
        span: node.span,
        message: lookup && lookup.kind !== "resolved"
          ? sourceLookupMessage(node.elementName, lookup)
          : `geometry endpoint「@${node.elementName}.${node.property}」を一意に解決できません。`,
        occurrenceIndex: null,
        presentation: lookup && lookup.kind !== "resolved"
          ? invalidReferencePresentation(node.elementName)
          : { key: "diagnostic.builtin-geometry-argument-invalid-endpoint", parameters: { function: builtinName, reference: `@${node.elementName}.${node.property}` } }
      });
      return;
    }
    // Endpoint selectors can follow an explicit transformation checkpoint.
    // Module resolvers already attach that checkpoint to the target identity.
    if (node.occurrenceIndex) {
      visit(node.occurrenceIndex);
    }
    geometryEndpointTargets.set(node.span.start, { endpointKey, target: { ...target, geometryType: "path" } });
  };

  const visit = (node: ScalarExpressionAst, boundNames: ReadonlySet<string> = new Set()): void => {
    switch (node.kind) {
      case "reference":
        if (!boundNames.has(node.name) && !optionalCollectionMatchReferenceStarts?.has(node.span.start)) {
          nextReference(node.name, node.span);
        }
        return;
      case "collectionIndex":
        if (!boundNames.has(node.name) && collectionIndexBaseReferenceOccurrenceIndexes?.has(referenceCursor)) {
          nextReference(node.name, node.span);
        }
        visit(node.index, boundNames);
        return;
      case "geometryProperty":
        return;
      case "recordFieldCollectionIndex":
        if (node.receiver.occurrenceIndex) visit(node.receiver.occurrenceIndex, boundNames);
        visit(node.index, boundNames);
        return;
      case "numberLiteral":
      case "stringLiteral":
      case "booleanLiteral":
      case "unresolvedChoiceLiteral":
        return;
      case "optionalMember":
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
              (parameterType === "point" || parameterType === "line" || (parameterType !== undefined && typeof parameterType !== "string" && parameterType.kind === "geometryEndpoint"))
            ) {
              if (parameterType !== undefined && typeof parameterType !== "string" && parameterType.kind === "geometryEndpoint") {
                resolveGeometryEndpointArgument(nodeArgument, node.name);
                return;
              }
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
          if (parameterType && typeof parameterType !== "string" && parameterType.kind === "geometryEndpoint") {
            resolveGeometryEndpointArgument(nodeArgument, node.name);
            return;
          }
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
  return { references, claimedReferenceOccurrenceIndexes, geometryPropertyTargets, geometryEndpointTargets, issues };
};
