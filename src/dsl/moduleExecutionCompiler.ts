import { createCadElement } from "../model/elementFactory";
import { createNameIndex, resolveId } from "./dslReferences";
import { isCompilableDslStatement } from "./dslCompilationGuard";
import { parseElementActivityLiteral } from "./dslActivity";
import type {
  ElementNameContext } from "../model/elementNames";
import type { NameIndex } from "./dslReferences";
import type {
  CompileDslContext,
  CompileDslResult,
  DslAttribute,
  DslDiagnostic,
  DslStatement
} from "./dslTypes";
import type {
  CadElement,
  Layout,
  PrintOutput,
  SvgOutput,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import type { DslMajorVersion } from "./dslVersion";
import type { MaterializedExecutionStatement, ModuleMaterialization } from "./moduleMaterialization";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import type { DslGeometryResolverOverrides } from "./dslApplyArgs";

type ApplyStatement = (
  element: CadElement,
  statement: DslStatement,
  index: NameIndex,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[],
  nameContext: ElementNameContext,
  visibilityRoles?: VisibilityRole[],
  majorVersion?: DslMajorVersion,
  geometryResolvers?: DslGeometryResolverOverrides,
  statementIndex?: number
) => CadElement;

type BuildSourceOutputModel = (input: {
  statements: DslStatement[];
  elements: CadElement[];
  nameIndex: NameIndex;
  sourceNamespace?: import("./sourceLexicalNamespaceIndex").SourceLexicalNamespaceIndex;
  elementIdByStatementIndex: ReadonlyMap<number, string>;
  stableStatementIdByIndex?: ReadonlyMap<number, string>;
  diagnostics: DslDiagnostic[];
  includeStatement: (statement: DslStatement, statementIndex: number) => boolean;
}) => {
  layouts: Layout[];
  printOutputs: PrintOutput[];
  svgOutputs: SvgOutput[];
  layoutIdsByStatementIndex: Map<number, string>;
  outputIdsByStatementIndex: Map<number, string>;
};

type MaterializedVisibilitySettings = {
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId?: string;
  layouts?: Layout[];
  printOutputs?: PrintOutput[];
  svgOutputs?: SvgOutput[];
};

const attr = (attrs: DslAttribute[], key: string) => attrs.find((item) => item.key === key)?.value;

const warning = (line: number, message: string): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  message
});

const moduleInstanceActivity = (entry: MaterializedExecutionStatement) => {
  if (entry.statement.kind !== "moduleInstance") return undefined;
  const state = entry.statement.options.find((option) => option.name === "state");
  return state ? parseElementActivityLiteral(state.value) ?? "visible" : "visible";
};

/** Compile a materialized execution plan through the ordinary element path. */
export const compileMaterializedExecution = ({
  statements,
  context,
  diagnostics,
  visibilitySettings,
  buildSourceOutputModel,
  materialization,
  moduleGeometryRuntime,
  applyStatement
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
  visibilitySettings: MaterializedVisibilitySettings;
  materialization: ModuleMaterialization;
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  applyStatement: ApplyStatement;
  buildSourceOutputModel: BuildSourceOutputModel;
}): CompileDslResult => {
  const documentMode = context.mode === "document";
  const existing = documentMode ? [] : context.elements;
  const executionStatements = materialization.executionStatements;
  const createBase = (entry: MaterializedExecutionStatement) => {
    const base = createCadElement(entry.type, existing, { createId: () => entry.runtimeElementId });
    const name = entry.statement.name || (entry.type === "moduleInstance" ? base.name : "");
    return {
      ...base,
      name,
      ...(entry.parentGroupId ? { parentGroupId: entry.parentGroupId } : {}),
      ...(entry.conditionalBranch ? { conditionalBranch: entry.conditionalBranch } : {}),
      ...(entry.type === "moduleInstance" ? { activity: moduleInstanceActivity(entry) ?? base.activity } : {})
    } as CadElement;
  };

  let placeholderElements = executionStatements.map(createBase);
  const scopeKeyOf = (entry: MaterializedExecutionStatement) => {
    // Root module instances are opaque containers in the caller namespace.
    // Their body children belong only to the instance-local scope below.
    if (entry.instancePath.length === 0 || (
      entry.origin?.kind === "moduleInstance" &&
      entry.origin.callerModuleDefinitionStatementId === null
    )) return "root";
    return `instance:${JSON.stringify(entry.instancePath)}`;
  };
  const entryScopeKeys = executionStatements.map(scopeKeyOf);
  const entriesByScope = new Map<string, MaterializedExecutionStatement[]>();
  executionStatements.forEach((entry, entryIndex) => {
    const key = entryScopeKeys[entryIndex];
    entriesByScope.set(key, [...(entriesByScope.get(key) ?? []), entry]);
  });
  const placeholderElementsByScope = new Map<string, CadElement[]>();
  for (const [scopeKey, scopedEntries] of entriesByScope) {
    const scopedEntryIds = new Set(scopedEntries.map((entry) => entry.runtimeElementId));
    placeholderElementsByScope.set(
      scopeKey,
      placeholderElements.filter((element) => scopedEntryIds.has(element.id))
    );
  }
  const scopeIndexOf = (scopeKey: string, elements: CadElement[]) => createNameIndex(
    scopeKey === "root" ? [...existing, ...elements] : elements
  );
  const preliminaryIndexes = new Map<string, NameIndex>();
  for (const [scopeKey, scopedElements] of placeholderElementsByScope) {
    preliminaryIndexes.set(scopeKey, scopeIndexOf(scopeKey, scopedElements));
  }
  placeholderElements = placeholderElements.map((element, entryIndex) => {
    const entry = executionStatements[entryIndex];
    if (entry.parentGroupId || entry.sourceBlockChild || entry.type === "moduleInstance") return element;
    const parentToken = attr(entry.statement.attrs, "parent");
    const preliminaryIndex = preliminaryIndexes.get(entryScopeKeys[entryIndex]);
    if (!preliminaryIndex) throw new Error(`compileMaterializedExecution: missing scope ${entryScopeKeys[entryIndex]}`);
    return parentToken
      ? {
          ...element,
          parentGroupId: resolveId(parentToken, preliminaryIndex, entry.statement.line, diagnostics, element)
        }
      : element;
  });

  const finalElementsByScope = new Map<string, CadElement[]>();
  for (const [scopeKey, scopedEntries] of entriesByScope) {
    const scopedEntryIds = new Set(scopedEntries.map((entry) => entry.runtimeElementId));
    finalElementsByScope.set(
      scopeKey,
      placeholderElements.filter((element) => scopedEntryIds.has(element.id))
    );
  }
  const indexesByScope = new Map<string, NameIndex>();
  for (const [scopeKey, scopedElements] of finalElementsByScope) {
    indexesByScope.set(scopeKey, scopeIndexOf(scopeKey, scopedElements));
  }
  if (!indexesByScope.has("root")) indexesByScope.set("root", scopeIndexOf("root", []));
  const rootIndex = indexesByScope.get("root");
  if (!rootIndex) throw new Error("compileMaterializedExecution: missing root name scope");
  const compiledElements = placeholderElements.map((base, entryIndex) => {
    const entry = executionStatements[entryIndex];
    if (entry.type === "moduleInstance") return base;
    const index = indexesByScope.get(entryScopeKeys[entryIndex]);
    if (!index) throw new Error(`compileMaterializedExecution: missing scope ${entryScopeKeys[entryIndex]}`);

    let effectiveStatement = entry.statement;
    if (entry.sourceBlockChild && attr(entry.statement.attrs, "parent")) {
      diagnostics.push(warning(entry.statement.line, "ブロック内の parent= 属性は無視されます。"));
      effectiveStatement = { ...entry.statement, attrs: entry.statement.attrs.filter((item) => item.key !== "parent") };
    }
    const compiled = applyStatement(
      base,
      effectiveStatement,
      index,
      diagnostics,
      index.elements,
      index.nameContext,
      visibilitySettings.visibilityRoles,
      context.majorVersion,
      moduleGeometryRuntime?.resolversByRuntimeElementId.get(entry.runtimeElementId),
      entry.sourceStatementIndex
    );
    return {
      ...compiled,
      ...(entry.parentGroupId ? { parentGroupId: entry.parentGroupId } : {}),
      ...(entry.conditionalBranch ? { conditionalBranch: entry.conditionalBranch } : {})
    };
  });

  const insertionIndex = documentMode
    ? 0
    : Math.min(Math.max(context.insertionIndex ?? existing.length, 0), existing.length);
  const elements = documentMode
    ? compiledElements
    : [
        ...existing.slice(0, insertionIndex),
        ...compiledElements,
        ...existing.slice(insertionIndex)
      ];
  const selectedElementIds = compiledElements.map((element) => element.id);
  const outputModel = buildSourceOutputModel({
    statements,
    elements,
    nameIndex: rootIndex,
    sourceNamespace: context.sourceLexicalResolution?.sourceNamespace,
    elementIdByStatementIndex: materialization.elementIdBySourceStatementIndex,
    stableStatementIdByIndex: context.stableStatementIdByIndex,
    diagnostics,
    includeStatement: (_statement, statementIndex) => isCompilableDslStatement(statements, statementIndex)
  });

  return {
    elements,
    selectedElementId: selectedElementIds[0] ?? null,
    selectedElementIds,
    visibilityRoles: visibilitySettings.visibilityRoles,
    visibilityProfiles: visibilitySettings.visibilityProfiles,
    activeVisibilityProfileId: visibilitySettings.activeVisibilityProfileId,
    layouts: outputModel.layouts,
    printOutputs: outputModel.printOutputs,
    svgOutputs: outputModel.svgOutputs,
    evaluationLimitIndex: materialization.evaluationLimitIndex,
    diagnostics,
    changedCount: selectedElementIds.length,
    elementIdsByStatementIndex: new Map(materialization.elementIdBySourceStatementIndex),
    layoutIdsByStatementIndex: outputModel.layoutIdsByStatementIndex,
    outputIdsByStatementIndex: outputModel.outputIdsByStatementIndex,
    moduleMaterialization: materialization,
    moduleGeometryRuntime
  };
};
