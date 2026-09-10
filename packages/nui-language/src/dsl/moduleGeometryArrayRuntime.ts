import type { ElementId, PointAnchor } from "../types/geometry";
import { derivedAnchor, isDerivedPointKeyForGeometryCategory } from "../model/pointAnchors";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslSpan, DslStatement } from "./dslTypes";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { coordinateComponent } from "./dslParameterSpanScanner";
import { makeNumericExpression } from "../geometry/numericExpressions";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";
import { parseScalarExpression } from "../scalars/expressionParser";
import {
  parseGeometryArrayDeferredModuleExportId,
  type GeometryArraySemanticAnalysis,
  type GeometryArraySourceTarget,
  type GeometryArrayValueSemantic
} from "./geometryArraySemanticAnalysis";
import { geometryArrayTypeOfModuleParameter } from "./geometryArraySourceAnnotations";
import {
  geometryArrayTypeName,
  isGeometryArrayTypeAssignable,
  type GeometryArrayType
} from "./geometryArrayTypes";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import type { ModuleMaterialization } from "./moduleMaterialization";
import type { ModuleGeometryReferenceSemantic, ModuleScalarExpressionSemantic, ModuleScalarSourceTarget, ModuleSemanticAnalysis } from "./moduleSemanticTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { ScalarValue } from "../scalars/types";
import type { ModuleRuntimeContext } from "./moduleRuntimeContext";
import {
  pathKey,
  sourceAliasForTarget,
  geometryInputTargetForAlias,
  type GeometryInputTargetSource,
  type RuntimeGeometryInputTarget,
  type ExportEntry,
  type GeometryAlias,
  type InstanceContext
} from "./moduleGeometryRuntimeLowering";
import {
  buildSourceLexicalNamespaceIndex,
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";

export type ModuleGeometryArrayRuntimeCompilation = {
  diagnostics: readonly DslDiagnostic[];
  resolveLineReferenceList: (
    token: string,
    statementIndex: number,
    currentPath: readonly string[]
  ) => readonly ElementId[] | null;
  resolvePointReferenceList: (
    token: string,
    statementIndex: number,
    currentPath: readonly string[]
  ) => readonly PointAnchor[] | null;
  resolveLineReferenceTargetAt: (
    token: string,
    statementIndex: number,
    currentPath: readonly string[],
    target?: ModuleGeometryReferenceSemantic["target"]
  ) => RuntimeGeometryInputTarget | null;
  resolvePointReferenceAt: (
    token: string,
    statementIndex: number,
    currentPath: readonly string[],
    target?: ModuleGeometryReferenceSemantic["target"]
  ) => PointAnchor | RuntimeGeometryInputTarget | null;
  acceptsDeferredLineListExport: (
    reference: ModuleGeometryReferenceSemantic,
    currentPath: readonly string[]
  ) => boolean;
  resolveGeometryArrayAliasesForValueId: (
    valueId: string,
    currentPath: readonly string[]
  ) => readonly GeometryAlias[] | null;
};

type RuntimeArrayMember = {
  interfaceType: ModuleGeometryInterfaceType;
  alias: GeometryAlias | null;
  anchor?: PointAnchor;
};

type RuntimeArrayValue = {
  type: GeometryArrayType;
  members: readonly RuntimeArrayMember[];
};

type RuntimeResult = {
  value: RuntimeArrayValue | null;
  actualType: GeometryArrayType | null;
};

const pointAnchorForAlias = (alias: GeometryAlias | null | undefined): PointAnchor | undefined => {
  if (!alias) return undefined;
  if (alias.kind === "point") return alias.anchor;
  if (alias.kind === "value") return {
    mode: "geometryValue",
    occurrence: alias.occurrence,
    ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
  };
  return undefined;
};

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const parsedSourceReference = (text: string) => {
  const parsed = parseDslSourceReference(text.trim());
  return parsed.kind === "valid" ? parsed.reference : null;
};

const referencePath = (text: string) => {
  const reference = parsedSourceReference(text);
  if (!reference || reference.property) return null;
  return parseDslReferenceToken(reference.pathText);
};

const coordinateMember = (text: string) => {
  const span = { start: 0, end: text.length };
  return coordinateComponent(text, span, "x") && coordinateComponent(text, span, "y") ? text.trim() : null;
};

const coordinateAnchor = (text: string): PointAnchor | null => {
  const span = { start: 0, end: text.length };
  const x = coordinateComponent(text, span, "x");
  const y = coordinateComponent(text, span, "y");
  if (!x || !y) return null;
  return {
    mode: "coordinate",
    x: makeNumericExpression(text.slice(x.start, x.end)),
    y: makeNumericExpression(text.slice(y.start, y.end))
  };
};

const isLineEndpointPointKey = (value: string) => value === "start" || value === "end";

const aliasWithPointKey = (alias: GeometryAlias | undefined, pointKey: string | null): GeometryAlias | null => {
  if (!alias) return null;
  if (!pointKey) return alias;
  return alias.kind === "line" ? { kind: "point", anchor: derivedAnchor(alias.elementId, pointKey) } : null;
};

const physicalSpanFor = (statement: DslStatement, span: DslSpan) => {
  const segments: { from: number; to: number }[] = [];
  let logicalStart = 0;
  for (const segment of statement.physicalSpan.segments) {
    const length = segment.to - segment.from;
    const logicalEnd = logicalStart + length;
    const from = Math.max(span.start, logicalStart);
    const to = Math.min(span.end, logicalEnd);
    if (from < to) segments.push({ from: segment.from + from - logicalStart, to: segment.from + to - logicalStart });
    logicalStart = logicalEnd + 1;
  }
  return segments.length ? { segments, sourceRevision: statement.sourceRevision } : null;
};

const runtimeDiagnostic = (
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  parameters?: Readonly<Record<string, string | number | boolean>>
): DslDiagnostic => {
  const physicalSpan = physicalSpanFor(statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: { key: `diagnostic.${code}`, ...(parameters ? { parameters } : {}) },
    logicalSpan: span,
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

const parameterValueId = (definitionStatementId: string, parameterIndex: number) =>
  `${definitionStatementId}:parameter:${parameterIndex}`;

const parameterSlotFromValueId = (
  analysis: GeometryArraySemanticAnalysis,
  valueId: string
) => analysis.moduleParameters.find((parameter) => parameterValueId(parameter.definitionStatementId, parameter.parameterIndex) === valueId) ?? null;

export const buildModuleGeometryArrayRuntime = ({
  statements,
  stableStatementIdByIndex,
  moduleSemanticAnalysis,
  moduleMaterialization,
  contextsByPath,
  exportsByPath,
  moduleRuntimeContext,
  sourceNamespace
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  contextsByPath: ReadonlyMap<string, InstanceContext>;
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>;
  moduleRuntimeContext?: ModuleRuntimeContext;
  sourceNamespace?: SourceLexicalNamespaceIndex;
}): ModuleGeometryArrayRuntimeCompilation => {
  type RuntimeSource = {
    documentId: string;
    statements: readonly DslStatement[];
    stableStatementIdByIndex: ReadonlyMap<number, string>;
    sourceNamespace: SourceLexicalNamespaceIndex;
    moduleSemanticAnalysis: ModuleSemanticAnalysis;
    analysis: GeometryArraySemanticAnalysis | null;
  };
  const rootSource: RuntimeSource = {
    documentId: moduleRuntimeContext?.rootDocumentId ?? "root",
    statements,
    stableStatementIdByIndex,
    sourceNamespace: sourceNamespace
      ?? moduleRuntimeContext?.documentFor(moduleRuntimeContext.rootDocumentId)?.sourceLexicalNamespace
      ?? buildSourceLexicalNamespaceIndex(statements, stableStatementIdByIndex),
    moduleSemanticAnalysis,
    analysis: null
  };
  rootSource.analysis = rootSource.sourceNamespace.geometryArraySemanticAnalysis;
  const sourceForDocument = (documentId: string | undefined): RuntimeSource => {
    if (!moduleRuntimeContext || !documentId || documentId === moduleRuntimeContext.rootDocumentId) return rootSource;
    const document = moduleRuntimeContext.documentFor(documentId as import("../document/multiDocumentPrimitives").DocumentId);
    if (!document) return rootSource;
    return {
      documentId: document.documentId,
      statements: document.statements,
      stableStatementIdByIndex: document.statementIdByStatementIndex,
      sourceNamespace: document.sourceLexicalNamespace,
      moduleSemanticAnalysis: document.moduleSemanticAnalysis,
      analysis: document.sourceLexicalNamespace.geometryArraySemanticAnalysis
    };
  };
  const sourceForPath = (path: readonly string[]): RuntimeSource => {
    for (let length = path.length; length > 0; length -= 1) {
      const context = contextsByPath.get(pathKey(path.slice(0, length)));
      if (context?.definitionDocumentId) return sourceForDocument(context.definitionDocumentId);
    }
    return rootSource;
  };
  const diagnostics: DslDiagnostic[] = [];
  const diagnosticKeys = new Set<string>();

  const addDiagnostic = (diagnostic: DslDiagnostic) => {
    const physicalStart = diagnostic.physicalSpan?.segments[0]?.from ?? -1;
    const key = `${diagnostic.code ?? diagnostic.message}:${physicalStart}:${diagnostic.column}`;
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push(diagnostic);
  };

  const hasForeignArrayAnalysis = Boolean(moduleRuntimeContext && [...moduleRuntimeContext.documentsById.values()]
    .some((document) => document.documentId !== moduleRuntimeContext.rootDocumentId && document.sourceLexicalNamespace.geometryArraySemanticAnalysis));
  if (!rootSource.analysis && !hasForeignArrayAnalysis) {
    return {
      diagnostics,
      resolveLineReferenceList: () => null,
      resolvePointReferenceList: () => null,
      resolveLineReferenceTargetAt: () => null,
      resolvePointReferenceAt: () => null,
      acceptsDeferredLineListExport: () => false,
      resolveGeometryArrayAliasesForValueId: () => null
    };
  }
  const arrayExportsByDocument = new Map<string, Map<string, Map<string, GeometryArrayValueSemantic>>>();
  const arrayExportsForSource = (source: RuntimeSource) => {
    const existing = arrayExportsByDocument.get(source.documentId);
    if (existing) return existing;
    const exportsByDefinition = new Map<string, Map<string, GeometryArrayValueSemantic>>();
    const definitionIdByIndex = new Map(source.moduleSemanticAnalysis.definitions.map((definition) => [definition.statementIndex, definition.statementId] as const));
    for (const value of source.analysis?.values ?? []) {
      if (!value.exported || value.ownerModuleDefinitionStatementIndex === null) continue;
      const definitionId = definitionIdByIndex.get(value.ownerModuleDefinitionStatementIndex);
      if (!definitionId) continue;
      const exports = exportsByDefinition.get(definitionId) ?? new Map<string, GeometryArrayValueSemantic>();
      exports.set(value.name, value);
      exportsByDefinition.set(definitionId, exports);
    }
    arrayExportsByDocument.set(source.documentId, exportsByDefinition);
    return exportsByDefinition;
  };

  const contextForDefinition = (currentPath: readonly string[], definitionStatementId: string): InstanceContext | null => {
    for (let length = currentPath.length; length > 0; length -= 1) {
      const context = contextsByPath.get(pathKey(currentPath.slice(0, length)));
      if (context?.definitionStatementId === definitionStatementId) return context;
    }
    return null;
  };

  const childContextFor = (currentPath: readonly string[], instanceStatementId: string) => [...contextsByPath.values()].find((context) =>
    context.path.length === currentPath.length + 1 &&
    currentPath.every((part, index) => context.path[index] === part) &&
    context.instanceStatementId === instanceStatementId
  );

  // Geometry arrays are materialized before the scalar program is assembled.
  // Conditions are already resolved and typechecked by Module semantics, so
  // this small adapter only reads the typed scalar leaves needed to select a
  // geometry branch at materialization time. It deliberately has no name or
  // type resolution of its own.
  const evaluateCollectionControlFlowScalar = (
    semantic: ModuleScalarExpressionSemantic,
    currentPath: readonly string[],
    seen: ReadonlySet<string> = new Set()
  ): ScalarValue | null => {
    const evaluate = (expression: ModuleScalarExpressionSemantic, ast: ScalarExpressionAst): ScalarValue | null => {
      const key = `${expression.ast.span.start}:${ast.span.start}`;
      if (seen.has(key)) return null;
      const reference = expression.references.find((candidate) => candidate.span.start === ast.span.start);
      const evaluateTarget = (target: ModuleScalarSourceTarget): ScalarValue | null => {
        if (target.kind === "documentBinding") {
          const site = moduleSemanticAnalysis.rootScalarExpressionsByStatementId.get(target.statementId);
          return site ? evaluate(site.expression, site.expression.ast) : null;
        }
        if (target.kind === "parameter") {
          const context = contextForDefinition(currentPath, target.definitionStatementId);
          const instance = context
            ? sourceForDocument(context.instanceDocumentId).moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId)
            : null;
          const binding = instance?.parameterBindings.find((candidate) => candidate.parameterIndex === target.parameterIndex);
          return binding?.value?.kind === "scalar"
            ? evaluate(binding.value.expression, binding.value.expression.ast)
            : binding?.usesDefault
              ? context?.definition.parameters[target.parameterIndex]?.defaultExpression
                ? evaluate(context.definition.parameters[target.parameterIndex]!.defaultExpression!, context.definition.parameters[target.parameterIndex]!.defaultExpression!.ast)
                : null
              : null;
        }
        if (target.kind === "moduleLocal") {
          const context = contextForDefinition(currentPath, currentPath.length ? sourceForPath(currentPath).moduleSemanticAnalysis.definitionsByStatementId.keys().next().value ?? "" : "");
          const definition = sourceForPath(currentPath).moduleSemanticAnalysis.definitionsByStatementId.get(target.statementId);
          const owner = context?.definition ?? [...sourceForPath(currentPath).moduleSemanticAnalysis.definitions].find((candidate) =>
            candidate.bodyStatements.some((statement) => statement.statementId === target.statementId)
          );
          const site = owner?.bodyStatements.find((statement) => statement.statementId === target.statementId)?.scalarExpressions.find((candidate) => candidate.parameterKey === null);
          return site ? evaluate(site.expression, site.expression.ast) : definition ? null : null;
        }
        if (target.kind === "deferredModuleScalarExport") {
          const child = childContextFor(currentPath, target.instanceStatementId);
          const definition = child?.definition;
          const site = definition?.bodyStatements.find((statement) => statement.statementId === target.exportedStatementId)?.scalarExpressions.find((candidate) => candidate.parameterKey === null);
          return site ? evaluate(site.expression, site.expression.ast) : null;
        }
        return null;
      };
      switch (ast.kind) {
        case "numberLiteral": return { kind: "number", value: ast.value };
        case "stringLiteral": return { kind: "string", value: ast.value };
        case "booleanLiteral": return { kind: "boolean", value: ast.value };
        case "unresolvedChoiceLiteral": {
          const type = expression.type?.kind === "choice" ? expression.type : null;
          return type ? { kind: "choice", value: ast.raw, options: type.options } : null;
        }
        case "reference": {
          const target = reference?.target;
          if (!target) return null;
          return ["documentBinding", "parameter", "moduleLocal", "deferredModuleScalarExport"].includes(target.kind)
            ? evaluateTarget(target as ModuleScalarSourceTarget)
            : null;
        }
        case "group": return evaluate(expression, ast.expression);
        case "unary": {
          const value = evaluate(expression, ast.operand);
          if (!value) return null;
          if (ast.operator === "!" && value.kind === "boolean") return { kind: "boolean", value: !value.value };
          if ((ast.operator === "+" || ast.operator === "-") && value.kind === "number") return { kind: "number", value: ast.operator === "-" ? -value.value : value.value };
          return null;
        }
        case "binary": {
          const left = evaluate(expression, ast.left);
          const right = evaluate(expression, ast.right);
          if (!left || !right) return null;
          if ((ast.operator === "==" || ast.operator === "!=") && left.kind === right.kind) {
            const equal = left.kind === "choice" && right.kind === "choice"
              ? left.value === right.value && left.options.join("\u0000") === right.options.join("\u0000")
              : left.value === right.value;
            return { kind: "boolean", value: ast.operator === "==" ? equal : !equal };
          }
          if (left.kind === "boolean" && right.kind === "boolean" && (ast.operator === "&&" || ast.operator === "||")) {
            return { kind: "boolean", value: ast.operator === "&&" ? left.value && right.value : left.value || right.value };
          }
          if (left.kind === "number" && right.kind === "number") {
            const value = ast.operator === "+" ? left.value + right.value : ast.operator === "-" ? left.value - right.value : ast.operator === "*" ? left.value * right.value : ast.operator === "/" ? left.value / right.value : null;
            if (value !== null) return { kind: "number", value };
          }
          return null;
        }
        case "valueIf": {
          const condition = evaluate(expression, ast.condition);
          if (!condition || condition.kind !== "boolean") return null;
          return evaluate(expression, condition.value ? ast.thenBranch : ast.elseBranch);
        }
        case "valueMatch": {
          const scrutinee = evaluate(expression, ast.scrutinee);
          if (!scrutinee || scrutinee.kind !== "choice") return null;
          const arm = ast.arms.find((candidate) => candidate.label === scrutinee.value);
          return arm ? evaluate(expression, arm.expression) : null;
        }
        case "call": {
          if (ast.name !== "hasValue") return null;
          const parameter = expression.hasValueParameters.find((candidate) => candidate.span.start === ast.span.start);
          if (!parameter) return null;
          const context = contextForDefinition(currentPath, parameter.definitionStatementId);
          const instance = context
            ? sourceForDocument(context.instanceDocumentId).moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId)
            : null;
          const binding = instance?.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
          return { kind: "boolean", value: binding?.state === "optionalSupplied" || binding?.state === "requiredSupplied" };
        }
        default: return null;
      }
    };
    return evaluate(semantic, semantic.ast);
  };

  const arrayExportSemantic = (currentPath: readonly string[], instanceStatementId: string, exportName: string) => {
    const childContext = childContextFor(currentPath, instanceStatementId);
    if (!childContext) return null;
    const childPath = childContext.path;
    const childSource = sourceForDocument(childContext.definitionDocumentId);
    const exported = arrayExportsForSource(childSource).get(childContext.definitionStatementId)?.get(exportName) ?? null;
    return exported ? { childPath, childContext, exported } : null;
  };

  const singularTargetFor = (target: GeometryArraySourceTarget, currentPath: readonly string[]) => {
    if (target.kind === "moduleParameter") {
      return {
        kind: "parameter" as const,
        definitionStatementId: target.definitionStatementId,
        parameterIndex: target.parameterIndex,
        geometryKind: target.interfaceType === "point" ? "point" as const : "line" as const
      };
    }
    if (target.kind === "geometryValue") {
      return {
        kind: "geometryValue" as const,
        statementId: target.statementId,
        statementIndex: target.statementIndex,
        declaredInterfaceType: target.interfaceType,
        backingTarget: null,
        ...(target.pointKey ? { pointKey: target.pointKey } : {})
      };
    }
    if (target.kind !== "geometry") return null;
    const statement = sourceForPath(currentPath).statements[target.statementIndex];
    if (statement?.kind !== "element" || !isGeometryDeclarationCategory(statement.category)) return null;
    return {
      kind: "sourceGeometry" as const,
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      category: statement.category,
      geometryKind: target.interfaceType === "point" ? "point" as const : "line" as const
    };
  };

  const sourceValueCache = new Map<string, RuntimeArrayValue | null>();
  const parameterValueCache = new Map<string, RuntimeArrayValue | null>();
  const cacheKey = (path: readonly string[], id: string) => `${pathKey(path)}:${id}`;

  const lowerArrayExport = (
    currentPath: readonly string[],
    instanceStatementId: string,
    exportName: string,
    visited: ReadonlySet<string>
  ): RuntimeResult => {
    const entry = arrayExportSemantic(currentPath, instanceStatementId, exportName);
    if (!entry) return { value: null, actualType: null };
    return {
      value: lowerSemantic(entry.exported, entry.childPath, visited),
      actualType: entry.exported.type
    };
  };

  const lowerParameter = (
    currentPath: readonly string[],
    definitionStatementId: string,
    parameterIndex: number,
    visited: ReadonlySet<string>
  ): RuntimeArrayValue | null => {
    const context = contextForDefinition(currentPath, definitionStatementId);
    if (!context) return null;
    const key = cacheKey(context.path, parameterValueId(definitionStatementId, parameterIndex));
    if (parameterValueCache.has(key)) return parameterValueCache.get(key) ?? null;
    const instanceSource = sourceForDocument(context.instanceDocumentId);
    const definitionSource = sourceForPath(context.path);
    const instance = instanceSource.moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId);
    const binding = instance?.parameterBindings.find((candidate) => candidate.parameterIndex === parameterIndex);
    const parameter = definitionSource.analysis?.moduleParametersBySlot.get(`${definitionStatementId}:${parameterIndex}`);
    if (!instance || !binding || !parameter || binding.argumentIndex === null || binding.state === "optionalOmitted" || binding.state === "requiredOmitted") {
      parameterValueCache.set(key, null);
      return null;
    }
    const statement = instanceSource.statements[instance.statementIndex];
    if (statement?.kind !== "moduleInstance") {
      parameterValueCache.set(key, null);
      return null;
    }
    const argument = statement.arguments[binding.argumentIndex];
    if (!argument) {
      parameterValueCache.set(key, null);
      return null;
    }
    const parsed = parseGeometryArrayExpression(argument.value);
    for (const issue of parsed.diagnostics) {
      addDiagnostic(runtimeDiagnostic(
        statement,
        { start: argument.valueSpan.start + issue.span.start, end: argument.valueSpan.start + issue.span.end },
        issue.code,
        issue.message
      ));
    }
    if (!parsed.expression || parsed.diagnostics.length) {
      parameterValueCache.set(key, null);
      return null;
    }

    const callerPath = context.path.slice(0, -1);
    let value: RuntimeArrayValue | null = null;
    if (parsed.expression.kind === "reference") {
      const resolved = resolveWholeReference(argument.value, instance.statementIndex, callerPath, visited);
      if (resolved.actualType && !isGeometryArrayTypeAssignable(resolved.actualType, parameter.type)) {
        addDiagnostic(runtimeDiagnostic(
          statement,
          argument.valueSpan,
          "geometry-array-assignability-mismatch",
          `geometry array argument「${parameter.name}」の型が一致しません。`,
          { actual: resolved.actualType ? geometryArrayTypeName(resolved.actualType) : "unknown", expected: geometryArrayTypeName(parameter.type) }
        ));
      } else if (resolved.value) {
        value = { type: parameter.type, members: resolved.value.members };
      }
    } else if (parsed.expression.kind === "literal") {
      const members: RuntimeArrayMember[] = [];
      for (const member of parsed.expression.members) {
        const span = { start: argument.valueSpan.start + member.span.start, end: argument.valueSpan.start + member.span.end };
        const coordinate = coordinateMember(member.text);
        if (coordinate) {
          const actual: GeometryArrayType = { kind: "geometryArray", elementType: "point" };
          if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
          addDiagnostic(runtimeDiagnostic(
            statement,
            span,
            "geometry-array-member-type-mismatch",
            `geometry array argument「${parameter.name}」に point を渡せません。`,
            { member: member.text, expected: geometryArrayTypeName(parameter.type), actual: "point" }
          ));
          } else members.push({ interfaceType: "point", alias: null, anchor: coordinateAnchor(coordinate) ?? undefined });
          continue;
        }
        const sourceReference = parsedSourceReference(member.text);
        if (!sourceReference) {
          addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-invalid-member", "geometry array member は geometry reference または coordinate point で指定してください。"));
          continue;
        }
        const path = parseDslReferenceToken(sourceReference.pathText);
        if (path.segments.length === 0) {
          addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-invalid-member", "geometry array member の参照が不正です。"));
          continue;
        }
        const pointKey = sourceReference.property;
        if (pointKey && parameter.type.elementType !== "point") {
          addDiagnostic(runtimeDiagnostic(
            statement,
            span,
            "geometry-array-member-type-mismatch",
            "derived point reference は point[] の member としてのみ使用できます。",
            { member: member.text, expected: "point[]", actual: parameter.type.elementType }
          ));
          continue;
        }

        const ownerIndex = moduleOwnerIndexOf(instanceSource.statements, instance.statementIndex);
        if (path.segments.length === 1 && !path.absolute && ownerIndex !== null) {
          const owner = instanceSource.statements[ownerIndex];
          if (owner?.kind === "moduleDefinition") {
            const parameterIndexInOwner = owner.parameters.findIndex((candidate) => candidate.name === path.segments[0]);
            if (parameterIndexInOwner >= 0) {
              const ownerParameter = owner.parameters[parameterIndexInOwner]!;
              const nestedArray = geometryArrayTypeOfModuleParameter(ownerParameter);
              if (nestedArray) {
                addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-nested-array", "geometry array を literal member として入れ子にすることはできません。"));
                continue;
              }
              const interfaceType = moduleGeometryInterfaceTypeOf(ownerParameter.type);
              const ownerDefinitionId = instanceSource.stableStatementIdByIndex.get(ownerIndex);
              if (interfaceType && ownerDefinitionId) {
                if (pointKey && ((interfaceType !== "line" && interfaceType !== "path") || !isLineEndpointPointKey(pointKey))) {
                  addDiagnostic(runtimeDiagnostic(
                    statement,
                    span,
                    "geometry-array-member-type-mismatch",
                    `geometry parameter「${path.segments[0]}」の derived point「${pointKey}」を point[] member として解決できません。`,
                    { member: member.text, expected: "point[]", actual: `derived point ${pointKey}` }
                  ));
                  continue;
                }
                const memberInterfaceType: ModuleGeometryInterfaceType = pointKey ? "point" : interfaceType;
                const actual: GeometryArrayType = { kind: "geometryArray", elementType: memberInterfaceType };
                if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
                  addDiagnostic(runtimeDiagnostic(
                    statement,
                    span,
                    "geometry-array-member-type-mismatch",
                    `geometry array argument「${parameter.name}」の member 型が一致しません。`,
                    { member: member.text, expected: geometryArrayTypeName(parameter.type), actual: geometryArrayTypeName(actual) }
                  ));
                  continue;
                }
                const baseAlias = sourceAliasForTarget({
                  kind: "parameter",
                  definitionStatementId: ownerDefinitionId,
                  parameterIndex: parameterIndexInOwner,
                  geometryKind: interfaceType === "point" ? "point" : "line"
                }, callerPath, contextsByPath, moduleMaterialization, exportsByPath);
                const alias = aliasWithPointKey(baseAlias, pointKey);
                members.push({
                  interfaceType: memberInterfaceType,
                  alias,
                  ...(pointAnchorForAlias(alias) ? { anchor: pointAnchorForAlias(alias) } : {})
                });
                continue;
              }
            }
          }
        }

        const lookup = resolveSourceLexicalPath(instanceSource.sourceNamespace, instance.statementIndex, path);
        if (lookup.kind === "resolved") {
          const interfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
          if (!interfaceType) {
            addDiagnostic(runtimeDiagnostic(
              statement,
              span,
              "geometry-array-member-not-geometry",
              `参照先「${member.text}」は geometry value ではありません。`,
              { member: member.text }
            ));
            continue;
          }
          const sourceStatement = lookup.declaration.statement;
          if (sourceStatement.kind !== "element" || !isGeometryDeclarationCategory(sourceStatement.category)) continue;
          if (pointKey && !isDerivedPointKeyForGeometryCategory(sourceStatement.category, pointKey)) {
            addDiagnostic(runtimeDiagnostic(
              statement,
              span,
              "geometry-array-member-type-mismatch",
              `derived point「${pointKey}」を参照先「${sourceReference.pathText}」から解決できません。`,
              { member: member.text, expected: "point[]", actual: `derived point ${pointKey}` }
            ));
            continue;
          }
          const memberInterfaceType: ModuleGeometryInterfaceType = pointKey ? "point" : interfaceType;
          const actual: GeometryArrayType = { kind: "geometryArray", elementType: memberInterfaceType };
          if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
            addDiagnostic(runtimeDiagnostic(
              statement,
              span,
              "geometry-array-member-type-mismatch",
              `geometry array argument「${parameter.name}」の member 型が一致しません。`,
              { member: member.text, expected: geometryArrayTypeName(parameter.type), actual: geometryArrayTypeName(actual) }
            ));
            continue;
          }
          const baseAlias = sourceAliasForTarget({
            kind: "sourceGeometry",
            statementId: lookup.declaration.statementId,
            statementIndex: lookup.declaration.statementIndex,
            category: sourceStatement.category,
            geometryKind: interfaceType === "point" ? "point" : "line"
          }, callerPath, contextsByPath, moduleMaterialization, exportsByPath);
          const alias = aliasWithPointKey(baseAlias, pointKey);
          members.push({
            interfaceType: memberInterfaceType,
            alias,
            ...(pointAnchorForAlias(alias) ? { anchor: pointAnchorForAlias(alias) } : {})
          });
          continue;
        }
        if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
          const child = childContextFor(callerPath, lookup.declaration.statementId);
          const exportEntry = child ? exportsByPath.get(pathKey(child.path))?.get(path.segments[1]!) : undefined;
          if (!exportEntry) {
            addDiagnostic(runtimeDiagnostic(
              statement,
              span,
              "module-undefined-export",
              `module export「${path.segments[1]}」が見つかりません。`,
              { target: path.segments[1]! }
            ));
            continue;
          }
          const exportedStatement = sourceForPath(callerPath).statements[exportEntry.exported.exportedStatementIndex];
          const interfaceType = moduleGeometryInterfaceTypeOfElement(exportedStatement);
          if (!interfaceType) continue;
          if (pointKey && (exportedStatement?.kind !== "element" || !isGeometryDeclarationCategory(exportedStatement.category) || !isDerivedPointKeyForGeometryCategory(exportedStatement.category, pointKey))) {
            addDiagnostic(runtimeDiagnostic(
              statement,
              span,
              "geometry-array-member-type-mismatch",
              `module export「${path.segments[1]}」の derived point「${pointKey}」を解決できません。`,
              { member: member.text, expected: "point[]", actual: `derived point ${pointKey}` }
            ));
            continue;
          }
          const memberInterfaceType: ModuleGeometryInterfaceType = pointKey ? "point" : interfaceType;
          const actual: GeometryArrayType = { kind: "geometryArray", elementType: memberInterfaceType };
          if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
            addDiagnostic(runtimeDiagnostic(
              statement,
              span,
              "geometry-array-member-type-mismatch",
              `geometry array argument「${parameter.name}」の member 型が一致しません。`,
              { member: member.text, expected: geometryArrayTypeName(parameter.type), actual: geometryArrayTypeName(actual) }
            ));
            continue;
          }
          const alias = aliasWithPointKey(exportEntry.alias, pointKey);
          members.push({
            interfaceType: memberInterfaceType,
            alias,
            ...(pointAnchorForAlias(alias) ? { anchor: pointAnchorForAlias(alias) } : {})
          });
          continue;
        }
        addDiagnostic(runtimeDiagnostic(
          statement,
          span,
          "geometry-array-member-unresolved",
          `未解決の geometry array member です: ${member.text}`,
          { member: member.text }
        ));
      }
      if (members.length === parsed.expression.members.length) value = { type: parameter.type, members };
    } else {
      addDiagnostic(runtimeDiagnostic(
        statement,
        argument.valueSpan,
        "geometry-array-value-for-unsupported",
        "geometry array parameter では scalar value-for を使用できません。"
      ));
    }

    parameterValueCache.set(key, value);
    return value;
  };

  function lowerSemantic(
    semantic: GeometryArrayValueSemantic,
    currentPath: readonly string[],
    visited: ReadonlySet<string>
  ): RuntimeArrayValue | null {
    const key = cacheKey(currentPath, semantic.statementId);
    if (sourceValueCache.has(key)) return sourceValueCache.get(key) ?? null;
    if (!semantic.value || visited.has(key)) return null;
    const nextVisited = new Set([...visited, key]);

    if (semantic.value.kind === "literal") {
      const members: RuntimeArrayMember[] = semantic.value.members.map((member) => {
        if (member.target.kind === "coordinate") {
          return {
            interfaceType: member.interfaceType,
            alias: null,
            ...(coordinateAnchor(member.target.source) ? { anchor: coordinateAnchor(member.target.source)! } : {})
          };
        }
        const target = singularTargetFor(member.target, currentPath);
        const alias = target
          ? aliasWithPointKey(
            sourceAliasForTarget(target, currentPath, contextsByPath, moduleMaterialization, exportsByPath),
            member.target.pointKey ?? null
          )
          : undefined;
        return {
          interfaceType: member.interfaceType,
          alias: alias ?? null,
          ...(pointAnchorForAlias(alias) ? { anchor: pointAnchorForAlias(alias) } : {})
        };
      });
      const value = { type: semantic.type, members };
      sourceValueCache.set(key, value);
      return value;
    }

    if (semantic.value.kind === "map") {
      const mappedValue = semantic.value;
      const sourceValue = lowerValueById(mappedValue.sourceValueId, currentPath, nextVisited);
      const sourceAliases = sourceValue ? aliasesFor(sourceValue) : null;
      if (!sourceAliases) {
        sourceValueCache.set(key, null);
        return null;
      }
      const mappedMembers: RuntimeArrayMember[] = sourceAliases.map((sourceAlias, memberIndex) => {
        const resultInterfaceType = mappedValue.resultElementType;
        const mappedAlias: GeometryAlias = {
          kind: "mappedValue",
          occurrence: {
            sourceStatementId: semantic.statementId,
            instancePath: [...currentPath],
            mappedMemberIndex: memberIndex
          },
          geometryType: resultInterfaceType === "point" ? "point" : "line",
          interfaceType: resultInterfaceType,
          source: sourceAlias,
          mapValueId: semantic.statementId,
          binderId: mappedValue.binderId,
          executionPosition: semantic.statementIndex
        };
        return {
          interfaceType: resultInterfaceType,
          alias: mappedAlias,
          ...(pointAnchorForAlias(mappedAlias) ? { anchor: pointAnchorForAlias(mappedAlias) } : {})
        };
      });
      const value = { type: semantic.type, members: mappedMembers };
      sourceValueCache.set(key, value);
      return value;
    }

    if (semantic.value.kind === "if") {
      const condition = semantic.value.condition
        ? evaluateCollectionControlFlowScalar(semantic.value.condition, currentPath)
        : null;
      if (!condition || condition.kind !== "boolean") {
        sourceValueCache.set(key, null);
        return null;
      }
      const selected = condition.value ? semantic.value.thenValue : semantic.value.elseValue;
      const selectedSemantic: GeometryArrayValueSemantic = {
        ...semantic,
        value: selected
      };
      const value = lowerSemantic(selectedSemantic, currentPath, visited);
      sourceValueCache.set(key, value);
      return value;
    }
    if (semantic.value.kind === "match") {
      const scrutinee = semantic.value.scrutinee
        ? evaluateCollectionControlFlowScalar(semantic.value.scrutinee, currentPath)
        : null;
      if (!scrutinee || scrutinee.kind !== "choice") {
        sourceValueCache.set(key, null);
        return null;
      }
      const selected = semantic.value.arms.find((arm) => arm.label === scrutinee.value)?.value;
      if (!selected) {
        sourceValueCache.set(key, null);
        return null;
      }
      const selectedSemantic: GeometryArrayValueSemantic = {
        ...semantic,
        value: selected
      };
      const value = lowerSemantic(selectedSemantic, currentPath, visited);
      sourceValueCache.set(key, value);
      return value;
    }

    const currentSource = sourceForPath(currentPath);
    const currentAnalysis = currentSource.analysis;
    if (!currentAnalysis) {
      sourceValueCache.set(key, null);
      return null;
    }
    const targetSemantic = currentAnalysis.valuesByStatementId.get(semantic.value.targetValueId);
    if (targetSemantic) {
      if (
        semantic.ownerModuleDefinitionStatementIndex !== null &&
        targetSemantic.ownerModuleDefinitionStatementIndex !== semantic.ownerModuleDefinitionStatementIndex
      ) {
        const statement = currentSource.statements[semantic.statementIndex];
        if (statement) addDiagnostic(runtimeDiagnostic(statement, semantic.value.sourceSpan, "module-array-outer-capture", "module body から outer geometry array を暗黙 capture できません。"));
        sourceValueCache.set(key, null);
        return null;
      }
      const targetValue = lowerSemantic(targetSemantic, currentPath, nextVisited);
      const value = targetValue ? { type: semantic.type, members: targetValue.members } : null;
      sourceValueCache.set(key, value);
      return value;
    }

    const parameter = parameterSlotFromValueId(currentAnalysis, semantic.value.targetValueId);
    if (parameter) {
      const parameterValue = lowerParameter(currentPath, parameter.definitionStatementId, parameter.parameterIndex, nextVisited);
      const value = parameterValue ? { type: semantic.type, members: parameterValue.members } : null;
      sourceValueCache.set(key, value);
      return value;
    }

    const deferred = parseGeometryArrayDeferredModuleExportId(semantic.value.targetValueId);
    if (deferred) {
      const resolved = lowerArrayExport(currentPath, deferred.instanceStatementId, deferred.exportName, nextVisited);
      const statement = currentSource.statements[semantic.statementIndex];
      if (!resolved.actualType) {
        if (statement) addDiagnostic(runtimeDiagnostic(
          statement,
          semantic.value.sourceSpan,
          "module-undefined-export",
          `module geometry array export「${deferred.exportName}」が見つかりません。`,
          { target: deferred.exportName }
        ));
        sourceValueCache.set(key, null);
        return null;
      }
      if (!isGeometryArrayTypeAssignable(resolved.actualType, semantic.type)) {
        if (statement) addDiagnostic(runtimeDiagnostic(
          statement,
          semantic.value.sourceSpan,
          "geometry-array-assignability-mismatch",
          `module geometry array export「${deferred.exportName}」の型が一致しません。`,
          { actual: geometryArrayTypeName(resolved.actualType), expected: geometryArrayTypeName(semantic.type) }
        ));
        sourceValueCache.set(key, null);
        return null;
      }
      const value = resolved.value ? { type: semantic.type, members: resolved.value.members } : null;
      sourceValueCache.set(key, value);
      return value;
    }

    sourceValueCache.set(key, null);
    return null;
  }

  const lowerValueById = (
    valueId: string,
    currentPath: readonly string[],
    visited: ReadonlySet<string>
  ): RuntimeArrayValue | null => {
    const source = sourceForPath(currentPath);
    const semantic = source.analysis?.valuesByStatementId.get(valueId);
    if (semantic) return lowerSemantic(semantic, currentPath, visited);
    const parameter = source.analysis ? parameterSlotFromValueId(source.analysis, valueId) : null;
    if (parameter) return lowerParameter(currentPath, parameter.definitionStatementId, parameter.parameterIndex, visited);
    const deferred = parseGeometryArrayDeferredModuleExportId(valueId);
    if (deferred) return lowerArrayExport(currentPath, deferred.instanceStatementId, deferred.exportName, visited).value;
    return null;
  };

  function resolveWholeReference(
    source: string,
    statementIndex: number,
    currentPath: readonly string[],
    visited: ReadonlySet<string>
  ): RuntimeResult {
    const path = referencePath(source);
    if (!path || path.segments.length === 0) return { value: null, actualType: null };
    const runtimeSource = sourceForPath(currentPath);
    const ownerIndex = moduleOwnerIndexOf(runtimeSource.statements, statementIndex);
    if (path.segments.length === 1 && !path.absolute && ownerIndex !== null) {
      const owner = runtimeSource.statements[ownerIndex];
      const definitionId = runtimeSource.stableStatementIdByIndex.get(ownerIndex);
      if (owner?.kind === "moduleDefinition" && definitionId) {
        const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === path.segments[0]);
        if (parameterIndex >= 0) {
          const parameterType = geometryArrayTypeOfModuleParameter(owner.parameters[parameterIndex]!);
          if (parameterType) {
            return {
              value: lowerParameter(currentPath, definitionId, parameterIndex, visited),
              actualType: parameterType
            };
          }
        }
      }
    }

    const lookup = resolveSourceLexicalPath(runtimeSource.sourceNamespace, statementIndex, path);
    if (lookup.kind === "resolved") {
      const semantic = runtimeSource.analysis?.valuesByStatementIndex.get(lookup.declaration.statementIndex);
      return semantic
        ? { value: lowerSemantic(semantic, currentPath, visited), actualType: semantic.type }
        : { value: null, actualType: null };
    }
    if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
      return lowerArrayExport(currentPath, lookup.declaration.statementId, path.segments[1]!, visited);
    }
    return { value: null, actualType: null };
  }

  // Validate supplied array parameter arguments once per concrete instance and
  // deferred export aliases once per reachable instance path. This keeps
  // source diagnostics independent from whether a particular list consumer
  // happens to execute.
  for (const context of contextsByPath.values()) {
    const contextSource = sourceForPath(context.path);
    const contextAnalysis = contextSource.analysis;
    if (!contextAnalysis) continue;
    const parameters = contextAnalysis.moduleParameters.filter((parameter) => parameter.definitionStatementId === context.definitionStatementId);
    for (const parameter of parameters) lowerParameter(context.path, parameter.definitionStatementId, parameter.parameterIndex, new Set());
    for (const semantic of contextAnalysis.values) {
      if (semantic.ownerModuleDefinitionStatementIndex === context.definition.statementIndex) lowerSemantic(semantic, context.path, new Set());
    }
  }
  for (const semantic of rootSource.analysis?.values ?? []) {
    if (semantic.ownerModuleDefinitionStatementIndex === null) lowerSemantic(semantic, [], new Set());
  }

  const resolveLineReferenceList = (token: string, statementIndex: number, currentPath: readonly string[]) => {
    const resolved = resolveWholeReference(token, statementIndex, currentPath, new Set());
    if (!resolved.value || resolved.value.type.elementType === "point") return null;
    const ids: ElementId[] = [];
    for (const member of resolved.value.members) {
      if (!isModuleGeometryInterfaceAssignable(member.interfaceType, "path") || member.alias?.kind !== "line") return null;
      ids.push(member.alias.elementId);
    }
    return ids;
  };

  const pointAnchorsFor = (value: RuntimeArrayValue): readonly PointAnchor[] | null => {
    if (value.type.elementType !== "point") return null;
    const anchors: PointAnchor[] = [];
    for (const member of value.members) {
      if (member.interfaceType !== "point" || !member.anchor) return null;
      anchors.push(member.anchor);
    }
    return anchors;
  };

  const resolvePointReferenceList = (token: string, statementIndex: number, currentPath: readonly string[]) => {
    const resolved = resolveWholeReference(token, statementIndex, currentPath, new Set());
    if (resolved.value) return pointAnchorsFor(resolved.value);

    const parsed = parseGeometryArrayExpression(token);
    if (!parsed.expression || parsed.diagnostics.length || parsed.expression.kind !== "literal") return null;
    const anchors: PointAnchor[] = [];
    for (const member of parsed.expression.members) {
      const coordinate = coordinateAnchor(member.text);
      if (coordinate) {
        anchors.push(coordinate);
        continue;
      }
      const path = referencePath(member.text);
      if (!path || path.segments.length === 0) return null;
      const sourceReference = parsedSourceReference(member.text);
      const pointKey = sourceReference?.property ?? null;
      const runtimeSource = sourceForPath(currentPath);
      const ownerIndex = moduleOwnerIndexOf(runtimeSource.statements, statementIndex);
      let alias: GeometryAlias | null = null;
      if (path.segments.length === 1 && !path.absolute && ownerIndex !== null) {
        const owner = runtimeSource.statements[ownerIndex];
        const definitionId = runtimeSource.stableStatementIdByIndex.get(ownerIndex);
        if (owner?.kind === "moduleDefinition" && definitionId) {
          const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === path.segments[0]);
          if (parameterIndex >= 0 && !geometryArrayTypeOfModuleParameter(owner.parameters[parameterIndex]!)) {
            const interfaceType = moduleGeometryInterfaceTypeOf(owner.parameters[parameterIndex]!.type);
            if (interfaceType) {
              const baseAlias = sourceAliasForTarget({
                kind: "parameter",
                definitionStatementId: definitionId,
                parameterIndex,
                geometryKind: interfaceType === "point" ? "point" : "line"
              }, currentPath, contextsByPath, moduleMaterialization, exportsByPath);
              alias = aliasWithPointKey(baseAlias, pointKey);
            }
          }
        }
      }
      if (!alias) {
        const lookup = resolveSourceLexicalPath(runtimeSource.sourceNamespace, statementIndex, path);
        if (lookup.kind === "resolved") {
          const sourceStatement = lookup.declaration.statement;
          const interfaceType = moduleGeometryInterfaceTypeOfElement(sourceStatement);
          if (sourceStatement.kind === "element" && isGeometryDeclarationCategory(sourceStatement.category) && interfaceType) {
            if (!pointKey || isDerivedPointKeyForGeometryCategory(sourceStatement.category, pointKey)) {
              const baseAlias = sourceAliasForTarget({
                kind: "sourceGeometry",
                statementId: lookup.declaration.statementId,
                statementIndex: lookup.declaration.statementIndex,
                category: sourceStatement.category,
                geometryKind: interfaceType === "point" ? "point" : "line"
              }, currentPath, contextsByPath, moduleMaterialization, exportsByPath);
              alias = aliasWithPointKey(baseAlias, pointKey);
            }
          }
        } else if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
          const child = childContextFor(currentPath, lookup.declaration.statementId);
          const exportEntry = child ? exportsByPath.get(pathKey(child.path))?.get(path.segments[1]!) : undefined;
          if (exportEntry) alias = aliasWithPointKey(exportEntry.alias, pointKey);
        }
      }
      if (alias?.kind !== "point") return null;
      anchors.push(alias.anchor);
    }
    return anchors;
  };

  const indexedSource = (token: string) => {
    const parsed = parseScalarExpression(token, { start: 0, end: token.length });
    return parsed.ast?.kind === "collectionIndex" && parsed.ast.index.kind === "numberLiteral"
      ? { base: `@${parsed.ast.name}`, index: parsed.ast.index.value }
      : null;
  };

  function aliasesFor(value: RuntimeArrayValue): Array<Exclude<GeometryAlias, { kind: "collectionIndex" }>> | null {
    if (value.members.some((member) => member.alias?.kind === "collectionIndex")) return null;
    return value.members.flatMap((member) => {
      if (member.alias) return [member.alias as Exclude<GeometryAlias, { kind: "collectionIndex" }>];
      return member.anchor ? [{ kind: "point" as const, anchor: member.anchor }] : [];
    }).length === value.members.length
      ? value.members.map((member) => (member.alias ?? { kind: "point" as const, anchor: member.anchor! }) as Exclude<GeometryAlias, { kind: "collectionIndex" }>)
      : null;
  }

  const resolveGeometryArrayAliasesForValueId = (valueId: string, currentPath: readonly string[]) => {
    const value = lowerValueById(valueId, currentPath, new Set());
    return value ? aliasesFor(value) : null;
  };

  const indexedTargetFor = (
    target: Extract<ModuleGeometryReferenceSemantic["target"], { kind: "collectionIndex" }> | undefined,
    resolved: RuntimeArrayValue | null,
    expectedGeometryKind: "point" | "line",
    currentPath: readonly string[]
  ): PointAnchor | RuntimeGeometryInputTarget | null => {
    if (!target || !resolved) return null;
    const aliases = aliasesFor(resolved);
    if (!aliases) return null;
    if (target.index.ast.kind === "numberLiteral") {
      const member = aliases[target.index.ast.value];
      return member
        ? expectedGeometryKind === "point"
          ? member.kind === "mappedValue"
            ? geometryInputTargetForAlias(member)
            : pointAnchorForAlias(member) ?? null
          : geometryInputTargetForAlias(member)
        : null;
    }
    if (expectedGeometryKind === "line" && aliases.some((alias) => alias.kind === "point")) return null;
    const members = aliases.flatMap((alias) => {
      const lowered = geometryInputTargetForAlias(alias);
      return lowered ? [lowered] : [];
    });
    return members.length === aliases.length
      ? {
          kind: "collectionIndex",
          target,
          members: aliases,
          currentPath
        } satisfies GeometryInputTargetSource
      : null;
  };

  const resolveLineReferenceTargetAt = (token: string, statementIndex: number, currentPath: readonly string[], target?: ModuleGeometryReferenceSemantic["target"]) => {
    if (target?.kind === "collectionIndex") {
      const resolved = resolveWholeReference(target.source, statementIndex, currentPath, new Set());
      const indexed = indexedTargetFor(target, resolved.value, "line", currentPath);
      return indexed && "kind" in indexed ? indexed : null;
    }
    const indexed = indexedSource(token);
    if (!indexed || !Number.isInteger(indexed.index) || indexed.index < 0) return null;
    const resolved = resolveWholeReference(indexed.base, statementIndex, currentPath, new Set());
    const member = resolved.value?.members[indexed.index];
    if (!member || !isModuleGeometryInterfaceAssignable(member.interfaceType, "path") || !member.alias) return null;
    if (member.alias.kind === "line") {
      return { kind: "drawable" as const, elementId: member.alias.elementId, geometryType: "line" as const };
    }
    if (member.alias.kind === "value" && member.alias.geometryType === "line") {
      return {
        kind: "geometryValue" as const,
        occurrence: member.alias.occurrence,
        geometryType: member.alias.interfaceType === "path" ? "path" as const : "line" as const
      };
    }
    return null;
  };

  const resolvePointReferenceAt = (token: string, statementIndex: number, currentPath: readonly string[], target?: ModuleGeometryReferenceSemantic["target"]): PointAnchor | RuntimeGeometryInputTarget | null => {
    if (target?.kind === "collectionIndex") {
      const resolved = resolveWholeReference(target.source, statementIndex, currentPath, new Set());
      const indexed = indexedTargetFor(target, resolved.value, "point", currentPath);
      if (!indexed) return null;
      return "target" in indexed || "mode" in indexed || "kind" in indexed ? indexed : null;
    }
    const indexed = indexedSource(token);
    if (!indexed || !Number.isInteger(indexed.index) || indexed.index < 0) return null;
    const resolved = resolveWholeReference(indexed.base, statementIndex, currentPath, new Set());
    const anchors = resolved.value ? pointAnchorsFor(resolved.value) : null;
    return anchors?.[indexed.index] ?? null;
  };

  const acceptsDeferredLineListExport = (reference: ModuleGeometryReferenceSemantic, currentPath: readonly string[]) => {
    if (reference.role !== "lineReferenceList" || reference.target?.kind !== "deferredModuleExport") return false;
    const exported = arrayExportSemantic(currentPath, reference.target.instanceStatementId, reference.target.exportName)?.exported;
    return Boolean(exported && exported.type.elementType !== "point");
  };

  return {
    diagnostics,
    resolveLineReferenceList,
    resolvePointReferenceList,
    resolveLineReferenceTargetAt,
    resolvePointReferenceAt,
    acceptsDeferredLineListExport,
    resolveGeometryArrayAliasesForValueId
  };
};
