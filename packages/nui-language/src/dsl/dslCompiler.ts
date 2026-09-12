import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createCadElement } from "../model/elementFactory";
import { isLineLikeElement, isPointElement } from "../model/pointAnchors";
import type { ElementNameContext } from "../model/elementNames";
import { resolveElementNamePath } from "../model/elementNames";
import type {
  CadElement,
  CadElementType,
  DrawingModifierProperties,
  DrawingModifierDefinition,
  DrawingModifierProfileDelta,
  DrawingProfile,
  ElementId,
  Layout,
  LayoutOrigin,
  LayoutPlacement,
  PrintOutput,
  PrintPaperSizeId,
  SvgOutput,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { applyArgs, createDefaultIntermediateId, type DslGeometryResolverOverrides } from "./dslApplyArgs";
import { MISSING_ATTRIBUTE_VALUE_CODE, type ScannedArg } from "./dslArgScanner";
import { constructionFor, type DslConstructionSpec } from "./dslConstructions";
import { isCompilableDslStatement, isInUnloweredModuleSubtree, type DslStatementInclusion } from "./dslCompilationGuard";
import { isElementDslStatement, parseDsl } from "./dslParser";
import { createNameIndex, resolveId, type NameIndex } from "./dslReferences";
import { formatDslReferencePath, parseDslReferenceToken, parseDslSourceReference, type DslSourceReference } from "./dslReferenceTokens";
import { resolveSourceLexicalDeclaration, resolveSourceLexicalPath, resolveSourceLexicalPathSegments, type SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
import type {
  CompileDslContext,
  CompileDslResult,
  DslAttribute,
  DslDiagnostic,
  DslModifierProfileBlock,
  DslStatement
} from "./dslTypes";
import { unquoteDslString } from "./dslTokens";
import type { DslMajorVersion } from "./dslVersion";
import { materializeModuleExecution, type ModuleMaterialization } from "./moduleMaterialization";
import { buildModuleGeometryRuntime } from "./moduleGeometryRuntime";
import { moduleRuntimeGeometryKindOf } from "./moduleGeometryInterfaces";
import { compileMaterializedExecution } from "./moduleExecutionCompiler";
import type { TransformationOperation, TransformationRecipe, TransformationTargetSelector } from "./transformationRecipes";
import { transformationElementType } from "./transformationRecipes";
import { isKnownNumericComputedGeometryProperty } from "../geometry/numericGeometryProperties";
import { encodeIdentityTuple } from "../document/identityTuple";

const attr = (attrs: DslAttribute[], key: string) =>
  attrs.find((item) => item.key === key)?.value;

// name: 引数の生値は(P2/P3のscanCallArgsが)quoteを含んだ生スライスで返るため、
// 設定文(color/role/view/layout/print/svg)の name 属性はここで明示的に unquote する
// (要素側の text kind パラメータは dslApplyArgs.ts 側で既に unquote 済み)。
const unquoteName = (value: string | undefined) => value === undefined ? undefined : unquoteDslString(value);

export const statementTypeOf = (statement: DslStatement): CadElementType => {
  if (statement.kind === "element") return statement.type ?? "group";
  return statement.kind as CadElementType;
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

const warning = (line: number, message: string): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  message
});

const modifierPropertiesFrom = (
  statement: Extract<DslStatement, { kind: "modifierDefinition" }> | DslModifierProfileBlock
): DrawingModifierProperties => ({
  ...(statement.state ? { state: statement.state } : {}),
  ...(statement.widthPx !== null ? { widthPx: statement.widthPx } : {}),
  ...(statement.style ? { style: statement.style } : {}),
  ...(statement.color ? { color: statement.color } : {})
});

const isTopLevelModifierDefinition = (
  statement: DslStatement
): statement is Extract<DslStatement, { kind: "modifierDefinition" }> =>
  statement.kind === "modifierDefinition" && !statement.enclosing;

const modifierDefinitionsFromStatements = (
  statements: readonly DslStatement[],
  sourceNamespace: SourceLexicalNamespaceIndex | undefined,
  diagnostics: DslDiagnostic[]
): DrawingModifierDefinition[] => statements.flatMap((statement, statementIndex) => {
  if (!isTopLevelModifierDefinition(statement)) return [];
  const common = modifierPropertiesFrom(statement);
  const profileDeltas: DrawingModifierProfileDelta[] = [];
  const blockStatements = statements.filter(
    (candidate): candidate is Extract<DslStatement, { kind: "modifierProfileBlock" }> =>
      candidate.kind === "modifierProfileBlock" && candidate.enclosing?.statementIndex === statementIndex
  );
  const resolvedProfileIds = new Set<string>();
  for (const [blockIndex, block] of statement.profileBlocks.entries()) {
    const blockStatement = blockStatements[blockIndex];
    const sourceStatementIndex = blockStatement ? statements.indexOf(blockStatement) : statementIndex;
    const path = parseDslReferenceToken(block.profileName);
    const lookup = sourceNamespace
      ? resolveSourceLexicalPath(sourceNamespace, sourceStatementIndex, path)
      : block.profileName
        ? { kind: "resolved" as const, declaration: { statementId: block.profileName, name: block.profileName, kind: "profile" as const } }
        : { kind: "undefined" as const };
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "profile") {
      const message = lookup.kind === "forward"
        ? `Drawing Profile「${block.profileName}」はこの位置より後で宣言されています。`
        : lookup.kind === "ambiguous"
          ? `Drawing Profile 参照が曖昧です: ${block.profileName}`
          : lookup.kind === "resolved"
            ? `参照先「${block.profileName}」は Drawing Profile ではありません。`
            : `未定義の Drawing Profile です: ${block.profileName}`;
      diagnostics.push({
        severity: "error",
        line: blockStatement?.line ?? statement.line,
        column: 1,
        code: "invalid-drawing-profile-reference",
        message,
        presentation: {
          key: "diagnostic.invalid-drawing-profile-reference",
          parameters: { profile: block.profileName }
        },
        ...(block.profileNameSpan ? { logicalSpan: block.profileNameSpan, statementIndex: sourceStatementIndex } : {})
      });
      continue;
    }
    if (resolvedProfileIds.has(lookup.declaration.statementId)) {
      diagnostics.push({
        severity: "error",
        line: blockStatement?.line ?? statement.line,
        column: 1,
        code: "duplicate-drawing-profile-override",
        message: `modifier の Drawing Profile「${lookup.declaration.name}」は1つだけ指定できます。`,
        presentation: {
          key: "diagnostic.duplicate-drawing-profile-override",
          parameters: { profile: lookup.declaration.name }
        },
        ...(block.profileNameSpan ? { logicalSpan: block.profileNameSpan, statementIndex: sourceStatementIndex } : {})
      });
      continue;
    }
    resolvedProfileIds.add(lookup.declaration.statementId);
    profileDeltas.push({
      profileId: lookup.declaration.statementId,
      profileName: lookup.declaration.name,
      ...modifierPropertiesFrom(block)
    });
  }
  return [{
    name: statement.name,
    ...common,
    ...(profileDeltas.length ? { profileDeltas } : {})
  }];
});

const drawingProfilesFromStatements = (
  statements: readonly DslStatement[],
  sourceNamespace?: SourceLexicalNamespaceIndex
): DrawingProfile[] => statements.flatMap((statement) => {
  if (statement.kind !== "profileDeclaration" || statement.enclosing || !statement.name) return [];
  const declaration = sourceNamespace?.allDeclarations.find(
    (candidate) => candidate.statementIndex === statements.indexOf(statement) && candidate.kind === "profile"
  );
  return [{ id: declaration?.statementId ?? statement.name, name: statement.name }];
});

const booleanValue = (value: string) =>
  ["true", "1", "yes", "on"].includes(value.toLowerCase())
    ? true
    : ["false", "0", "no", "off"].includes(value.toLowerCase())
      ? false
      : null;

const coordinatePair = (value: string) => {
  const match = value.trim().match(/^\((.*),(.*)\)$/);
  return match ? { x: match[1].trim(), y: match[2].trim() } : null;
};

type NumericLiteral = { value: number; finite: boolean };

const numericLiteral = (source: string): NumericLiteral | null => {
  const value = source.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const number = Number(value);
  return { value: number, finite: Number.isFinite(number) };
};

const normalizedNumeric = (source: string, elements: readonly CadElement[], nameContext: ElementNameContext) =>
  makeNumericExpression(normalizeNumericExpressionInput(source, [...elements], undefined, nameContext));

const roleIdByToken = (roles: VisibilityRole[], token: string) => {
  const normalized = unquoteDslString(token);
  return roles.find((role) => role.id === normalized || role.name === normalized)?.id ?? normalized;
};

const visibilityProfileIdByToken = (profiles: VisibilityProfile[], token: string) => {
  const normalized = unquoteDslString(token);
  return profiles.find((profile) => profile.id === normalized || profile.name === normalized)?.id ?? normalized;
};

const sourceReferencePath = (token: string, line: number, diagnostics: DslDiagnostic[]) => {
  const parsed = parseDslSourceReference(token);
  if (parsed.kind !== "valid" || parsed.reference.property) {
    diagnostics.push(diagnostic(line, `参照が不正です: ${token}`));
    return null;
  }
  return parseDslReferenceToken(parsed.reference.pathText);
};

const sourceDeclarationFor = (
  token: string,
  statementIndex: number,
  expected: readonly string[],
  sourceNamespace: SourceLexicalNamespaceIndex | undefined,
  line: number,
  diagnostics: DslDiagnostic[]
) => {
  const path = sourceReferencePath(token, line, diagnostics);
  if (!path || !sourceNamespace) return null;
  const resolved = resolveSourceLexicalPathSegments(sourceNamespace, statementIndex, path);
  if (resolved.lookup.kind !== "resolved") {
    const message = resolved.lookup.kind === "forward"
      ? `参照先「${token}」はこの位置より後で宣言されています。`
      : resolved.lookup.kind === "ambiguous"
        ? `参照が曖昧です: ${token}`
        : resolved.lookup.kind === "invalidTraversal"
          ? `参照先「${token}」はこの種類の宣言を辿れません。`
          : `未定義の参照です: ${token}`;
    diagnostics.push(diagnostic(line, message));
    return null;
  }
  if (!expected.includes(resolved.lookup.declaration.kind)) {
    diagnostics.push(diagnostic(line, `参照先「${token}」は ${expected.join(" / ")} ではありません。`));
    return null;
  }
  return { ...resolved, declaration: resolved.segments.at(-1)! };
};

// P6 applyArgs は ScannedArg[] を要求するが DslStatement は DslAttribute[] を運ぶ。
// applyArgs は key/value しか参照しないため、span 側は再構成すれば足りる。
const scannedArgsFromAttrs = (attrs: DslAttribute[]): ScannedArg[] =>
  attrs.map((item) => ({
    key: item.key,
    keySpan: { start: item.keyStart, end: item.keyStart + item.key.length },
    value: item.value,
    valueSpan: { start: item.valueStart, end: item.valueEnd }
  }));

const constructionSpecFor = (statement: DslStatement): DslConstructionSpec | null => {
  if (statement.kind === "group") return constructionFor("group", "");
  if (statement.kind === "element" && statement.type) return constructionFor(statement.category, statement.construction);
  return null;
};

export const applyStatement = (
  element: CadElement,
  statement: DslStatement,
  index: NameIndex,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[],
  nameContext: ElementNameContext,
  visibilityRoles: VisibilityRole[] = [],
  majorVersion?: DslMajorVersion,
  geometryResolvers?: DslGeometryResolverOverrides,
  statementIndex?: number
): CadElement => {
  const named = {
    ...element,
    name: statement.name,
    ...(statement.modifierNames?.length ? { modifierNames: [...statement.modifierNames] } : { modifierNames: undefined })
  };
  const spec = constructionSpecFor(statement);
  if (!spec) return named;

  const result = applyArgs(named, spec, scannedArgsFromAttrs(statement.attrs), {
    index,
    line: statement.line,
    elementsForExpressions,
    nameContext,
    visibilityRoles,
    createIntermediateId: createDefaultIntermediateId,
    majorVersion,
    ...geometryResolvers
  });
  diagnostics.push(...result.diagnostics.map((item) =>
    item.logicalSpan && statementIndex !== undefined ? { ...item, statementIndex } : item
  ));

  let next = result.element;
  if (result.metadata.parent) {
    next = { ...next, parentGroupId: resolveId(result.metadata.parent, index, statement.line, diagnostics, next) };
  }
  if (result.metadata.branch) {
    next = { ...next, conditionalBranch: result.metadata.branch };
  }
  return next;
};

type TransformationStatement = Extract<DslStatement, { kind: "transformation" }>;

const transformationDiagnostic = (
  statement: TransformationStatement,
  message: string,
  code: string,
  logicalSpan?: { start: number; end: number },
  statementIndex?: number
): DslDiagnostic => ({
  severity: "error",
  line: statement.line,
  column: 1,
  code,
  message,
  presentation: { key: `diagnostic.${code}` },
  ...(logicalSpan && statementIndex !== undefined ? { logicalSpan, statementIndex } : {})
});

const transformationTargetPath = (target: TransformationTargetSelector) =>
  target.stagePath.length ? target.stagePath.join(".") : "<root>";

const targetOccurrenceKey = (target: TransformationTargetSelector) => target.occurrenceIndex ?? "*";

const hasForGroupAncestor = (element: CadElement, elementsById: ReadonlyMap<ElementId, CadElement>) => {
  const visited = new Set<ElementId>();
  let parentId = element.parentGroupId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = elementsById.get(parentId);
    if (!parent) return false;
    if (parent.type === "forGroup") return true;
    parentId = parent.parentGroupId;
  }
  return false;
};

const resolveTransformationOwner = ({
  target,
  statement,
  statementIndex,
  index,
  sourceNamespace,
  sourceElementIds,
  currentElement,
  diagnostics
}: {
  target: DslSourceReference;
  statement: TransformationStatement;
  statementIndex: number;
  index: NameIndex;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  sourceElementIds?: ReadonlyMap<number, ElementId>;
  currentElement?: Pick<CadElement, "parentGroupId">;
  diagnostics: DslDiagnostic[];
}): ElementId | null => {
  if (sourceNamespace && sourceElementIds) {
    const lookup = resolveSourceLexicalPath(sourceNamespace, statementIndex, target.path);
    if (lookup.kind === "resolved" && lookup.declaration.kind === "geometry") {
      const elementId = sourceElementIds.get(lookup.declaration.statementIndex);
      if (elementId) return elementId;
    }
    const message = lookup.kind === "forward"
      ? `transformation target「${target.source}」はこの位置より後で宣言されています。`
      : lookup.kind === "ambiguous"
        ? `transformation target「${target.source}」が曖昧です。`
        : lookup.kind === "resolved"
          ? `transformation target「${target.source}」は geometry ではありません。`
          : `transformation target「${target.source}」を解決できません。`;
    diagnostics.push(transformationDiagnostic(statement, message, "unresolved-transformation-target", target.pathRange, statementIndex));
    return null;
  }
  const resolved = resolveElementNamePath({
    path: { absolute: target.path.absolute, parts: target.path.segments },
    elements: index.elements,
    currentElement,
    context: index.nameContext
  });
  if (resolved.status === "resolved") return resolved.element.id;
  diagnostics.push(transformationDiagnostic(
    statement,
    resolved.status === "ambiguous"
      ? `transformation target「${target.source}」が曖昧です。`
      : `transformation target「${target.source}」を解決できません。`,
    "unresolved-transformation-target",
    target.pathRange,
    statementIndex
  ));
  return null;
};

const parseTransformationTargetSelector = (
  source: string,
  span: { start: number; end: number },
  statement: TransformationStatement,
  statementIndex: number,
  operation: TransformationStatement["construction"],
  index: NameIndex,
  sourceNamespace: SourceLexicalNamespaceIndex | undefined,
  sourceElementIds: ReadonlyMap<number, ElementId> | undefined,
  resolveModuleOwner: ((target: DslSourceReference, statementIndex: number) => ElementId | undefined) | undefined,
  stageDeclarations: ReadonlySet<string>,
  diagnostics: DslDiagnostic[]
): TransformationTargetSelector | null => {
  if (source.startsWith("@")) {
    diagnostics.push(transformationDiagnostic(statement, "transformation target に `@` は付けません。", "malformed-transformation-target", span, statementIndex));
    return null;
  }
  const parsed = parseDslSourceReference(`@${source}`);
  if (parsed.kind !== "valid") {
    diagnostics.push(transformationDiagnostic(statement, `transformation target が不正です: ${source}`, "malformed-transformation-target", span, statementIndex));
    return null;
  }
  const reference = parsed.reference;
  if (reference.property?.includes("[")) {
    diagnostics.push(transformationDiagnostic(statement, `generated occurrence は stage/property の後ではなく selector の直後に指定してください: ${source}`, "malformed-transformation-target", span, statementIndex));
    return null;
  }
  const propertySegments = reference.property ? reference.property.split(".") : [];
  const endpointKey = operation === "edge" || operation === "extend"
    ? propertySegments.at(-1) === "start" || propertySegments.at(-1) === "end"
      ? propertySegments.at(-1) as "start" | "end"
      : undefined
    : undefined;
  const stagePath = endpointKey ? propertySegments.slice(0, -1) : propertySegments;
  if (stagePath.some((part) => part === "final")) {
    diagnostics.push(transformationDiagnostic(statement, "`final` は transformation target に指定できません。", "invalid-final-transformation-target", span, statementIndex));
  }
  if (operation !== "edge" && operation !== "extend" && (propertySegments.includes("start") || propertySegments.includes("end"))) {
    diagnostics.push(transformationDiagnostic(statement, `${operation} は endpoint ではなく owner / stage を対象にします。`, "transformation-target-kind-incompatible", span, statementIndex));
  }
  if ((operation === "edge" || operation === "extend") && !endpointKey) {
    diagnostics.push(transformationDiagnostic(statement, `${operation} の target には `.concat("`.start` または `.end` が必要です。"), "transformation-target-kind-incompatible", span, statementIndex));
  }
  const ownerId = resolveModuleOwner?.(reference, statementIndex) ?? resolveTransformationOwner({
      target: reference,
      statement,
      statementIndex,
      index,
      sourceNamespace,
      sourceElementIds,
      currentElement: statement.enclosing && sourceElementIds
        ? { parentGroupId: sourceElementIds.get(statement.enclosing.statementIndex) }
        : undefined,
      diagnostics
    });
  if (!ownerId) return null;
  const owner = index.elementsById.get(ownerId);
  if (!owner || !isLineLikeElement(owner)) {
    diagnostics.push(transformationDiagnostic(statement, `transformation target「${source}」は線 / path geometry ではありません。`, "transformation-target-kind-incompatible", span, statementIndex));
  }
  const occurrenceIndex = reference.occurrenceIndex ?? undefined;
  if (occurrenceIndex !== undefined && owner && !hasForGroupAncestor(owner, index.elementsById)) {
    diagnostics.push(transformationDiagnostic(statement, `明示された generated occurrence「${source}」は利用できません。`, "generated-occurrence-unavailable", span, statementIndex));
  }
  const canonical = `@${formatDslReferencePath(reference.path)}${occurrenceIndex === undefined ? "" : `[${occurrenceIndex}]`}${reference.property ? `.${reference.property}` : ""}`;
  const stageKey = `${ownerId}\u0000${occurrenceIndex ?? "*"}\u0000${stagePath.join(".")}`;
  const stageDeclared = stageDeclarations.has(stageKey) ||
    (occurrenceIndex !== undefined && stageDeclarations.has(`${ownerId}\u0000*\u0000${stagePath.join(".")}`));
  if (stagePath.length > 0 && stagePath[0] !== "base" && !stageDeclared) {
    diagnostics.push(transformationDiagnostic(statement, `stage「${transformationTargetPath({ ownerId, source, canonical, stagePath })}」はこの位置では利用できません。`, "unresolved-transformation-stage", span, statementIndex));
  }
  return {
    source,
    canonical,
    ownerId,
    stagePath,
    ...(occurrenceIndex !== undefined ? { occurrenceIndex } : {}),
    ...(endpointKey ? { endpointKey } : {})
  };
};

const compileTransformationOperation = ({
  statement,
  statementIndex,
  targets,
  elements,
  index,
  diagnostics
}: {
  statement: TransformationStatement;
  statementIndex: number;
  targets: readonly TransformationTargetSelector[];
  elements: CadElement[];
  index: NameIndex;
  diagnostics: DslDiagnostic[];
}): TransformationOperation | null => {
  const mutationSpec = constructionFor("mutation", statement.construction);
  if (!mutationSpec) return null;
  const ignoredTargetArgs = new Set(["end1", "end2", "end", "targets", "target"]);
  const operationSpec: DslConstructionSpec = {
    ...mutationSpec,
    args: mutationSpec.args.filter((argSpec) => !ignoredTargetArgs.has(argSpec.arg))
  };
  const ownerId = targets[0]?.ownerId ?? `transformation:${statementIndex}`;
  const seed = { ...createCadElement(transformationElementType(statement.construction), elements), id: ownerId, name: "" };
  const result = applyArgs(
    seed,
    operationSpec,
    scannedArgsFromAttrs(statement.attrs.filter((item) => item.key !== "enabled")),
    {
      index,
      line: statement.line,
      elementsForExpressions: elements,
      nameContext: index.nameContext,
      createIntermediateId: createDefaultIntermediateId,
      majorVersion: undefined
    }
  );
  diagnostics.push(...result.diagnostics.map((item) => ({ ...item, statementIndex })));
  switch (statement.construction) {
    case "edge":
      return { kind: "edge", intersectionIndex: (result.element as Extract<CadElement, { type: "edge" }>).intersectionIndex };
    case "extend":
      return { kind: "extend", point: (result.element as Extract<CadElement, { type: "extendTrim" }>).point };
    case "move": {
      const element = result.element as Extract<CadElement, { type: "move" }>;
      return { kind: "move", startPoint: element.startPoint, endPoint: element.endPoint, scale: element.scale, angleDeg: element.angleDeg, mirrorX: element.mirrorX };
    }
    case "mirrorMove": {
      const element = result.element as Extract<CadElement, { type: "symmetricMove" }>;
      return { kind: "mirrorMove", axisPoint1: element.axisPoint1, axisPoint2: element.axisPoint2 };
    }
    case "reverse":
      return { kind: "reverse" };
  }
};

const compileTransformationRecipes = ({
  statements,
  elements,
  index,
  sourceNamespace,
  sourceElementIds,
  resolveModuleOwner,
  stableStatementIdByIndex,
  includeStatement,
  diagnostics
}: {
  statements: readonly DslStatement[];
  elements: CadElement[];
  index: NameIndex;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  sourceElementIds?: ReadonlyMap<number, ElementId>;
  resolveModuleOwner?: (target: DslSourceReference, statementIndex: number) => ElementId | undefined;
  stableStatementIdByIndex?: ReadonlyMap<number, string>;
  includeStatement: DslStatementInclusion;
  diagnostics: DslDiagnostic[];
}): TransformationRecipe[] => {
  const recipes: TransformationRecipe[] = [];
  const stageDeclarations = new Set<string>();
  const geometryPropertyNames = new Set<string>([
    ...["start", "end", "center", "intermediatePoints"],
    ...["length", "radius", "sweepAngleDeg", "startAngleDeg", "endAngleDeg", "startHandleLength", "endHandleLength", "x", "y"]
  ]);
  for (const [statementIndex, candidate] of statements.entries()) {
    if (!includeStatement(candidate, statementIndex) || candidate.kind !== "transformation") continue;
    const statement = candidate;
    const targets = statement.targets.flatMap((target) => {
      const parsed = parseTransformationTargetSelector(
        target.source,
        target.span,
        statement,
        statementIndex,
        statement.construction,
        index,
        sourceNamespace,
        sourceElementIds,
        resolveModuleOwner,
        stageDeclarations,
        diagnostics
      );
      return parsed ? [parsed] : [];
    });
    const expectedCount = statement.construction === "edge" ? 2 : 1;
    if ((statement.construction === "edge" && targets.length !== expectedCount) ||
        (statement.construction === "extend" && targets.length !== expectedCount) ||
        ((statement.construction === "reverse") && targets.length !== expectedCount) ||
        ((statement.construction === "move" || statement.construction === "mirrorMove") && targets.length < expectedCount)) {
      diagnostics.push(transformationDiagnostic(statement, `${statement.construction} の target 数が不正です。`, "transformation-target-kind-incompatible", undefined, statementIndex));
      continue;
    }
    if (statement.stageName && (statement.stageName === "base" || statement.stageName === "final")) {
      diagnostics.push(transformationDiagnostic(statement, `stage name「${statement.stageName}」は予約されています。`, "reserved-transformation-stage-name", statement.stageNameSpan ?? undefined, statementIndex));
    }
    if (statement.stageName && (geometryPropertyNames.has(statement.stageName) || isKnownNumericComputedGeometryProperty(statement.stageName))) {
      diagnostics.push(transformationDiagnostic(statement, `stage name「${statement.stageName}」は geometry property と衝突します。`, "transformation-stage-property-collision", statement.stageNameSpan ?? undefined, statementIndex));
    }
    if (!targets.length) continue;
    for (const target of targets) {
      if (!statement.stageName) continue;
      const siblingKey = `${target.ownerId}\u0000${targetOccurrenceKey(target)}\u0000${target.stagePath.join(".")}\u0000${statement.stageName}`;
      if (stageDeclarations.has(siblingKey)) {
        diagnostics.push(transformationDiagnostic(statement, `同じ recipe branch に stage「${statement.stageName}」が重複しています。`, "duplicate-transformation-stage", statement.stageNameSpan ?? undefined, statementIndex));
      }
      stageDeclarations.add(`${target.ownerId}\u0000${targetOccurrenceKey(target)}\u0000${[...target.stagePath, statement.stageName].join(".")}`);
      // Keep the sibling key in the same set as a private marker: the full
      // path above is what later target selectors resolve against.
      stageDeclarations.add(siblingKey);
    }
    const operation = compileTransformationOperation({ statement, statementIndex, targets, elements, index, diagnostics });
    if (!operation) continue;
    const enabledToken = attr(statement.attrs, "enabled");
    const enabled = enabledToken === undefined ? true : booleanValue(unquoteDslString(enabledToken));
    if (enabled === null) {
      diagnostics.push(transformationDiagnostic(statement, "enabled は true / false で指定してください。", "invalid-transformation-enabled", statement.payloadSpans.enabled, statementIndex));
    }
    recipes.push({
      id: stableStatementIdByIndex?.get(statementIndex) ?? `transformation:${statementIndex}`,
      sourceStatementIndex: statementIndex,
      ...(stableStatementIdByIndex?.get(statementIndex) ? { sourceStatementId: stableStatementIdByIndex.get(statementIndex) } : {}),
      construction: statement.construction,
      targets,
      recipeOwnerPath: targets[0]?.stagePath ?? [],
      stageName: statement.stageName,
      enabled: enabled ?? true,
      operation
    });
  }
  return recipes;
};

type ModuleTransformationCompilation = {
  sourceRecipes: TransformationRecipe[];
  runtimeRecipes: TransformationRecipe[];
};

const moduleDefinitionIndexFor = (
  statements: readonly DslStatement[],
  statementIndex: number
): number | null => {
  const visited = new Set<number>();
  let current = statements[statementIndex]?.enclosing?.statementIndex ?? null;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const candidate = statements[current];
    if (candidate?.kind === "moduleDefinition") return current;
    current = candidate?.enclosing?.statementIndex ?? null;
  }
  return null;
};

const moduleGeometryStatement = (statement: DslStatement) => {
  if (statement.kind === "group") return true;
  return statement.kind === "element" && statement.type !== null;
};

const sourceScopeForModuleDefinition = ({
  statements,
  definitionStatementIndex,
  bodyStatementIndexes,
  stableStatementIdByIndex
}: {
  statements: readonly DslStatement[];
  definitionStatementIndex: number;
  bodyStatementIndexes: readonly number[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
}) => {
  const sourceElementIds = new Map<number, ElementId>();
  for (const statementIndex of bodyStatementIndexes) {
    const statement = statements[statementIndex];
    if (!statement || moduleDefinitionIndexFor(statements, statementIndex) !== definitionStatementIndex) continue;
    if (!moduleGeometryStatement(statement)) continue;
    const identity = stableStatementIdByIndex.get(statementIndex) ?? `module-source:${statementIndex}`;
    sourceElementIds.set(statementIndex, identity);
  }
  const elements = [...sourceElementIds.entries()].flatMap(([statementIndex, id]) => {
    const statement = statements[statementIndex];
    if (!statement) return [];
    const type = statement.kind === "group" ? "group" : statement.kind === "element" ? statement.type : null;
    if (!type) return [];
    const parentStatementIndex = (() => {
      let enclosing = statement.enclosing?.statementIndex;
      while (enclosing !== undefined) {
        if (sourceElementIds.has(enclosing)) return enclosing;
        enclosing = statements[enclosing]?.enclosing?.statementIndex;
      }
      return undefined;
    })();
    return [{
      ...createCadElement(type, [], { createId: () => id }),
      name: statement.name ?? "",
      ...(parentStatementIndex !== undefined ? { parentGroupId: sourceElementIds.get(parentStatementIndex) } : {})
    } as CadElement];
  });
  return { sourceElementIds, elements };
};

const sameStatementPath = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const moduleQualifiedOwnerFor = ({
  target,
  statementIndex,
  sourceNamespace,
  moduleSemanticAnalysis,
  materialization,
  stableStatementIdByIndex,
  moduleRuntimeContext,
  runtime
}: {
  target: DslSourceReference;
  statementIndex: number;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  moduleSemanticAnalysis: NonNullable<CompileDslContext["moduleSemanticAnalysis"]>;
  materialization: ModuleMaterialization;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleRuntimeContext?: CompileDslContext["moduleRuntimeContext"];
  runtime: boolean;
}): ElementId | undefined => {
  if (!sourceNamespace || target.path.segments.length !== 2) return undefined;
  const instanceLookup = resolveSourceLexicalDeclaration(
    sourceNamespace,
    statementIndex,
    target.path.segments[0]!
  );
  if (instanceLookup.kind !== "resolved" || instanceLookup.declaration.kind !== "moduleInstance") return undefined;
  const instance = moduleSemanticAnalysis.instancesByStatementId.get(instanceLookup.declaration.statementId);
  if (!instance?.callee) return undefined;
  const definition = moduleRuntimeContext?.definitionFor(instance.callee.definitionIdentity)
    ?? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const exported = definition?.exports.find((candidate) =>
    candidate.kind === "geometry" && candidate.name === target.path.segments[1]
  );
  if (!definition || !exported || exported.kind !== "geometry") return undefined;
  const entry = materialization.executionStatements.find((candidate) =>
    candidate.origin?.kind === "moduleBody" &&
    sameStatementPath(candidate.instancePath, [instance.statementId]) &&
    candidate.sourceStatementIndex === exported.exportedStatementIndex
  );
  if (!entry) return undefined;
  if (runtime) return entry.runtimeElementId;
  return stableStatementIdByIndex.get(exported.exportedStatementIndex);
};

const sourceElementsForTransformationRecipes = ({
  elements,
  materialization,
  stableStatementIdByIndex,
  rootElementIdsByStatementIndex
}: {
  elements: readonly CadElement[];
  materialization: ModuleMaterialization;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  rootElementIdsByStatementIndex: ReadonlyMap<number, ElementId>;
}): { elements: CadElement[]; elementIdsByStatementIndex: Map<number, ElementId> } => {
  const sourceElementIdsByStatementIndex = new Map(rootElementIdsByStatementIndex);
  const sourceIdByRuntimeId = new Map<ElementId, ElementId>();
  for (const entry of materialization.executionStatements) {
    if (entry.origin?.kind !== "moduleBody") continue;
    const sourceId = stableStatementIdByIndex.get(entry.sourceStatementIndex);
    if (!sourceId) continue;
    sourceElementIdsByStatementIndex.set(entry.sourceStatementIndex, sourceId);
    sourceIdByRuntimeId.set(entry.runtimeElementId, sourceId);
  }
  const seen = new Set<ElementId>();
  const sourceElements = elements.flatMap((element) => {
    const sourceId = sourceIdByRuntimeId.get(element.id);
    const id = sourceId ?? element.id;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      ...element,
      id,
      ...(element.parentGroupId
        ? { parentGroupId: sourceIdByRuntimeId.get(element.parentGroupId) ?? element.parentGroupId }
        : {})
    }];
  });
  return { elements: sourceElements, elementIdsByStatementIndex: sourceElementIdsByStatementIndex };
};

const compileModuleTransformationRecipes = ({
  statements,
  materialization,
  elements,
  moduleSemanticAnalysis,
  stableStatementIdByIndex,
  sourceNamespace,
  moduleRuntimeContext,
  diagnostics
}: {
  statements: readonly DslStatement[];
  materialization: import("./moduleMaterialization").ModuleMaterialization;
  elements: CadElement[];
  moduleSemanticAnalysis: NonNullable<CompileDslContext["moduleSemanticAnalysis"]>;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  moduleRuntimeContext?: CompileDslContext["moduleRuntimeContext"];
  diagnostics: DslDiagnostic[];
}): ModuleTransformationCompilation => {
  const sourceRecipes: TransformationRecipe[] = [];
  const runtimeRecipes: TransformationRecipe[] = [];
  const localDefinitions = moduleSemanticAnalysis.definitions.filter((definition) =>
    definition.documentId === undefined || moduleRuntimeContext?.documentFor(definition.documentId)?.statements === statements
  );
  for (const definition of localDefinitions) {
    const definitionStatements = moduleRuntimeContext?.documentFor(definition.documentId)?.statements ?? statements;
    if (definitionStatements !== statements) continue;
    const scope = sourceScopeForModuleDefinition({
      statements,
      definitionStatementIndex: definition.statementIndex,
      bodyStatementIndexes: definition.bodyStatements.map((body) => body.statementIndex),
      stableStatementIdByIndex
    });
    const includeDefinitionTransformation = (candidate: DslStatement, statementIndex: number) =>
      candidate.kind === "transformation" && moduleDefinitionIndexFor(statements, statementIndex) === definition.statementIndex;
    const geometryParameterNames = new Set(
      definition.parameters
        .filter((parameter) => moduleRuntimeGeometryKindOf(parameter.type) !== null)
        .map((parameter) => parameter.name)
    );
    for (const [statementIndex, candidate] of statements.entries()) {
      if (!includeDefinitionTransformation(candidate, statementIndex) || candidate.kind !== "transformation") continue;
      for (const target of candidate.targets) {
        const parsedTarget = parseDslSourceReference(`@${target.source}`);
        const parameterName = parsedTarget.kind === "valid" ? parsedTarget.reference.path.segments[0] : undefined;
        if (parsedTarget.kind !== "valid" || parsedTarget.reference.path.segments.length !== 1 || !parameterName || !geometryParameterNames.has(parameterName)) continue;
        diagnostics.push(transformationDiagnostic(
          candidate,
          `module geometry parameter「${parameterName}」はtransformation targetに指定できません。`,
          "module-geometry-parameter-mutation",
          target.span,
          statementIndex
        ));
      }
    }
    sourceRecipes.push(...compileTransformationRecipes({
      statements,
      elements: scope.elements,
      index: createNameIndex(scope.elements),
      sourceNamespace,
      sourceElementIds: scope.sourceElementIds,
      stableStatementIdByIndex,
      includeStatement: includeDefinitionTransformation,
      diagnostics
    }));
  }

  for (const instanceEntry of materialization.executionStatements) {
    if (instanceEntry.type !== "moduleInstance" || !instanceEntry.origin) continue;
    const definition = moduleSemanticAnalysis.definitions.find((candidate) =>
      candidate.statementId === instanceEntry.origin?.moduleDefinitionStatementId
    );
    if (!definition || definition.documentId !== undefined && moduleRuntimeContext?.documentFor(definition.documentId)?.statements !== statements) continue;
    const bodyEntries = materialization.executionStatements.filter((entry) =>
      entry.origin?.kind === "moduleBody" && sameStatementPath(entry.instancePath, instanceEntry.instancePath)
    );
    const runtimeSourceElementIds = new Map<number, ElementId>(
      bodyEntries.map((entry) => [entry.sourceStatementIndex, entry.runtimeElementId])
    );
    const runtimeElementIds = new Set(bodyEntries.map((entry) => entry.runtimeElementId));
    const runtimeElements = elements.filter((element) => runtimeElementIds.has(element.id));
    const includeDefinitionTransformation = (candidate: DslStatement, statementIndex: number) =>
      candidate.kind === "transformation" && moduleDefinitionIndexFor(statements, statementIndex) === definition.statementIndex;
    const runtimeDiagnostics: DslDiagnostic[] = [];
    const lowered = compileTransformationRecipes({
      statements,
      elements: runtimeElements,
      index: createNameIndex(runtimeElements),
      sourceNamespace,
      sourceElementIds: runtimeSourceElementIds,
      stableStatementIdByIndex,
      includeStatement: includeDefinitionTransformation,
      diagnostics: runtimeDiagnostics
    });
    const definitionBodyIndexes = definition.bodyStatements
      .map((body) => body.statementIndex)
      .filter((statementIndex) => moduleDefinitionIndexFor(statements, statementIndex) === definition.statementIndex)
      .sort((left, right) => left - right);
    const bodySpan = Math.max(1, definitionBodyIndexes.length + 1);
    for (const recipe of lowered) {
      const position = definitionBodyIndexes.indexOf(recipe.sourceStatementIndex);
      runtimeRecipes.push({
        ...recipe,
        id: encodeIdentityTuple(["module-transformation", ...instanceEntry.instancePath, recipe.id]),
        runtimeSourceOrder: instanceEntry.executionUnitStatementIndex + (Math.max(0, position) + 1) / bodySpan
      });
    }
  }
  return { sourceRecipes, runtimeRecipes };
};

export const applyVisibilitySettings = ({
  statements,
  context,
  diagnostics,
  includeStatement
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
  includeStatement: DslStatementInclusion;
}) => {
  let visibilityRoles = [...(context.visibilityRoles ?? [])];
  let visibilityProfiles = [...(context.visibilityProfiles ?? [])];
  let activeVisibilityProfileId = context.activeVisibilityProfileId;

  const upsertRole = (statement: Extract<DslStatement, { kind: "role" }>) => {
    const id = attr(statement.attrs, "id") ?? statement.name;
    const name = unquoteName(attr(statement.attrs, "name")) ?? statement.name;
    const existing = visibilityRoles.find((role) => role.id === id || role.name === statement.name);
    if (existing) {
      visibilityRoles = visibilityRoles.map((role) =>
        role.id === existing.id ? { ...role, name } : role
      );
      return;
    }
    visibilityRoles = [...visibilityRoles, { id, name }];
  };

  const upsertProfile = (statement: Extract<DslStatement, { kind: "view" }>) => {
    const id = attr(statement.attrs, "id") ?? statement.name;
    const name = unquoteName(attr(statement.attrs, "name")) ?? statement.name;
    const existing = visibilityProfiles.find((profile) => profile.id === id || profile.name === statement.name);
    const defaultAttr = attr(statement.attrs, "default") ?? attr(statement.attrs, "defaultRoleVisible");
    const defaultRoleVisible =
      defaultAttr === undefined
        ? existing?.defaultRoleVisible ?? true
        : booleanValue(defaultAttr) ?? true;
    const roleVisibility = { ...(existing?.roleVisibility ?? {}) };

    for (const { key, value } of statement.attrs) {
      if (key === "id" || key === "name" || key === "default" || key === "defaultRoleVisible") continue;
      const roleId = roleIdByToken(visibilityRoles, key);
      if (!visibilityRoles.some((role) => role.id === roleId)) {
        diagnostics.push(warning(statement.line, `未定義の表示ロールです: ${key}`));
      }
      const parsed = booleanValue(value);
      if (parsed === null) {
        diagnostics.push(diagnostic(statement.line, `${key} は true/false で指定してください。`));
        continue;
      }
      roleVisibility[roleId] = parsed;
    }

    const profile = { id, name, defaultRoleVisible, roleVisibility };
    visibilityProfiles = existing
      ? visibilityProfiles.map((item) => item.id === existing.id ? { ...profile, id: existing.id } : item)
      : [...visibilityProfiles, profile];
  };

  for (const [statementIndex, statement] of statements.entries()) {
    if (!includeStatement(statement, statementIndex)) continue;
    if (statement.kind === "role") upsertRole(statement);
  }
  for (const [statementIndex, statement] of statements.entries()) {
    if (!includeStatement(statement, statementIndex)) continue;
    if (statement.kind === "view") upsertProfile(statement);
  }
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex];
    if (!includeStatement(statement, statementIndex)) continue;
    if (statement.kind === "activeView") {
      const profileId = visibilityProfileIdByToken(visibilityProfiles, statement.name);
      if (visibilityProfiles.some((profile) => profile.id === profileId)) {
        activeVisibilityProfileId = profileId;
      } else {
        diagnostics.push(warning(statement.line, `未定義の表示プロファイルです: ${statement.name}`));
        activeVisibilityProfileId = profileId;
      }
    }
  }

  return {
    visibilityRoles,
    visibilityProfiles,
    activeVisibilityProfileId
  };
};

type SourceOutputModel = {
  layouts: Layout[];
  printOutputs: PrintOutput[];
  svgOutputs: SvgOutput[];
  layoutIdsByStatementIndex: Map<number, string>;
  outputIdsByStatementIndex: Map<number, string>;
};

const sourceIdAt = (stableStatementIdByIndex: ReadonlyMap<number, string> | undefined, statementIndex: number) =>
  stableStatementIdByIndex?.get(statementIndex) ?? "";

const isDescendantOf = (element: CadElement, ancestorId: ElementId, elementsById: ReadonlyMap<ElementId, CadElement>) => {
  let current: CadElement | undefined = element;
  while (current?.parentGroupId) {
    if (current.parentGroupId === ancestorId) return true;
    current = elementsById.get(current.parentGroupId);
  }
  return false;
};

const resolveSourceGroup = ({
  token,
  statementIndex,
  sourceNamespace,
  elements,
  elementIdByStatementIndex,
  nameIndex,
  line,
  diagnostics
}: {
  token: string;
  statementIndex: number;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  elements: readonly CadElement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  nameIndex: NameIndex;
  line: number;
  diagnostics: DslDiagnostic[];
}) => {
  if (sourceNamespace) {
    const resolved = sourceDeclarationFor(token, statementIndex, ["group"], sourceNamespace, line, diagnostics);
    if (!resolved) return null;
    const groupId = elementIdByStatementIndex.get(resolved.declaration.statementIndex);
    const group = groupId ? elements.find((element) => element.id === groupId) : undefined;
    if (!group || group.type !== "group") {
      diagnostics.push(diagnostic(line, `place の参照先はグループではありません: ${token}`));
      return null;
    }
    return { declaration: resolved.declaration, group };
  }
  const groupId = resolveId(token, nameIndex, line, diagnostics);
  const group = elements.find((element) => element.id === groupId);
  if (!group || group.type !== "group") {
    diagnostics.push(diagnostic(line, `place の参照先はグループではありません: ${token}`));
    return null;
  }
  return { declaration: null, group };
};

const resolveLayoutOrigin = ({
  token,
  statementIndex,
  target,
  targetDeclaration,
  sourceNamespace,
  elements,
  elementIdByStatementIndex,
  line,
  diagnostics
}: {
  token: string | undefined;
  statementIndex: number;
  target: CadElement;
  targetDeclaration: { statementId: string } | null;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  elements: readonly CadElement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  line: number;
  diagnostics: DslDiagnostic[];
}): LayoutOrigin => {
  if (!token) return { kind: "localOrigin" };
  if (!sourceNamespace) {
    diagnostics.push(diagnostic(line, `place origin は source lexical namespace で解決できません: ${token}`));
    return { kind: "localOrigin" };
  }
  const path = sourceReferencePath(token, line, diagnostics);
  if (!path) return { kind: "localOrigin" };
  const resolved = resolveSourceLexicalPathSegments(sourceNamespace, statementIndex, path);
  if (resolved.lookup.kind !== "resolved") {
    diagnostics.push(diagnostic(line, `origin の参照先を解決できません: ${token}`));
    return { kind: "localOrigin" };
  }
  const originDeclaration = resolved.segments.at(-1);
  if (!originDeclaration) return { kind: "localOrigin" };
  if (targetDeclaration && originDeclaration.statementId === targetDeclaration.statementId) {
    return { kind: "localOrigin" };
  }
  if (originDeclaration.kind !== "geometry") {
    diagnostics.push(diagnostic(line, `origin の参照先は点ではありません: ${token}`));
    return { kind: "localOrigin" };
  }
  const pointId = elementIdByStatementIndex.get(originDeclaration.statementIndex);
  const point = pointId ? elements.find((element) => element.id === pointId) : undefined;
  if (!point || !isPointElement(point)) {
    diagnostics.push(diagnostic(line, `origin の参照先は点ではありません: ${token}`));
    return { kind: "localOrigin" };
  }
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  if (!isDescendantOf(point, target.id, elementsById)) {
    diagnostics.push(diagnostic(line, `origin の点は配置対象グループの内部にありません: ${token}`));
    return { kind: "localOrigin" };
  }
  return { kind: "point", pointId: point.id };
};

const resolveOutputDeclaration = (
  token: string | undefined,
  statementIndex: number,
  expected: readonly string[],
  sourceNamespace: SourceLexicalNamespaceIndex | undefined,
  line: number,
  diagnostics: DslDiagnostic[]
) => token && sourceNamespace
  ? sourceDeclarationFor(token, statementIndex, expected, sourceNamespace, line, diagnostics)
  : null;

export const buildSourceOutputModel = ({
  statements,
  elements,
  nameIndex,
  sourceNamespace,
  elementIdByStatementIndex,
  stableStatementIdByIndex,
  diagnostics,
  includeStatement
}: {
  statements: DslStatement[];
  elements: CadElement[];
  nameIndex: NameIndex;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  stableStatementIdByIndex?: ReadonlyMap<number, string>;
  diagnostics: DslDiagnostic[];
  includeStatement: DslStatementInclusion;
}): SourceOutputModel => {
  const layouts: Layout[] = [];
  const printOutputs: PrintOutput[] = [];
  const svgOutputs: SvgOutput[] = [];
  const layoutIdsByStatementIndex = new Map<number, string>();
  const outputIdsByStatementIndex = new Map<number, string>();
  const nameContext = nameIndex.nameContext;

  for (const [statementIndex, statement] of statements.entries()) {
    if (!includeStatement(statement, statementIndex) || statement.kind !== "layout" || !statement.name) continue;
    const layoutId = sourceIdAt(stableStatementIdByIndex, statementIndex);
    const scaleSource = attr(statement.attrs, "scale");
    const scale = normalizedNumeric(scaleSource ?? "1", elements, nameContext);
    const scaleLiteral = numericLiteral(scaleSource ?? "1");
    if (scaleLiteral !== null && (!scaleLiteral.finite || scaleLiteral.value <= 0)) {
      diagnostics.push(diagnostic(statement.line, "layout scale は有限の正の値で指定してください。"));
    }
    const placements: LayoutPlacement[] = [];
    for (const [memberIndex, member] of statements.entries()) {
      if (!includeStatement(member, memberIndex) || member.kind !== "place" || member.enclosing?.statementIndex !== statementIndex) continue;
      const target = resolveSourceGroup({
        token: member.group,
        statementIndex: memberIndex,
        sourceNamespace,
        elements,
        elementIdByStatementIndex,
        nameIndex,
        line: member.line,
        diagnostics
      });
      const atSource = attr(member.attrs, "at");
      const at = atSource ? coordinatePair(atSource) : null;
      if (!at) {
        diagnostics.push(diagnostic(member.line, "place には `at: (x, y)` が必要です。"));
      }
      const atX = normalizedNumeric(at?.x ?? "0", elements, nameContext);
      const atY = normalizedNumeric(at?.y ?? "0", elements, nameContext);
      const scaleSource = attr(member.attrs, "scale");
      const angleSource = attr(member.attrs, "angle") ?? "0";
      const angleValue = normalizedNumeric(angleSource, elements, nameContext);
      const angleLiteral = numericLiteral(angleSource);
      const normalizedAngle = angleLiteral === null || !angleLiteral.finite
        ? angleValue
        : ((angleLiteral.value % 360) + 360) % 360;
      const mirrorValue = booleanValue(attr(member.attrs, "mirror") ?? "false");
      if (mirrorValue === null) diagnostics.push(diagnostic(member.line, "place mirror は true / false で指定してください。"));
      const scaleLiteral = scaleSource === undefined ? null : numericLiteral(scaleSource);
      if (scaleLiteral !== null && (!scaleLiteral.finite || scaleLiteral.value <= 0)) {
        diagnostics.push(diagnostic(member.line, "place scale は有限の正の値で指定してください。"));
      }
      if (angleLiteral !== null && !angleLiteral.finite) {
        diagnostics.push(diagnostic(member.line, "place angle は有限の値で指定してください。"));
      }
      if (!target) continue;
      const placementId = sourceIdAt(stableStatementIdByIndex, memberIndex);
      placements.push({
        id: placementId,
        groupId: target.group.id,
        origin: resolveLayoutOrigin({
          token: attr(member.attrs, "origin"),
          statementIndex: memberIndex,
          target: target.group,
          targetDeclaration: target.declaration,
          sourceNamespace,
          elements,
          elementIdByStatementIndex,
          line: member.line,
          diagnostics
        }),
        at: { x: atX, y: atY },
        ...(scaleSource !== undefined ? { scale: normalizedNumeric(scaleSource, elements, nameContext) } : {}),
        angleDeg: normalizedAngle,
        mirror: mirrorValue ?? false
      });
    }
    layouts.push({ id: layoutId, name: statement.name, scale, placements });
    layoutIdsByStatementIndex.set(statementIndex, layoutId);
  }

  const layoutById = new Map(layouts.map((layout) => [layout.id, layout]));
  const paperDimensions: Record<PrintPaperSizeId, { width: number; height: number }> = {
    a4: { width: 210, height: 297 },
    a3: { width: 297, height: 420 }
  };
  for (const [statementIndex, statement] of statements.entries()) {
    if (!includeStatement(statement, statementIndex) || (statement.kind !== "print" && statement.kind !== "svg")) continue;
    const outputId = sourceIdAt(stableStatementIdByIndex, statementIndex);
    const layoutReference = resolveOutputDeclaration(attr(statement.attrs, "layout"), statementIndex, ["layout"], sourceNamespace, statement.line, diagnostics);
    const layoutId = layoutReference?.declaration.statementId ?? "";
    if (layoutId && !layoutById.has(layoutId)) diagnostics.push(diagnostic(statement.line, "print/svg layout の宣言を取得できません。"));
    const profileReference = resolveOutputDeclaration(attr(statement.attrs, "profile"), statementIndex, ["profile"], sourceNamespace, statement.line, diagnostics);
    const profileId = profileReference?.declaration.statementId;
    if (statement.kind === "print") {
      const paperSource = attr(statement.attrs, "paper") ?? "a4";
      const paper = paperSource as PrintPaperSizeId;
      if (paper !== "a4" && paper !== "a3") diagnostics.push(diagnostic(statement.line, "print paper は a4 または a3 で指定してください。"));
      const orientationSource = attr(statement.attrs, "orientation") ?? "portrait";
      if (orientationSource !== "portrait" && orientationSource !== "landscape") diagnostics.push(diagnostic(statement.line, "orientation は portrait / landscape で指定してください。"));
      const overlapAttribute = statement.attrs.find((item) => item.key === "overlap");
      const overlapSource = overlapAttribute?.value ?? "0";
      const overlapLiteral = numericLiteral(overlapSource);
      if (overlapLiteral !== null && overlapLiteral.value < 0) diagnostics.push(diagnostic(statement.line, "print overlap は 0 以上で指定してください。"));
      if (overlapLiteral !== null && overlapLiteral.finite && (paper === "a4" || paper === "a3")) {
        const base = paperDimensions[paper];
        const width = orientationSource === "landscape" ? base.height : base.width;
        const height = orientationSource === "landscape" ? base.width : base.height;
        if (width - overlapLiteral.value * 2 <= 0 || height - overlapLiteral.value * 2 <= 0) {
          const overlapUpperBound = Math.min(width, height) / 2;
          diagnostics.push({
            ...diagnostic(statement.line, `print の overlap が大きすぎます。${paper === "a4" ? "A4" : "A3"} ${orientationSource === "landscape" ? "landscape" : "portrait"} では overlap を ${overlapUpperBound}mm 未満にしてください。`),
            ...(overlapAttribute ? {
              logicalSpan: { start: overlapAttribute.valueStart, end: overlapAttribute.valueEnd },
              statementIndex
            } : {})
          });
        }
      }
      printOutputs.push({
        id: outputId,
        name: statement.name,
        layoutId,
        ...(profileId ? { profileId } : {}),
        paper: paper === "a3" ? "a3" : "a4",
        orientation: orientationSource === "landscape" ? "landscape" : "portrait",
        overlap: normalizedNumeric(overlapSource, elements, nameContext)
      });
    } else {
      const marginSource = attr(statement.attrs, "margin") ?? "0";
      const marginLiteral = numericLiteral(marginSource);
      if (marginLiteral !== null && marginLiteral.value < 0) diagnostics.push(diagnostic(statement.line, "svg margin は 0 以上で指定してください。"));
      svgOutputs.push({
        id: outputId,
        name: statement.name,
        layoutId,
        ...(profileId ? { profileId } : {}),
        margin: normalizedNumeric(marginSource, elements, nameContext)
      });
    }
    outputIdsByStatementIndex.set(statementIndex, outputId);
  }
  return { layouts, printOutputs, svgOutputs, layoutIdsByStatementIndex, outputIdsByStatementIndex };
};

export const compileDslToElements = (source: string, context: CompileDslContext): CompileDslResult => {
  const parsed = context.preparsed ?? parseDsl(source);
  const diagnostics: DslDiagnostic[] = [...parsed.diagnostics];
  const sourceNamespace = context.sourceLexicalResolution?.sourceNamespace;
  const modifiers = modifierDefinitionsFromStatements(parsed.statements, sourceNamespace, diagnostics);
  const drawingProfiles = drawingProfilesFromStatements(parsed.statements, sourceNamespace);
  // Same missing-attribute-value carve-out as dslDocument.ts's fatal gates:
  // an intentionally-blank `key:` value must not prevent every other
  // statement in the document from compiling into elements.
  if (parsed.diagnostics.some((item) => item.severity === "error" && item.code !== MISSING_ATTRIBUTE_VALUE_CODE)) {
    return {
      elements: context.elements,
      transformationRecipes: [],
      modifiers,
      drawingProfiles,
      selectedElementId: null,
      selectedElementIds: [],
      visibilityRoles: context.visibilityRoles,
      visibilityProfiles: context.visibilityProfiles,
      activeVisibilityProfileId: context.activeVisibilityProfileId,
      layouts: context.layouts,
      printOutputs: context.printOutputs,
      svgOutputs: context.svgOutputs,
      diagnostics,
      changedCount: 0
    };
  }

  const includeStatement: DslStatementInclusion = (_statement, statementIndex) =>
    isCompilableDslStatement(parsed.statements, statementIndex);
  const visibilitySettings = applyVisibilitySettings({
    statements: parsed.statements,
    context,
    diagnostics,
    includeStatement
  });
  const documentMode = context.mode === "document";
  const moduleAwareCompilation = documentMode && context.moduleSemanticAnalysis && context.stableStatementIdByIndex;
  // Drawing Modifier references belong to the source document, not to the
  // materialized runtime element list. Validate every geometry/group
  // declaration against the document-level modifier definitions before the
  // selected compilation path continues. The module-aware call sees the full
  // source AST, including declarations inside Module bodies; the ordinary
  // preflight retains its existing module-subtree exclusion.
  const modifierNames = new Set(modifiers.map((modifier) => modifier.name));
  const modifierStatements = moduleAwareCompilation
    ? parsed.statements
    : parsed.statements.filter((statement, statementIndex) => isCompilableDslStatement(parsed.statements, statementIndex));
  const referencedModifierNames = new Set<string>();
  for (const statement of modifierStatements) {
    if (!isElementDslStatement(statement)) continue;
    for (const modifierName of statement.modifierNames ?? []) {
      referencedModifierNames.add(modifierName);
      if (!modifierNames.has(modifierName)) {
        diagnostics.push(diagnostic(statement.line, `未定義の modifier です: ${modifierName}`));
      }
    }
  }
  for (const [statementIndex, statement] of parsed.statements.entries()) {
    if (!isTopLevelModifierDefinition(statement) || !statement.name || !statement.nameSpan) continue;
    if (referencedModifierNames.has(statement.name)) continue;
    diagnostics.push({
      severity: "warning",
      line: statement.line,
      column: statement.nameSpan.start + 1,
      code: "unused-drawing-modifier",
      message: `Drawing Modifier「${statement.name}」はどこからも使用されていません。`,
      presentation: {
        key: "diagnostic.unused-drawing-modifier",
        parameters: { name: statement.name }
      },
      logicalSpan: statement.nameSpan,
      statementIndex
    });
  }
  if (documentMode && context.moduleSemanticAnalysis && context.stableStatementIdByIndex) {
    const moduleMaterialization = materializeModuleExecution({
      statements: parsed.statements,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      assignedElementIds: context.assignedElementIds ?? new Map(),
      moduleSemanticAnalysis: context.moduleSemanticAnalysis,
      moduleRuntimeContext: context.moduleRuntimeContext
    });
    const moduleGeometryRuntime = buildModuleGeometryRuntime({
      statements: parsed.statements,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      moduleSemanticAnalysis: context.moduleSemanticAnalysis,
      moduleMaterialization,
      moduleRuntimeContext: context.moduleRuntimeContext,
      sourceNamespace: context.sourceLexicalResolution?.sourceNamespace
    });
    diagnostics.push(...moduleGeometryRuntime.diagnostics);
    const materialized = compileMaterializedExecution({
      statements: parsed.statements,
      context,
      diagnostics,
      visibilitySettings,
      materialization: moduleMaterialization,
      moduleGeometryRuntime,
      applyStatement,
      buildSourceOutputModel
    });
    // Root recipes target the materialized root geometry. Module-body recipes
    // use the same transformation compiler against each module definition and
    // concrete instance scope; they remain recipe values rather than drawable
    // elements.
    const sourceTransformationElements = sourceElementsForTransformationRecipes({
      elements: materialized.elements,
      materialization: moduleMaterialization,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      rootElementIdsByStatementIndex: moduleMaterialization.elementIdBySourceStatementIndex
    });
    const rootTransformationRecipes = compileTransformationRecipes({
      statements: parsed.statements,
      elements: sourceTransformationElements.elements,
      index: createNameIndex(sourceTransformationElements.elements),
      sourceNamespace: context.sourceLexicalResolution?.sourceNamespace,
      sourceElementIds: sourceTransformationElements.elementIdsByStatementIndex,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      resolveModuleOwner: (target, statementIndex) => moduleQualifiedOwnerFor({
        target,
        statementIndex,
        sourceNamespace: context.sourceLexicalResolution?.sourceNamespace,
        moduleSemanticAnalysis: context.moduleSemanticAnalysis!,
        materialization: moduleMaterialization,
        stableStatementIdByIndex: context.stableStatementIdByIndex!,
        moduleRuntimeContext: context.moduleRuntimeContext,
        runtime: false
      }),
      includeStatement: (statement, statementIndex) =>
        includeStatement(statement, statementIndex) && !isInUnloweredModuleSubtree(parsed.statements, statementIndex),
      diagnostics
    });
    const runtimeRootDiagnostics: DslDiagnostic[] = [];
    const runtimeRootTransformationRecipes = compileTransformationRecipes({
      statements: parsed.statements,
      elements: materialized.elements,
      index: createNameIndex(materialized.elements, context.sourceLexicalResolution),
      sourceNamespace: context.sourceLexicalResolution?.sourceNamespace,
      sourceElementIds: moduleMaterialization.elementIdBySourceStatementIndex,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      resolveModuleOwner: (target, statementIndex) => moduleQualifiedOwnerFor({
        target,
        statementIndex,
        sourceNamespace: context.sourceLexicalResolution?.sourceNamespace,
        moduleSemanticAnalysis: context.moduleSemanticAnalysis!,
        materialization: moduleMaterialization,
        stableStatementIdByIndex: context.stableStatementIdByIndex!,
        moduleRuntimeContext: context.moduleRuntimeContext,
        runtime: true
      }),
      includeStatement: (statement, statementIndex) =>
        includeStatement(statement, statementIndex) && !isInUnloweredModuleSubtree(parsed.statements, statementIndex),
      diagnostics: runtimeRootDiagnostics
    });
    diagnostics.push(...runtimeRootDiagnostics);
    const moduleTransformationCompilation = compileModuleTransformationRecipes({
      statements: parsed.statements,
      materialization: moduleMaterialization,
      elements: materialized.elements,
      moduleSemanticAnalysis: context.moduleSemanticAnalysis,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      sourceNamespace: context.sourceLexicalResolution?.sourceNamespace,
      moduleRuntimeContext: context.moduleRuntimeContext,
      diagnostics
    });
    const transformationRecipes = [
      ...rootTransformationRecipes,
      ...moduleTransformationCompilation.sourceRecipes
    ];
    return {
      ...materialized,
      transformationRecipes,
      documentTransformationRecipes: rootTransformationRecipes,
      runtimeTransformationRecipes: [
        ...runtimeRootTransformationRecipes,
        ...moduleTransformationCompilation.runtimeRecipes
      ],
      modifiers,
      drawingProfiles
    };
  }
  const existing = documentMode ? [] : context.elements;
  const statementIndexOf = new Map<DslStatement, number>(
    parsed.statements.map((statement, index) => [statement, index])
  );
  const elementStatements = parsed.statements.filter(
    (statement, statementIndex) => isElementDslStatement(statement) && isCompilableDslStatement(parsed.statements, statementIndex)
  );
  const statementsWithIds = elementStatements.map((statement) => {
    const type = statementTypeOf(statement);
    return {
      statement,
      type,
      id:
        attr(statement.attrs, "id") ??
        context.assignedElementIds?.get(statementIndexOf.get(statement) ?? -1) ??
        (statement.name
          ? existing.find((element) => element.name === statement.name && element.type === type)?.id
          : undefined)
    };
  });
  const createdIds = new Map<DslStatement, ElementId>();
  for (const item of statementsWithIds) {
    createdIds.set(item.statement, item.id ?? createCadElement(item.type, existing).id);
  }

  const blockContextOf = (
    statement: DslStatement
  ): { parentId: ElementId; branch?: "then" | "else" } | null => {
    if (!statement.enclosing) return null;
    const parentStatement = parsed.statements[statement.enclosing.statementIndex];
    if (!parentStatement || !isElementDslStatement(parentStatement)) return null;
    const parentId = createdIds.get(parentStatement);
    if (!parentId) return null;
    return {
      parentId,
      ...(statementTypeOf(parentStatement) === "conditionalGroup"
        ? { branch: statement.enclosing.branch }
        : {})
    };
  };

  const withBlockContext = (element: CadElement, statement: DslStatement): CadElement => {
    const block = blockContextOf(statement);
    if (!block) return element;
    return {
      ...element,
      parentGroupId: block.parentId,
      ...(block.branch ? { conditionalBranch: block.branch } : {})
    };
  };

  let placeholderElements = statementsWithIds.map(({ statement, type }) => ({
    ...createCadElement(type, existing, { createId: () => createdIds.get(statement) ?? "" }),
    name: statement.name
  }));
  const preliminaryIndex = createNameIndex([...existing, ...placeholderElements], context.sourceLexicalResolution);
  placeholderElements = placeholderElements.map((element, index) => {
    const statement = statementsWithIds[index].statement;
    const block = blockContextOf(statement);
    if (block) return withBlockContext(element, statement);
    const parentToken = attr(statement.attrs, "parent");
    return parentToken
      ? {
          ...element,
          parentGroupId: resolveId(parentToken, preliminaryIndex, statement.line, diagnostics, element)
        }
      : element;
  });
  const index = createNameIndex([...existing, ...placeholderElements], context.sourceLexicalResolution);
  const elementsForExpressions = [...existing, ...placeholderElements];

  const updates = new Map<ElementId, CadElement>();
  const insertions: CadElement[] = [];
  for (const { statement, type } of statementsWithIds) {
    if (statement.kind === "element" && !statement.type) continue;
    const id = createdIds.get(statement) ?? createCadElement(type, existing).id;
    const current = existing.find((element) => element.id === id);
    const base = withBlockContext(
      current ?? createCadElement(type, [...existing, ...insertions], { createId: () => id }),
      statement
    );
    let effectiveStatement = statement;
    if (blockContextOf(statement) && attr(statement.attrs, "parent")) {
      diagnostics.push(warning(statement.line, "ブロック内の parent= 属性は無視されます。"));
      effectiveStatement = { ...statement, attrs: statement.attrs.filter((item) => item.key !== "parent") };
    }
    const compiled = withBlockContext(
      applyStatement(
        base,
        effectiveStatement,
        index,
        diagnostics,
        elementsForExpressions,
        index.nameContext,
        visibilitySettings.visibilityRoles,
        context.majorVersion,
        undefined,
        statementIndexOf.get(statement)
      ),
      statement
    );
    if (current) {
      updates.set(id, compiled);
    } else {
      insertions.push(compiled);
    }
  }

  const insertionIndex = documentMode
    ? 0
    : Math.min(Math.max(context.insertionIndex ?? existing.length, 0), existing.length);
  const updatedExisting = existing.map((element) => updates.get(element.id) ?? element);
  const elements = [
    ...updatedExisting.slice(0, insertionIndex),
    ...insertions,
    ...updatedExisting.slice(insertionIndex)
  ];
  const selectedElementIds = [...updates.keys(), ...insertions.map((element) => element.id)];

  const elementIdBySourceStatement = new Map<number, ElementId>();
  for (const [sourceStatement, elementId] of createdIds) {
    const sourceIndex = statementIndexOf.get(sourceStatement);
    if (sourceIndex !== undefined) elementIdBySourceStatement.set(sourceIndex, elementId);
  }
  const outputModel = buildSourceOutputModel({
    statements: parsed.statements,
    elements,
    nameIndex: createNameIndex(elements, context.sourceLexicalResolution),
    sourceNamespace,
    elementIdByStatementIndex: elementIdBySourceStatement,
    stableStatementIdByIndex: context.stableStatementIdByIndex,
    diagnostics,
    includeStatement
  });

  let evaluationLimitIndex: number | undefined;
  const atStopIndex = parsed.statements.findIndex(
    (statement, statementIndex) => statement.kind === "atStop" && includeStatement(statement, statementIndex)
  );
  if (atStopIndex >= 0) {
    if (documentMode) {
      evaluationLimitIndex = parsed.statements
        .map((statement, statementIndex) => ({ statement, statementIndex }))
        .slice(0, atStopIndex)
        .filter(({ statement, statementIndex }) =>
          isElementDslStatement(statement) && isCompilableDslStatement(parsed.statements, statementIndex)
        ).length;
    } else {
      const stopStatement = parsed.statements[atStopIndex];
      diagnostics.push(warning(stopStatement.line, "stop は文書全体の適用でのみ有効なため無視されます。"));
    }
  }

  const elementIdsByStatementIndex = new Map<number, ElementId>();
  for (const [statement, id] of createdIds) {
    const index = statementIndexOf.get(statement);
    if (index !== undefined) elementIdsByStatementIndex.set(index, id);
  }

  const transformationRecipes = compileTransformationRecipes({
    statements: parsed.statements,
    elements,
    index: createNameIndex(elements, context.sourceLexicalResolution),
    sourceNamespace,
    sourceElementIds: elementIdBySourceStatement,
    stableStatementIdByIndex: context.stableStatementIdByIndex,
    includeStatement,
    diagnostics
  });

  return {
    elements,
    transformationRecipes,
    documentTransformationRecipes: transformationRecipes,
    runtimeTransformationRecipes: transformationRecipes,
    modifiers,
    drawingProfiles,
    selectedElementId: selectedElementIds[0] ?? null,
    selectedElementIds,
    visibilityRoles: visibilitySettings.visibilityRoles,
    visibilityProfiles: visibilitySettings.visibilityProfiles,
    activeVisibilityProfileId: visibilitySettings.activeVisibilityProfileId,
    layouts: outputModel.layouts,
    printOutputs: outputModel.printOutputs,
    svgOutputs: outputModel.svgOutputs,
    evaluationLimitIndex,
    diagnostics,
    changedCount: selectedElementIds.length,
    elementIdsByStatementIndex,
    layoutIdsByStatementIndex: outputModel.layoutIdsByStatementIndex,
    outputIdsByStatementIndex: outputModel.outputIdsByStatementIndex
  };
};
