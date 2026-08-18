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
  DrawingModifierDefinition,
  ElementId,
  PaletteColor,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { lowerScalarProgram } from "../scalars/scalarProgram";
import { analyzeTypedDeclarations } from "../scalars/typedDeclarationAnalysis";
import { bindingIssuesToDiagnostics } from "../scalars/bindingIssueDiagnostics";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { compilePropertyBindings, type ScalarValueSource } from "../scalars/propertyBindingCompiler";
import { compileNumericBindings, type CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import { compileConditionalGroupConditions } from "../scalars/conditionalGroupConditionCompiler";
import { compileSetStatements, type SetStatementAnalysis } from "../scalars/setStatementCompiler";
import {
  buildBindingControlMetadata,
  buildBindingVersionGraph,
  type BindingVersionGraph
} from "../scalars/bindingVersions";
import { compileTextTemplates, type TextTemplateAst } from "../scalars/textTemplate";
import { buildTypedDependencyGraph, type TypedDependencyGraph } from "../scalars/typedDependencyGraph";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { formatNumericValueForDsl } from "./dslExpressionFormat";
import { isCompilableDslStatement, type DslStatementInclusion } from "./dslCompilationGuard";
import { compilePropertyReferenceSyntax } from "./dslPropertyReferenceSyntax";
import { buildPlacementRefsByStatementIndex } from "./dslPrintLayoutPlacementIndex";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import {
  buildSourceLexicalNamespaceIndex,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";
import { analyzeModuleSemantics } from "./moduleSemanticAnalysis";
import type { ModuleSemanticAnalysis } from "./moduleSemanticTypes";
import type { ModuleMaterialization } from "./moduleMaterialization";
import { compileModuleScalarRuntime, moduleScalarBindingIdFor, moduleScalarExportBindingSeeds, type ModuleScalarRuntimeCompilation } from "../scalars/moduleScalarRuntime";
import { MISSING_ATTRIBUTE_VALUE_CODE } from "./dslArgScanner";
import { isElementDslStatement, parseDsl, parseDslSnapshot } from "./dslParser";
import type { SourceRevision } from "./logicalStatementSourceMap";
import { createStatementIdentity, type StatementIdentity } from "../document/statementIdentity";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { BindingId, SourceNamespaceBindingResolver } from "../scalars/bindingCatalog";
import type { ScalarProgram, ScalarProgramPositionMap } from "../scalars/scalarProgram";
import type {
  MaterializedNumericBindingSource,
  MaterializedPropertyBindingSource
} from "../scalars/moduleScalarRuntime";
import {
  documentDslRefs,
  flatRefs,
  serializedStatementLines,
  serializeVisibilitySettingsLines,
  type DslSerializerRefs
} from "./dslSerializer";
import { serializeElementStatementBlock, type SerializedStatement } from "./dslSerializeElement";
import type { DslDiagnostic, DslEnclosing, DslStatement, ParseDslResult } from "./dslTypes";
import { formatDslReferencePath, formatDslReferenceToken, parseDslReferenceToken } from "./dslReferenceTokens";
import { resolveSourceLexicalDeclaration } from "./sourceLexicalNamespaceIndex";
import { DSL_INDENT, formatDslName, quoteDslString } from "./dslTokens";
import {
  isSupportedDslMajorVersion,
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  SUPPORTED_DSL_MAJOR_VERSIONS,
  type DslMajorVersion
} from "./dslVersion";

export {
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  SUPPORTED_DSL_MAJOR_VERSIONS,
  type DslMajorVersion
} from "./dslVersion";

// `nui 4` 文書全体のcompile / serializeファサード。`.nui` のsourceTextを唯一の
// 正として扱い、ここではテキストと構造化データの往復だけを担う。

export type DslDocumentData = {
  elements: CadElement[];
  /** Document-level source definitions; runtime modifier resolution is deferred. */
  modifiers?: DrawingModifierDefinition[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
  /** `undefined` means no stop marker; a numeric value includes an explicit terminal stop. */
  evaluationLimitIndex: number | undefined;
};

export type SerializeDslDocumentOptions = {
  headerComment?: string;
  /** Keep the supplied element order && legacy ID references instead of nesting blocks. */
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
  /** Stable source ownership for document-level modifier definitions. */
  byModifierName: Map<string, StatementInfo>;
  /** Definition ranges keyed by the source modifier name. */
  modifierDefinitionRangeByName: Map<string, LineRange>;
  /** Reconciler-owned identities, present only when typed declarations need them. */
  statementIdByStatementIndex?: Map<number, string>;
  /** Reverse lookup for a current reconciler-owned statement identity. */
  statementIndexByStatementId?: Map<string, number>;
  /** Current physical statement range by reconciler-owned source identity. */
  statementRangeById: Map<StatementIdentity, StatementInfo>;
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
    modifiers?: number;
    visibility?: number;
    elements?: number;
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
  /** Task 48: this exact compile's span-projection context, so a later
   * diagnostic producer working from this compiled document (e.g.
   * runtimeScalarDiagnostics.ts, once an evaluation result arrives) can
   * project an exact physicalSpan without re-parsing. Always present -
   * depends only on the initial parse, not on how far compilation got. */
  spans: DiagnosticSpanContext;
  scalarProgram?: ScalarProgram;
  bindingAnalysis?: BindingAnalysis;
  scalarProgramPositionMap?: ScalarProgramPositionMap;
  /** Task 22 compiled property binding sources, keyed by propertyBindingOccurrenceKey. */
  propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  /** Task 48: Task 22's property binding sources grouped by bindingId - see
   * propertyBindingCompiler.ts's own field doc. */
  occurrenceKeysByBindingId?: ReadonlyMap<BindingId, readonly string[]>;
  /** Compiled typed occurrences within every canonical number parameter. */
  numericBindings?: ReadonlyMap<string, CompiledNumericBinding>;
  /**
   * Task 25 compiled typed boolean conditions for `conditionalGroup.condition`,
   * keyed by propertyBindingOccurrenceKey(statementIndex, "condition"). A
   * separate map from `propertyBindings` because the value here is a full
   * `TypedScalarExpression` AST, not a single-binding `ScalarValueSource` -
   * `condition` accepts an arbitrary boolean expression, not just a bare
   * `@name` reference.
   */
  conditionalGroupConditions?: ReadonlyMap<string, TypedScalarExpression>;
  /**
   * Task 26 compiled `label(text: ...)` templates, keyed by
   * propertyBindingOccurrenceKey(statementIndex, "text"). Present for every
   * nui 4 document with a canonical text occurrence, independent of whether
   * the document has any typed declaration at all - unlike propertyBindings/
   * conditionalGroupConditions above, this does not gate on `scalarAnalysis`.
   */
  textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  /**
   * Task 29 compiled `set name = expression` target/RHS resolution, keyed by
   * plain statementIndex rather than propertyBindingOccurrenceKey - a `set`
   * statement has exactly one target, unlike the multi-attribute occurrence
   * maps above, so the string occurrence-key format doesn't apply. Like
   * textTemplates, this does not gate on `scalarAnalysis` (a `set` with no
   * catalog to resolve against must still be diagnosed, not silently
   * dropped) - see compileSetStatements's own handling of an undefined
   * bindingAnalysis.
   */
  setStatements?: ReadonlyMap<number, SetStatementAnalysis>;
  /** Task 30 evaluation-neutral declaration/set version graph. */
  bindingVersions?: BindingVersionGraph;
  /** Task 36 static dependency graph for this exact compile attempt. */
  typedDependencyGraph?: TypedDependencyGraph;
  /** Task 2 source-only lexical declarations, including inert module bodies. */
  sourceLexicalNamespace?: SourceLexicalNamespaceIndex;
  /** Source-only semantic projection used by host-neutral Definition Query. */
  sourceSemanticAnalysis?: ModuleSemanticAnalysis;
  /** Task 3 source-only module semantic result; never contains runtime geometry || instance IDs. */
  moduleSemanticAnalysis?: ModuleSemanticAnalysis;
  /** Task 5 runtime expansion && source-origin mapping; never persisted as source. */
  moduleMaterialization?: ModuleMaterialization;
  /** Source-derived scalar order for materialized runtime occurrences. */
  scalarExecutionPositionByRuntimeElementId?: ReadonlyMap<ElementId, number>;
  /** Direct materialized occurrences; runtime builders consume these without re-resolution. */
  materializedPropertyBindings?: readonly MaterializedPropertyBindingSource[];
  materializedGroupPrintEnabledBindings?: ReadonlyMap<ElementId, ScalarValueSource>;
  materializedNumericBindings?: readonly MaterializedNumericBindingSource[];
  materializedTextTemplates?: readonly import("../scalars/moduleScalarRuntime").MaterializedTextTemplateSource[];
  moduleConditionalOwnerStatementIdByElementId?: ReadonlyMap<ElementId, string>;
  moduleForGroupMutationOwnerByElementId?: ReadonlyMap<ElementId, Extract<import("../scalars/bindingVersions").BindingControlOwner, { kind: "forGroup" }> & { elementId: ElementId }>;
  materializedConditionalGroupConditions?: readonly { elementId: ElementId; expression: TypedScalarExpression }[];
  /**
   * Task 48: `bindingAnalysis.issues` (duplicate-binding/binding-cycle/
   * self-initialization/undefined-binding/forward-binding-reference) adapted
   * to `DslDiagnostic` for the gutter/Problems popover. Deliberately kept
   * OUT of `diagnostics`/the pass-fail gate below: today, a document whose
   * only problem is a BindingIssue still compiles successfully (the
   * offending binding is excluded from the scalar program via the existing
   * program-eligibility mechanism; every other element/binding evaluates
   * normally) - appending these into the gating `diagnostics` array would
   * turn that per-binding degradation into a whole-document compile failure,
   * a real behavior change this task must not make. Display-only surfaces
   * merge this array with `diagnostics` themselves.
   */
  bindingIssueDiagnostics?: readonly DslDiagnostic[];
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

export const serializePaletteColorLine = (
  color: PaletteColor,
  defaultColorId: string
): string => {
  const args = [
    quoteDslString(color.hex),
    `name: ${quoteDslString(color.name)}`,
    ...(color.id === defaultColorId ? ["default: true"] : [])
  ];
  return `color ${formatDslName(color.id)} (${args.join(", ")})`;
};

export const serializePaletteLines = (
  palette: DocumentPalette
): string[] => palette.colors.map((color) => serializePaletteColorLine(color, palette.defaultColorId));

export const serializeDrawingModifierLines = (
  modifiers: readonly DrawingModifierDefinition[]
): string[] => modifiers.flatMap((modifier) => [
  `modifier ${formatDslName(modifier.name)} {`,
  `${DSL_INDENT}state: ${modifier.state},`,
  "}"
]);

// ==== 印刷レイアウト ====

const resolveGroupToken = (
  elements: CadElement[],
  groupId: ElementId,
  context: ElementNameContext
): string => {
  // Unresolved print targets retain their canonical source reference so that
  // a compile -> serialize -> recompile round-trip does not add a second `@`.
  if (groupId.startsWith("@")) return groupId;
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
  const numeric = (value: Parameters<typeof formatNumericValueForDsl>[0]) =>
    formatNumericValueForDsl(value, elements, undefined, nameContext);

  const headerArgs = [
    `output: ${layout.outputKind}`,
    ...(profileName ? [`view: ${formatDslName(profileName)}`] : []),
    `paper: ${formatDslName(layout.paperSizeId)}`,
    `orientation: ${layout.orientation}`,
    `width: ${numeric(layout.svgCanvasWidthMm)}`,
    `height: ${numeric(layout.svgCanvasHeightMm)}`,
    `columns: ${numeric(layout.columns)}`,
    `rows: ${numeric(layout.rows)}`,
    `overlap: ${numeric(layout.overlapMm)}`,
    `scale: ${numeric(layout.scale)}`
  ];

  const memberLines = layout.placements.map((placement) => {
    const groupToken = resolveGroupToken(elements, placement.groupId, nameContext);
    return `${DSL_INDENT}place ${groupToken.startsWith("@") ? "" : "@"}${groupToken}(x: ${numeric(placement.x)}, y: ${numeric(placement.y)}, angle: ${numeric(placement.angleDeg)}, mirrorX: ${placement.mirrorX})`;
  });

  return [
    `printLayout ${formatDslName(displayName)}(`,
    ...headerArgs.map((line) => `${DSL_INDENT}${line},`),
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
export const planPrintLayoutSection = (
  data: DslDocumentData
): PrintLayoutSectionPlan => {
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

// ==== 要素ツリー(ブレースブロック + stop) ====

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
  /** ,parent:/,branch: フォールバックで出力されたトップレベル文。 */
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
      ...statement.args.map((arg) =>
        `${argIndent}${arg.text}${statement.argumentSeparator === "comma" ? "," : ""}`
      ),
      `${indent}${statement.close}${appendBrace ? " {" : ""}`
    ],
    argKeys: [null, ...statement.args.map((arg) => arg.key), null]
  };
};

// 非連続な親子配置(並べ替え禁止の帰結として通常のブロック表現が不可能な
// 場合),の過渡期フォールバック用: ,parent:/,branch: を呼び出しの引数として
// 差し込む(呼び出し本体を持たない header は
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
  return {
    header: `${before} = expression(`,
    args: [{ key: "value", text: `value: ${value}` }, ...extra],
    close: ")",
    ...(statement.argumentSeparator ? { argumentSeparator: statement.argumentSeparator } : {}),
  };
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
        lines: [`${DSL_INDENT.repeat(stack.length)}stop`],
        argKeys: [null],
        depth: stack.length,
        role: "atStop"
      });
    }

    const parentId = element.parentGroupId;
    const desiredBranch: "then" | "else" = element.conditionalBranch === "else" ? "else" : "then";
    const targetIdx = parentId ? stack.findIndex((frame) => frame.elementId === parentId) : -1;

    // 非連続な親子配置(並べ替え禁止の帰結として通常のブロック表現が
    // 不可能な場合)は、過渡期のフォールバックとして ,parent:/,branch:
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
      lines: ["stop"],
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
    if (hasAtStop && index === limit) lines.push("stop");
    lines.push(...serializedFlatStatementLines(element, serializeElementStatementBlock(element, refs)));
  }
  if (hasAtStop && limit === elements.length) lines.push("stop");
  return lines;
};

export const serializeDocumentToDsl = (
  data: DslDocumentData,
  majorVersion: DslMajorVersion,
  options: SerializeDslDocumentOptions = {}
): string => {
  const refs = options.preserveElementOrder ? flatRefs() : documentDslRefs(data.elements);
  const sections: string[][] = [
    [`nui ${majorVersion}`, ...(options.headerComment ? [`# ${options.headerComment}`] : [])],
    serializePaletteLines(data.palette),
    serializeVisibilitySettingsLines(data.visibilityRoles, data.visibilityProfiles, data.activeVisibilityProfileId),
    serializeDrawingModifierLines(data.modifiers ?? []),
    options.preserveElementOrder
      ? serializeFlatElementTree(data.elements, refs, data.evaluationLimitIndex)
      : serializeElementTree(data.elements, refs, data.evaluationLimitIndex),
    serializePrintLayoutSection(data)
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

const validateVersionStatements = (
  statements: DslStatement[],
  includeStatement: DslStatementInclusion = () => true
): VersionValidation => {
  const diagnostics: DslDiagnostic[] = [];
  let unsupportedMajor: number | null = null;
  let majorVersion: DslMajorVersion | null = null;
  const versionStatements = statements.filter(
    (statement, statementIndex) => statement.kind === "version" && includeStatement(statement, statementIndex)
  );
  const firstStatement = statements[0];

  if (!firstStatement) {
    diagnostics.push(versionDiagnostic(1, "文書が空です。先頭に `nui 4` が必要です。"));
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

/**
 * ,printLayoutは文書の真の最終sink: 最初のprintLayoutブロックが始まった後は
 * さらなるprintLayoutブロック(とその内部のplace)以外を許さない。これは
 * printLayout位置でのtyped binding参照値を常にterminal valueと一致させる
 * ための構造的な制約 - 正規化(serializeDocumentToDsl/textPatch.ts)がset等の
 * 本文statementをprintLayoutセクションより前へ黙って並び替えるため、
 * printLayoutの後にそれらを書けてしまうと再正規化のたびに評価結果が
 * 変わりうる。
 */
const PRINT_LAYOUT_TRAILING_ALLOWED_KINDS = new Set<DslStatement["kind"]>([
  "printLayout",
  "place",
  "typedDeclaration",
  "set",
  "activePrintLayout",
  "blockEnd",
  "blockElse"
]);

const validatePrintLayoutPlacement = (
  statements: DslStatement[],
  includeStatement: DslStatementInclusion = () => true
): DslDiagnostic[] => {
  const firstPrintLayoutIndex = statements.findIndex(
    (statement, statementIndex) => statement.kind === "printLayout" && includeStatement(statement, statementIndex)
  );
  if (firstPrintLayoutIndex < 0) return [];
  const diagnostics: DslDiagnostic[] = [];
  for (let index = firstPrintLayoutIndex + 1; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!includeStatement(statement, index)) continue;
    const enclosingIndex = statement.enclosing?.statementIndex;
    const isPrintLayoutChild =
      enclosingIndex !== undefined && statements[enclosingIndex]?.kind === "printLayout";
    const isPrintLayoutLocal = statement.kind === "typedDeclaration" || statement.kind === "set";
    if (
      PRINT_LAYOUT_TRAILING_ALLOWED_KINDS.has(statement.kind) &&
      (!isPrintLayoutLocal || isPrintLayoutChild)
    ) continue;
    diagnostics.push({
      severity: "error",
      line: statement.line,
      column: 1,
      message:
        "printLayoutブロック以降には、さらなるprintLayoutブロック以外のstatementを配置できません。printLayoutは文書の最後にまとめて配置してください。"
    });
  }
  return diagnostics;
};

const attrValueOf = (statement: DslStatement, key: string) =>
  statement.attrs.find((item) => item.key === key)?.value;

const buildStatementMap = (
  statements: DslStatement[],
  lastLine: number,
  elementIdByStatementIndex: Map<number, ElementId>,
  printLayoutIdsByStatementIndex: Map<number, string> | undefined,
  assignedStatementIds?: ReadonlyMap<number, string>,
  includeStatement: DslStatementInclusion = () => true
): StatementMap => {
  const infos: StatementInfo[] = [];
  const stack: StatementInfo[] = [];
  const byKey = new Map<string, StatementInfo>();
  const setFirst = (key: string, info: StatementInfo) => {
    if (!byKey.has(key)) byKey.set(key, info);
  };
  const placementRefByStatementIndex = buildPlacementRefsByStatementIndex(statements, printLayoutIdsByStatementIndex);

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

    const included = includeStatement(statement, statementIndex);
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

    if (!included) return;
    switch (statement.kind) {
      case "color":
        byKey.set(`color:${statement.name}`, info);
        break;
      case "modifierDefinition":
        byKey.set(`modifier:${statement.name}`, info);
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
      case "place": {
        const ref = placementRefByStatementIndex.get(statementIndex);
        if (ref) byKey.set(`place:${ref.layoutId}:${ref.placementIndex}`, info);
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
  const byModifierName = new Map<string, StatementInfo>();
  const modifierDefinitionRangeByName = new Map<string, LineRange>();
  for (const info of infos) {
    const statement = statements[info.statementIndex];
    if (!includeStatement(statement, info.statementIndex) || statement.kind !== "modifierDefinition") continue;
    if (!byModifierName.has(statement.name)) byModifierName.set(statement.name, info);
    if (!modifierDefinitionRangeByName.has(statement.name)) {
      modifierDefinitionRangeByName.set(statement.name, { ...info.range });
    }
  }
  const statementIdByStatementIndex = assignedStatementIds
    ? new Map<number, string>(assignedStatementIds)
    : undefined;
  if (statementIdByStatementIndex) {
    for (const [statementIndex, elementId] of elementIdByStatementIndex) {
      statementIdByStatementIndex.set(statementIndex, elementId);
    }
  }
  const statementIndexByStatementId = statementIdByStatementIndex
    ? (() => {
        const indexes = new Map<string, number>();
        const duplicates = new Set<string>();
        for (const [statementIndex, statementId] of statementIdByStatementIndex) {
          if (duplicates.has(statementId)) continue;
          if (indexes.has(statementId)) {
            indexes.delete(statementId);
            duplicates.add(statementId);
            continue;
          }
          indexes.set(statementId, statementIndex);
        }
        return indexes;
      })()
    : undefined;
  const statementRangeById = new Map<StatementIdentity, StatementInfo>();
  for (const [statementIndex, statementId] of statementIdByStatementIndex ?? []) {
    const info = infos[statementIndex];
    if (info && !statementRangeById.has(statementId)) statementRangeById.set(statementId, info);
  }

  const sectionEnds: StatementMap["sectionEnds"] = {};
  for (const info of infos) {
    const statement = statements[info.statementIndex];
    if (!includeStatement(statement, info.statementIndex)) continue;
    if (statement.kind === "version") {
      sectionEnds.version = Math.max(sectionEnds.version ?? 0, info.line);
    } else if (statement.kind === "color") {
      sectionEnds.palette = Math.max(sectionEnds.palette ?? 0, info.line);
    } else if (statement.kind === "modifierDefinition") {
      sectionEnds.modifiers = Math.max(sectionEnds.modifiers ?? 0, info.range.endLine, info.endLine);
    } else if (statement.kind === "role" || statement.kind === "view" || statement.kind === "activeView") {
      sectionEnds.visibility = Math.max(sectionEnds.visibility ?? 0, info.line);
    } else if (
      statement.kind === "group" ||
      statement.kind === "element" ||
      statement.kind === "typedDeclaration" ||
      statement.kind === "set" ||
      statement.kind === "atStop"
    ) {
      // 単一行の複数行call(例: 複数行coordinate())はブロックを開かないため
      // range.endLineは更新されない - info.endLine(文自体の最終物理行)との
      // maxを取る。
      sectionEnds.elements = Math.max(sectionEnds.elements ?? 0, info.range.endLine, info.endLine);
    } else if (statement.kind === "printLayout" || statement.kind === "activePrintLayout") {
      sectionEnds.printLayouts = Math.max(sectionEnds.printLayouts ?? 0, info.range.endLine);
    }
  }

  return {
    sourceRevision: statements[0]?.sourceRevision ?? 0,
    statements: infos,
    byElementId,
    elementIdByStatementIndex,
    byModifierName,
    modifierDefinitionRangeByName,
    ...(statementIdByStatementIndex ? { statementIdByStatementIndex } : {}),
    ...(statementIndexByStatementId ? { statementIndexByStatementId } : {}),
    statementRangeById,
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
  const includeStatement: DslStatementInclusion = (_statement, statementIndex) =>
    isCompilableDslStatement(parsed.statements, statementIndex);
  const versionValidation = validateVersionStatements(parsed.statements, includeStatement);
  const printLayoutPlacementDiagnostics = validatePrintLayoutPlacement(parsed.statements, includeStatement);

  let compiled = compileDslToElements(normalized, {
    elements: [],
    mode: "document",
    preparsed: parsed,
    assignedElementIds: options.assignedStatementIds ?? options.assignedElementIds,
    majorVersion: versionValidation.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION
  });
  const hasTypedDeclarations = parsed.statements.some(
    (statement, statementIndex) => statement.kind === "typedDeclaration" && includeStatement(statement, statementIndex)
  );
  // set statements need the same reconciler-issued identity map as typed
  // declarations (Task 29) - the gate must include them too, otherwise a
  // document with `set` but no local const/let would build the map from a
  // fallback empty source instead of the caller's real reconciliation
  // output.
  const hasSetStatements = parsed.statements.some(
    (statement, statementIndex) => statement.kind === "set" && includeStatement(statement, statementIndex)
  );
  // printLayout/place numeric fields resolve `@name` against typed const/let
  // bindings the same way element fields do (Task 53), so a document with a
  // printLayout block but zero typedDeclaration/set statements of its own
  // must still run scalar analysis - otherwise an unresolved `@name` inside
  // printLayout (e.g. `scale: @nope`) never reaches compileNumericBindings
  // at all && silently produces no diagnostic. `place` never appears
  // outside an enclosing `printLayout` block, so checking `printLayout`
  // alone covers both.
  const hasPrintLayoutStatements = parsed.statements.some(
    (statement, statementIndex) => statement.kind === "printLayout" && includeStatement(statement, statementIndex)
  );
  const hasModuleStatements = parsed.statements.some(
    (statement) => statement.kind === "moduleDefinition" || statement.kind === "moduleInstance"
  );
  const hasCompilableGeometryStatements = parsed.statements.some(
    (statement, statementIndex) => isElementDslStatement(statement) && includeStatement(statement, statementIndex)
  );
  const hasSourceNamespaceStatements = parsed.statements.some(
    (statement, statementIndex) =>
      includeStatement(statement, statementIndex) &&
      (
        statement.kind === "group" ||
        statement.kind === "moduleDefinition" ||
        statement.kind === "moduleInstance" ||
        statement.kind === "typedDeclaration" ||
        (statement.kind === "element" &&
          (isGeometryDeclarationCategory(statement.category) ||
            statement.type === "conditionalGroup" ||
            statement.type === "forGroup"))
      )
  );
  const stableStatementIdByIndex =
    (hasTypedDeclarations || hasSetStatements || hasPrintLayoutStatements || hasModuleStatements || hasSourceNamespaceStatements)
    ? new Map<number, string>(options.assignedStatementIds ?? options.assignedElementIds ?? [])
    : undefined;
  if (stableStatementIdByIndex) {
    for (const [statementIndex, elementId] of compiled.elementIdsByStatementIndex ?? []) {
      stableStatementIdByIndex.set(statementIndex, elementId);
    }
    // Standalone parse/compile callers do not have a prior reconciled
    // snapshot. Allocate an opaque internal identity for a printLayout scope;
    // canonicalDocument supplies the reconciler-owned identity on the normal
    // edit path, so this fallback never becomes a user-visible name || source
    // namespace.
    parsed.statements.forEach((statement, statementIndex) => {
      if (statement.kind === "printLayout" && !stableStatementIdByIndex.has(statementIndex)) {
        stableStatementIdByIndex.set(statementIndex, createStatementIdentity("printLayout"));
      }
    });
  }
  const sourceNamespaceRequiresIdentity = (statement: DslStatement) =>
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance" ||
    statement.kind === "group" ||
    statement.kind === "typedDeclaration" ||
    (statement.kind === "element" &&
      (isGeometryDeclarationCategory(statement.category) ||
        statement.type === "conditionalGroup" ||
        statement.type === "forGroup"));
  const sourceNamespaceHasCompleteIdentity =
    stableStatementIdByIndex !== undefined &&
    (options.assignedStatementIds !== undefined || options.assignedElementIds !== undefined) &&
    parsed.statements.every(
      (statement, statementIndex) => !sourceNamespaceRequiresIdentity(statement) || stableStatementIdByIndex.has(statementIndex)
    );
  const sourceLexicalNamespace = sourceNamespaceHasCompleteIdentity
    ? buildSourceLexicalNamespaceIndex(parsed.statements, stableStatementIdByIndex!)
    : undefined;
  if (sourceLexicalNamespace && stableStatementIdByIndex) {
    // The first compile establishes reconciler-owned element identities &&
    // structural metadata. Re-run the same compiler with the source
    // namespace attached so ordinary geometry consumers select source
    // declarations before the legacy materialized-name fallback. Module
    // export members are still handled by the later module runtime path.
    compiled = compileDslToElements(normalized, {
      elements: [],
      mode: "document",
      preparsed: parsed,
      assignedElementIds: options.assignedStatementIds ?? options.assignedElementIds ?? compiled.elementIdsByStatementIndex,
      majorVersion: versionValidation.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION,
      sourceLexicalResolution: {
        sourceNamespace: sourceLexicalNamespace,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map()
      }
    });
  }
  // Task 48: the one parse-time span index every typed-variable diagnostic
  // producer - including ones that run later, against this exact compiled
  // document, from outside compileDslDocument itself (runtimeScalarDiagnostics.ts) -
  // projects an exact physicalSpan through. Built once here, never re-parsed,
  // never re-scanned per diagnostic; always available, even on the earliest
  // error return below, since it depends only on `parsed`.
  const spans: DiagnosticSpanContext = { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom };
  const projectedCompilerDiagnostics = compiled.diagnostics.map((diagnostic) => {
    const { logicalSpan, statementIndex, ...publicDiagnostic } = diagnostic;
    if (logicalSpan === undefined || statementIndex === undefined) return publicDiagnostic;
    const statement = parsed.statements[statementIndex];
    const physicalSpan = statement ? exactPhysicalSpan(spans, statement, logicalSpan) : null;
    return {
      ...publicDiagnostic,
      exactSpanOnly: true as const,
      ...(physicalSpan ? { physicalSpan } : {})
    };
  });
  const baseDiagnostics = [
    ...versionValidation.diagnostics,
    ...printLayoutPlacementDiagnostics,
    ...projectedCompilerDiagnostics,
    ...(sourceLexicalNamespace?.diagnostics ?? [])
  ];

  // missing-attribute-value ("well-formed but currently-empty named value" -
  // see dslArgScanner.ts) is deliberately excluded from the fatal gate here,
  // matching dslValueSpans.ts's existing carve-out for the same code: an
  // intentionally-blank `key:` (typed by hand, || spliced in as a
  // command-line creation draft) still yields a compiled document with an
  // ordinary element-level diagnostic, the same way an unresolved reference
  // does, instead of discarding the whole document back to its last-good
  // state. Every other error-severity diagnostic - actual syntax errors,
  // type errors, etc. - keeps making the document fatal.
  if (baseDiagnostics.some((item) => item.severity === "error" && item.code !== MISSING_ATTRIBUTE_VALUE_CODE)) {
    return {
      document: null,
      majorVersion: versionValidation.majorVersion,
      statements: parsed.statements,
      statementMap: null,
      sourceLines,
      diagnostics: baseDiagnostics,
      spans,
      ...(sourceLexicalNamespace ? { sourceLexicalNamespace } : {})
    };
  }

  let scalarAnalysisCompilation = stableStatementIdByIndex
    ? analyzeTypedDeclarations({
        statements: parsed.statements,
        stableStatementIdByIndex,
        reconciledContainers: {
          elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
          elements: compiled.elements
        },
        spans,
        includeStatement,
        sourceNamespace: sourceLexicalNamespace
      })
    : { diagnostics: [] };
  let documentScalarAnalysis = scalarAnalysisCompilation.analysis;
  let documentScalarProgram = documentScalarAnalysis ? lowerScalarProgram(documentScalarAnalysis) : undefined;
  const logicalTextByStatementIndex = new Map<number, string>();
  for (const [statementIndex, statement] of parsed.statements.entries()) {
    const logical = parsed.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (logical) logicalTextByStatementIndex.set(statementIndex, logical.logicalText);
  }
  const documentScalarBindings = documentScalarAnalysis
    ? new Map(
        documentScalarAnalysis.bindingAnalysis.catalog.bindings
          .filter((binding) => binding.kind === "typed")
          .map((binding) => [
            binding.statementIndex,
            {
              bindingId: binding.id,
              statementId: stableStatementIdByIndex!.get(binding.statementIndex)!
            }
          ] as const)
      )
    : undefined;
  const sourceSemanticCompilation = sourceLexicalNamespace && stableStatementIdByIndex
    ? analyzeModuleSemantics({
        statements: parsed.statements,
        stableStatementIdByIndex,
        sourceNamespace: sourceLexicalNamespace,
        spans,
        logicalTextByStatementIndex,
        documentScalarBindings
      })
    : undefined;
  // The source semantic projection is also useful for Definition Query in a
  // document without Modules. Keep Module runtime/lowering paths gated by the
  // existing hasModuleStatements condition below.
  const moduleSemanticCompilation = hasModuleStatements ? sourceSemanticCompilation : undefined;
  if (moduleSemanticCompilation && sourceLexicalNamespace && stableStatementIdByIndex) {
    const exportBindingSeeds = moduleScalarExportBindingSeeds(
      moduleSemanticCompilation,
      sourceLexicalNamespace
    );
    const hasRootGeometryBuiltinOccurrences = [...moduleSemanticCompilation.rootScalarExpressionsByStatementId.values()]
      .some((site) => site.expression.geometryBuiltinArguments.length > 0);
    if (exportBindingSeeds.length > 0 || hasRootGeometryBuiltinOccurrences) {
      const seedById = new Map(exportBindingSeeds.map((seed) => [seed.id, seed] as const));
      const additionalBindingResolver: SourceNamespaceBindingResolver = (name, statementIndex) => {
        const path = parseDslReferenceToken(name);
        if (path.segments.length !== 2) return null;
        const instanceLookup = resolveSourceLexicalDeclaration(sourceLexicalNamespace, statementIndex, path.segments[0]);
        if (instanceLookup.kind === "forward" || instanceLookup.kind === "ambiguous") {
          return instanceLookup.declarations.every((declaration) => declaration.kind === "moduleInstance")
            ? {
                kind: "blocked",
                reason: instanceLookup.kind,
                declarationKind: "moduleInstance",
                ...(instanceLookup.declarations[0] ? { statementId: instanceLookup.declarations[0].statementId } : {})
              }
            : null;
        }
        if (instanceLookup.kind !== "resolved" || instanceLookup.declaration.kind !== "moduleInstance") return null;
        const instance = moduleSemanticCompilation.instancesByStatementId.get(instanceLookup.declaration.statementId);
        const definition = instance?.callee && moduleSemanticCompilation.definitionsByStatementId.get(instance.callee.definitionStatementId);
        const exported = definition?.exports.find((entry) => entry.kind === "scalar" && entry.name === path.segments[1]);
        if (!instance || !definition || !exported || exported.kind !== "scalar") {
          const privateMember = !definition?.exports.some((entry) => entry.name === path.segments[1]) && definition?.bodyStatements.some((body) =>
            parsed.statements[body.statementIndex]?.name === path.segments[1]
          );
          return {
            kind: "blocked",
            reason: privateMember ? "private" : "incompatible",
            declarationKind: "moduleInstance",
            statementId: instanceLookup.declaration.statementId
          };
        }
        const bindingId = moduleScalarBindingIdFor(
          [instance.statementId],
          definition.statementId,
          exported.exportedStatementId
        );
        return seedById.has(bindingId) ? { kind: "resolved", bindingId } : {
          kind: "blocked",
          reason: "incompatible",
          declarationKind: "moduleInstance",
          statementId: instance.statementId
        };
      };
      scalarAnalysisCompilation = analyzeTypedDeclarations({
        statements: parsed.statements,
        stableStatementIdByIndex,
        reconciledContainers: {
          elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
          elements: compiled.elements
        },
        spans,
        includeStatement,
        sourceNamespace: sourceLexicalNamespace,
        additionalBindings: exportBindingSeeds,
        additionalBindingResolver,
        additionalGeometryResolver: ({ statementIndex, node, expectedGeometryType }) => {
          const statementId = stableStatementIdByIndex.get(statementIndex);
          const site = statementId
            ? moduleSemanticCompilation.rootScalarExpressionsByStatementId.get(statementId)
            : undefined;
          const occurrence = site?.expression.geometryBuiltinArguments.find((candidate) =>
            candidate.span.start === node.span.start && candidate.expectedGeometryType === expectedGeometryType
          );
          const target = occurrence?.reference.target;
          if (!occurrence || !target || (occurrence.reference.resolution !== "resolved" && occurrence.reference.resolution !== "deferred")) return undefined;
          if (target.kind === "parameter") {
            return {
              statementId: target.definitionStatementId,
              statementIndex: -1,
              geometryType: expectedGeometryType,
              ...(target.pointKey ? { pointKey: target.pointKey } : {})
            };
          }
          if (target.kind === "sourceGeometry") {
            return {
              statementId: target.statementId,
              statementIndex: target.statementIndex,
              geometryType: expectedGeometryType,
              ...(target.pointKey ? { pointKey: target.pointKey } : {})
            };
          }
          return {
            statementId: target.instanceStatementId,
            statementIndex: target.instanceStatementIndex,
            geometryType: expectedGeometryType,
            ...(target.pointKey ? { pointKey: target.pointKey } : {})
          };
        }
      });
      documentScalarAnalysis = scalarAnalysisCompilation.analysis;
      documentScalarProgram = documentScalarAnalysis ? lowerScalarProgram(documentScalarAnalysis) : undefined;
    }
  }
  if (
    moduleSemanticCompilation &&
    !moduleSemanticCompilation.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
    stableStatementIdByIndex
  ) {
    compiled = compileDslToElements(normalized, {
      elements: [],
      mode: "document",
      preparsed: parsed,
      assignedElementIds: options.assignedStatementIds ?? options.assignedElementIds ?? compiled.elementIdsByStatementIndex,
      stableStatementIdByIndex,
      moduleSemanticAnalysis: moduleSemanticCompilation,
      majorVersion: versionValidation.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION
    });
  }
  let scalarAnalysis = documentScalarAnalysis;
  let scalarProgram = documentScalarProgram;
  let moduleScalarCompilation: ModuleScalarRuntimeCompilation | undefined;
  if (
    moduleSemanticCompilation &&
    !moduleSemanticCompilation.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
    compiled.moduleMaterialization &&
    stableStatementIdByIndex
  ) {
    moduleScalarCompilation = compileModuleScalarRuntime({
      statements: parsed.statements,
      stableStatementIdByIndex,
      moduleSemanticAnalysis: moduleSemanticCompilation,
      moduleMaterialization: compiled.moduleMaterialization,
      documentBindingAnalysis: documentScalarAnalysis?.bindingAnalysis,
      documentScalarProgram,
      reconciledContainers: {
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        elements: compiled.elements
      },
      includeStatement,
      elements: compiled.elements,
      sourceScopeIndex: sourceLexicalNamespace?.scopeIndex,
      moduleGeometryRuntime: compiled.moduleGeometryRuntime,
      drawingModifiers: compiled.modifiers
    });
    const hasModuleScalarBindings = moduleScalarCompilation.bindingAnalysis.catalog.bindings.some((binding) =>
      binding.resolutionMode === "preResolvedOnly"
    );
    const hasModuleTypedNumericBindings = moduleScalarCompilation.materializedNumericBindings.some(
      (entry) => entry.binding.typedExpression !== undefined
    );
    if (documentScalarAnalysis || hasModuleScalarBindings || hasModuleTypedNumericBindings) {
      scalarAnalysis = documentScalarAnalysis
        ? { ...documentScalarAnalysis, bindingAnalysis: moduleScalarCompilation.bindingAnalysis }
        : {
            bindingAnalysis: moduleScalarCompilation.bindingAnalysis,
            typedInitializerByBindingId: new Map(),
            positionMap: { sourceOrderByElementIndex: [] }
          };
      scalarProgram = moduleScalarCompilation.scalarProgram;
    } else {
      scalarAnalysis = undefined;
      scalarProgram = undefined;
    }
    compiled = {
      ...compiled,
      moduleMaterialization: {
        ...compiled.moduleMaterialization,
        scalarExecutionPositionByRuntimeElementId: moduleScalarCompilation.scalarExecutionPositionByRuntimeElementId
      }
    };
  }
  const allDiagnostics = [
    ...versionValidation.diagnostics,
    ...printLayoutPlacementDiagnostics,
    ...compiled.diagnostics,
    ...(sourceLexicalNamespace?.diagnostics ?? []),
    ...scalarAnalysisCompilation.diagnostics,
    ...(moduleSemanticCompilation?.diagnostics ?? [])
  ];
  // Task 48: see CompiledDslDocument.bindingIssueDiagnostics for why this is
  // never concatenated into allDiagnostics/finalDiagnostics below.
  const bindingIssueDiagnostics = scalarAnalysis
    ? bindingIssuesToDiagnostics(scalarAnalysis.bindingAnalysis, parsed.statements, spans)
    : [];

  // Task 22: property binding compile/typecheck. Only meaningful once typed
  // declarations exist to reference (nui4 + at least one binding) - a
  // document with none can never contain a valid `@name` property source.
  const propertyBindingCompilation = scalarAnalysis
    ? compilePropertyBindings({
        statements: parsed.statements,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        elements: compiled.elements,
        bindingAnalysis: scalarAnalysis.bindingAnalysis,
        spans,
        includeStatement
      })
    : undefined;
  const numericBindingCompilation = scalarAnalysis
    ? compileNumericBindings({
        statements: parsed.statements,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        elements: compiled.elements,
        bindingAnalysis: scalarAnalysis.bindingAnalysis,
        spans,
        includeStatement,
        printLayouts: compiled.printLayouts,
        printLayoutIdsByStatementIndex: compiled.printLayoutIdsByStatementIndex
      })
    : undefined;
  // Task 25: conditionalGroup.condition typed-boolean compile/typecheck.
  // Same scalarAnalysis-present gate as property bindings above - reuses the
  // same bindingAnalysis, never re-resolves names || re-derives Task 13's
  // diagnostics itself.
  const conditionalGroupConditionCompilation = scalarAnalysis
    ? compileConditionalGroupConditions({
        statements: parsed.statements,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        elements: compiled.elements,
        bindingAnalysis: scalarAnalysis.bindingAnalysis,
        spans,
        includeStatement
      })
    : undefined;
  // Task 26: text template brace/escape/hole analysis for every canonical
  // `label(text: ...)` occurrence. Unlike the two compilers above, this does
  // NOT gate on `scalarAnalysis` - a nui4 document with zero typed
  // declarations still needs its text templates scanned for escape/brace
  // structure (only reference resolution itself needs a binding catalog,
  // && gracefully has none here).
  const textTemplateCompilation = hasCompilableGeometryStatements
    ? compileTextTemplates({
        statements: parsed.statements,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        elements: compiled.elements,
        bindingAnalysis: scalarAnalysis?.bindingAnalysis,
        spans,
        includeStatement
      })
    : undefined;
  // Every supported document requires element-property references to carry
  // the `@` sigil, including documents with no scalar declarations of their
  // own.
  const propertyReferenceSyntaxCompilation = hasCompilableGeometryStatements
    ? compilePropertyReferenceSyntax({
        statements: parsed.statements,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        elements: compiled.elements,
        spans,
        includeStatement
      })
    : undefined;
  // Task 29: `set name = expression` target resolution/RHS typecheck. Gated
  // on `stableStatementIdByIndex` being truthy (narrowed inline below, so no
  // `!`/`?? new Map()` is ever needed) && on `hasSetStatements`, NOT on
  // `scalarAnalysis` truthy - like textTemplates above, a `set` with no
  // catalog to resolve against must still be diagnosed
  // (invalid-set-target), not silently dropped. compileSetStatements itself
  // handles `bindingAnalysis === undefined`; the identity map it receives
  // here is always the caller's real reconciler output because the gate
  // above already widened to include `set` statements.
  const setStatementCompilation = stableStatementIdByIndex && hasSetStatements
    ? compileSetStatements({
        statements: parsed.statements,
      stableStatementIdByIndex,
      bindingAnalysis: scalarAnalysis?.bindingAnalysis,
      elements: compiled.elements,
      elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
      sourceNamespace: sourceLexicalNamespace,
      spans,
      includeStatement
      })
    : undefined;
  // Task 30 only consumes products of the compiler/analysis passes above.
  // It intentionally remains available for a recoverable invalid let: the
  // compiled document is still erroneous, but Task 31 needs the poisoned
  // version 0 && its validated recovery set chain without reparsing source.
  const bindingControlMetadata = scalarAnalysis && stableStatementIdByIndex
    ? new Map([
        ...buildBindingControlMetadata(
          scalarAnalysis.bindingAnalysis.catalog.scopeIndex,
          stableStatementIdByIndex,
          moduleScalarCompilation?.scalarExecutionPositionByStatementIndex
        ),
        ...(moduleScalarCompilation?.controlByScopeId ?? new Map())
      ])
    : undefined;
  const documentSetStatements = setStatementCompilation?.setsByStatementIndex && moduleScalarCompilation
    ? new Map(Array.from(setStatementCompilation.setsByStatementIndex, ([statementIndex, set]) => [
        statementIndex,
        {
          ...set,
          sourceOrder: moduleScalarCompilation.scalarExecutionPositionByStatementIndex.get(statementIndex) ?? set.sourceOrder
        }
      ] as const))
    : setStatementCompilation?.setsByStatementIndex;
  const allSetStatements = scalarAnalysis && stableStatementIdByIndex
    ? new Map<number, SetStatementAnalysis>([
        ...(documentSetStatements ?? new Map()),
        ...(moduleScalarCompilation?.moduleSetStatements.map((set, index) => [-(index + 1), set] as const) ?? [])
      ])
    : undefined;
  const bindingVersions = scalarAnalysis && stableStatementIdByIndex && scalarProgram && bindingControlMetadata
    ? buildBindingVersionGraph({
        scalarProgram,
        bindingAnalysis: scalarAnalysis.bindingAnalysis,
        setStatements: allSetStatements,
        controlByScopeId: bindingControlMetadata,
        requiresExecutionOrdering: moduleScalarCompilation !== undefined
      })
    : undefined;
  // This is intentionally built before the final diagnostic gate. It is a
  // current-source analysis record, not part of the last-good geometry model.
  const typedDependencyGraph = buildTypedDependencyGraph({
    elements: compiled.elements,
    drawingModifiers: compiled.modifiers,
    elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
    bindingAnalysis: scalarAnalysis?.bindingAnalysis,
    bindingVersions,
    propertyBindings: propertyBindingCompilation?.sourcesByOccurrenceKey,
    numericBindings: numericBindingCompilation?.sourcesByOccurrenceKey,
    textTemplates: textTemplateCompilation?.templatesByOccurrenceKey,
    setStatements: setStatementCompilation?.setsByStatementIndex,
    scalarProgram
  });
  const finalDiagnostics = [
    ...(propertyBindingCompilation ? [...allDiagnostics, ...propertyBindingCompilation.diagnostics] : allDiagnostics),
    ...(numericBindingCompilation ? numericBindingCompilation.diagnostics : []),
    ...(conditionalGroupConditionCompilation ? conditionalGroupConditionCompilation.diagnostics : []),
    ...(textTemplateCompilation ? textTemplateCompilation.diagnostics : []),
    ...(propertyReferenceSyntaxCompilation ? propertyReferenceSyntaxCompilation.diagnostics : []),
    ...(setStatementCompilation ? setStatementCompilation.diagnostics : [])
  ];
  // Same missing-attribute-value carve-out as the earlier fatal gate above.
  if (finalDiagnostics.some((item) => item.severity === "error" && item.code !== MISSING_ATTRIBUTE_VALUE_CODE)) {
    return {
      document: null,
      majorVersion: versionValidation.majorVersion,
      statements: parsed.statements,
      statementMap: null,
      sourceLines,
      diagnostics: finalDiagnostics,
      spans,
      ...(scalarProgram ? { scalarProgram } : {}),
      ...(scalarAnalysis ? { bindingAnalysis: scalarAnalysis.bindingAnalysis } : {}),
      ...(documentScalarAnalysis ? { scalarProgramPositionMap: documentScalarAnalysis.positionMap } : {}),
      ...(numericBindingCompilation ? { numericBindings: numericBindingCompilation.sourcesByOccurrenceKey } : {}),
      ...(setStatementCompilation ? { setStatements: setStatementCompilation.setsByStatementIndex } : {}),
      ...(bindingVersions ? { bindingVersions } : {}),
      ...(typedDependencyGraph ? { typedDependencyGraph } : {}),
      ...(sourceLexicalNamespace ? { sourceLexicalNamespace } : {}),
      ...(sourceSemanticCompilation && !moduleSemanticCompilation ? { sourceSemanticAnalysis: sourceSemanticCompilation } : {}),
      ...(moduleSemanticCompilation ? { moduleSemanticAnalysis: moduleSemanticCompilation } : {}),
      ...(compiled.moduleMaterialization ? { moduleMaterialization: compiled.moduleMaterialization } : {}),
      ...(moduleScalarCompilation?.scalarExecutionPositionByRuntimeElementId
        ? { scalarExecutionPositionByRuntimeElementId: moduleScalarCompilation.scalarExecutionPositionByRuntimeElementId }
        : {}),
      ...(moduleScalarCompilation?.materializedPropertyBindings.length
        ? { materializedPropertyBindings: moduleScalarCompilation.materializedPropertyBindings }
        : {}),
      ...(moduleScalarCompilation?.materializedGroupPrintEnabledBindings.size
        ? { materializedGroupPrintEnabledBindings: moduleScalarCompilation.materializedGroupPrintEnabledBindings }
        : {}),
      ...(moduleScalarCompilation?.materializedNumericBindings.length
        ? { materializedNumericBindings: moduleScalarCompilation.materializedNumericBindings }
        : {}),
      ...(moduleScalarCompilation?.materializedTextTemplates.length
        ? { materializedTextTemplates: moduleScalarCompilation.materializedTextTemplates }
        : {}),
      ...(moduleScalarCompilation?.conditionalOwnerStatementIdByElementId.size
        ? { moduleConditionalOwnerStatementIdByElementId: moduleScalarCompilation.conditionalOwnerStatementIdByElementId }
        : {}),
      ...(moduleScalarCompilation?.forGroupMutationOwnerByElementId.size
        ? { moduleForGroupMutationOwnerByElementId: moduleScalarCompilation.forGroupMutationOwnerByElementId }
        : {}),
      ...(moduleScalarCompilation?.materializedConditionalGroupConditions.length
        ? { materializedConditionalGroupConditions: moduleScalarCompilation.materializedConditionalGroupConditions }
        : {}),
      ...(bindingIssueDiagnostics.length > 0 ? { bindingIssueDiagnostics } : {})
    };
  }

  const visibilityProfiles = compiled.visibilityProfiles?.length
    ? compiled.visibilityProfiles
    : [defaultVisibilityProfile()];
  const printLayouts = compiled.printLayouts ?? [];

  const document: DslDocumentData = {
    elements: compiled.elements,
    modifiers: compiled.modifiers ?? [],
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
    stableStatementIdByIndex,
    includeStatement
  );

  return {
    document,
    majorVersion: versionValidation.majorVersion,
    statements: parsed.statements,
    statementMap,
    sourceLines,
    diagnostics: finalDiagnostics,
    spans,
    ...(scalarProgram ? { scalarProgram } : {}),
    ...(scalarAnalysis ? { bindingAnalysis: scalarAnalysis.bindingAnalysis } : {}),
    ...(documentScalarAnalysis ? { scalarProgramPositionMap: documentScalarAnalysis.positionMap } : {}),
    ...(propertyBindingCompilation
      ? {
          propertyBindings: propertyBindingCompilation.sourcesByOccurrenceKey,
          occurrenceKeysByBindingId: propertyBindingCompilation.occurrenceKeysByBindingId
        }
      : {}),
    ...(numericBindingCompilation ? { numericBindings: numericBindingCompilation.sourcesByOccurrenceKey } : {}),
    ...(conditionalGroupConditionCompilation
      ? { conditionalGroupConditions: conditionalGroupConditionCompilation.sourcesByOccurrenceKey }
      : {}),
    ...(textTemplateCompilation ? { textTemplates: textTemplateCompilation.templatesByOccurrenceKey } : {}),
    ...(setStatementCompilation ? { setStatements: setStatementCompilation.setsByStatementIndex } : {}),
    ...(bindingVersions ? { bindingVersions } : {}),
    ...(typedDependencyGraph ? { typedDependencyGraph } : {}),
    ...(sourceLexicalNamespace ? { sourceLexicalNamespace } : {}),
    ...(sourceSemanticCompilation && !moduleSemanticCompilation ? { sourceSemanticAnalysis: sourceSemanticCompilation } : {}),
    ...(moduleSemanticCompilation ? { moduleSemanticAnalysis: moduleSemanticCompilation } : {}),
    ...(compiled.moduleMaterialization ? { moduleMaterialization: compiled.moduleMaterialization } : {}),
    ...(moduleScalarCompilation?.scalarExecutionPositionByRuntimeElementId
      ? { scalarExecutionPositionByRuntimeElementId: moduleScalarCompilation.scalarExecutionPositionByRuntimeElementId }
      : {}),
    ...(moduleScalarCompilation?.materializedPropertyBindings.length
      ? { materializedPropertyBindings: moduleScalarCompilation.materializedPropertyBindings }
      : {}),
    ...(moduleScalarCompilation?.materializedGroupPrintEnabledBindings.size
      ? { materializedGroupPrintEnabledBindings: moduleScalarCompilation.materializedGroupPrintEnabledBindings }
      : {}),
    ...(moduleScalarCompilation?.materializedNumericBindings.length
      ? { materializedNumericBindings: moduleScalarCompilation.materializedNumericBindings }
      : {}),
    ...(moduleScalarCompilation?.materializedTextTemplates.length
      ? { materializedTextTemplates: moduleScalarCompilation.materializedTextTemplates }
      : {}),
    ...(moduleScalarCompilation?.conditionalOwnerStatementIdByElementId.size
      ? { moduleConditionalOwnerStatementIdByElementId: moduleScalarCompilation.conditionalOwnerStatementIdByElementId }
      : {}),
    ...(moduleScalarCompilation?.forGroupMutationOwnerByElementId.size
      ? { moduleForGroupMutationOwnerByElementId: moduleScalarCompilation.forGroupMutationOwnerByElementId }
      : {}),
    ...(moduleScalarCompilation?.materializedConditionalGroupConditions.length
      ? { materializedConditionalGroupConditions: moduleScalarCompilation.materializedConditionalGroupConditions }
      : {}),
    ...(bindingIssueDiagnostics.length > 0 ? { bindingIssueDiagnostics } : {})
  };
};

export const parseDslDocument = (source: string): ParseDslDocumentResult => {
  const compiled = compileDslDocument(source);
  return { document: compiled.document, diagnostics: compiled.diagnostics };
};
