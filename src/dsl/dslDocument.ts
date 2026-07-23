import { defaultDocumentPalette } from "../palette/palette";
import {
  createElementNameContext,
  elementQualifiedNameParts,
  resolveElementName,
  type ElementNameContext
} from "../model/elementNames";
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
import { lowerScalarProgram } from "../scalars/scalarProgram";
import { analyzeTypedDeclarations } from "../scalars/typedDeclarationAnalysis";
import { formatNumericValueForDsl } from "./dslExpressionFormat";
import { parseDsl, parseDslSnapshot } from "./dslParser";
import type { SourceRevision } from "./logicalStatementSourceMap";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { ScalarProgram, ScalarProgramPositionMap } from "../scalars/scalarProgram";
import {
  documentDslRefs,
  flatRefs,
  serializedStatementLines,
  serializeVisibilitySettingsLines,
  type DslSerializerRefs
} from "./dslSerializer";
import { serializeElementStatementBlock, type SerializedStatement } from "./dslSerializeElement";
import type { DslDiagnostic, DslEnclosing, DslStatement, ParseDslResult } from "./dslTypes";
import { formatDslReferencePath, formatDslReferenceToken } from "./dslReferenceTokens";
import { DSL_INDENT, formatDslName, quoteDslString } from "./dslTokens";
import {
  isSupportedDslMajorVersion,
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  SUPPORTED_DSL_MAJOR_VERSIONS,
  type DslMajorVersion
} from "./dslVersion";

export {
  LEGACY_IMPORT_DSL_MAJOR_VERSION,
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  requireDslMajorVersionForFeature,
  SUPPORTED_DSL_MAJOR_VERSIONS,
  TYPED_SYNTAX_REQUIRES_NUI3_CODE,
  type DslMajorVersion
} from "./dslVersion";

// `nui 2` 文書全体のcompile / serializeファサード。`.nui` のsourceTextを唯一の
// 正として扱い、ここではテキストと構造化データの往復だけを担う。

export type DslDocumentData = {
  elements: CadElement[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
  /** `undefined` means no @stop marker; a numeric value includes an explicit terminal @stop. */
  evaluationLimitIndex: number | undefined;
};

export type SerializeDslDocumentOptions = {
  headerComment?: string;
  /** Keep the supplied element order and legacy ID references instead of nesting blocks. */
  preserveElementOrder?: boolean;
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
  /** 文ヘッダー自身の最終物理行。ブロック全体の終端とは別。 */
  endLine: number;
  /** ブロックを開く文は開き行〜対応する `}` 行。それ以外は line..line。 */
  range: LineRange;
  /** conditionalGroup ブロックの `} else {` 行(あれば)。 */
  elseLine?: number;
  /** Independent structural source lines. Never inferred from a header. */
  openBraceLine?: number;
  elseBraceLine?: number;
  closeBraceLine?: number;
  sourceRevision: SourceRevision;
  /** 正準インデント深さ(ブロックスタック深さ)。 */
  indentDepth: number;
  enclosing: DslEnclosing | null;
};

export type StatementMap = {
  sourceRevision: SourceRevision;
  /** パース結果の全文と並行(index一致)。 */
  statements: StatementInfo[];
  byElementId: Map<ElementId, StatementInfo>;
  elementIdByStatementIndex: Map<number, ElementId>;
  /** Reconciler-owned identities, present only when typed declarations need them. */
  statementIdByStatementIndex?: Map<number, string>;
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
  /**
   * 先頭のversion文だけから決まる。要素文など本文側の他のエラーとは独立。
   * nullになるのはheader自体が欠落・重複・不正・未対応の場合だけで、本文の
   * 無関係なエラーでdocumentがnullになっても、正しいheaderがあればここは
   * 値を保つ。
   */
  majorVersion: DslMajorVersion | null;
  statements: DslStatement[];
  /** エラー診断がある場合は null。 */
  statementMap: StatementMap | null;
  /** 改行正規化済みソースの行配列。 */
  sourceLines: string[];
  diagnostics: DslDiagnostic[];
  scalarProgram?: ScalarProgram;
  bindingAnalysis?: BindingAnalysis;
  scalarProgramPositionMap?: ScalarProgramPositionMap;
};

export type CompileDslDocumentOptions = {
  /** 文index(全文配列基準)→ 継承させる実行時要素ID(statementReconciler の出力)。 */
  assignedElementIds?: ReadonlyMap<number, ElementId>;
  /** Superset of assignedElementIds; typed declarations require this opaque identity. */
  assignedStatementIds?: ReadonlyMap<number, string>;
  /** 同じsourceを事前parseした結果。指定時はdocument compile内の再parseを省く。 */
  preparsed?: ParseDslResult;
  sourceRevision?: SourceRevision;
};

const versionDiagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

// ==== パレット ====

export const serializePaletteColorLine = (color: PaletteColor, defaultColorId: string): string => {
  const args = [
    quoteDslString(color.hex),
    `name: ${quoteDslString(color.name)}`,
    ...(color.id === defaultColorId ? ["default: true"] : [])
  ];
  return `color ${formatDslName(color.id)} (${args.join(" ")})`;
};

export const serializePaletteLines = (palette: DocumentPalette): string[] =>
  palette.colors.map((color) => serializePaletteColorLine(color, palette.defaultColorId));

// ==== 印刷レイアウト ====

const resolveGroupToken = (
  elements: CadElement[],
  groupId: ElementId,
  context: ElementNameContext
): string => {
  const target = context.elementsById.get(groupId);
  if (!target || !target.name.trim()) return formatDslReferenceToken(groupId);
  const resolution = resolveElementName({ token: target.name, elements, context });
  if (resolution.status === "resolved" && resolution.element.id === groupId) {
    return formatDslName(target.name);
  }
  return formatDslReferencePath({
    absolute: false,
    segments: elementQualifiedNameParts(target, elements, context)
  });
};

const printLayoutBlockLines = (
  layout: PrintLayout,
  displayName: string,
  elements: CadElement[],
  nameContext: ElementNameContext,
  visibilityProfiles: VisibilityProfile[]
): string[] => {
  const profileName = layout.visibilityProfileId
    ? visibilityProfiles.find((profile) => profile.id === layout.visibilityProfileId)?.name ??
      layout.visibilityProfileId
    : undefined;
  const numeric = (value: Parameters<typeof formatNumericValueForDsl>[0], localVars: NumericVariable[] = []) =>
    formatNumericValueForDsl(value, elements, localVars, undefined, nameContext);
  const layoutNumeric = (value: Parameters<typeof formatNumericValueForDsl>[0]) =>
    numeric(value, layout.numericVariables ?? []);

  const argLines = [
    `output: ${layout.outputKind}`,
    ...(profileName ? [`view: ${formatDslName(profileName)}`] : []),
    `paper: ${layout.paperSizeId}`,
    `orientation: ${layout.orientation}`,
    `columns: ${layoutNumeric(layout.columns)}`,
    `rows: ${layoutNumeric(layout.rows)}`,
    `overlap: ${layoutNumeric(layout.overlapMm)}`,
    `scale: ${layoutNumeric(layout.scale)}`,
    `canvas: (${layoutNumeric(layout.svgCanvasWidthMm)}, ${layoutNumeric(layout.svgCanvasHeightMm)})`
  ];

  const localVars = layout.numericVariables ?? [];
  const memberLines: string[] = [];
  for (const variable of localVars) {
    memberLines.push(
      `${DSL_INDENT}layoutVar ${formatDslName(variable.name)} = ${numeric(variable.value, localVars)}`
    );
  }
  for (const placement of layout.placements) {
    memberLines.push(
      `${DSL_INDENT}place ${resolveGroupToken(elements, placement.groupId, nameContext)} (at: (${numeric(placement.x, localVars)}, ${numeric(placement.y, localVars)}) angle: ${numeric(placement.angleDeg, localVars)} mirrorX: ${placement.mirrorX})`
    );
  }

  return [
    `printLayout ${formatDslName(displayName)} (`,
    ...argLines.map((line) => `${DSL_INDENT}${line}`),
    ") {",
    ...memberLines,
    "}"
  ];
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
  if (printLayouts.length === 0) {
    return {
      blocks: [],
      activePrintLayoutLine: activePrintLayoutId
        ? `activePrintLayout ${formatDslName(activePrintLayoutId)}`
        : null
    };
  }
  const nameContext = createElementNameContext(elements);

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
      lines: printLayoutBlockLines(layout, displayName, elements, nameContext, visibilityProfiles)
    };
  });
  const activePrintLayoutLine = activeLayout
    ? !activeIsFirst
      ? `activePrintLayout ${formatDslName(promotedName ?? activeLayout.name)}`
      : null
    : activePrintLayoutId
      ? `activePrintLayout ${formatDslName(activePrintLayoutId)}`
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

export type ElementTreeRow = {
  /** この文の(インデント済み)物理行群。縦型callは header/引数行.../close の複数行。 */
  lines: string[];
  /** lines と並行。各行が担う引数キー名(header/close/構造行はnull)。 */
  argKeys: (string | null)[];
  /** 正準インデント深さ(blockEnd/blockElse は開き文と同じ深さ)。 */
  depth: number;
  role: "statement" | "blockEnd" | "blockElse" | "atStop";
  /** statement 行はその要素、blockEnd / blockElse 行は対応する開き要素のID。 */
  elementId?: ElementId;
  /** parent:/branch: フォールバックで出力されたトップレベル文。 */
  fallback?: boolean;
};

// container(group/if/for)ヘッダの `{` は独立した blockStart 行を合成せず、
// ヘッダ自身の最終物理行に直接乗せる(確定仕様1.3: v2正準形はヘッダ行末尾に
// `{`)。P5 containerStatement は常に1行ヘッダ(close: null)を返すため、
// その1行の末尾に " {" を足すだけでよい。
const statementRows = (
  statement: SerializedStatement,
  depth: number,
  appendBrace: boolean
): { lines: string[]; argKeys: (string | null)[] } => {
  const indent = DSL_INDENT.repeat(depth);
  if (!statement.close) {
    return { lines: [`${indent}${statement.header}${appendBrace ? " {" : ""}`], argKeys: [null] };
  }
  const argIndent = `${indent}${DSL_INDENT}`;
  return {
    lines: [
      `${indent}${statement.header}`,
      ...statement.args.map((arg) => `${argIndent}${arg.text}`),
      `${indent}${statement.close}${appendBrace ? " {" : ""}`
    ],
    argKeys: [null, ...statement.args.map((arg) => arg.key), null]
  };
};

// 非連続な親子配置(並べ替え禁止の帰結として通常のブロック表現が不可能な
// 場合)の過渡期フォールバック用: parent:/branch: を呼び出しの引数として
// 差し込む(短形式 var のように呼び出し本体を持たない header は
// expression(...) 呼び出しへ開き直す)。Phase 5で `parent=` パース受理ごと
// このフォールバック自体を削除する想定。
export const withFallbackParentArgs = (
  statement: SerializedStatement,
  parentToken: string,
  branch: "then" | "else"
): SerializedStatement => {
  const extra = [
    { key: "parent", text: `parent: ${parentToken}` },
    ...(branch === "else" ? [{ key: "branch", text: "branch: else" }] : [])
  ];
  if (statement.close) return { ...statement, args: [...statement.args, ...extra] };
  const equalsIndex = statement.header.indexOf("=");
  const before = statement.header.slice(0, equalsIndex).trimEnd();
  const value = statement.header.slice(equalsIndex + 1).trim();
  return { header: `${before} = expression(`, args: [{ key: "value", text: `value: ${value}` }, ...extra], close: ")" };
};

// 要素配列の正準ブロック構造を行レコード列として構築する。全体シリアライズと
// 行パッチ(src/document/textPatch.ts)がこの単一の構造計算を共有することで、
// パッチ結果が常にシリアライザ産テキストと構造的に一致する。
export const layoutElementTree = (
  elements: CadElement[],
  refs: DslSerializerRefs,
  evaluationLimitIndex: number | undefined
): ElementTreeRow[] => {
  const lines: ElementTreeRow[] = [];
  const stack: BlockFrame[] = [];
  const hasAtStop = evaluationLimitIndex !== undefined;
  const limit = Math.max(0, Math.min(evaluationLimitIndex ?? elements.length, elements.length));
  let emitted = 0;

  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const frame = stack.pop()!;
      lines.push({
        lines: [`${DSL_INDENT.repeat(stack.length)}}`],
        argKeys: [null],
        depth: stack.length,
        role: "blockEnd",
        elementId: frame.elementId
      });
    }
  };

  for (const element of elements) {
    if (hasAtStop && emitted === limit) {
      lines.push({
        lines: [`${DSL_INDENT.repeat(stack.length)}@stop`],
        argKeys: [null],
        depth: stack.length,
        role: "atStop"
      });
    }

    const parentId = element.parentGroupId;
    const desiredBranch: "then" | "else" = element.conditionalBranch === "else" ? "else" : "then";
    const targetIdx = parentId ? stack.findIndex((frame) => frame.elementId === parentId) : -1;

    // 非連続な親子配置(並べ替え禁止の帰結として通常のブロック表現が
    // 不可能な場合)は、過渡期のフォールバックとして parent:/branch:
    // 引数付きのトップレベル文で無損失に出力する。Phase 1c以降は
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
      const parentToken = refs.token(parentId!, element);
      const statement = withFallbackParentArgs(serializeElementStatementBlock(element, refs), parentToken, desiredBranch);
      const rows = statementRows(statement, 0, false);
      lines.push({
        lines: rows.lines,
        argKeys: rows.argKeys,
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
            lines: [`${DSL_INDENT.repeat(targetIdx)}} else {`],
            argKeys: [null],
            depth: targetIdx,
            role: "blockElse",
            elementId: top.elementId
          });
          top.branch = "else";
        }
      }
      const kind = containerKind(element.type);
      const rows = statementRows(serializeElementStatementBlock(element, refs), stack.length, Boolean(kind));
      lines.push({
        lines: rows.lines,
        argKeys: rows.argKeys,
        depth: stack.length,
        role: "statement",
        elementId: element.id
      });
      if (kind) {
        stack.push({ elementId: element.id, kind, branch: "then" });
      }
    }

    emitted += 1;
  }

  closeTo(0);
  if (hasAtStop && emitted === limit) {
    lines.push({
      lines: ["@stop"],
      argKeys: [null],
      depth: 0,
      role: "atStop"
    });
  }
  return lines;
};

const serializeElementTree = (
  elements: CadElement[],
  refs: DslSerializerRefs,
  evaluationLimitIndex: number | undefined
): string[] => layoutElementTree(elements, refs, evaluationLimitIndex).flatMap((line) => line.lines);

// ==== ファサード ====

// preserveElementOrder(フラット出力)専用: group/if/for は v2 文法上
// 常に `{`/`}` ブロックを要求するため、子を入れ子にせず id=/parent= の
// フラット属性だけで表現する場合でも、ヘッダ直後に空ブロックを添える。
const serializedFlatStatementLines = (element: CadElement, statement: SerializedStatement): string[] =>
  containerKind(element.type)
    ? [`${statement.header} {`, "}"]
    : serializedStatementLines(statement, "");

const serializeFlatElementTree = (
  elements: CadElement[],
  refs: DslSerializerRefs,
  evaluationLimitIndex: number | undefined
) => {
  const lines: string[] = [];
  const hasAtStop = evaluationLimitIndex !== undefined;
  const limit = Math.max(0, Math.min(evaluationLimitIndex ?? elements.length, elements.length));
  for (const [index, element] of elements.entries()) {
    if (hasAtStop && index === limit) lines.push("@stop");
    lines.push(...serializedFlatStatementLines(element, serializeElementStatementBlock(element, refs)));
  }
  if (hasAtStop && limit === elements.length) lines.push("@stop");
  return lines;
};

export const serializeDocumentToDsl = (
  data: DslDocumentData,
  majorVersion: DslMajorVersion,
  options: SerializeDslDocumentOptions = {}
): string => {
  const refs = options.preserveElementOrder ? flatRefs(majorVersion) : documentDslRefs(data.elements, majorVersion);
  const sections: string[][] = [
    [`nui ${majorVersion}`, ...(options.headerComment ? [`# ${options.headerComment}`] : [])],
    serializePaletteLines(data.palette),
    serializeVisibilitySettingsLines(data.visibilityRoles, data.visibilityProfiles, data.activeVisibilityProfileId),
    serializePrintLayoutSection(data),
    options.preserveElementOrder
      ? serializeFlatElementTree(data.elements, refs, data.evaluationLimitIndex)
      : serializeElementTree(data.elements, refs, data.evaluationLimitIndex)
  ];
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
};

type VersionValidation = {
  diagnostics: DslDiagnostic[];
  unsupportedMajor: number | null;
  /**
   * 先頭のversion文だけで決まる。文書全体のエラー有無とは独立。missing/
   * duplicate/invalid/unsupported headerのときだけnull。
   */
  majorVersion: DslMajorVersion | null;
};

const validateVersionStatements = (statements: DslStatement[]): VersionValidation => {
  const diagnostics: DslDiagnostic[] = [];
  let unsupportedMajor: number | null = null;
  let majorVersion: DslMajorVersion | null = null;
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
    } else if (!isSupportedDslMajorVersion(value)) {
      unsupportedMajor = value;
      diagnostics.push(
        versionDiagnostic(
          firstStatement.line,
          `未対応のDSLバージョンです: ${value}(対応: ${SUPPORTED_DSL_MAJOR_VERSIONS.join(", ")})`
        )
      );
    } else {
      majorVersion = value;
    }
  }
  for (const extra of versionStatements.slice(1)) {
    diagnostics.push(versionDiagnostic(extra.line, "`nui` は文書の先頭に1つだけ書けます。"));
  }
  // 重複headerは(先頭が有効でも)どのmajorが正なのか曖昧なため、確定させない。
  if (versionStatements.length > 1) majorVersion = null;
  return { diagnostics, unsupportedMajor, majorVersion };
};

/**
 * ファイル読込境界用。コンパイラと同じversion検証を使い、先頭の有効な
 * version指令が現在未対応のmajorかだけを返す。
 */
export const unsupportedDslMajorVersion = (source: string): number | null =>
  validateVersionStatements(parseDsl(source).statements).unsupportedMajor;

const attrValueOf = (statement: DslStatement, key: string) =>
  statement.attrs.find((item) => item.key === key)?.value;

const buildStatementMap = (
  statements: DslStatement[],
  lastLine: number,
  elementIdByStatementIndex: Map<number, ElementId>,
  printLayoutIdsByStatementIndex: Map<number, string> | undefined,
  assignedStatementIds?: ReadonlyMap<number, string>
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
        endLine: statement.endLine,
        range: { startLine: statement.line, endLine: statement.line },
        indentDepth: Math.max(0, stack.length - 1),
        enclosing: statement.enclosing,
        sourceRevision: statement.sourceRevision
      };
      const top = stack.pop();
      if (top) {
        top.range.endLine = statement.line;
        top.closeBraceLine = statement.line;
      }
      infos.push(info);
      return;
    }
    if (statement.kind === "blockElse") {
      const info: StatementInfo = {
        statementIndex,
        kind: statement.kind,
        line: statement.line,
        endLine: statement.endLine,
        range: { startLine: statement.line, endLine: statement.line },
        indentDepth: Math.max(0, stack.length - 1),
        enclosing: statement.enclosing,
        sourceRevision: statement.sourceRevision
      };
      const top = stack.at(-1);
      if (top) {
        top.elseLine = statement.line;
        top.elseBraceLine = statement.line;
      }
      infos.push(info);
      return;
    }

    const info: StatementInfo = {
      statementIndex,
      kind: statement.kind,
      line: statement.line,
      endLine: statement.endLine,
      range: { startLine: statement.line, endLine: statement.line },
      indentDepth: stack.length,
      enclosing: statement.enclosing,
      sourceRevision: statement.sourceRevision,
      openBraceLine: statement.openBraceLine
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
  const statementIdByStatementIndex = assignedStatementIds
    ? new Map<number, string>(assignedStatementIds)
    : undefined;
  if (statementIdByStatementIndex) {
    for (const [statementIndex, elementId] of elementIdByStatementIndex) {
      statementIdByStatementIndex.set(statementIndex, elementId);
    }
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
    sourceRevision: statements[0]?.sourceRevision ?? 0,
    statements: infos,
    byElementId,
    elementIdByStatementIndex,
    ...(statementIdByStatementIndex ? { statementIdByStatementIndex } : {}),
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
  const parsed = options.preparsed ?? parseDslSnapshot({ normalizedSource: normalized, sourceRevision: options.sourceRevision ?? 0 });
  const versionValidation = validateVersionStatements(parsed.statements);

  const compiled = compileDslToElements(normalized, {
    elements: [],
    mode: "document",
    preparsed: parsed,
    assignedElementIds: options.assignedStatementIds ?? options.assignedElementIds,
    majorVersion: versionValidation.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION
  });
  const hasTypedDeclarations = parsed.statements.some((statement) => statement.kind === "typedDeclaration");
  const stableStatementIdByIndex = hasTypedDeclarations
    ? new Map<number, string>(options.assignedStatementIds ?? options.assignedElementIds ?? [])
    : undefined;
  if (stableStatementIdByIndex) {
    for (const [statementIndex, elementId] of compiled.elementIdsByStatementIndex ?? []) {
      stableStatementIdByIndex.set(statementIndex, elementId);
    }
  }
  const baseDiagnostics = [...versionValidation.diagnostics, ...compiled.diagnostics];

  if (baseDiagnostics.some((item) => item.severity === "error")) {
    return {
      document: null,
      majorVersion: versionValidation.majorVersion,
      statements: parsed.statements,
      statementMap: null,
      sourceLines,
      diagnostics: baseDiagnostics
    };
  }

  const scalarAnalysisCompilation = versionValidation.majorVersion === 3 && stableStatementIdByIndex
    ? analyzeTypedDeclarations({
        statements: parsed.statements,
        stableStatementIdByIndex,
        reconciledContainers: {
          elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
          elements: compiled.elements
        }
      })
    : { diagnostics: [] };
  const allDiagnostics = [...baseDiagnostics, ...scalarAnalysisCompilation.diagnostics];
  if (allDiagnostics.some((item) => item.severity === "error")) {
    return {
      document: null,
      majorVersion: versionValidation.majorVersion,
      statements: parsed.statements,
      statementMap: null,
      sourceLines,
      diagnostics: allDiagnostics
    };
  }
  const scalarAnalysis = scalarAnalysisCompilation.analysis;
  const scalarProgram = scalarAnalysis ? lowerScalarProgram(scalarAnalysis) : undefined;

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
    evaluationLimitIndex: compiled.evaluationLimitIndex
  };

  const statementMap = buildStatementMap(
    parsed.statements,
    sourceLines.length,
    compiled.elementIdsByStatementIndex ?? new Map(),
    compiled.printLayoutIdsByStatementIndex,
    stableStatementIdByIndex
  );

  return {
    document,
    majorVersion: versionValidation.majorVersion,
    statements: parsed.statements,
    statementMap,
    sourceLines,
    diagnostics: allDiagnostics,
    ...(scalarProgram ? { scalarProgram } : {}),
    ...(scalarAnalysis ? { bindingAnalysis: scalarAnalysis.bindingAnalysis } : {}),
    ...(scalarAnalysis ? { scalarProgramPositionMap: scalarAnalysis.positionMap } : {})
  };
};

export const parseDslDocument = (source: string): ParseDslDocumentResult => {
  const compiled = compileDslDocument(source);
  return { document: compiled.document, diagnostics: compiled.diagnostics };
};
