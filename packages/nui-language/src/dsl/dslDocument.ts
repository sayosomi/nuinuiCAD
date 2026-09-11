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
  DrawingModifierDefinition,
  DrawingProfile,
  ElementId,
  Layout,
  PrintOutput,
  SvgOutput,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { lowerScalarProgram } from "../scalars/scalarProgram";
import { analyzeTypedDeclarations } from "../scalars/typedDeclarationAnalysis";
import { bindingIssuesToDiagnostics } from "../scalars/bindingIssueDiagnostics";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { compilePropertyBindings, type ScalarValueSource } from "../scalars/propertyBindingCompiler";
import {
  compileNumericBindings,
  type CompiledNumericBinding,
  type NumericBindingConsumerReference
} from "../scalars/numericBindingCompiler";
import { compileConditionalGroupConditions } from "../scalars/conditionalGroupConditionCompiler";
import { compileSetStatements, type SetStatementAnalysis } from "../scalars/setStatementCompiler";
import {
  buildBindingControlMetadata,
  buildBindingVersionGraph,
  type BindingVersionGraph
} from "../scalars/bindingVersions";
import { compileTextTemplates, type TextTemplateAst } from "../scalars/textTemplate";
import { buildTypedDependencyGraph, type TypedDependencyGraph } from "../scalars/typedDependencyGraph";
import type { ScalarExpressionResolvedGeometryProperty, TypedScalarExpression } from "../scalars/typedExpressionAst";
import { formatNumericValueForDsl } from "./dslExpressionFormat";
import { isCompilableDslStatement, isCanonicalValueBindingDeclaration, type DslStatementInclusion } from "./dslCompilationGuard";
import { compilePropertyReferenceSyntax } from "./dslPropertyReferenceSyntax";
import { buildPlacementRefsByStatementIndex } from "./dslPrintLayoutPlacementIndex";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import { isDslGeometryValueType, nominalRecordTypeOfDslValueType, scalarTypeOfDslValueType } from "./dslValueTypes";
import { collectionLengthForValueId, collectionValueSemanticForStatement, geometryArrayDeferredModuleExportId } from "./geometryArraySemanticAnalysis";
import type { GenericArraySourceTarget } from "./geometryArraySemanticAnalysis";
import type { DslArrayMappedValue, DslArraySemanticValue } from "./geometryArraySemantics";
import {
  buildSourceLexicalNamespaceIndex,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";
import { analyzeModuleSemantics } from "./moduleSemanticAnalysis";
import { unwrapModuleGeometrySourceTarget, type ModuleScalarSourceTarget, type ModuleSemanticAnalysis } from "./moduleSemanticTypes";
import type { ModuleRuntimeContext } from "./moduleRuntimeContext";
import type { ModuleMaterialization } from "./moduleMaterialization";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import { geometryAliasForSourceElement, propertyForAlias } from "./moduleGeometryRuntimeLowering";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";
import { buildRootGeometryValueProgram } from "./moduleGeometryValueProgram";
import { compileModuleScalarRuntime, lowerExpression, moduleRecordExportFieldBindingIdFor, moduleScalarBindingIdFor, moduleScalarExportBindingSeeds, type ModuleScalarRuntimeCompilation } from "../scalars/moduleScalarRuntime";
import { recordScalarBindingIdFor } from "../scalars/recordScalarLowering";
import { MISSING_ATTRIBUTE_VALUE_CODE } from "./dslArgScanner";
import { isElementDslStatement, parseDsl, parseDslSnapshot } from "./dslParser";
import type { SourceRevision } from "./logicalStatementSourceMap";
import { createStatementIdentity, type StatementIdentity } from "../document/statementIdentity";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { bindingIdForStableStatementId, type BindingId, type BindingSeed, type SourceNamespaceBindingResolver } from "../scalars/bindingCatalog";
import type { ScalarProgram, ScalarProgramCollection, ScalarProgramCollectionMember, ScalarProgramPositionMap } from "../scalars/scalarProgram";
import type { ScalarValue } from "../scalars/types";
import { scanScalarLiteral } from "../scalars/literalScanner";
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
import { formatDslReferencePath, formatDslReferenceToken, parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { resolveSourceLexicalDeclaration, resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import { DSL_INDENT, formatDslName, splitDslList } from "./dslTokens";
import { parseScalarExpression } from "../scalars/expressionParser";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
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

// `nui 1` 文書全体のcompile / serializeファサード。`.nui` のsourceTextを唯一の
// 正として扱い、ここではテキストと構造化データの往復だけを担う。

export type DslDocumentData = {
  elements: CadElement[];
  /** Document-level source definitions; runtime modifier resolution is deferred. */
  modifiers?: DrawingModifierDefinition[];
  /** Document-level drawing profile declarations, in source order. */
  drawingProfiles?: DrawingProfile[];
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  layouts: Layout[];
  printOutputs: PrintOutput[];
  svgOutputs: SvgOutput[];
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
  /** Stable source ownership for document-level drawing profile declarations. */
  byDrawingProfileName: Map<string, StatementInfo>;
  /** Declaration ranges keyed by the source drawing profile name. */
  drawingProfileDeclarationRangeByName: Map<string, LineRange>;
  /** Profile override block ranges keyed by modifier and profile name. */
  modifierProfileBlockRangeByModifierAndProfile: Map<string, LineRange>;
  /** Reconciler-owned identities, present only when typed declarations need them. */
  statementIdByStatementIndex?: Map<number, string>;
  /** Reverse lookup for a current reconciler-owned statement identity. */
  statementIndexByStatementId?: Map<string, number>;
  /** Current physical statement range by reconciler-owned source identity. */
  statementRangeById: Map<StatementIdentity, StatementInfo>;
  /**
   * 非要素文のキー: `role:<id>` / `view:<id>` / `layout:<id>` /
   * `print:<id>` / `svg:<id>` / `version` / `atStop` / `activeView`。
   * active系は最後の出現(コンパイラのlast-winsに一致)、version/atStopは最初の出現。
   */
  byKey: Map<string, StatementInfo>;
  /** 各セクションが存在する場合の最終行(セクション新設時の挿入アンカー)。 */
  sectionEnds: {
    version?: number;
    drawingProfiles?: number;
    modifiers?: number;
    visibility?: number;
    elements?: number;
    layouts?: number;
    outputs?: number;
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
  /** Exact-current source element products retained even when unrelated diagnostics make `document` fatal. */
  sourceElementsByStatementIndex: ReadonlyMap<number, CadElement>;
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
  /** Task 61 numeric consumers grouped by binding id, retaining the
   * compiler-owned occurrence key and exact `@name` reference span. */
  numericConsumerReferencesByBindingId?: ReadonlyMap<BindingId, readonly NumericBindingConsumerReference[]>;
  /** Source-output declaration identities used by StatementMap and bindings. */
  layoutIdsByStatementIndex?: Map<number, string>;
  outputIdsByStatementIndex?: Map<number, string>;
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
   * nui 1 document with a canonical text occurrence, independent of whether
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
  /** Exact graph/semantic owner used by imported module runtime products. */
  moduleRuntimeContext?: ModuleRuntimeContext;
  /** Task 5 runtime expansion && source-origin mapping; never persisted as source. */
  moduleMaterialization?: ModuleMaterialization;
  /** Compiler-owned Module geometry lowering for exact current runtime consumers. */
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  /** Compiled immutable geometry values; never part of document.elements. */
  geometryValueProgram?: import("./moduleGeometryValueProgram").GeometryValueProgram;
  /** Source-derived scalar order for materialized runtime occurrences. */
  scalarExecutionPositionByRuntimeElementId?: ReadonlyMap<ElementId, number>;
  /** Direct materialized occurrences; runtime builders consume these without re-resolution. */
  materializedPropertyBindings?: readonly MaterializedPropertyBindingSource[];
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
  /** Optional exact multi-document graph/semantic context for this root. */
  moduleRuntimeContext?: ModuleRuntimeContext;
};

const versionDiagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

/** Attach the code-derived presentation identity at the document boundary for
 * legacy producers that already expose a stable code but do not need any
 * semantic parameters. Parameterized producers attach their richer sidecar at
 * their own construction site. */
const withDiagnosticPresentation = (diagnostic: DslDiagnostic): DslDiagnostic =>
  diagnostic.presentation || diagnostic.code === undefined
    ? diagnostic
    : { ...diagnostic, presentation: { key: `diagnostic.${diagnostic.code}` } };

export const serializeDrawingProfileLines = (
  profiles: readonly DrawingProfile[]
): string[] => profiles.map((profile) => `profile ${formatDslName(profile.name)}`);

const serializeDrawingModifierProperties = (
  properties: {
    state?: string;
    widthPx?: number;
    style?: string;
    color?: { kind: "themeRole"; role: string } | { kind: "fixed"; hex: string };
  }
): string[] => {
  const lines: string[] = [];
  if (properties.state) lines.push(`${DSL_INDENT}state: ${properties.state},`);
  if (properties.widthPx !== undefined) lines.push(`${DSL_INDENT}width: ${properties.widthPx}px,`);
  if (properties.style) lines.push(`${DSL_INDENT}style: ${properties.style},`);
  if (properties.color) {
    const color = properties.color.kind === "themeRole"
      ? properties.color.role
      : properties.color.hex.toLowerCase();
    lines.push(`${DSL_INDENT}color: ${color},`);
  }
  return lines;
};

export const serializeDrawingModifierLines = (
  modifiers: readonly DrawingModifierDefinition[]
): string[] => modifiers.flatMap((modifier) => {
  const lines = [`modifier ${formatDslName(modifier.name)} {`];
  lines.push(...serializeDrawingModifierProperties(modifier));
  for (const delta of modifier.profileDeltas ?? []) {
    lines.push(`${DSL_INDENT}for @${formatDslName(delta.profileName)} {`);
    lines.push(...serializeDrawingModifierProperties({
      state: delta.state,
      widthPx: delta.widthPx,
      style: delta.style,
      color: delta.color
    }).map((line) => `${DSL_INDENT}${line}`));
    lines.push(`${DSL_INDENT}}`);
  }
  lines.push("}");
  return lines;
});

// ==== layout / print / svg source declarations ====

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

const sourceReference = (name: string) => name.startsWith("@")
  ? name
  : `@${formatDslReferencePath(parseDslReferenceToken(name))}`;

const resolveElementReferenceToken = (
  elements: CadElement[],
  elementId: ElementId,
  context: ElementNameContext
) => {
  const element = context.elementsById.get(elementId);
  if (!element) return formatDslReferenceToken(elementId);
  return formatDslReferencePath({
    absolute: false,
    segments: elementQualifiedNameParts(element, elements, context)
  });
};

const serializeSourceOutputLines = (data: DslDocumentData): string[] => {
  const nameContext = createElementNameContext(data.elements);
  const numeric = (value: Parameters<typeof formatNumericValueForDsl>[0]) =>
    formatNumericValueForDsl(value, data.elements, undefined, nameContext);
  const lines: string[] = [];
  for (const layout of data.layouts) {
    if (layout.scale === 1) {
      lines.push(`layout ${formatDslName(layout.name)} {`);
    } else {
      lines.push(`layout ${formatDslName(layout.name)}(`);
      lines.push(`${DSL_INDENT}scale: ${numeric(layout.scale)},`);
      lines.push(") {");
    }
    for (const placement of layout.placements) {
      const groupToken = resolveGroupToken(data.elements, placement.groupId, nameContext);
      const placeIndent = DSL_INDENT.repeat(2);
      const args = [
        ...(placement.origin.kind === "point"
          ? [`origin: ${sourceReference(resolveElementReferenceToken(data.elements, placement.origin.pointId, nameContext))},`]
          : []),
        `at: (${numeric(placement.at.x)}, ${numeric(placement.at.y)}),`,
        ...(placement.scale !== undefined ? [`scale: ${numeric(placement.scale)},`] : []),
        `angle: ${numeric(placement.angleDeg)},`,
        `mirror: ${placement.mirror},`
      ];
      lines.push(`${DSL_INDENT}place ${sourceReference(groupToken)}(`);
      lines.push(...args.map((line) => `${placeIndent}${line}`));
      lines.push(`${placeIndent})`);
    }
    lines.push("}");
  }
  const profileName = (id: string | undefined) => id
    ? data.drawingProfiles?.find((profile) => profile.id === id)?.name ?? id
    : undefined;
  for (const output of data.printOutputs) {
    lines.push(`print ${formatDslName(output.name)}(`);
    lines.push(`${DSL_INDENT}layout: ${sourceReference(data.layouts.find((layout) => layout.id === output.layoutId)?.name ?? output.layoutId)},`);
    const profile = profileName(output.profileId);
    if (profile) lines.push(`${DSL_INDENT}profile: ${sourceReference(profile)},`);
    lines.push(`${DSL_INDENT}paper: ${output.paper},`);
    lines.push(`${DSL_INDENT}orientation: ${output.orientation},`);
    lines.push(`${DSL_INDENT}overlap: ${numeric(output.overlap)},`);
    lines.push(")");
  }
  for (const output of data.svgOutputs) {
    lines.push(`svg ${formatDslName(output.name)}(`);
    lines.push(`${DSL_INDENT}layout: ${sourceReference(data.layouts.find((layout) => layout.id === output.layoutId)?.name ?? output.layoutId)},`);
    const profile = profileName(output.profileId);
    if (profile) lines.push(`${DSL_INDENT}profile: ${sourceReference(profile)},`);
    lines.push(`${DSL_INDENT}margin: ${numeric(output.margin)},`);
    lines.push(")");
  }
  return lines;
};

export type SourceOutputBlock = { layoutId: string; lines: string[] };

/** Structural source-output plan used by the existing statement patch bridge.
 * It preserves source declaration order while keeping output declarations as
 * independent blocks; no runtime preview/export model is involved. */
export const planSourceOutputSection = (data: DslDocumentData): {
  blocks: SourceOutputBlock[];
  activeSourceOutputLine: string | null;
} => {
  const lines = serializeSourceOutputLines(data);
  const blocks: SourceOutputBlock[] = [];
  let cursor = 0;
  const takeBlock = (matches: (line: string) => boolean, id: string, close: string) => {
    const start = lines.findIndex((line, index) => index >= cursor && matches(line));
    if (start < 0) return;
    const end = lines.findIndex((line, index) => index >= start && line.trim() === close);
    if (end < 0) return;
    blocks.push({ layoutId: id, lines: lines.slice(start, end + 1) });
    cursor = end + 1;
  };
  for (const layout of data.layouts) {
    const header = `layout ${formatDslName(layout.name)}`;
    takeBlock((line) => line === `${header} {` || line === `${header}(`, layout.id, "}");
  }
  for (const output of data.printOutputs) takeBlock((line) => line === `print ${formatDslName(output.name)}(`, output.id, ")");
  for (const output of data.svgOutputs) takeBlock((line) => line === `svg ${formatDslName(output.name)}(`, output.id, ")");
  return { blocks, activeSourceOutputLine: null };
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
  const drawingProfiles = data.drawingProfiles?.length
    ? data.drawingProfiles
    : [...new Map(
        (data.modifiers ?? []).flatMap((modifier) => (modifier.profileDeltas ?? []).map((delta) => [
          delta.profileId,
          { id: delta.profileId, name: delta.profileName }
        ] as const))
      ).values()];
  const sections: string[][] = [
    [`nui ${majorVersion}`, ...(options.headerComment ? [`// ${options.headerComment}`] : [])],
    serializeVisibilitySettingsLines(data.visibilityRoles, data.visibilityProfiles, data.activeVisibilityProfileId),
    serializeDrawingProfileLines(drawingProfiles),
    serializeDrawingModifierLines(data.modifiers ?? []),
    options.preserveElementOrder
      ? serializeFlatElementTree(data.elements, refs, data.evaluationLimitIndex)
      : serializeElementTree(data.elements, refs, data.evaluationLimitIndex),
    serializeSourceOutputLines(data)
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

/**
 * Source-output declarations are validated in their authored order.
 * Source-output declarations are kept as authored source blocks.
 * Numeric references are compiled against the same source namespace.
 * The source bridge does not silently reorder geometry statements.
 * 本文statementをprintLayoutセクションより前へ黙って並び替えるため、
 * Source declarations remain in authored order after normalization.
 * 変わりうる。
 */
const validateSourceOutputPlacement = (): DslDiagnostic[] => [];

const attrValueOf = (statement: DslStatement, key: string) =>
  statement.attrs.find((item) => item.key === key)?.value;

export const buildStatementMap = (
  statements: DslStatement[],
  lastLine: number,
  elementIdByStatementIndex: Map<number, ElementId>,
  layoutIdsByStatementIndex: Map<number, string> | undefined,
  outputIdsByStatementIndex: Map<number, string> | undefined,
  assignedStatementIds?: ReadonlyMap<number, string>,
  includeStatement: DslStatementInclusion = () => true
): StatementMap => {
  const infos: StatementInfo[] = [];
  const stack: StatementInfo[] = [];
  const byKey = new Map<string, StatementInfo>();
  const setFirst = (key: string, info: StatementInfo) => {
    if (!byKey.has(key)) byKey.set(key, info);
  };
  const placementRefByStatementIndex = buildPlacementRefsByStatementIndex(statements, layoutIdsByStatementIndex);

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
      case "modifierDefinition":
        byKey.set(`modifier:${statement.name}`, info);
        break;
      case "profileDeclaration":
        byKey.set(`profile:${statement.name}`, info);
        break;
      case "role":
        byKey.set(`role:${attrValueOf(statement, "id") ?? statement.name}`, info);
        break;
      case "view":
        byKey.set(`view:${attrValueOf(statement, "id") ?? statement.name}`, info);
        break;
      case "layout": {
        const layoutId = layoutIdsByStatementIndex?.get(statementIndex) ?? statement.name;
        if (layoutId) byKey.set(`layout:${layoutId}`, info);
        break;
      }
      case "print": {
        const outputId = outputIdsByStatementIndex?.get(statementIndex) ?? statement.name;
        if (outputId) byKey.set(`print:${outputId}`, info);
        break;
      }
      case "svg": {
        const outputId = outputIdsByStatementIndex?.get(statementIndex) ?? statement.name;
        if (outputId) byKey.set(`svg:${outputId}`, info);
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
  const byDrawingProfileName = new Map<string, StatementInfo>();
  const drawingProfileDeclarationRangeByName = new Map<string, LineRange>();
  const modifierProfileBlockRangeByModifierAndProfile = new Map<string, LineRange>();
  for (const info of infos) {
    const statement = statements[info.statementIndex];
    if (!includeStatement(statement, info.statementIndex)) continue;
    if (statement.kind === "modifierDefinition") {
      if (!byModifierName.has(statement.name)) byModifierName.set(statement.name, info);
      if (!modifierDefinitionRangeByName.has(statement.name)) {
        modifierDefinitionRangeByName.set(statement.name, { ...info.range });
      }
    } else if (statement.kind === "profileDeclaration") {
      if (!byDrawingProfileName.has(statement.name)) byDrawingProfileName.set(statement.name, info);
      if (!drawingProfileDeclarationRangeByName.has(statement.name)) {
        drawingProfileDeclarationRangeByName.set(statement.name, { ...info.range });
      }
    } else if (statement.kind === "modifierProfileBlock") {
      const parent = statement.enclosing?.statementIndex === undefined
        ? undefined
        : statements[statement.enclosing.statementIndex];
      if (parent?.kind === "modifierDefinition") {
        const key = `${parent.name}\0${statement.profileName}`;
        if (!modifierProfileBlockRangeByModifierAndProfile.has(key)) {
          modifierProfileBlockRangeByModifierAndProfile.set(key, { ...info.range });
        }
      }
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
    } else if (statement.kind === "profileDeclaration") {
      sectionEnds.drawingProfiles = Math.max(sectionEnds.drawingProfiles ?? 0, info.line);
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
    } else if (statement.kind === "layout") {
      sectionEnds.layouts = Math.max(sectionEnds.layouts ?? 0, info.range.endLine);
    } else if (statement.kind === "print" || statement.kind === "svg") {
      sectionEnds.outputs = Math.max(sectionEnds.outputs ?? 0, info.range.endLine);
    }
  }

  return {
    sourceRevision: statements[0]?.sourceRevision ?? 0,
    statements: infos,
    byElementId,
    elementIdByStatementIndex,
    byModifierName,
    modifierDefinitionRangeByName,
    byDrawingProfileName,
    drawingProfileDeclarationRangeByName,
    modifierProfileBlockRangeByModifierAndProfile,
    ...(statementIdByStatementIndex ? { statementIdByStatementIndex } : {}),
    ...(statementIndexByStatementId ? { statementIndexByStatementId } : {}),
    statementRangeById,
    byKey,
    sectionEnds
  };
};

const sourceElementsFor = (compiled: {
  elements: readonly CadElement[];
  elementIdsByStatementIndex?: ReadonlyMap<number, ElementId>;
}): ReadonlyMap<number, CadElement> => {
  const elementsById = new Map(compiled.elements.map((element) => [element.id, element]));
  return new Map(
    [...(compiled.elementIdsByStatementIndex ?? [])].flatMap(([statementIndex, elementId]) => {
      const element = elementsById.get(elementId);
      return element ? [[statementIndex, element] as const] : [];
    })
  );
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
  const sourceOutputPlacementDiagnostics = validateSourceOutputPlacement();

  let compiled = compileDslToElements(normalized, {
    elements: [],
    mode: "document",
    preparsed: parsed,
    assignedElementIds: options.assignedStatementIds ?? options.assignedElementIds,
    majorVersion: versionValidation.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION
  });
  const hasTypedDeclarations = parsed.statements.some(
    (statement, statementIndex) => statement.kind === "typedDeclaration" && isCanonicalValueBindingDeclaration(parsed.statements, statementIndex)
  );
  // set statements need the same reconciler-issued identity map as typed
  // declarations (Task 29) - the gate must include them too, otherwise a
  // document with `set` but no local const/let would build the map from a
  // fallback empty source instead of the caller's real reconciliation
  // output.
  const hasSetStatements = parsed.statements.some(
    (statement, statementIndex) => statement.kind === "set" && includeStatement(statement, statementIndex)
  );
  // layout/place/output numeric fields resolve `@name` against typed const/let
  // bindings the same way element fields do (Task 53), so a document with a
  // layout/output declarations but zero typedDeclaration/set statements of its own
  // must still run scalar analysis - otherwise an unresolved `@name` inside
  // at all && silently produces no diagnostic. `place` is covered by its
  // enclosing layout declaration.
  const hasSourceOutputStatements = parsed.statements.some(
    (statement, statementIndex) => (statement.kind === "layout" || statement.kind === "print" || statement.kind === "svg") && includeStatement(statement, statementIndex)
  );
  const hasModuleStatements = parsed.statements.some(
    (statement) => statement.kind === "moduleDefinition" || statement.kind === "moduleInstance"
  );
  const hasGeometryValueStatements = parsed.statements.some(
    (statement) => statement.kind === "typedDeclaration" && statement.valueType?.kind !== "array" &&
      (statement.valueType?.kind === "point" || statement.valueType?.kind === "line" || statement.valueType?.kind === "path")
  );
  const hasRecordValueControlFlowStatements = parsed.statements.some(
    (statement) => statement.kind === "typedDeclaration" && nominalRecordTypeOfDslValueType(statement.valueType) !== null &&
      /^(?:if\s*\(|match\b)/.test(statement.initializer.trim())
  );
  const containsCollectionIndex = (ast: ScalarExpressionAst | null): boolean => {
    if (!ast) return false;
    switch (ast.kind) {
      case "collectionIndex": return true;
      case "unary": return containsCollectionIndex(ast.operand);
      case "binary": return containsCollectionIndex(ast.left) || containsCollectionIndex(ast.right);
      case "group": return containsCollectionIndex(ast.expression);
      case "valueIf": return containsCollectionIndex(ast.condition) || containsCollectionIndex(ast.thenBranch) || containsCollectionIndex(ast.elseBranch);
      case "valueMatch": return containsCollectionIndex(ast.scrutinee) || ast.arms.some((arm) => containsCollectionIndex(arm.expression));
      case "call": return ast.args.some((argument) => containsCollectionIndex(argument.expression));
      default: return false;
    }
  };
  const hasGenericCollectionIndexStatements = parsed.statements.some((statement) =>
    statement.kind === "typedDeclaration" && statement.initializer
      ? containsCollectionIndex(parseScalarExpression(statement.initializer, { start: 0, end: statement.initializer.length }).ast)
      : false
  );
  const hasGeometryCollectionIndexStatements = parsed.statements.some((statement, statementIndex) =>
    isElementDslStatement(statement) && includeStatement(statement, statementIndex) && statement.attrs.some((attribute) => {
      const sources = [attribute.value, ...splitDslList(attribute.value)];
      return sources.some((source) =>
        containsCollectionIndex(parseScalarExpression(source, { start: 0, end: source.length }).ast)
      );
    })
  );
  const hasCollectionControlFlowStatements = parsed.statements.some((statement) => {
    if (statement.kind !== "typedDeclaration" || statement.valueType?.kind !== "array") return false;
    const parsedCollection = parseGeometryArrayExpression(statement.initializer);
    return parsedCollection.expression?.kind === "if" || parsedCollection.expression?.kind === "match";
  });
  const hasCompilableGeometryStatements = parsed.statements.some(
    (statement, statementIndex) => isElementDslStatement(statement) && includeStatement(statement, statementIndex)
  );
  const hasSourceNamespaceStatements = parsed.statements.some(
    (statement, statementIndex) =>
      (statement.kind === "typedDeclaration" && isCanonicalValueBindingDeclaration(parsed.statements, statementIndex)) ||
      (includeStatement(statement, statementIndex) &&
        (statement.kind === "recordDefinition" ||
          statement.kind === "group" ||
          statement.kind === "moduleDefinition" ||
          statement.kind === "moduleInstance" ||
          statement.kind === "profileDeclaration" ||
          statement.kind === "layout" ||
          statement.kind === "print" ||
          statement.kind === "svg" ||
          (statement.kind === "element" &&
            (isGeometryDeclarationCategory(statement.category) ||
              statement.type === "conditionalGroup" ||
              statement.type === "forGroup"))))
  );
  const hasDrawingProfileStatements = parsed.statements.some(
    (statement, statementIndex) => statement.kind === "profileDeclaration" && includeStatement(statement, statementIndex)
  );
  const stableStatementIdByIndex =
    (hasTypedDeclarations || hasSetStatements || hasSourceOutputStatements || hasModuleStatements || hasSourceNamespaceStatements)
    ? new Map<number, string>(options.assignedStatementIds ?? options.assignedElementIds ?? [])
    : undefined;
  if (stableStatementIdByIndex) {
    for (const [statementIndex, elementId] of compiled.elementIdsByStatementIndex ?? []) {
      stableStatementIdByIndex.set(statementIndex, elementId);
    }
    // Standalone parse/compile callers do not have a prior reconciled
    // snapshot. Allocate opaque internal identities for source declarations;
    // canonicalDocument supplies the reconciler-owned identity on the normal
    // edit path, so this fallback never becomes a user-visible name || source
    // namespace.
    parsed.statements.forEach((statement, statementIndex) => {
      if ((statement.kind === "layout" || statement.kind === "print" || statement.kind === "svg" || statement.kind === "place") && !stableStatementIdByIndex.has(statementIndex)) {
        stableStatementIdByIndex.set(statementIndex, createStatementIdentity(statement.kind));
      }
      if (statement.kind === "profileDeclaration" && !stableStatementIdByIndex.has(statementIndex)) {
        stableStatementIdByIndex.set(statementIndex, createStatementIdentity("profile"));
      }
      if (
        hasDrawingProfileStatements &&
        !stableStatementIdByIndex.has(statementIndex) &&
        (
          statement.kind === "moduleDefinition" ||
          statement.kind === "moduleInstance" ||
          statement.kind === "group" ||
          (statement.kind === "element" && (
            isGeometryDeclarationCategory(statement.category) ||
            statement.type === "conditionalGroup" ||
            statement.type === "forGroup"
          ))
        )
      ) {
        stableStatementIdByIndex.set(
          statementIndex,
          createStatementIdentity(statement.kind === "element" ? statement.type ?? "element" : statement.kind)
        );
      }
    });
  }
  const sourceNamespaceRequiresIdentity = (statement: DslStatement) =>
    statement.kind === "recordDefinition" ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance" ||
    statement.kind === "profileDeclaration" ||
    statement.kind === "layout" ||
    statement.kind === "print" ||
    statement.kind === "svg" ||
    statement.kind === "group" ||
    statement.kind === "typedDeclaration" ||
    (statement.kind === "element" &&
      (isGeometryDeclarationCategory(statement.category) ||
        statement.type === "conditionalGroup" ||
        statement.type === "forGroup"));
  const sourceNamespaceHasCompleteIdentity =
    stableStatementIdByIndex !== undefined &&
    (options.assignedStatementIds !== undefined || options.assignedElementIds !== undefined || stableStatementIdByIndex?.size !== 0) &&
    parsed.statements.every(
      (statement, statementIndex) => !sourceNamespaceRequiresIdentity(statement) || stableStatementIdByIndex.has(statementIndex)
    );
  const sourceLexicalNamespace = sourceNamespaceHasCompleteIdentity
    ? buildSourceLexicalNamespaceIndex(parsed.statements, stableStatementIdByIndex!)
    : undefined;
  const hasNominalRecordCollectionValueFor = sourceLexicalNamespace?.geometryArraySemanticAnalysis?.genericValues.some((value) => {
    if (value.valueType.elementType.kind !== "record" || !value.value) return false;
    const visit = (candidate: DslArraySemanticValue<GenericArraySourceTarget>): boolean => {
      if (candidate.kind === "map") return candidate.sourceElementType.kind === "record" || candidate.resultElementType.kind === "record";
      if (candidate.kind === "if") return visit(candidate.thenValue) || visit(candidate.elseValue);
      if (candidate.kind === "match") return candidate.arms.some((arm) => visit(arm.value));
      return false;
    };
    return visit(value.value);
  }) ?? false;
  const moduleRuntimeContext = (() => {
    const candidate = options.moduleRuntimeContext;
    if (!candidate?.valid || !stableStatementIdByIndex || !sourceLexicalNamespace) return undefined;
    const root = candidate.documentFor(candidate.rootDocumentId);
    if (!root || root.source.kind !== "root-current" ||
        root.source.normalizedSource !== normalized ||
        root.source.sourceRevision !== parsed.sourceRevision ||
        root.statements.length !== parsed.statements.length) return undefined;
    for (const [statementIndex, statementId] of root.statementIdByStatementIndex) {
      if (stableStatementIdByIndex.get(statementIndex) !== statementId) return undefined;
    }
    return candidate;
  })();
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
      stableStatementIdByIndex,
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
  const projectCompilerDiagnostic = (diagnostic: DslDiagnostic): DslDiagnostic => {
    const { logicalSpan, statementIndex, ...publicDiagnostic } = diagnostic;
    if (logicalSpan === undefined || statementIndex === undefined) return publicDiagnostic;
    const statement = parsed.statements[statementIndex];
    const physicalSpan = statement ? exactPhysicalSpan(spans, statement, logicalSpan) : null;
    return {
      ...publicDiagnostic,
      exactSpanOnly: true as const,
      ...(physicalSpan ? { physicalSpan } : {})
    };
  };
  const projectedCompilerDiagnostics = compiled.diagnostics.map(projectCompilerDiagnostic);
  const baseDiagnostics = [
    ...versionValidation.diagnostics,
    ...sourceOutputPlacementDiagnostics,
    ...projectedCompilerDiagnostics,
    ...(sourceLexicalNamespace?.diagnostics ?? [])
  ].map(withDiagnosticPresentation);

  // missing-attribute-value ("well-formed but currently-empty named value" -
  // see dslArgScanner.ts) is deliberately excluded from the fatal gate here,
  // matching dslValueSpans.ts's existing carve-out for the same code: an
  // intentionally-blank `key:` (typed by hand, || spliced in as a
  // command-line creation draft) still yields a compiled document with an
  // ordinary element-level diagnostic, the same way an unresolved reference
  // does, instead of discarding the whole document back to its last-good
  // state. Every other error-severity diagnostic - actual syntax errors,
  // type errors, etc. - keeps making the document fatal. A missing record
  // constructor field is allowed through this gate so scalar projections can
  // still report independent control-flow diagnostics; the final diagnostic
  // gate below still rejects the document.
  if (baseDiagnostics.some((item) =>
    item.severity === "error" &&
    item.code !== MISSING_ATTRIBUTE_VALUE_CODE &&
    item.code !== "record-constructor-missing-field"
  )) {
    return {
      document: null,
      majorVersion: versionValidation.majorVersion,
      statements: parsed.statements,
      statementMap: null,
      sourceLines,
      diagnostics: baseDiagnostics,
      spans,
      sourceElementsByStatementIndex: sourceElementsFor(compiled),
      ...(sourceLexicalNamespace ? { sourceLexicalNamespace } : {})
    };
  }

  const rootGeometryValuePropertyResolver = sourceLexicalNamespace
    ? ({ statementIndex, node }: {
        statementIndex: number;
        node: Extract<import("../scalars/expressionAst").ScalarExpressionAst, { kind: "geometryProperty" }>;
      }) => {
        const lookup = resolveSourceLexicalDeclaration(
          sourceLexicalNamespace,
          statementIndex,
          parseDslReferenceToken(node.elementName).segments[0] ?? node.elementName
        );
        if (lookup.kind !== "resolved" ||
            lookup.declaration.kind !== "typedDeclaration" ||
            lookup.declaration.statement.kind !== "typedDeclaration" ||
            !isDslGeometryValueType(lookup.declaration.statement.valueType)) {
          if (
            lookup.kind === "resolved" &&
            lookup.declaration.kind === "typedDeclaration" &&
            lookup.declaration.statement.kind === "typedDeclaration" &&
            node.property === "length"
          ) {
            const collectionAnalysis = sourceLexicalNamespace.geometryArraySemanticAnalysis;
            const value = collectionAnalysis
              ? collectionValueSemanticForStatement(collectionAnalysis, lookup.declaration.statementIndex)
              : null;
            const length = value && collectionAnalysis
              ? collectionLengthForValueId(collectionAnalysis, value.statementId)
              : null;
            if (value && length !== null) {
              return {
                kind: "collection" as const,
                collectionValueId: value.statementId,
                collectionLength: length ?? 0,
                targetSourceOrder: lookup.declaration.statementIndex,
                type: { kind: "number" as const }
              };
            }
          }
          // Module export property resolution is owned by the later Module
          // semantic pass. Keep the first scalar pass fail-closed without
          // emitting a duplicate geometry diagnostic for a qualified
          // collection candidate; the later pass replaces this placeholder
          // with the exact export identity or its diagnostic.
          const path = parseDslReferenceToken(node.elementName);
          const instanceLookup = path.segments.length === 2
            ? resolveSourceLexicalDeclaration(sourceLexicalNamespace, statementIndex, path.segments[0]!)
            : null;
          if (node.property === "length" && instanceLookup?.kind === "resolved" && instanceLookup.declaration.kind === "moduleInstance") {
            return {
              kind: "collection" as const,
              collectionValueId: JSON.stringify([instanceLookup.declaration.statementId, path.segments[1]]),
              collectionLength: 0,
              targetSourceOrder: instanceLookup.declaration.statementIndex,
              type: { kind: "number" as const }
            };
          }
          return null;
        }
        const declaredInterfaceType = lookup.declaration.statement.valueType.kind;
        const pointPath = /^(start|end)\.(x|y)$/.exec(node.property);
        const property = pointPath ? pointPath[2]! : node.property;
        const pointKey = pointPath?.[1];
        const valid = declaredInterfaceType === "point"
          ? property === "x" || property === "y"
          : property === "length" || property === "startAngleDeg" || property === "endAngleDeg" || Boolean(pointPath);
        if (!valid) return null;
        return {
          kind: "geometryValue" as const,
          occurrence: { sourceStatementId: stableStatementIdByIndex!.get(lookup.declaration.statementIndex)!, instancePath: [] },
          property,
          ...(pointKey ? { pointKey } : {}),
          targetSourceOrder: lookup.declaration.statementIndex,
          type: { kind: "number" as const }
        };
      }
    : undefined;

  const rootCollectionIndexResolver = sourceLexicalNamespace
    ? ({ statementIndex, node }: {
        statementIndex: number;
        node: Extract<import("../scalars/expressionAst").ScalarExpressionAst, { kind: "collectionIndex" }>;
      }) => {
        const recordFieldPrefix = "__nui_record_field__";
        if (node.name.startsWith(recordFieldPrefix)) {
          try {
            const encoded = JSON.parse(node.name.slice(recordFieldPrefix.length)) as unknown;
            if (
              Array.isArray(encoded) && encoded.length === 3 &&
              typeof encoded[0] === "string" && typeof encoded[1] === "string" &&
              typeof encoded[2] === "number" && Number.isInteger(encoded[2]) && encoded[2] >= 0
            ) {
              const basePath = parseDslReferenceToken(encoded[0]);
              const baseLookup = resolveSourceLexicalPath(sourceLexicalNamespace, statementIndex, basePath);
              const baseValue = baseLookup.kind === "resolved" && baseLookup.declaration.kind === "typedDeclaration"
                ? sourceLexicalNamespace.geometryArraySemanticAnalysis?.genericValuesByStatementIndex.get(baseLookup.declaration.statementIndex) ?? null
                : null;
              const recordType = baseValue?.valueType.elementType.kind === "record"
                ? baseValue.valueType.elementType.identity
                : null;
              const field = recordType
                ? sourceLexicalNamespace.recordSemanticAnalysis?.definitionsByStatementId.get(recordType)?.fields.find((candidate) =>
                    candidate.identity.recordStatementId === encoded[1] && candidate.fieldIndex === encoded[2]
                  )
                : undefined;
              if (baseValue && field) {
                const collectionValueId = `record-field-collection:${JSON.stringify([
                  baseValue.statementId,
                  encoded[1],
                  encoded[2]
                ])}`;
                return {
                  kind: "resolvedCollectionIndex" as const,
                  collectionValueId,
                  collectionLength: collectionLengthForValueId(sourceLexicalNamespace.geometryArraySemanticAnalysis!, baseValue.statementId),
                  // The record field backing slot is ordered within its
                  // record declaration, while the collection owner is
                  // ordered by its enclosing declaration. Semantic analysis
                  // already proves the source precedes this record value;
                  // use the established synthetic marker at runtime so the
                  // two order domains are not compared as if they were one.
                  targetSourceOrder: -1,
                  type: field.type
                };
              }
            }
          } catch {
            // The compiler only emits its own encoded field projection names.
          }
          return null;
        }
        const path = parseDslReferenceToken(node.name);
        const lookup = resolveSourceLexicalPath(sourceLexicalNamespace, statementIndex, path);
        let value: ReturnType<typeof collectionValueSemanticForStatement> = null;
        let targetSourceOrder: number | null = null;
        let collectionValueId: string | null = null;
        if (lookup.kind === "resolved" && lookup.declaration.kind === "typedDeclaration") {
          value = sourceLexicalNamespace.geometryArraySemanticAnalysis
            ? collectionValueSemanticForStatement(sourceLexicalNamespace.geometryArraySemanticAnalysis, lookup.declaration.statementIndex)
            : null;
          targetSourceOrder = lookup.declaration.statementIndex;
          collectionValueId = value?.statementId ?? null;
        } else if (path.segments.length === 2 && lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance") {
          const instance = lookup.declaration.statement;
          if (instance.kind !== "moduleInstance") return null;
          const localDefinitionLookup = resolveSourceLexicalPath(sourceLexicalNamespace, lookup.declaration.statementIndex, parseDslReferenceToken(instance.moduleName));
          const runtimeInstance = moduleRuntimeContext?.analysisFor(moduleRuntimeContext.rootDocumentId)?.instancesByStatementId.get(lookup.declaration.statementId);
          const runtimeDefinition = moduleRuntimeContext && runtimeInstance?.callee
            ? moduleRuntimeContext.definitionFor(runtimeInstance.callee.definitionIdentity)
            : undefined;
          if (runtimeDefinition && moduleRuntimeContext) {
            const definingAnalysis = moduleRuntimeContext.documentFor(runtimeDefinition.documentId ?? moduleRuntimeContext.rootDocumentId)?.sourceLexicalNamespace.geometryArraySemanticAnalysis;
            const exported = runtimeDefinition.exports.find((candidate) => candidate.kind === "collection" && candidate.name === path.segments[1]);
            if (exported?.kind === "collection" && definingAnalysis) {
              value = definingAnalysis.genericValuesByStatementId.get(exported.exportedStatementId) ?? null;
              targetSourceOrder = lookup.declaration.statementIndex;
              collectionValueId = geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!);
            }
          } else if (localDefinitionLookup.kind === "resolved" && localDefinitionLookup.declaration.statement.kind === "moduleDefinition") {
            const exportedIndex = parsed.statements.findIndex((candidate) =>
              candidate.kind === "typedDeclaration" && candidate.exported && candidate.name === path.segments[1] &&
              candidate.enclosing?.statementIndex === localDefinitionLookup.declaration.statementIndex
            );
            if (exportedIndex >= 0) {
              value = sourceLexicalNamespace.geometryArraySemanticAnalysis
                ? collectionValueSemanticForStatement(sourceLexicalNamespace.geometryArraySemanticAnalysis, exportedIndex)
                : null;
              targetSourceOrder = lookup.declaration.statementIndex;
              collectionValueId = geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!);
            }
          }
        }
        if (!value || !sourceLexicalNamespace.geometryArraySemanticAnalysis || !("valueType" in value)) return null;
        const scalarElementType = scalarTypeOfDslValueType(value.valueType.elementType);
        if (!scalarElementType) return null;
        return {
          kind: "resolvedCollectionIndex" as const,
          collectionValueId: collectionValueId ?? value.statementId,
          collectionLength: collectionValueId === value.statementId
            ? collectionLengthForValueId(sourceLexicalNamespace.geometryArraySemanticAnalysis, value.statementId)
            : null,
          targetSourceOrder: targetSourceOrder ?? -1,
          type: scalarElementType
        };
      }
    : undefined;

  // Value-for collection shape is owned by the collection semantic pass, but
  // its scalar body belongs to the established typed-declaration analyzer.
  // Give each body a source-owned synthetic binding so the normal source
  // sweep, collection-index resolver, geometry-property resolver, and scalar
  // typechecker all see the immutable binder without making it a surrounding
  // declaration.
  const rootValueForBodyEntries = sourceLexicalNamespace?.geometryArraySemanticAnalysis
    ? sourceLexicalNamespace.geometryArraySemanticAnalysis.genericValues.flatMap((value) => {
        if (value.ownerModuleDefinitionStatementIndex !== null) return [];
        const statement = parsed.statements[value.statementIndex];
        if (statement?.kind !== "typedDeclaration") return [];
        const mappedValues: DslArrayMappedValue[] = [];
        const collect = (candidate: DslArraySemanticValue<GenericArraySourceTarget>) => {
          if (candidate.kind === "map") {
            if (candidate.sourceElementType.kind === "record" || candidate.resultElementType.kind === "record") return;
            mappedValues.push(candidate);
            return;
          }
          if (candidate.kind === "if") {
            collect(candidate.thenValue);
            collect(candidate.elseValue);
            return;
          }
          if (candidate.kind === "match") {
            for (const arm of candidate.arms) collect(arm.value);
          }
        };
        if (value.value) collect(value.value);
        return mappedValues.map((mapped) => ({ value, mapped, statement }));
      })
    : [];
  const rootValueForBodyBindingSeeds: readonly BindingSeed[] = rootValueForBodyEntries.flatMap(({ value, mapped }) => {
    const sourceElementType = scalarTypeOfDslValueType(mapped.sourceElementType);
    if (!sourceElementType) return [];
    const binderId = mapped.binderId;
    const scopeId = sourceLexicalNamespace!.scopeIndex.scopeOfStatement.get(value.statementIndex) ?? sourceLexicalNamespace!.scopeIndex.rootScopeId;
    return {
      id: binderId,
      kind: "typed" as const,
      name: mapped.binder,
      nameSpan: mapped.binderSpan,
      statementIndex: value.statementIndex,
      sourceOrder: 1,
      effectiveScopeId: scopeId,
      visibility: { kind: "typed", scopeId } as const,
      mutability: "readonly" as const,
      declaredType: sourceElementType,
      declarationVersionId: `value-for-binder-version:${binderId}`,
      resolutionMode: "preResolvedOnly" as const,
      catalogOrder: "source" as const
    };
  });
  const rootValueForBodyInitializers = rootValueForBodyEntries.flatMap(({ mapped, statement }) => {
    const resultElementType = scalarTypeOfDslValueType(mapped.resultElementType);
    if (!resultElementType) return [];
    const initializerSpan = statement.payloadSpans.initializer;
    if (!initializerSpan) return [];
    return [{
      bindingId: mapped.binderId,
      raw: statement.initializer.slice(mapped.bodySpan.start - initializerSpan.start, mapped.bodySpan.end - initializerSpan.start),
      span: mapped.bodySpan,
      expectedType: resultElementType
    }];
  });
  const rootValueForBodyBindingResolver: SourceNamespaceBindingResolver = (name, statementIndex) => {
    const entry = rootValueForBodyEntries.find(({ value, mapped }) => {
      return value.statementIndex === statementIndex && mapped.binder === name;
    });
    return entry ? { kind: "resolved", bindingId: entry.mapped.binderId } : null;
  };
  const applyRootValueForBodies = (analysis: BindingAnalysis | undefined, typedInitializers: ReadonlyMap<BindingId, TypedScalarExpression> | undefined) => {
    if (!analysis || !typedInitializers || !sourceLexicalNamespace?.geometryArraySemanticAnalysis) return;
    for (const { mapped } of rootValueForBodyEntries) {
      const body = typedInitializers.get(mapped.binderId);
      if (body) mapped.body = body;
    }
  };

  const rootScalarCollectionValues = (analysis: BindingAnalysis, moduleAnalysis?: ModuleSemanticAnalysis): readonly ScalarProgramCollection[] => {
    const collectionAnalysis = sourceLexicalNamespace?.geometryArraySemanticAnalysis;
    if (!collectionAnalysis || !stableStatementIdByIndex) return [];
    const values: ScalarProgramCollection[] = [];
    const append = (valueId: string, collectionValue: NonNullable<typeof collectionAnalysis.genericValues[number]["value"]>, sourceStatementId: string, sourceOrder: number): void => {
      if (collectionValue.kind === "if") {
        const thenValueId = `${valueId}:then`;
        const elseValueId = `${valueId}:else`;
        append(thenValueId, collectionValue.thenValue as NonNullable<typeof collectionAnalysis.genericValues[number]["value"]>, sourceStatementId, sourceOrder);
        append(elseValueId, collectionValue.elseValue as NonNullable<typeof collectionAnalysis.genericValues[number]["value"]>, sourceStatementId, sourceOrder);
        if (!collectionValue.condition) return;
        const condition = lowerExpression(
          collectionValue.condition,
          (target) => target.kind === "documentBinding" ? analysis.catalog.bindingsById.get(target.bindingId) : undefined,
          analysis.catalog.bindingsById,
          undefined,
          undefined,
          undefined,
          () => false,
          (id) => id,
          (order) => order
        ).expression;
        values.push({ valueId, kind: "if", condition, thenValueId, elseValueId, sourceOrder });
        return;
      }
      if (collectionValue.kind === "match") {
        if (!collectionValue.scrutinee) return;
        const arms = collectionValue.arms.map((arm) => {
          const armValueId = `${valueId}:arm:${arm.label}`;
          append(armValueId, arm.value as NonNullable<typeof collectionAnalysis.genericValues[number]["value"]>, sourceStatementId, sourceOrder);
          return { label: arm.label, valueId: armValueId };
        });
        const scrutinee = lowerExpression(
          collectionValue.scrutinee,
          (target) => target.kind === "documentBinding" ? analysis.catalog.bindingsById.get(target.bindingId) : undefined,
          analysis.catalog.bindingsById,
          undefined,
          undefined,
          undefined,
          () => false,
          (id) => id,
          (order) => order
        ).expression;
        values.push({ valueId, kind: "match", scrutinee, arms, sourceOrder });
        return;
      }
      if (collectionValue.valueType.elementType.kind === "record") return;
      const elementType = scalarTypeOfDslValueType(collectionValue.valueType.elementType);
      if (!elementType) return;
      if (collectionValue.kind === "map") {
        if (collectionValue.sourceElementType.kind === "record" || collectionValue.resultElementType.kind === "record") return;
        if (!collectionValue.body) return;
        values.push({ valueId, kind: "map", sourceValueId: collectionValue.sourceValueId, sourceElementType: collectionValue.sourceElementType, resultElementType: collectionValue.resultElementType, binderId: collectionValue.binderId, body: collectionValue.body, sourceOrder: collectionValue.sourceOrder });
        return;
      }
      if (collectionValue.kind === "alias") {
        values.push({ valueId, kind: "alias", targetValueId: collectionValue.targetValueId });
        return;
      }
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of collectionValue.members) {
        if (member.target.kind === "scalarValue" && member.target.statementId === sourceStatementId) {
          const literal = scanScalarLiteral(member.sourceText, { start: 0, end: member.sourceText.length });
          if (literal.kind === "error" || literal.span.start !== 0 || literal.span.end !== member.sourceText.length) return;
          const scalarValue: ScalarValue | null = literal.kind === "number"
            ? { kind: "number", value: literal.value }
            : literal.kind === "string"
              ? { kind: "string", value: literal.cooked }
              : literal.kind === "boolean"
                ? { kind: "boolean", value: literal.value }
                : elementType.kind === "choice" ? { kind: "choice", value: literal.raw, options: elementType.options } : null;
          if (!scalarValue) return;
          members.push({ kind: "literal", type: elementType, value: scalarValue });
          continue;
        }
        if (member.target.kind !== "scalarValue") return;
        const binding = analysis.catalog.bindingsById.get(bindingIdForStableStatementId(member.target.statementId));
        if (!binding || binding.kind !== "typed") return;
        members.push({ kind: "binding", type: elementType, bindingId: binding.id });
      }
      values.push({ valueId, kind: "literal", members });
    };
    for (const value of collectionAnalysis.genericValues) {
      if (value.ownerModuleDefinitionStatementIndex !== null) continue;
      if (value.valueType.elementType.kind === "record") continue;
      const elementType = scalarTypeOfDslValueType(value.valueType.elementType);
      const collectionValue = value.value;
      if (!elementType || !collectionValue) continue;
      if (collectionValue.kind === "if" || collectionValue.kind === "match") {
        if (moduleAnalysis) append(value.statementId, collectionValue, value.statementId, value.statementIndex);
        continue;
      }
      if (collectionValue.kind === "map" && collectionValue.body) {
        if (collectionValue.sourceElementType.kind === "record" || collectionValue.resultElementType.kind === "record") continue;
        const sourceElementType = scalarTypeOfDslValueType(collectionValue.sourceElementType);
        const resultElementType = scalarTypeOfDslValueType(collectionValue.resultElementType);
        if (!sourceElementType || !resultElementType) continue;
        values.push({
          valueId: value.statementId,
          kind: "map",
          sourceValueId: collectionValue.sourceValueId,
          sourceElementType,
          resultElementType,
          binderId: collectionValue.binderId,
          body: collectionValue.body,
          sourceOrder: collectionValue.sourceOrder
        });
        continue;
      }
      if (collectionValue.kind === "map") continue;
      if (collectionValue.kind === "alias") {
        values.push({ valueId: value.statementId, kind: "alias", targetValueId: collectionValue.targetValueId });
        continue;
      }
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of collectionValue.members) {
        if (member.target.kind === "scalarValue" && member.target.statementId === value.statementId) {
          const literal = scanScalarLiteral(member.sourceText, { start: 0, end: member.sourceText.length });
          if (literal.kind === "error" || literal.span.start !== 0 || literal.span.end !== member.sourceText.length) break;
          const scalarValue: ScalarValue | null = literal.kind === "number"
            ? { kind: "number", value: literal.value }
            : literal.kind === "string"
              ? { kind: "string", value: literal.cooked }
              : literal.kind === "boolean"
                ? { kind: "boolean", value: literal.value }
                : elementType.kind === "choice"
                  ? { kind: "choice", value: literal.raw, options: elementType.options }
                  : null;
          if (!scalarValue) break;
          members.push({ kind: "literal", type: elementType, value: scalarValue });
          continue;
        }
        if (member.target.kind !== "scalarValue") break;
        const binding = analysis.catalog.bindingsById.get(bindingIdForStableStatementId(member.target.statementId));
        if (!binding || binding.kind !== "typed") break;
        members.push({ kind: "binding", type: elementType, bindingId: binding.id });
      }
      if (members.length === collectionValue.members.length) {
        values.push({ valueId: value.statementId, kind: "literal", members });
      }
    }
    return values;
  };

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
        sourceNamespace: sourceLexicalNamespace,
        additionalGeometryPropertyResolver: rootGeometryValuePropertyResolver,
        additionalCollectionIndexResolver: rootCollectionIndexResolver,
        additionalBindings: rootValueForBodyBindingSeeds,
        additionalBindingResolver: rootValueForBodyBindingResolver,
        additionalInitializers: rootValueForBodyInitializers,
        nonProgramBindingIds: new Set(rootValueForBodyBindingSeeds.map((seed) => seed.id))
      })
    : { diagnostics: [] };
  let documentScalarAnalysis = scalarAnalysisCompilation.analysis;
  applyRootValueForBodies(documentScalarAnalysis?.bindingAnalysis, documentScalarAnalysis?.typedInitializerByBindingId);
  let documentScalarProgram = documentScalarAnalysis
    ? lowerScalarProgram({ ...documentScalarAnalysis, collectionValues: rootScalarCollectionValues(documentScalarAnalysis.bindingAnalysis) })
    : undefined;
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
  const locallyAnalyzedSourceSemanticCompilation = sourceLexicalNamespace && stableStatementIdByIndex
    ? analyzeModuleSemantics({
        statements: parsed.statements,
        stableStatementIdByIndex,
        sourceNamespace: sourceLexicalNamespace,
        spans,
        logicalTextByStatementIndex,
        documentScalarBindings
      })
    : undefined;
  const sourceSemanticCompilation = moduleRuntimeContext?.analysisFor(moduleRuntimeContext.rootDocumentId) ?? locallyAnalyzedSourceSemanticCompilation;
  // The source semantic projection is also useful for Definition Query in a
  // document without Modules. Geometry values also need this path so their
  // source-only aliases can be lowered at existing geometry consumers.
  const moduleSemanticCompilation = hasModuleStatements || hasGeometryValueStatements || hasRecordValueControlFlowStatements || hasGenericCollectionIndexStatements || hasGeometryCollectionIndexStatements || hasCollectionControlFlowStatements || hasNominalRecordCollectionValueFor ? sourceSemanticCompilation : undefined;
  let moduleGeometryPropertyResolver: ((input: {
    statementIndex: number;
    node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>;
  }) => ScalarExpressionResolvedGeometryProperty | null) | undefined;
  if (moduleSemanticCompilation && sourceLexicalNamespace && stableStatementIdByIndex) {
    const exportBindingSeeds = moduleScalarExportBindingSeeds(
      moduleSemanticCompilation,
      sourceLexicalNamespace,
      moduleRuntimeContext
    );
    // Runtime-owned Module export bindings are not document scalar
    // declarations. Do not add them to the fallback document catalog once
    // Module semantics already has an error, because the runtime path is
    // intentionally skipped in that case and binding-version construction
    // must not see an eligible seed without a scalar program initializer.
    const usableExportBindingSeeds = moduleSemanticCompilation.diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? []
      : exportBindingSeeds;
    const hasRootGeometryRuntimeOccurrences = [...moduleSemanticCompilation.rootScalarExpressionsByStatementId.values()]
      .some((site) => site.expression.geometryBuiltinArguments.length > 0 || site.expression.geometryProperties.some((property) =>
        property.target?.kind === "sourceGeometryProperty" || property.target?.kind === "deferredModuleExportProperty"
      ));
    const hasRootCollectionLengthOccurrences = [...moduleSemanticCompilation.rootScalarExpressionsByStatementId.values()]
      .some((site) => site.expression.geometryProperties.some((property) =>
        property.target?.kind === "collectionValueLength" ||
        property.target?.kind === "collectionParameterLength" ||
        property.target?.kind === "deferredModuleCollectionExportLength"
      ));
    const hasRootCollectionIndexOccurrences = [...moduleSemanticCompilation.rootScalarExpressionsByStatementId.values()]
      .some((site) => site.expression.ast.kind === "collectionIndex" || site.expression.references.some((reference) => reference.collectionValueId !== undefined));
    if (
      usableExportBindingSeeds.length > 0 ||
      hasRootGeometryRuntimeOccurrences ||
      hasRootCollectionLengthOccurrences ||
      hasRootCollectionIndexOccurrences ||
      moduleSemanticCompilation.rootRecordValuesByStatementId.size > 0 ||
      hasCollectionControlFlowStatements
    ) {
      const seedById = new Map(usableExportBindingSeeds.map((seed) => [seed.id, seed] as const));
      const qualifiedModuleExportFor = (statementIndex: number, path: ReturnType<typeof parseDslReferenceToken>) => {
        if (path.segments.length !== 2) return null;
        const instanceLookup = resolveSourceLexicalDeclaration(sourceLexicalNamespace, statementIndex, path.segments[0]!);
        if (instanceLookup.kind !== "resolved" || instanceLookup.declaration.kind !== "moduleInstance") return null;
        const instance = moduleSemanticCompilation.instancesByStatementId.get(instanceLookup.declaration.statementId);
        const definition = instance?.callee
          ? moduleRuntimeContext?.definitionFor(instance.callee.definitionIdentity)
            ?? moduleSemanticCompilation.definitionsByStatementId.get(instance.callee.definitionStatementId)
          : undefined;
        const exported = definition?.exports.find((entry) => entry.name === path.segments[1]) ?? null;
        return instance && definition ? { instance, definition, exported } : null;
      };
      const additionalBindingResolver: SourceNamespaceBindingResolver = (name, statementIndex) => {
        const valueForBinder = rootValueForBodyBindingResolver(
          name,
          statementIndex,
          sourceLexicalNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceLexicalNamespace.scopeIndex.rootScopeId
        );
        if (valueForBinder) return valueForBinder;
        const parsedSource = parseDslSourceReference(`@${name}`);
        const path = parsedSource.kind === "valid" ? parsedSource.reference.path : parseDslReferenceToken(name);
        const property = parsedSource.kind === "valid" ? parsedSource.reference.property : null;
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
        const resolved = qualifiedModuleExportFor(statementIndex, path);
        if (property !== null) {
          const exportedRecord = resolved?.exported;
          const field = exportedRecord?.kind === "record"
            ? exportedRecord.definition.fields.find((candidate) => candidate.name === property)
            : undefined;
          if (!resolved || resolved.exported?.kind !== "record" || !field) {
            return {
              kind: "blocked",
              reason: "incompatible",
              declarationKind: "moduleInstance",
              statementId: instanceLookup.declaration.statementId
            };
          }
          const bindingId = moduleRecordExportFieldBindingIdFor({
            moduleSemanticAnalysis: moduleSemanticCompilation,
            sourceNamespace: sourceLexicalNamespace,
            instanceStatementId: resolved.instance.statementId,
            instanceIdentity: resolved.instance.identity,
            exportName: path.segments[1],
            exportedStatementId: resolved.exported.exportedStatementId,
            field: field.identity,
            moduleRuntimeContext
          });
          return bindingId && seedById.has(bindingId) ? { kind: "resolved", bindingId } : {
            kind: "blocked",
            reason: "incompatible",
            declarationKind: "moduleInstance",
            statementId: resolved.instance.statementId
          };
        }
        const exported = resolved?.exported;
        if (!resolved || !exported || exported.kind !== "scalar") {
          const definingStatements = resolved
            ? moduleRuntimeContext?.documentFor(
                resolved.definition.documentId ?? resolved.instance.callee?.definitionIdentity?.documentId
              )?.statements ?? parsed.statements
            : [];
          const privateMember = !resolved?.definition.exports.some((entry) => entry.name === path.segments[1]) && (
            resolved?.definition.localScalars.some((local) => local.name === path.segments[1]) ||
            (resolved
              ? definingStatements.some((candidate) =>
                  candidate.name === path.segments[1] && candidate.enclosing?.statementIndex === resolved.definition.statementIndex
                )
              : false)
          );
          return {
            kind: "blocked",
            reason: privateMember ? "private" : "incompatible",
            declarationKind: "moduleInstance",
            statementId: instanceLookup.declaration.statementId
          };
        }
        const instancePath = moduleRuntimeContext
          ? moduleRuntimeContext.runtimePathForInstance([], resolved.instance)
          : [resolved.instance.statementId];
        const bindingId = moduleScalarBindingIdFor(
          instancePath,
          resolved.definition.statementId,
          exported.exportedStatementId
        );
        return seedById.has(bindingId) ? { kind: "resolved", bindingId } : {
          kind: "blocked",
          reason: "incompatible",
          declarationKind: "moduleInstance",
          statementId: resolved.instance.statementId
        };
      };
      moduleGeometryPropertyResolver = ({ statementIndex, node }: {
        statementIndex: number;
        node: Extract<import("../scalars/expressionAst").ScalarExpressionAst, { kind: "geometryProperty" }>;
      }) => {
        const statementId = stableStatementIdByIndex.get(statementIndex);
        const site = statementId
          ? moduleSemanticCompilation.rootScalarExpressionsByStatementId.get(statementId)
          : undefined;
        const candidates = site?.expression.geometryProperties.filter((candidate) => candidate.property === node.property) ?? [];
        const property = candidates.find((candidate) => candidate.span.start === node.span.start) ?? (candidates.length === 1 ? candidates[0] : undefined);
        const target = property?.target;
        if (!property?.type || !target) return null;
        if (target.kind === "collectionValueLength" || target.kind === "collectionParameterLength" || target.kind === "deferredModuleCollectionExportLength") {
          return {
            kind: "collection" as const,
            collectionValueId: target.kind === "collectionValueLength"
              ? target.valueId
              : target.kind === "collectionParameterLength"
                ? `${target.definitionStatementId}:parameter:${target.parameterIndex}`
                : JSON.stringify([target.instanceStatementId, target.exportName]),
            collectionLength: target.kind === "collectionValueLength" ? target.length ?? 0 : 0,
            targetSourceOrder: target.kind === "collectionValueLength"
              ? target.statementIndex
              : target.kind === "deferredModuleCollectionExportLength"
                ? target.instanceStatementIndex
                : -1,
            type: { kind: "number" as const }
          };
        }
        if (target.kind === "sourceGeometryProperty") {
          const elementId = compiled.elementIdsByStatementIndex?.get(target.statementIndex);
          if (!elementId) return null;
          const elementsById = new Map(compiled.elements.map((element) => [element.id, element] as const));
          const alias = geometryAliasForSourceElement(
            elementId,
            target.category === "point" ? "point" : "line",
            target.pointKey
          );
          const lowered = alias ? propertyForAlias(alias, target.property, elementsById) : undefined;
          if (!lowered || lowered.kind !== "runtime") return null;
          return {
            elementId: lowered.elementId,
            property: lowered.property,
            targetSourceOrder: target.statementIndex,
            type: property.type
          };
        }
        if (target.kind === "geometryValueProperty") {
          return {
            kind: "geometryValue",
            occurrence: {
              sourceStatementId: target.statementId,
              instancePath: []
            },
            property: target.property,
            ...(target.pointKey ? { pointKey: target.pointKey } : {}),
            targetSourceOrder: target.statementIndex,
            type: property.type
          };
        }
        if (target.kind === "forGroupOccurrenceProperty") {
          return {
            kind: "forGroupOccurrence",
            templateElementId: target.statementId,
            property: target.property,
            targetSourceOrder: target.statementIndex,
            index: null,
            ...(target.pointKey ? { pointKey: target.pointKey } : {}),
            type: property.type
          };
        }
        if (target.kind !== "deferredModuleExportProperty") return null;
        return {
          elementId: target.instanceStatementId,
          property: target.property,
          targetSourceOrder: target.instanceStatementIndex,
          type: property.type
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
        additionalBindings: [...rootValueForBodyBindingSeeds, ...usableExportBindingSeeds],
        additionalBindingResolver,
        additionalInitializers: rootValueForBodyInitializers,
        nonProgramBindingIds: new Set(rootValueForBodyBindingSeeds.map((seed) => seed.id)),
        additionalCollectionIndexResolver: rootCollectionIndexResolver,
        additionalRecordValueResolver: (value) => {
          const reference = value.reference;
          if (!reference || value.typeIdentity === null) return null;
          const path = parseDslReferenceToken(reference.name);
          const resolved = qualifiedModuleExportFor(value.statementIndex, path);
          if (!resolved || resolved.exported?.kind !== "record" || resolved.exported.typeIdentity !== value.typeIdentity) return null;
          const fieldBindingIdsByFieldIndex = new Map<number, BindingId>();
          for (const field of resolved.exported.definition.fields) {
            const bindingId = moduleRecordExportFieldBindingIdFor({
              moduleSemanticAnalysis: moduleSemanticCompilation,
              sourceNamespace: sourceLexicalNamespace,
              instanceStatementId: resolved.instance.statementId,
              instanceIdentity: resolved.instance.identity,
              exportName: resolved.exported.name,
              exportedStatementId: resolved.exported.exportedStatementId,
              field: field.identity,
              moduleRuntimeContext
            });
            if (!bindingId || !seedById.has(bindingId)) return null;
            fieldBindingIdsByFieldIndex.set(field.fieldIndex, bindingId);
          }
          return {
            typeIdentity: resolved.exported.typeIdentity,
            fieldBindingIdsByFieldIndex
          };
        },
        additionalRecordPropertyResolver: ({ statementIndex, node }) => {
          const statementId = stableStatementIdByIndex.get(statementIndex);
          const site = statementId
            ? moduleSemanticCompilation.rootScalarExpressionsByStatementId.get(statementId)
            : undefined;
          const recordValue = statementId
            ? moduleSemanticCompilation.rootRecordValuesByStatementId.get(statementId)
            : undefined;
          const recordCandidates = recordValue?.fieldExpressions.flatMap((field) =>
            field.expression?.geometryProperties.filter((candidate) => candidate.property === node.property) ?? []
          ) ?? [];
          const candidates = [
            ...(site?.expression.geometryProperties.filter((candidate) => candidate.property === node.property) ?? []),
            ...recordCandidates
          ];
          const property = candidates.find((candidate) => candidate.span.start === node.span.start) ?? (candidates.length === 1 ? candidates[0] : undefined);
          if (property?.target?.kind !== "recordField" || !property.type) return null;
          const recordFieldBindingIdForTarget = (target: ModuleScalarSourceTarget): BindingId | null => {
            if (target.kind !== "recordField") return null;
            if (target.record.kind === "recordValue") {
              return recordScalarBindingIdFor(target.record.statementId, target.field);
            }
            if (target.record.kind === "recordCollectionIndex") {
              const index = target.record.index.ast.kind === "numberLiteral" ? target.record.index.ast.value : null;
              const member = index !== null && Number.isInteger(index) && index >= 0
                ? target.record.members?.[index]
                : undefined;
              return member ? recordFieldBindingIdForTarget({ ...target, record: member }) : null;
            }
            if (target.record.kind === "deferredModuleRecordExport") {
              return moduleRecordExportFieldBindingIdFor({
                moduleSemanticAnalysis: moduleSemanticCompilation,
                sourceNamespace: sourceLexicalNamespace,
                instanceStatementId: target.record.instanceStatementId,
                instanceIdentity: target.record.instanceIdentity,
                exportName: target.record.exportName,
                exportedStatementId: target.record.exportedStatementId,
                field: target.field,
                moduleRuntimeContext
              }) ?? null;
            }
            return null;
          };
          const directBindingId = recordFieldBindingIdForTarget(property.target);
          const lookup = directBindingId
            ? { kind: "resolved" as const, bindingId: directBindingId }
            : additionalBindingResolver(`${node.elementName}.${node.property}`, statementIndex, sourceLexicalNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceLexicalNamespace.scopeIndex.rootScopeId);
          return {
            resolution: {
              kind: "resolvedType" as const,
              bindingId: lookup?.kind === "resolved" ? lookup.bindingId : null,
              type: lookup?.kind === "resolved" ? property.type : null
            },
            ...(lookup?.kind === "resolved"
              ? { dependency: { bindingId: lookup.bindingId, name: `${node.elementName}.${node.property}`, span: node.span } }
              : {})
          };
        },
        additionalGeometryPropertyResolver: moduleGeometryPropertyResolver,
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
          const unwrapped = unwrapModuleGeometrySourceTarget(target);
          const pointKey = unwrapped.pointKey;
          if (unwrapped.target.kind === "parameter") {
            return {
              statementId: unwrapped.target.definitionStatementId,
              statementIndex: -1,
              geometryType: expectedGeometryType,
              ...(pointKey ? { pointKey } : {})
            };
          }
          if (unwrapped.target.kind === "sourceGeometry") {
            return {
              statementId: unwrapped.target.statementId,
              statementIndex: unwrapped.target.statementIndex,
              geometryType: expectedGeometryType,
              ...(pointKey ? { pointKey } : {})
            };
          }
          if (unwrapped.target.kind === "geometryValue") {
            return {
              kind: "geometryValue",
              occurrence: { sourceStatementId: unwrapped.target.statementId, instancePath: [] },
              statementId: unwrapped.target.statementId,
              statementIndex: unwrapped.target.statementIndex,
              geometryType: expectedGeometryType,
              ...(pointKey ? { pointKey } : {})
            };
          }
          if (unwrapped.target.kind === "forGroupOccurrence") {
            return {
              kind: "forGroupOccurrence",
              templateElementId: unwrapped.target.statementId,
              statementId: unwrapped.target.statementId,
              statementIndex: unwrapped.target.statementIndex,
              targetSourceOrder: unwrapped.target.statementIndex,
              index: null,
              geometryType: expectedGeometryType,
              ...(pointKey ? { pointKey } : {})
            };
          }
          if (unwrapped.target.kind === "geometryValueForBinder") return undefined;
          if (unwrapped.target.kind === "collectionIndex") return undefined;
          return {
            statementId: unwrapped.target.instanceStatementId,
            statementIndex: unwrapped.target.instanceStatementIndex,
            geometryType: expectedGeometryType,
            ...(pointKey ? { pointKey } : {})
          };
        }
      });
      documentScalarAnalysis = scalarAnalysisCompilation.analysis;
      applyRootValueForBodies(documentScalarAnalysis?.bindingAnalysis, documentScalarAnalysis?.typedInitializerByBindingId);
      documentScalarProgram = documentScalarAnalysis
        ? lowerScalarProgram({ ...documentScalarAnalysis, collectionValues: rootScalarCollectionValues(documentScalarAnalysis.bindingAnalysis, moduleSemanticCompilation) })
        : undefined;
    }
  }
  if (
    moduleSemanticCompilation &&
    !moduleSemanticCompilation.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
    stableStatementIdByIndex &&
    sourceLexicalNamespace
  ) {
    compiled = compileDslToElements(normalized, {
      elements: [],
      mode: "document",
      preparsed: parsed,
      assignedElementIds: options.assignedStatementIds ?? options.assignedElementIds ?? compiled.elementIdsByStatementIndex,
      stableStatementIdByIndex,
      sourceLexicalResolution: {
        sourceNamespace: sourceLexicalNamespace,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map(),
        ...(moduleSemanticCompilation
          ? {
              geometryValueByStatementIndex: new Map(
                moduleSemanticCompilation.geometryValues.flatMap((value): Array<[
                  number,
                  {
                    kind: "value" | "drawable";
                    occurrence?: { sourceStatementId: string; instancePath: readonly string[] };
                    declaredInterfaceType: "point" | "line" | "path";
                    elementId?: string;
                  }
                ]> => {
                  let backing = value.backingTarget;
                  while (backing?.kind === "geometryValue" && backing.backingTarget) backing = backing.backingTarget;
                  if (backing?.kind === "sourceGeometry") {
                    const elementId = compiled.elementIdsByStatementIndex?.get(backing.statementIndex);
                    return elementId
                      ? [[
                          value.statementIndex,
                          {
                            kind: "drawable" as const,
                            declaredInterfaceType: value.declaredInterfaceType,
                            elementId
                          }
                        ] as const]
                      : [];
                  }
                  const sourceStatementId = backing?.kind === "geometryValue" ? backing.statementId : value.statementId;
                  return [[
                    value.statementIndex,
                    {
                      kind: "value" as const,
                      occurrence: { sourceStatementId, instancePath: [] },
                      declaredInterfaceType: value.declaredInterfaceType
                    }
                  ] as const];
                })
              )
            }
          : {})
      },
      moduleSemanticAnalysis: moduleSemanticCompilation,
      moduleRuntimeContext,
      majorVersion: versionValidation.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION
    });
  }
  if (moduleSemanticCompilation && !compiled.geometryValueProgram && stableStatementIdByIndex) {
    const rootGeometryValueProgram = buildRootGeometryValueProgram({
      values: moduleSemanticCompilation.geometryValues,
      elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map()
    });
    if (rootGeometryValueProgram.length > 0) compiled = { ...compiled, geometryValueProgram: rootGeometryValueProgram };
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
      sourceNamespace: sourceLexicalNamespace,
      moduleGeometryRuntime: compiled.moduleGeometryRuntime,
      moduleRuntimeContext,
      drawingModifiers: compiled.modifiers
    });
    const hasModuleScalarBindings = moduleScalarCompilation.bindingAnalysis.catalog.bindings.some((binding) =>
      binding.resolutionMode === "preResolvedOnly"
    );
    const hasModuleTypedNumericBindings = moduleScalarCompilation.materializedNumericBindings.some(
      (entry) => entry.binding.typedExpression !== undefined
    );
    const hasModuleTypedConditionalGroupConditions = moduleScalarCompilation.materializedConditionalGroupConditions.length > 0;
    if (documentScalarAnalysis || hasModuleScalarBindings || hasModuleTypedNumericBindings || hasModuleTypedConditionalGroupConditions) {
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
      ...(compiled.moduleGeometryRuntime
        ? {
            moduleGeometryRuntime: {
              ...compiled.moduleGeometryRuntime,
              geometryInputTargetsByRuntimeElementId: moduleScalarCompilation.geometryInputTargetsByRuntimeElementId,
              geometryCollectionNodesByValueId: moduleScalarCompilation.geometryCollectionNodesByValueId
            }
          }
        : {}),
      moduleMaterialization: {
        ...compiled.moduleMaterialization,
        scalarExecutionPositionByRuntimeElementId: moduleScalarCompilation.scalarExecutionPositionByRuntimeElementId
      }
    };
  }
  const allDiagnostics = [
    ...versionValidation.diagnostics,
    ...sourceOutputPlacementDiagnostics,
    ...compiled.diagnostics.map((diagnostic) =>
      (diagnostic.code === "undefined-geometry-reference" || diagnostic.code === "unused-drawing-modifier")
        ? projectCompilerDiagnostic(diagnostic)
        : diagnostic
    ),
    ...(sourceLexicalNamespace?.diagnostics ?? []),
    ...scalarAnalysisCompilation.diagnostics,
    ...(moduleSemanticCompilation?.diagnostics ?? [])
  ].map(withDiagnosticPresentation);
  // Task 48: see CompiledDslDocument.bindingIssueDiagnostics for why this is
  // never concatenated into allDiagnostics/finalDiagnostics below.
  const bindingIssueDiagnostics = scalarAnalysis
    ? bindingIssuesToDiagnostics(scalarAnalysis.bindingAnalysis, parsed.statements, spans)
    : [];

  // Task 22: property binding compile/typecheck. Only meaningful once typed
  // declarations exist to reference (nui1 + at least one binding) - a
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
        layouts: compiled.layouts,
        layoutIdsByStatementIndex: compiled.layoutIdsByStatementIndex,
        ...(moduleGeometryPropertyResolver ? { additionalGeometryPropertyResolver: moduleGeometryPropertyResolver } : {})
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
  // NOT gate on `scalarAnalysis` - a nui1 document with zero typed
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
  const bindingVersions = scalarAnalysis && stableStatementIdByIndex && scalarProgram && bindingControlMetadata &&
    !allDiagnostics.some((diagnostic) => diagnostic.code === "record-constructor-missing-field")
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
  ].map(withDiagnosticPresentation);
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
      sourceElementsByStatementIndex: sourceElementsFor(compiled),
      ...(scalarProgram ? { scalarProgram } : {}),
      ...(scalarAnalysis ? { bindingAnalysis: scalarAnalysis.bindingAnalysis } : {}),
      ...(documentScalarAnalysis ? { scalarProgramPositionMap: documentScalarAnalysis.positionMap } : {}),
      ...(numericBindingCompilation
        ? {
            numericBindings: numericBindingCompilation.sourcesByOccurrenceKey,
            numericConsumerReferencesByBindingId: numericBindingCompilation.consumerReferencesByBindingId
          }
        : {}),
      ...(setStatementCompilation ? { setStatements: setStatementCompilation.setsByStatementIndex } : {}),
      ...(bindingVersions ? { bindingVersions } : {}),
      ...(typedDependencyGraph ? { typedDependencyGraph } : {}),
      ...(sourceLexicalNamespace ? { sourceLexicalNamespace } : {}),
      ...(sourceSemanticCompilation && !moduleSemanticCompilation ? { sourceSemanticAnalysis: sourceSemanticCompilation } : {}),
      ...(moduleSemanticCompilation ? { moduleSemanticAnalysis: moduleSemanticCompilation } : {}),
      ...(compiled.moduleMaterialization ? { moduleMaterialization: compiled.moduleMaterialization } : {}),
      ...(compiled.moduleGeometryRuntime ? { moduleGeometryRuntime: compiled.moduleGeometryRuntime } : {}),
      ...(compiled.geometryValueProgram ? { geometryValueProgram: compiled.geometryValueProgram } : {}),
      ...(moduleScalarCompilation?.geometryValueProgram ? { geometryValueProgram: moduleScalarCompilation.geometryValueProgram } : {}),
      ...(moduleScalarCompilation?.scalarExecutionPositionByRuntimeElementId
        ? { scalarExecutionPositionByRuntimeElementId: moduleScalarCompilation.scalarExecutionPositionByRuntimeElementId }
        : {}),
      ...(moduleScalarCompilation?.materializedPropertyBindings.length
        ? { materializedPropertyBindings: moduleScalarCompilation.materializedPropertyBindings }
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
  const layouts = compiled.layouts ?? [];
  const printOutputs = compiled.printOutputs ?? [];
  const svgOutputs = compiled.svgOutputs ?? [];

  const document: DslDocumentData = {
    elements: compiled.elements,
    modifiers: compiled.modifiers ?? [],
    ...(compiled.drawingProfiles?.length ? { drawingProfiles: compiled.drawingProfiles } : {}),
    visibilityRoles: compiled.visibilityRoles ?? [],
    visibilityProfiles,
    activeVisibilityProfileId:
      compiled.activeVisibilityProfileId ?? visibilityProfiles[0]?.id ?? DEFAULT_VISIBILITY_PROFILE_ID,
    layouts,
    printOutputs,
    svgOutputs,
    evaluationLimitIndex: compiled.evaluationLimitIndex
  };

  const statementMap = buildStatementMap(
    parsed.statements,
    sourceLines.length,
    compiled.elementIdsByStatementIndex ?? new Map(),
    compiled.layoutIdsByStatementIndex,
    compiled.outputIdsByStatementIndex,
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
    sourceElementsByStatementIndex: sourceElementsFor(compiled),
    ...(scalarProgram ? { scalarProgram } : {}),
    ...(scalarAnalysis ? { bindingAnalysis: scalarAnalysis.bindingAnalysis } : {}),
    ...(documentScalarAnalysis ? { scalarProgramPositionMap: documentScalarAnalysis.positionMap } : {}),
    ...(propertyBindingCompilation
      ? {
          propertyBindings: propertyBindingCompilation.sourcesByOccurrenceKey,
          occurrenceKeysByBindingId: propertyBindingCompilation.occurrenceKeysByBindingId
        }
      : {}),
    ...(numericBindingCompilation
      ? {
          numericBindings: numericBindingCompilation.sourcesByOccurrenceKey,
          numericConsumerReferencesByBindingId: numericBindingCompilation.consumerReferencesByBindingId
        }
      : {}),
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
    ...(moduleRuntimeContext ? { moduleRuntimeContext } : {}),
    ...(compiled.moduleMaterialization ? { moduleMaterialization: compiled.moduleMaterialization } : {}),
      ...(compiled.moduleGeometryRuntime ? { moduleGeometryRuntime: compiled.moduleGeometryRuntime } : {}),
      ...(compiled.geometryValueProgram ? { geometryValueProgram: compiled.geometryValueProgram } : {}),
      ...(moduleScalarCompilation?.geometryValueProgram ? { geometryValueProgram: moduleScalarCompilation.geometryValueProgram } : {}),
    ...(moduleScalarCompilation?.scalarExecutionPositionByRuntimeElementId
      ? { scalarExecutionPositionByRuntimeElementId: moduleScalarCompilation.scalarExecutionPositionByRuntimeElementId }
      : {}),
    ...(moduleScalarCompilation?.materializedPropertyBindings.length
      ? { materializedPropertyBindings: moduleScalarCompilation.materializedPropertyBindings }
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
