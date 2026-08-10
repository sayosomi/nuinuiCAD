import { createCadElement } from "../model/elementFactory";
import { createNameIndex, resolveId } from "./dslReferences";
import { isCompilableDslStatement } from "./dslCompilationGuard";
import { parseElementActivityLiteral } from "./dslActivity";
import type { ElementNameContext } from "../model/elementNames";
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
  DocumentPalette,
  PrintLayout,
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
  geometryResolvers?: DslGeometryResolverOverrides
) => CadElement;

type BuildBlockPrintLayouts = (input: {
  statements: DslStatement[];
  layouts: PrintLayout[] | undefined;
  elements: CadElement[];
  nameIndex: NameIndex;
  visibilityProfiles: VisibilityProfile[];
  diagnostics: DslDiagnostic[];
  printLayoutIdsByStatementIndex: Map<number, string>;
  includeStatement: (statement: DslStatement, statementIndex: number) => boolean;
}) => PrintLayout[] | undefined;

type MaterializedVisibilitySettings = {
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId?: string;
  palette?: DocumentPalette;
  printLayouts?: PrintLayout[];
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
  printLayoutIdsByStatementIndex,
  materialization,
  moduleGeometryRuntime,
  applyStatement,
  buildBlockPrintLayouts
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
  visibilitySettings: MaterializedVisibilitySettings;
  printLayoutIdsByStatementIndex: Map<number, string>;
  materialization: ModuleMaterialization;
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  applyStatement: ApplyStatement;
  buildBlockPrintLayouts: BuildBlockPrintLayouts;
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
      moduleGeometryRuntime?.resolversByRuntimeElementId.get(entry.runtimeElementId)
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
  const printLayouts = buildBlockPrintLayouts({
    statements,
    layouts: visibilitySettings.printLayouts ?? (documentMode ? [] : undefined),
    elements,
    nameIndex: rootIndex,
    visibilityProfiles: visibilitySettings.visibilityProfiles,
    diagnostics,
    printLayoutIdsByStatementIndex,
    includeStatement: (_statement, statementIndex) => isCompilableDslStatement(statements, statementIndex)
  });

  let activePrintLayoutId = context.activePrintLayoutId;
  for (const [statementIndex, statement] of statements.entries()) {
    if (!isCompilableDslStatement(statements, statementIndex)) continue;
    if (statement.kind !== "activePrintLayout") continue;
    const target =
      printLayouts?.find((layout) => layout.name === statement.name) ??
      printLayouts?.find((layout) => layout.id === statement.name);
    if (!target) {
      diagnostics.push(warning(statement.line, `未定義の印刷レイアウトです: ${statement.name}`));
      activePrintLayoutId = statement.name;
    } else {
      activePrintLayoutId = target.id;
    }
  }

  return {
    elements,
    selectedElementId: selectedElementIds[0] ?? null,
    selectedElementIds,
    visibilityRoles: visibilitySettings.visibilityRoles,
    visibilityProfiles: visibilitySettings.visibilityProfiles,
    activeVisibilityProfileId: visibilitySettings.activeVisibilityProfileId,
    palette: visibilitySettings.palette,
    printLayouts,
    activePrintLayoutId,
    evaluationLimitIndex: materialization.evaluationLimitIndex,
    diagnostics,
    changedCount: selectedElementIds.length,
    elementIdsByStatementIndex: new Map(materialization.elementIdBySourceStatementIndex),
    printLayoutIdsByStatementIndex,
    moduleMaterialization: materialization,
    moduleGeometryRuntime
  };
};
