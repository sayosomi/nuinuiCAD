import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createCadElement } from "../model/elementFactory";
import { isPointElement } from "../model/pointAnchors";
import type { ElementNameContext } from "../model/elementNames";
import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  DrawingModifierProperties,
  DrawingModifierDefinition,
  DrawingModifierProfileDelta,
  DrawingProfile,
  ElementId,
  PaletteColor,
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
import { isCompilableDslStatement, type DslStatementInclusion } from "./dslCompilationGuard";
import { isElementDslStatement, parseDsl } from "./dslParser";
import { createNameIndex, resolveId, type NameIndex } from "./dslReferences";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { resolveSourceLexicalPath, resolveSourceLexicalPathSegments, type SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
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
import { materializeModuleExecution } from "./moduleMaterialization";
import { buildModuleGeometryRuntime } from "./moduleGeometryRuntime";
import { compileMaterializedExecution } from "./moduleExecutionCompiler";

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

const modifierDefinitionsFromStatements = (
  statements: readonly DslStatement[],
  sourceNamespace: SourceLexicalNamespaceIndex | undefined,
  diagnostics: DslDiagnostic[]
): DrawingModifierDefinition[] => statements.flatMap((statement, statementIndex) => {
  if (statement.kind !== "modifierDefinition" || statement.enclosing) return [];
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

const applyPaletteStatements = ({
  statements,
  context,
  diagnostics,
  includeStatement
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
  includeStatement: DslStatementInclusion;
}): DocumentPalette | undefined => {
  const colorStatements = statements.filter(
    (statement, statementIndex): statement is Extract<DslStatement, { kind: "color" }> =>
      statement.kind === "color" && includeStatement(statement, statementIndex)
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

  const palette = applyPaletteStatements({ statements, context, diagnostics, includeStatement });

  return {
    visibilityRoles,
    visibilityProfiles,
    activeVisibilityProfileId,
    palette
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
      palette: context.palette,
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
  for (const statement of modifierStatements) {
    if (!isElementDslStatement(statement)) continue;
    for (const modifierName of statement.modifierNames ?? []) {
      if (!modifierNames.has(modifierName)) {
        diagnostics.push(diagnostic(statement.line, `未定義の modifier です: ${modifierName}`));
      }
    }
  }
  if (documentMode && context.moduleSemanticAnalysis && context.stableStatementIdByIndex) {
    const moduleMaterialization = materializeModuleExecution({
      statements: parsed.statements,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      assignedElementIds: context.assignedElementIds ?? new Map(),
      moduleSemanticAnalysis: context.moduleSemanticAnalysis
    });
    const moduleGeometryRuntime = buildModuleGeometryRuntime({
      statements: parsed.statements,
      stableStatementIdByIndex: context.stableStatementIdByIndex,
      moduleSemanticAnalysis: context.moduleSemanticAnalysis,
      moduleMaterialization
    });
    diagnostics.push(...moduleGeometryRuntime.diagnostics);
    return {
      ...compileMaterializedExecution({
      statements: parsed.statements,
      context,
      diagnostics,
      visibilitySettings,
      materialization: moduleMaterialization,
      moduleGeometryRuntime,
      applyStatement,
      buildSourceOutputModel
      }),
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

  return {
    elements,
    modifiers,
    drawingProfiles,
    selectedElementId: selectedElementIds[0] ?? null,
    selectedElementIds,
    visibilityRoles: visibilitySettings.visibilityRoles,
    visibilityProfiles: visibilitySettings.visibilityProfiles,
    activeVisibilityProfileId: visibilitySettings.activeVisibilityProfileId,
    palette: visibilitySettings.palette,
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
