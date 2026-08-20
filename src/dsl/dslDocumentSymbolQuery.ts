import type { DslStatement } from "./dslTypes";
import {
  type DslPhysicalSpan,
  type DocumentRange,
  type LogicalStatementSourceMap,
  type SourceSnapshot
} from "./logicalStatementSourceMap";

export type DslDocumentSymbolKind =
  | "module"
  | "object"
  | "namespace"
  | "constant"
  | "variable"
  | "enum"
  | "struct"
  | "property"
  | "field"
  | "string"
  | "file";

export type DslDocumentSymbol = {
  name: string;
  detail: string;
  kind: DslDocumentSymbolKind;
  range: { from: number; to: number };
  selectionRange: { from: number; to: number };
  children: DslDocumentSymbol[];
};

export type DslDocumentSymbolQueryInput = {
  source: SourceSnapshot;
  statements: readonly DslStatement[];
  sourceMap: LogicalStatementSourceMap;
};

type StructuralSymbolKind = "moduleDefinition" | "group" | "conditionalGroup" | "forGroup";

const structuralSymbolKindOf = (statement: DslStatement): StructuralSymbolKind | null => {
  if (statement.kind === "moduleDefinition" || statement.kind === "group") return statement.kind;
  if (statement.kind !== "element") return null;
  return statement.type === "conditionalGroup" || statement.type === "forGroup"
    ? statement.type
    : null;
};

const isStructuralSymbol = (statement: DslStatement): boolean =>
  structuralSymbolKindOf(statement) !== null;

const isExactCurrentRange = (
  range: DocumentRange,
  source: SourceSnapshot
): boolean =>
  range.sourceRevision === source.sourceRevision &&
  range.from >= 0 &&
  range.to >= range.from &&
  range.to <= source.normalizedSource.length;

const rangeFromDocumentRange = (
  range: DocumentRange,
  source: SourceSnapshot
): { from: number; to: number } | null =>
  isExactCurrentRange(range, source) ? { from: range.from, to: range.to } : null;

const rangeFromPhysicalSpan = (
  span: DslPhysicalSpan | null | undefined,
  source: SourceSnapshot
): { from: number; to: number } | null => {
  if (!span || span.sourceRevision !== source.sourceRevision || span.segments.length !== 1) return null;
  const segment = span.segments[0];
  if (!segment || segment.from < 0 || segment.to <= segment.from || segment.to > source.normalizedSource.length) return null;
  return { from: segment.from, to: segment.to };
};

const detailWithModifiers = (base: string, modifierNames: readonly string[] | undefined): string => {
  const names = modifierNames ?? [];
  return names.length > 0 ? `${base} [${names.join(", ")}]` : base;
};

const isNamedGeometryCategory = (category: string): boolean =>
  category === "point" ||
  category === "line" ||
  category === "curve" ||
  category === "arc" ||
  category === "text" ||
  category === "image";

const symbolNameSelectionRange = (
  statement: DslStatement,
  source: SourceSnapshot
): { from: number; to: number } | null =>
  rangeFromPhysicalSpan(statement.namePhysicalSpan, source);

const keywordSelectionRange = (
  statement: DslStatement,
  source: SourceSnapshot
): { from: number; to: number } | null =>
  rangeFromPhysicalSpan(statement.keywordPhysicalSpan, source);

const leafSymbolFor = (
  statement: DslStatement,
  source: SourceSnapshot
): DslDocumentSymbol | null => {
  const range = rangeFromDocumentRange(statement.documentRange, source);
  if (!range) return null;

  if (statement.kind === "moduleDefinition") {
    const selectionRange = symbolNameSelectionRange(statement, source);
    return selectionRange
      ? { name: statement.name, detail: "", kind: "module", range, selectionRange, children: [] }
      : null;
  }
  if (statement.kind === "moduleInstance") {
    const selectionRange = symbolNameSelectionRange(statement, source);
    return selectionRange
      ? { name: statement.name, detail: "", kind: "object", range, selectionRange, children: [] }
      : null;
  }
  if (statement.kind === "group") {
    const selectionRange = symbolNameSelectionRange(statement, source) ?? keywordSelectionRange(statement, source);
    return selectionRange
      ? {
          name: statement.name,
          detail: detailWithModifiers("group", statement.modifierNames),
          kind: "namespace",
          range,
          selectionRange,
          children: []
        }
      : null;
  }
  if (statement.kind === "typedDeclaration") {
    const selectionRange = symbolNameSelectionRange(statement, source);
    return selectionRange
      ? {
          name: statement.name,
          detail: "",
          kind: statement.bindingKind === "const" ? "constant" : "variable",
          range,
          selectionRange,
          children: []
        }
      : null;
  }
  if (statement.kind === "profileDeclaration") {
    const selectionRange = symbolNameSelectionRange(statement, source);
    return selectionRange
      ? { name: statement.name, detail: "profile", kind: "enum", range, selectionRange, children: [] }
      : null;
  }
  if (statement.kind === "modifierDefinition") {
    const selectionRange = symbolNameSelectionRange(statement, source);
    return selectionRange
      ? { name: statement.name, detail: "", kind: "struct", range, selectionRange, children: [] }
      : null;
  }
  if (statement.kind !== "element" || !statement.name || !isNamedGeometryCategory(statement.category)) return null;

  const selectionRange = symbolNameSelectionRange(statement, source);
  if (!selectionRange) return null;
  const kind = statement.category === "point"
    ? "property"
    : statement.category === "text"
      ? "string"
      : statement.category === "image"
        ? "file"
        : "field";
  return {
    name: statement.name,
    detail: detailWithModifiers(statement.category, statement.modifierNames),
    kind,
    range,
    selectionRange,
    children: []
  };
};

const blockEndFor = (
  statements: readonly DslStatement[],
  openerIndex: number
): DslStatement | undefined => statements.find(
  (statement) => statement.kind === "blockEnd" && statement.enclosing?.statementIndex === openerIndex
);

const blockElseFor = (
  statements: readonly DslStatement[],
  openerIndex: number
): DslStatement | undefined => statements.find(
  (statement) => statement.kind === "blockElse" && statement.enclosing?.statementIndex === openerIndex
);

const structuralRangeFor = (
  statement: DslStatement,
  statementIndex: number,
  statements: readonly DslStatement[],
  source: SourceSnapshot
): { from: number; to: number } | null => {
  const openerRange = rangeFromDocumentRange(statement.documentRange, source);
  if (!openerRange) return null;
  const close = blockEndFor(statements, statementIndex);
  const closeRange = close ? rangeFromDocumentRange(close.documentRange, source) : null;
  return {
    from: openerRange.from,
    to: closeRange?.to ?? source.normalizedSource.length
  };
};

const branchRangeFor = (
  statement: DslStatement,
  statementIndex: number,
  statements: readonly DslStatement[],
  source: SourceSnapshot,
  branch: "then" | "else"
): { from: number; to: number } | null => {
  const openerRange = rangeFromDocumentRange(statement.documentRange, source);
  if (!openerRange) return null;
  const elseStatement = blockElseFor(statements, statementIndex);
  const close = blockEndFor(statements, statementIndex);
  const elseRange = elseStatement ? rangeFromDocumentRange(elseStatement.documentRange, source) : null;
  const closeRange = close ? rangeFromDocumentRange(close.documentRange, source) : null;
  if (branch === "then") {
    return {
      from: openerRange.from,
      to: elseRange?.from ?? closeRange?.from ?? source.normalizedSource.length
    };
  }
  if (!elseRange) return null;
  return {
    from: elseRange.from,
    to: closeRange?.to ?? source.normalizedSource.length
  };
};

const conditionalBranchesFor = (
  statement: DslStatement,
  statementIndex: number,
  statements: readonly DslStatement[],
  source: SourceSnapshot
): DslDocumentSymbol[] => {
  const keywordRange = keywordSelectionRange(statement, source);
  if (!keywordRange) return [];
  const thenRange = branchRangeFor(statement, statementIndex, statements, source, "then");
  if (!thenRange) return [];
  const branches: DslDocumentSymbol[] = [{
    name: "THEN",
    detail: "",
    kind: "namespace",
    range: thenRange,
    selectionRange: keywordRange,
    children: []
  }];
  if (blockElseFor(statements, statementIndex)) {
    const elseRange = branchRangeFor(statement, statementIndex, statements, source, "else");
    if (!elseRange) return [];
    const elseStatement = blockElseFor(statements, statementIndex)!;
    const elseSelectionRange = rangeFromDocumentRange(elseStatement.documentRange, source);
    if (!elseSelectionRange) return [];
    branches.push({
      name: "ELSE",
      detail: "",
      kind: "namespace",
      range: elseRange,
      selectionRange: elseSelectionRange,
      children: []
    });
  }
  return branches;
};

const structuralSymbolFor = (
  statement: DslStatement,
  statementIndex: number,
  statements: readonly DslStatement[],
  source: SourceSnapshot
): DslDocumentSymbol | null => {
  const structuralKind = structuralSymbolKindOf(statement);
  if (!structuralKind) return null;
  const range = structuralRangeFor(statement, statementIndex, statements, source);
  if (!range) return null;
  if (structuralKind === "conditionalGroup") {
    const keywordRange = keywordSelectionRange(statement, source);
    const branches = conditionalBranchesFor(statement, statementIndex, statements, source);
    const condition = statement.attrs.find((attribute) => attribute.key === "condition")?.value ?? "";
    return keywordRange && branches.length > 0
      ? {
          name: `if (${condition})`,
          detail: "",
          kind: "namespace",
          range,
          selectionRange: keywordRange,
          children: branches
        }
      : null;
  }
  if (structuralKind === "forGroup") {
    const selectionRange = keywordSelectionRange(statement, source);
    const variable = statement.attrs.find((attribute) => attribute.key === "variable")?.value ?? "";
    return selectionRange
      ? { name: `for ${variable}`, detail: "", kind: "namespace", range, selectionRange, children: [] }
      : null;
  }
  const leaf = leafSymbolFor(statement, source);
  if (!leaf) return null;
  leaf.range = range;
  return leaf;
};

const conditionalBranchFor = (
  statement: DslStatement,
  statements: readonly DslStatement[]
): { conditionalIndex: number; branch: "then" | "else" } | null => {
  let current: DslStatement | undefined = statement;
  while (current?.enclosing) {
    const parentIndex: number = current.enclosing.statementIndex;
    const branch: "then" | "else" = current.enclosing.branch;
    const parent: DslStatement | undefined = statements[parentIndex];
    if (!parent) return null;
    if (parent.kind === "element" && parent.type === "conditionalGroup") {
      return { conditionalIndex: parentIndex, branch };
    }
    current = parent;
  }
  return null;
};

const nearestEmittedStructuralAncestor = (
  statement: DslStatement,
  statements: readonly DslStatement[],
  symbolsByIndex: ReadonlyMap<number, DslDocumentSymbol>
): number | null => {
  let current: DslStatement | undefined = statement;
  while (current?.enclosing) {
    const parentIndex: number = current.enclosing.statementIndex;
    if (symbolsByIndex.has(parentIndex)) return parentIndex;
    current = statements[parentIndex];
  }
  return null;
};

const exactCurrentInput = (input: DslDocumentSymbolQueryInput): boolean => {
  if (
    input.sourceMap.source !== input.source.normalizedSource ||
    input.sourceMap.sourceRevision !== input.source.sourceRevision
  ) return false;
  return input.statements.every((statement) =>
    statement.sourceRevision === input.source.sourceRevision &&
    statement.documentRange.sourceRevision === input.source.sourceRevision
  );
};

export const queryDslDocumentSymbols = (
  input: DslDocumentSymbolQueryInput
): DslDocumentSymbol[] => {
  if (!exactCurrentInput(input)) return [];

  const symbolsByIndex = new Map<number, DslDocumentSymbol>();
  const structuralSymbolsByIndex = new Map<number, DslDocumentSymbol>();
  for (const [statementIndex, statement] of input.statements.entries()) {
    const symbol = isStructuralSymbol(statement)
      ? structuralSymbolFor(statement, statementIndex, input.statements, input.source)
      : leafSymbolFor(statement, input.source);
    if (symbol) {
      symbolsByIndex.set(statementIndex, symbol);
      if (isStructuralSymbol(statement)) structuralSymbolsByIndex.set(statementIndex, symbol);
    }
  }

  const roots: DslDocumentSymbol[] = [];
  for (const [statementIndex, symbol] of symbolsByIndex.entries()) {
    const statement = input.statements[statementIndex]!;
    const parentIndex = nearestEmittedStructuralAncestor(statement, input.statements, structuralSymbolsByIndex);
    if (parentIndex !== null) {
      const parent = input.statements[parentIndex]!;
      if (parent.kind === "element" && parent.type === "conditionalGroup") {
        const conditionalBranch = conditionalBranchFor(statement, input.statements);
        const conditionalParent = symbolsByIndex.get(parentIndex);
        const branch = conditionalBranch && conditionalParent?.children.find(
          (child) => child.name === conditionalBranch.branch.toUpperCase()
        );
        if (branch) {
          branch.children.push(symbol);
          continue;
        }
      }
      symbolsByIndex.get(parentIndex)!.children.push(symbol);
    } else {
      roots.push(symbol);
    }
  }
  return roots;
};
