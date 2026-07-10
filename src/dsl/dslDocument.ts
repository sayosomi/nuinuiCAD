import { defaultDocumentPalette } from "../palette/palette";
import { createElementNameContext, resolveElementName, type ElementNameContext } from "../model/elementNames";
import { DEFAULT_VISIBILITY_PROFILE_ID, defaultVisibilityProfile } from "../model/visibilityProfiles";
import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  ElementId,
  NumericVariable,
  PaletteColor,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { formatNumericValueForDsl, shortestDslTokensById } from "./dslExpressionFormat";
import { parseDsl } from "./dslParser";
import {
  documentDslRefs,
  serializeElementStatement,
  serializeVisibilitySettingsLines,
  type DslSerializerRefs
} from "./dslSerializer";
import type { DslDiagnostic, DslEnclosing, DslStatement } from "./dslTypes";
import { DSL_INDENT, formatDslName, quoteDslString } from "./dslTokens";

// `nui 1` を先頭に持つ、文書全体を無損失に表すDSLテキストへの変換ファサード。
// 保存形式はまだJSON(Phase 1d以降で `.nui` に切り替え)。ここではテキスト
// ⇄ 構造化データの往復のみを扱い、ストア・UI・保存形式には触れない。

export type DslDocumentData = {
  elements: CadElement[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
  evaluationLimitIndex: number;
};

export type SerializeDslDocumentOptions = {
  headerComment?: string;
};

export type ParseDslDocumentResult = {
  document: DslDocumentData | null;
  diagnostics: DslDiagnostic[];
};

// ==== StatementMap(文⇄行対応) ====

export type LineRange = {
  /** 1-based・両端含む。 */
  startLine: number;
  endLine: number;
};

export type StatementInfo = {
  statementIndex: number;
  kind: DslStatement["kind"];
  /** 文自身の行(1-based)。 */
  line: number;
  /** ブロックを開く文は開き行〜対応する `}` 行。それ以外は line..line。 */
  range: LineRange;
  /** conditionalGroup ブロックの `} else {` 行(あれば)。 */
  elseLine?: number;
  /** 正準インデント深さ(ブロックスタック深さ)。 */
  indentDepth: number;
  enclosing: DslEnclosing | null;
};

export type StatementMap = {
  /** パース結果の全文と並行(index一致)。 */
  statements: StatementInfo[];
  byElementId: Map<ElementId, StatementInfo>;
  elementIdByStatementIndex: Map<number, ElementId>;
  /**
   * 非要素文のキー: `color:<id>` / `role:<id>` / `view:<id>` / `printLayout:<id>` /
   * `version` / `atStop` / `activeView` / `activePrintLayout`。
   * active系は最後の出現(コンパイラのlast-winsに一致)、version/atStopは最初の出現。
   */
  byKey: Map<string, StatementInfo>;
  /** 各セクションが存在する場合の最終行(セクション新設時の挿入アンカー)。 */
  sectionEnds: {
    version?: number;
    palette?: number;
    visibility?: number;
    printLayouts?: number;
  };
};

export type CompiledDslDocument = {
  document: DslDocumentData | null;
  statements: DslStatement[];
  /** エラー診断がある場合は null。 */
  statementMap: StatementMap | null;
  /** 改行正規化済みソースの行配列。 */
  sourceLines: string[];
  diagnostics: DslDiagnostic[];
};

export type CompileDslDocumentOptions = {
  /** 文index(全文配列基準)→ 継承させる実行時要素ID(statementReconciler の出力)。 */
  assignedElementIds?: ReadonlyMap<number, ElementId>;
};

const DSL_VERSION = 1;

const versionDiagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

// ==== パレット ====

export const serializePaletteColorLine = (color: PaletteColor, defaultColorId: string): string =>
  [
    "color",
    formatDslName(color.id),
    quoteDslString(color.hex),
    `name=${quoteDslString(color.name)}`,
    ...(color.id === defaultColorId ? ["default"] : [])
  ].join(" ");

export const serializePaletteLines = (palette: DocumentPalette): string[] =>
  palette.colors.map((color) => serializePaletteColorLine(color, palette.defaultColorId));

// ==== 印刷レイアウト ====

const resolveGroupToken = (
  elements: CadElement[],
  groupId: ElementId,
  context: ElementNameContext,
  rootTokens: Map<ElementId, string>
): string => {
  const target = context.elementsById.get(groupId);
  if (!target || !target.name.trim()) return groupId;
  const resolution = resolveElementName({ token: target.name, elements, context });
  if (resolution.status === "resolved" && resolution.element.id === groupId) {
    return formatDslName(target.name);
  }
  const qualified = rootTokens.get(groupId);
  return qualified ? formatDslName(qualified) : groupId;
};

const printLayoutBlockLines = (
  layout: PrintLayout,
  displayName: string,
  elements: CadElement[],
  nameContext: ElementNameContext,
  rootTokens: Map<ElementId, string>,
  visibilityProfiles: VisibilityProfile[]
): string[] => {
  const profileName = layout.visibilityProfileId
    ? visibilityProfiles.find((profile) => profile.id === layout.visibilityProfileId)?.name ??
      layout.visibilityProfileId
    : undefined;
  const numeric = (value: Parameters<typeof formatNumericValueForDsl>[0], localVars: NumericVariable[] = []) =>
    formatNumericValueForDsl(value, elements, localVars, undefined, nameContext);

  const header = [
    "printLayout",
    formatDslName(displayName),
    `output=${layout.outputKind}`,
    ...(profileName ? [`view=${formatDslName(profileName)}`] : []),
    `paper=${layout.paperSizeId}`,
    `orientation=${layout.orientation}`,
    `columns=${numeric(layout.columns)}`,
    `rows=${numeric(layout.rows)}`,
    `overlap=${numeric(layout.overlapMm)}`,
    `scale=${numeric(layout.scale)}`,
    `canvas=(${numeric(layout.svgCanvasWidthMm)}, ${numeric(layout.svgCanvasHeightMm)})`,
    "{"
  ].join(" ");

  const localVars = layout.numericVariables ?? [];
  const memberLines: string[] = [];
  for (const variable of localVars) {
    memberLines.push(
      `${DSL_INDENT}layoutVar ${formatDslName(variable.name)} = ${numeric(variable.value, localVars)}`
    );
  }
  for (const placement of layout.placements) {
    memberLines.push(
      [
        `${DSL_INDENT}place`,
        resolveGroupToken(elements, placement.groupId, nameContext, rootTokens),
        `at=(${numeric(placement.x, localVars)}, ${numeric(placement.y, localVars)})`,
        `angle=${numeric(placement.angleDeg, localVars)}`,
        `mirrorX=${placement.mirrorX}`
      ].join(" ")
    );
  }

  return [header, ...memberLines, "}"];
};

const PRINT_LAYOUT_PROMOTED_NAME_BASE = "レイアウト";

export type PrintLayoutSectionPlan = {
  /** レイアウトごとのブロック行(ヘッダ行〜閉じ `}` 行、無名アクティブの名前昇格適用済み)。 */
  blocks: Array<{ layoutId: string; lines: string[] }>;
  /** アクティブが先頭の場合は null(省略)。 */
  activePrintLayoutLine: string | null;
};

// printLayoutセクションの構造化プラン。全体シリアライズ(serializeDocumentToDsl)と
// 行パッチ(src/document/textPatch.ts)が同一の名前昇格ロジックを共有する。
export const planPrintLayoutSection = (data: DslDocumentData): PrintLayoutSectionPlan => {
  const { printLayouts, activePrintLayoutId, elements, visibilityProfiles } = data;
  if (printLayouts.length === 0) return { blocks: [], activePrintLayoutLine: null };
  const nameContext = createElementNameContext(elements);
  const rootTokens = shortestDslTokensById(elements, undefined, nameContext);

  const activeLayout = printLayouts.find((layout) => layout.id === activePrintLayoutId);
  const activeIsFirst = printLayouts[0]?.id === activePrintLayoutId;

  let promotedName: string | undefined;
  if (activeLayout && !activeLayout.name.trim() && !activeIsFirst) {
    const usedNames = new Set(printLayouts.filter((layout) => layout.name.trim()).map((layout) => layout.name.trim()));
    let index = 1;
    while (usedNames.has(`${PRINT_LAYOUT_PROMOTED_NAME_BASE}${index}`)) index += 1;
    promotedName = `${PRINT_LAYOUT_PROMOTED_NAME_BASE}${index}`;
  }

  const blocks = printLayouts.map((layout) => {
    const displayName = activeLayout && layout.id === activeLayout.id && promotedName ? promotedName : layout.name;
    return {
      layoutId: layout.id,
      lines: printLayoutBlockLines(layout, displayName, elements, nameContext, rootTokens, visibilityProfiles)
    };
  });
  const activePrintLayoutLine =
    activeLayout && !activeIsFirst
      ? `activePrintLayout ${formatDslName(promotedName ?? activeLayout.name)}`
      : null;
  return { blocks, activePrintLayoutLine };
};

const serializePrintLayoutSection = (data: DslDocumentData): string[] => {
  const plan = planPrintLayoutSection(data);
  return [
    ...plan.blocks.flatMap((block) => block.lines),
    ...(plan.activePrintLayoutLine ? [plan.activePrintLayoutLine] : [])
  ];
};

// ==== 要素ツリー(ブレースブロック + @stop) ====

type BlockFrame = {
  elementId: ElementId;
  kind: "group" | "conditionalGroup" | "forGroup";
  branch: "then" | "else";
};

const containerKind = (type: CadElementType): BlockFrame["kind"] | null =>
  type === "group" || type === "conditionalGroup" || type === "forGroup" ? type : null;

export type ElementTreeLine = {
  /** インデント・末尾 `{` 込みの完全な行テキスト。 */
  text: string;
  /** 正準インデント深さ(blockEnd/blockElse は開き文と同じ深さ)。 */
  depth: number;
  role: "statement" | "blockEnd" | "blockElse" | "atStop";
  /** statement 行はその要素、blockEnd / blockElse 行は対応する開き要素のID。 */
  elementId?: ElementId;
  /** parent=/branch= フォールバックで出力されたトップレベル文。 */
  fallback?: boolean;
};

// 要素配列の正準ブロック構造を行レコード列として構築する。全体シリアライズと
// 行パッチ(src/document/textPatch.ts)がこの単一の構造計算を共有することで、
// パッチ結果が常にシリアライザ産テキストと構造的に一致する。
export const layoutElementTree = (
  elements: CadElement[],
  refs: DslSerializerRefs,
  evaluationLimitIndex: number
): ElementTreeLine[] => {
  const lines: ElementTreeLine[] = [];
  const stack: BlockFrame[] = [];
  const limit = Math.max(0, Math.min(evaluationLimitIndex, elements.length));
  let emitted = 0;

  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const frame = stack.pop()!;
      lines.push({
        text: `${DSL_INDENT.repeat(stack.length)}}`,
        depth: stack.length,
        role: "blockEnd",
        elementId: frame.elementId
      });
    }
  };

  for (const element of elements) {
    if (emitted === limit) {
      lines.push({ text: `${DSL_INDENT.repeat(stack.length)}@stop`, depth: stack.length, role: "atStop" });
    }

    const parentId = element.parentGroupId;
    const desiredBranch: "then" | "else" = element.conditionalBranch === "else" ? "else" : "then";
    const targetIdx = parentId ? stack.findIndex((frame) => frame.elementId === parentId) : -1;

    // 非連続な親子配置(並べ替え禁止の帰結として通常のブロック表現が
    // 不可能な場合)は、過渡期のフォールバックとして parent=/branch=
    // 属性付きのトップレベル文で無損失に出力する。Phase 1c以降は
    // テキストが正準になりブレースが構造を強制するため、この分岐へは
    // 到達しなくなる想定(Phase 5で `parent=` パース受理ごと削除)。
    let fallback = Boolean(parentId) && targetIdx === -1;
    if (!fallback && targetIdx >= 0) {
      const top = stack[targetIdx];
      if (top.kind === "conditionalGroup" && top.branch === "else" && desiredBranch === "then") {
        fallback = true;
      }
    }

    if (fallback) {
      closeTo(0);
      const parentToken = formatDslName(refs.token(parentId!, element));
      const branchSuffix = element.conditionalBranch === "else" ? " branch=else" : "";
      lines.push({
        text: `${serializeElementStatement(element, refs)} parent=${parentToken}${branchSuffix}`,
        depth: 0,
        role: "statement",
        elementId: element.id,
        fallback: true
      });
    } else {
      closeTo(targetIdx + 1);
      if (targetIdx >= 0) {
        const top = stack[targetIdx];
        if (top.kind === "conditionalGroup" && top.branch === "then" && desiredBranch === "else") {
          lines.push({
            text: `${DSL_INDENT.repeat(targetIdx)}} else {`,
            depth: targetIdx,
            role: "blockElse",
            elementId: top.elementId
          });
          top.branch = "else";
        }
      }
      const kind = containerKind(element.type);
      lines.push({
        text: `${DSL_INDENT.repeat(stack.length)}${serializeElementStatement(element, refs)}${kind ? " {" : ""}`,
        depth: stack.length,
        role: "statement",
        elementId: element.id
      });
      if (kind) stack.push({ elementId: element.id, kind, branch: "then" });
    }

    emitted += 1;
  }

  closeTo(0);
  return lines;
};

const serializeElementTree = (
  elements: CadElement[],
  refs: DslSerializerRefs,
  evaluationLimitIndex: number
): string[] => layoutElementTree(elements, refs, evaluationLimitIndex).map((line) => line.text);

// ==== ファサード ====

export const serializeDocumentToDsl = (
  data: DslDocumentData,
  options: SerializeDslDocumentOptions = {}
): string => {
  const refs = documentDslRefs(data.elements);
  const sections: string[][] = [
    [`nui ${DSL_VERSION}`, ...(options.headerComment ? [`# ${options.headerComment}`] : [])],
    serializePaletteLines(data.palette),
    serializeVisibilitySettingsLines(data.visibilityRoles, data.visibilityProfiles, data.activeVisibilityProfileId),
    serializePrintLayoutSection(data),
    serializeElementTree(data.elements, refs, data.evaluationLimitIndex)
  ];
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
};

const versionDiagnostics = (statements: DslStatement[]): DslDiagnostic[] => {
  const diagnostics: DslDiagnostic[] = [];
  const versionStatements = statements.filter((statement) => statement.kind === "version");
  const firstStatement = statements[0];

  if (!firstStatement) {
    diagnostics.push(versionDiagnostic(1, "文書が空です。先頭に `nui 1` が必要です。"));
  } else if (firstStatement.kind !== "version") {
    diagnostics.push(versionDiagnostic(firstStatement.line, "文書の先頭は `nui <バージョン>` である必要があります。"));
  } else {
    const value = Number(firstStatement.value.trim());
    if (!Number.isInteger(value) || value <= 0) {
      diagnostics.push(versionDiagnostic(firstStatement.line, `不正なDSLバージョンです: ${firstStatement.value}`));
    } else if (value !== DSL_VERSION) {
      diagnostics.push(
        versionDiagnostic(firstStatement.line, `未対応のDSLバージョンです: ${value}(対応: ${DSL_VERSION})`)
      );
    }
  }
  for (const extra of versionStatements.slice(1)) {
    diagnostics.push(versionDiagnostic(extra.line, "`nui` は文書の先頭に1つだけ書けます。"));
  }
  return diagnostics;
};

const attrValueOf = (statement: DslStatement, key: string) =>
  statement.attrs.find((item) => item.key === key)?.value;

const buildStatementMap = (
  statements: DslStatement[],
  lastLine: number,
  elementIdByStatementIndex: Map<number, ElementId>,
  printLayoutIdsByStatementIndex: Map<number, string> | undefined
): StatementMap => {
  const infos: StatementInfo[] = [];
  const stack: StatementInfo[] = [];
  const byKey = new Map<string, StatementInfo>();
  const setFirst = (key: string, info: StatementInfo) => {
    if (!byKey.has(key)) byKey.set(key, info);
  };

  statements.forEach((statement, statementIndex) => {
    if (statement.kind === "blockEnd") {
      const info: StatementInfo = {
        statementIndex,
        kind: statement.kind,
        line: statement.line,
        range: { startLine: statement.line, endLine: statement.line },
        indentDepth: Math.max(0, stack.length - 1),
        enclosing: statement.enclosing
      };
      const top = stack.pop();
      if (top) top.range.endLine = statement.line;
      infos.push(info);
      return;
    }
    if (statement.kind === "blockElse") {
      const info: StatementInfo = {
        statementIndex,
        kind: statement.kind,
        line: statement.line,
        range: { startLine: statement.line, endLine: statement.line },
        indentDepth: Math.max(0, stack.length - 1),
        enclosing: statement.enclosing
      };
      const top = stack.at(-1);
      if (top) top.elseLine = statement.line;
      infos.push(info);
      return;
    }

    const info: StatementInfo = {
      statementIndex,
      kind: statement.kind,
      line: statement.line,
      range: { startLine: statement.line, endLine: statement.line },
      indentDepth: stack.length,
      enclosing: statement.enclosing
    };
    infos.push(info);
    if (statement.opensBlock) stack.push(info);

    switch (statement.kind) {
      case "color":
        byKey.set(`color:${statement.name}`, info);
        break;
      case "role":
        byKey.set(`role:${attrValueOf(statement, "id") ?? statement.name}`, info);
        break;
      case "view":
        byKey.set(`view:${attrValueOf(statement, "id") ?? statement.name}`, info);
        break;
      case "printLayout": {
        const layoutId = printLayoutIdsByStatementIndex?.get(statementIndex) ?? statement.name;
        if (layoutId) byKey.set(`printLayout:${layoutId}`, info);
        break;
      }
      case "version":
        setFirst("version", info);
        break;
      case "atStop":
        setFirst("atStop", info);
        break;
      case "activeView":
        byKey.set("activeView", info);
        break;
      case "activePrintLayout":
        byKey.set("activePrintLayout", info);
        break;
      default:
        break;
    }
  });

  // 未閉鎖ブロックはエラー診断付きでここへは来ない前提だが、防御的に文末で閉じる。
  for (const open of stack) open.range.endLine = lastLine;

  const byElementId = new Map<ElementId, StatementInfo>();
  for (const [statementIndex, elementId] of elementIdByStatementIndex) {
    const info = infos[statementIndex];
    if (info) byElementId.set(elementId, info);
  }

  const sectionEnds: StatementMap["sectionEnds"] = {};
  for (const info of infos) {
    const statement = statements[info.statementIndex];
    if (statement.kind === "version") {
      sectionEnds.version = Math.max(sectionEnds.version ?? 0, info.line);
    } else if (statement.kind === "color") {
      sectionEnds.palette = Math.max(sectionEnds.palette ?? 0, info.line);
    } else if (statement.kind === "role" || statement.kind === "view" || statement.kind === "activeView") {
      sectionEnds.visibility = Math.max(sectionEnds.visibility ?? 0, info.line);
    } else if (statement.kind === "printLayout" || statement.kind === "activePrintLayout") {
      sectionEnds.printLayouts = Math.max(sectionEnds.printLayouts ?? 0, info.range.endLine);
    }
  }

  return {
    statements: infos,
    byElementId,
    elementIdByStatementIndex,
    byKey,
    sectionEnds
  };
};

// 文書全体を1回のパースでコンパイルし、文⇄行対応(StatementMap)と診断を返す。
// statementReconciler の照合結果は options.assignedElementIds で注入できる。
export const compileDslDocument = (
  source: string,
  options: CompileDslDocumentOptions = {}
): CompiledDslDocument => {
  const normalized = source.replace(/\r\n/g, "\n");
  const sourceLines = normalized.split("\n");
  const parsed = parseDsl(normalized);
  const diagnostics = versionDiagnostics(parsed.statements);

  const compiled = compileDslToElements(normalized, {
    elements: [],
    mode: "document",
    preparsed: parsed,
    assignedElementIds: options.assignedElementIds
  });
  const allDiagnostics = [...diagnostics, ...compiled.diagnostics];

  if (allDiagnostics.some((item) => item.severity === "error")) {
    return {
      document: null,
      statements: parsed.statements,
      statementMap: null,
      sourceLines,
      diagnostics: allDiagnostics
    };
  }

  const visibilityProfiles = compiled.visibilityProfiles?.length
    ? compiled.visibilityProfiles
    : [defaultVisibilityProfile()];
  const printLayouts = compiled.printLayouts ?? [];

  const document: DslDocumentData = {
    elements: compiled.elements,
    palette: compiled.palette ?? defaultDocumentPalette(),
    visibilityRoles: compiled.visibilityRoles ?? [],
    visibilityProfiles,
    activeVisibilityProfileId:
      compiled.activeVisibilityProfileId ?? visibilityProfiles[0]?.id ?? DEFAULT_VISIBILITY_PROFILE_ID,
    printLayouts,
    activePrintLayoutId: compiled.activePrintLayoutId ?? printLayouts[0]?.id ?? "",
    evaluationLimitIndex: compiled.evaluationLimitIndex ?? compiled.elements.length
  };

  const statementMap = buildStatementMap(
    parsed.statements,
    sourceLines.length,
    compiled.elementIdsByStatementIndex ?? new Map(),
    compiled.printLayoutIdsByStatementIndex
  );

  return { document, statements: parsed.statements, statementMap, sourceLines, diagnostics: allDiagnostics };
};

export const parseDslDocument = (source: string): ParseDslDocumentResult => {
  const compiled = compileDslDocument(source);
  return { document: compiled.document, diagnostics: compiled.diagnostics };
};
