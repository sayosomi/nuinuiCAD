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

type ApplyStatement = (
  element: CadElement,
  statement: DslStatement,
  index: NameIndex,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[],
  nameContext: ElementNameContext,
  visibilityRoles?: VisibilityRole[],
  majorVersion?: DslMajorVersion
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
  applyStatement,
  buildBlockPrintLayouts
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
  visibilitySettings: MaterializedVisibilitySettings;
  printLayoutIdsByStatementIndex: Map<number, string>;
  materialization: ModuleMaterialization;
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
  const preliminaryIndex = createNameIndex([...existing, ...placeholderElements]);
  placeholderElements = placeholderElements.map((element, entryIndex) => {
    const entry = executionStatements[entryIndex];
    if (entry.parentGroupId || entry.sourceBlockChild || entry.type === "moduleInstance") return element;
    const parentToken = attr(entry.statement.attrs, "parent");
    return parentToken
      ? {
          ...element,
          parentGroupId: resolveId(parentToken, preliminaryIndex, entry.statement.line, diagnostics, element)
        }
      : element;
  });

  const index = createNameIndex([...existing, ...placeholderElements]);
  const elementsForExpressions = [...existing, ...placeholderElements];
  const compiledElements = placeholderElements.map((base, entryIndex) => {
    const entry = executionStatements[entryIndex];
    if (entry.type === "moduleInstance") return base;

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
      elementsForExpressions,
      index.nameContext,
      visibilitySettings.visibilityRoles,
      context.majorVersion
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
    nameIndex: createNameIndex(elements),
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
    moduleMaterialization: materialization
  };
};
