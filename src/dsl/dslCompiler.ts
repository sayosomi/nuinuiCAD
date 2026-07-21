import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createCadElement } from "../model/elementFactory";
import type { ElementNameContext } from "../model/elementNames";
import { nextPrintLayoutId, normalizePrintLayout } from "../print/printLayout";
import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  ElementId,
  NumericVariable,
  PaletteColor,
  PrintLayout,
  PrintLayoutPlacement,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { applyArgs, createDefaultIntermediateId } from "./dslApplyArgs";
import type { ScannedArg } from "./dslArgScanner";
import { constructionFor, type DslConstructionSpec } from "./dslConstructions";
import { isElementDslStatement, parseDsl } from "./dslParser";
import { createNameIndex, resolveId, type NameIndex } from "./dslReferences";
import type { CompileDslContext, CompileDslResult, DslAttribute, DslDiagnostic, DslStatement } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";
import type { DslMajorVersion } from "./dslVersion";
import {
  placeAngleAttrKey,
  placeAtAttrKey,
  printLayoutCanvasAttrKey,
  printLayoutColumnsAttrKey,
  printLayoutOverlapAttrKey,
  printLayoutPaperAttrKey,
  printLayoutRowsAttrKey,
  printLayoutScaleAttrKey,
  printLayoutViewAttrKey
} from "./dslPrintLayoutAttributes";

const attr = (attrs: DslAttribute[], key: string) =>
  attrs.find((item) => item.key === key)?.value;

// name: 引数の生値は(P2/P3のscanCallArgsが)quoteを含んだ生スライスで返るため、
// 設定文(color/role/view/printLayout)の name 属性はここで明示的に unquote する
// (要素側の text kind パラメータは dslApplyArgs.ts 側で既に unquote 済み)。
const unquoteName = (value: string | undefined) => value === undefined ? undefined : unquoteDslString(value);

export const statementTypeOf = (statement: DslStatement): CadElementType => {
  if (statement.kind === "element") return statement.type ?? "group";
  if (statement.kind === "variable") return "variable";
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

const paperSizeIds = new Set(["a4", "a3", "b5", "b4", "letter", "legal"]);

const roleIdByToken = (roles: VisibilityRole[], token: string) => {
  const normalized = unquoteDslString(token);
  return roles.find((role) => role.id === normalized || role.name === normalized)?.id ?? normalized;
};

const profileIdByToken = (profiles: VisibilityProfile[], token: string) => {
  const normalized = unquoteDslString(token);
  return profiles.find((profile) => profile.id === normalized || profile.name === normalized)?.id ?? normalized;
};

const outputKind = (value: string) => value === "svg" ? "svg" : "pdf";

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

const applyStatement = (
  element: CadElement,
  statement: DslStatement,
  index: NameIndex,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[],
  nameContext: ElementNameContext,
  visibilityRoles: VisibilityRole[] = [],
  majorVersion?: DslMajorVersion
): CadElement => {
  const named = { ...element, name: statement.name };
  if (statement.kind === "variable") {
    if (named.type !== "variable") return named;
    const expression = makeNumericExpression(
      normalizeNumericExpressionInput(statement.expression, elementsForExpressions, named.numericVariables ?? [], named, nameContext)
    );
    return { ...named, valueMode: "expression", expression };
  }

  const spec = constructionSpecFor(statement);
  if (!spec) return named;

  const result = applyArgs(named, spec, scannedArgsFromAttrs(statement.attrs), {
    index,
    line: statement.line,
    elementsForExpressions,
    nameContext,
    visibilityRoles,
    createIntermediateId: createDefaultIntermediateId,
    majorVersion
  });
  diagnostics.push(...result.diagnostics);

  let next = result.element;
  if (result.metadata.parent) {
    next = { ...next, parentGroupId: resolveId(result.metadata.parent, index, statement.line, diagnostics, next) };
  }
  if (result.metadata.branch) {
    next = { ...next, conditionalBranch: result.metadata.branch };
  }
  return next;
};

const applyPaletteStatements = ({
  statements,
  context,
  diagnostics
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
}): DocumentPalette | undefined => {
  const colorStatements = statements.filter(
    (statement): statement is Extract<DslStatement, { kind: "color" }> => statement.kind === "color"
  );
  if (colorStatements.length === 0) return context.palette;

  const colors: PaletteColor[] = context.palette ? [...context.palette.colors] : [];
  let defaultColorId = context.palette?.defaultColorId;
  let defaultCount = 0;
  for (const statement of colorStatements) {
    const id = statement.name;
    const existing = colors.find((color) => color.id === id);
    const nextColor: PaletteColor = {
      id,
      name: unquoteName(attr(statement.attrs, "name")) ?? existing?.name ?? id,
      hex: statement.hex
    };
    const existingIndex = colors.findIndex((color) => color.id === id);
    if (existingIndex >= 0) {
      colors[existingIndex] = nextColor;
    } else {
      colors.push(nextColor);
    }
    if (statement.isDefault) {
      defaultCount += 1;
      if (defaultCount > 1) {
        diagnostics.push(diagnostic(statement.line, "default は1つの色にのみ指定できます。"));
      }
      defaultColorId = id;
    }
  }
  return {
    colors,
    defaultColorId:
      defaultColorId && colors.some((color) => color.id === defaultColorId)
        ? defaultColorId
        : colors[0]?.id ?? ""
  };
};

const applyVisibilitySettings = ({
  statements,
  context,
  diagnostics,
  printLayoutIdsByStatementIndex
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
  printLayoutIdsByStatementIndex?: Map<number, string>;
}) => {
  let visibilityRoles = [...(context.visibilityRoles ?? [])];
  let visibilityProfiles = [...(context.visibilityProfiles ?? [])];
  let activeVisibilityProfileId = context.activeVisibilityProfileId;
  let printLayouts = context.printLayouts?.map((layout) => ({ ...layout })) ?? undefined;

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

  for (const statement of statements) {
    if (statement.kind === "role") upsertRole(statement);
  }
  for (const statement of statements) {
    if (statement.kind === "view") upsertProfile(statement);
  }
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex];
    if (statement.kind === "activeView") {
      const profileId = profileIdByToken(visibilityProfiles, statement.name);
      if (visibilityProfiles.some((profile) => profile.id === profileId)) {
        activeVisibilityProfileId = profileId;
      } else {
        diagnostics.push(warning(statement.line, `未定義の表示プロファイルです: ${statement.name}`));
        activeVisibilityProfileId = profileId;
      }
    }
    if (statement.kind === "printLayout" && !statement.opensBlock && printLayouts) {
      const profileToken = attr(statement.attrs, printLayoutViewAttrKey);
      const profileId = profileToken ? profileIdByToken(visibilityProfiles, profileToken) : undefined;
      if (profileToken && !visibilityProfiles.some((profile) => profile.id === profileId)) {
        diagnostics.push(warning(statement.line, `未定義の表示プロファイルです: ${profileToken}`));
      }
      const existing = printLayouts.find((layout) => layout.id === statement.name || layout.name === statement.name);
      const nextLayout = normalizePrintLayout({
        ...(existing ?? {}),
        id: existing?.id ?? attr(statement.attrs, "id") ?? statement.name,
        name: unquoteName(attr(statement.attrs, "name")) ?? existing?.name ?? statement.name,
        outputKind: attr(statement.attrs, "output")
          ? outputKind(attr(statement.attrs, "output") ?? "pdf")
          : existing?.outputKind,
        visibilityProfileId: profileId ?? existing?.visibilityProfileId
      }, context.elements, visibilityProfiles, { preserveDanglingReferences: true });
      printLayouts = existing
        ? printLayouts.map((layout) => layout.id === existing.id ? nextLayout : layout)
        : [...printLayouts, nextLayout];
      printLayoutIdsByStatementIndex?.set(statementIndex, nextLayout.id);
    }
  }

  const palette = applyPaletteStatements({ statements, context, diagnostics });

  return {
    visibilityRoles,
    visibilityProfiles,
    activeVisibilityProfileId,
    printLayouts,
    palette
  };
};

const buildBlockPrintLayouts = ({
  statements,
  layouts,
  elements,
  nameIndex,
  visibilityProfiles,
  diagnostics,
  printLayoutIdsByStatementIndex
}: {
  statements: DslStatement[];
  layouts: PrintLayout[] | undefined;
  elements: CadElement[];
  nameIndex: NameIndex;
  visibilityProfiles: VisibilityProfile[];
  diagnostics: DslDiagnostic[];
  printLayoutIdsByStatementIndex?: Map<number, string>;
}): PrintLayout[] | undefined => {
  const blockStatements = statements
    .map((statement, index) => ({ statement, index }))
    .filter((item) => item.statement.kind === "printLayout" && item.statement.opensBlock);
  if (blockStatements.length === 0) return layouts;

  let next = layouts ? [...layouts] : [];
  for (const { statement, index } of blockStatements) {
    if (statement.kind !== "printLayout") continue;
    const members = statements.filter(
      (member) =>
        (member.kind === "place" || member.kind === "layoutVar") &&
        member.enclosing?.statementIndex === index
    );
    const numericVariables: NumericVariable[] = [];
    const placements: PrintLayoutPlacement[] = [];
    const numeric = (source: string) =>
      makeNumericExpression(
        normalizeNumericExpressionInput(source, elements, numericVariables, undefined, nameIndex.nameContext)
      );

    for (const member of members) {
      if (member.kind === "layoutVar") {
        numericVariables.push({
          id: `print-variable-${numericVariables.length + 1}`,
          name: member.name,
          value: numeric(member.expression)
        });
        continue;
      }
      if (member.kind !== "place") continue;
      const groupId = resolveId(member.group, nameIndex, member.line, diagnostics);
      const target = nameIndex.elementsById.get(groupId);
      if (target && target.type !== "group") {
        diagnostics.push(diagnostic(member.line, `place の参照先はグループではありません: ${member.group}`));
      }
      const at = attr(member.attrs, placeAtAttrKey);
      const pair = at ? coordinatePair(at) : null;
      if (at && !pair) {
        diagnostics.push(diagnostic(member.line, "place の位置は `at=(x, y)` で指定してください。"));
      }
      placements.push({
        id: `placement-${placements.length + 1}`,
        groupId,
        x: pair ? numeric(pair.x) : 0,
        y: pair ? numeric(pair.y) : 0,
        angleDeg: numeric(attr(member.attrs, placeAngleAttrKey) ?? "0"),
        mirrorX: booleanValue(attr(member.attrs, "mirrorX") ?? "false") ?? false
      });
    }

    const profileToken = attr(statement.attrs, printLayoutViewAttrKey);
    const profileId = profileToken ? profileIdByToken(visibilityProfiles, profileToken) : undefined;
    if (profileToken && !visibilityProfiles.some((profile) => profile.id === profileId)) {
      diagnostics.push(warning(statement.line, `未定義の表示プロファイルです: ${profileToken}`));
    }
    const paper = attr(statement.attrs, printLayoutPaperAttrKey);
    if (paper && !paperSizeIds.has(paper)) {
      diagnostics.push(diagnostic(statement.line, `未対応の用紙サイズです: ${paper}`));
    }
    const orientation = attr(statement.attrs, "orientation");
    if (orientation && orientation !== "portrait" && orientation !== "landscape") {
      diagnostics.push(diagnostic(statement.line, "orientation は portrait / landscape で指定してください。"));
    }
    const output = attr(statement.attrs, "output");
    if (output && output !== "pdf" && output !== "svg") {
      diagnostics.push(diagnostic(statement.line, "output は pdf / svg で指定してください。"));
    }
    const canvas = attr(statement.attrs, printLayoutCanvasAttrKey);
    const canvasPair = canvas ? coordinatePair(canvas) : null;
    if (canvas && !canvasPair) {
      diagnostics.push(diagnostic(statement.line, "canvas は `canvas=(幅, 高さ)` で指定してください。"));
    }

    const existing = statement.name
      ? next.find((layout) => layout.name === statement.name || layout.id === statement.name)
      : undefined;
    const columns = attr(statement.attrs, printLayoutColumnsAttrKey);
    const rows = attr(statement.attrs, printLayoutRowsAttrKey);
    const overlap = attr(statement.attrs, printLayoutOverlapAttrKey);
    const scale = attr(statement.attrs, printLayoutScaleAttrKey);
    const layout = normalizePrintLayout({
      id: existing?.id ?? attr(statement.attrs, "id") ?? (statement.name || nextPrintLayoutId(next)),
      name: unquoteName(attr(statement.attrs, "name")) ?? statement.name,
      outputKind: output ? outputKind(output) : existing?.outputKind,
      visibilityProfileId: profileId ?? existing?.visibilityProfileId,
      paperSizeId: paper ?? existing?.paperSizeId,
      orientation: orientation ?? existing?.orientation,
      columns: columns === undefined ? existing?.columns : numeric(columns),
      rows: rows === undefined ? existing?.rows : numeric(rows),
      overlapMm: overlap === undefined ? existing?.overlapMm : numeric(overlap),
      scale: scale === undefined ? existing?.scale : numeric(scale),
      svgCanvasWidthMm: canvasPair ? numeric(canvasPair.x) : existing?.svgCanvasWidthMm,
      svgCanvasHeightMm: canvasPair ? numeric(canvasPair.y) : existing?.svgCanvasHeightMm,
      numericVariables,
      placements
    }, elements, visibilityProfiles, { preserveDanglingReferences: true });
    next = existing
      ? next.map((item) => (item.id === existing.id ? layout : item))
      : [...next, layout];
    printLayoutIdsByStatementIndex?.set(index, layout.id);
  }
  return next;
};

export const compileDslToElements = (source: string, context: CompileDslContext): CompileDslResult => {
  const parsed = context.preparsed ?? parseDsl(source);
  if (parsed.diagnostics.some((item) => item.severity === "error")) {
    return {
      elements: context.elements,
      selectedElementId: null,
      selectedElementIds: [],
      visibilityRoles: context.visibilityRoles,
      visibilityProfiles: context.visibilityProfiles,
      activeVisibilityProfileId: context.activeVisibilityProfileId,
      printLayouts: context.printLayouts,
      palette: context.palette,
      activePrintLayoutId: context.activePrintLayoutId,
      diagnostics: parsed.diagnostics,
      changedCount: 0
    };
  }

  const diagnostics: DslDiagnostic[] = [...parsed.diagnostics];
  const printLayoutIdsByStatementIndex = new Map<number, string>();
  const visibilitySettings = applyVisibilitySettings({
    statements: parsed.statements,
    context,
    diagnostics,
    printLayoutIdsByStatementIndex
  });
  const documentMode = context.mode === "document";
  const existing = documentMode ? [] : context.elements;
  const statementIndexOf = new Map<DslStatement, number>(
    parsed.statements.map((statement, index) => [statement, index])
  );
  const elementStatements = parsed.statements.filter(isElementDslStatement);
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
  const preliminaryIndex = createNameIndex([...existing, ...placeholderElements]);
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
  const index = createNameIndex([...existing, ...placeholderElements]);
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
        context.majorVersion
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

  const printLayouts = buildBlockPrintLayouts({
    statements: parsed.statements,
    layouts: visibilitySettings.printLayouts ?? (documentMode ? [] : undefined),
    elements,
    nameIndex: createNameIndex(elements),
    visibilityProfiles: visibilitySettings.visibilityProfiles,
    diagnostics,
    printLayoutIdsByStatementIndex
  });

  let activePrintLayoutId = context.activePrintLayoutId;
  for (const statement of parsed.statements) {
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

  let evaluationLimitIndex: number | undefined;
  const atStopIndex = parsed.statements.findIndex((statement) => statement.kind === "atStop");
  if (atStopIndex >= 0) {
    if (documentMode) {
      evaluationLimitIndex = parsed.statements
        .slice(0, atStopIndex)
        .filter(isElementDslStatement).length;
    } else {
      diagnostics.push(warning(parsed.statements[atStopIndex].line, "@stop は文書全体の適用でのみ有効なため無視されます。"));
    }
  }

  const elementIdsByStatementIndex = new Map<number, ElementId>();
  for (const [statement, id] of createdIds) {
    const index = statementIndexOf.get(statement);
    if (index !== undefined) elementIdsByStatementIndex.set(index, id);
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
    evaluationLimitIndex,
    diagnostics,
    changedCount: selectedElementIds.length,
    elementIdsByStatementIndex,
    printLayoutIdsByStatementIndex
  };
};
