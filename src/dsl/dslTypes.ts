import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  ElementId,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import type { DocumentRange, DslPhysicalSpan, LogicalStatement, LogicalStatementSourceMap, SourceRevision } from "./logicalStatementSourceMap";
import type { DslMajorVersion } from "./dslVersion";
import type { ScalarType } from "../scalars/types";
import type { BindingId } from "../scalars/bindingCatalog";
import type { DslNumericTypeOptions } from "./dslNumericTypeOptions";

/** Where a diagnostic's own consumer/declaration span lives, shared verbatim
 * by the Source Editor gutter, the Problems popover, and Inspector jump
 * calls so navigation identity never diverges between surfaces. Deliberately
 * plain data - no CodeMirror type may appear here (see AGENTS.md's
 * src/editor/ boundary). */
export type DslDiagnosticNavigationTarget =
  | { kind: "property"; occurrenceKey: string }
  | { kind: "templateHole"; occurrenceKey: string; holeIndex: number }
  | { kind: "binding"; bindingId: BindingId }
  | { kind: "element"; elementId: ElementId }
  /** Task 48 correction: for a diagnostic whose own exact span is a
   * reference occurrence (e.g. undefined-binding/forward-binding-reference/
   * self-initialization's `@name` token), not any binding's own declaration
   * - there is no dedicated ID-based index for an arbitrary reference inside
   * an initializer, so this carries the diagnostic's own already-resolved,
   * revision-stamped physicalSpan directly. Selecting it re-validates the
   * revision/bounds at click time (SourceEditorHandle.selectSourceSpan) and
   * no-ops rather than falling back to any other position. */
  | { kind: "sourceSpan"; physicalSpan: DslPhysicalSpan };

export type DslDiagnostic = {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
  sourceRevision?: SourceRevision;
  physicalSpan?: DslPhysicalSpan;
  /** Stable machine-readable identifier (e.g. Quick Fix routing). Optional; most diagnostics don't set one yet. */
  code?: string;
  /** Task 15's declared/typechecked type context for a scalar-type-mismatch-style diagnostic. */
  expectedType?: ScalarType;
  actualType?: ScalarType;
  bindingId?: BindingId;
  elementId?: ElementId;
  propertyKey?: string;
  /** "runtime" for a diagnostic derived from a TS/Rust ScalarEvaluation error; absent (compile-time) otherwise. */
  origin?: "runtime";
  /**
   * When true, this diagnostic's positioning is exact-or-nothing: `physicalSpan`
   * is set only when the logical->physical projection actually succeeded, and
   * callers (gutter linter, Quick Fix, Problems navigation) must never fall
   * back to a coarser line/column or whole-statement position for it. Legacy
   * diagnostics that never set this flag keep their existing line/column
   * fallback behavior unchanged.
   */
  exactSpanOnly?: true;
  navigationTarget?: DslDiagnosticNavigationTarget;
};

export type DslSpan = {
  start: number;
  end: number;
};

export type DslAttribute = {
  key: string;
  value: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
  physicalSpan?: DslPhysicalSpan;
  /** Set only when `value` is empty - see `ScannedArg.rawValueSpan` (dslArgScanner.ts). */
  rawValueSpan?: DslSpan;
};

export type DslEnclosing = {
  statementIndex: number;
  branch: "then" | "else";
};

export type DslModuleParameterType =
  | ScalarType
  | { kind: "point" }
  | { kind: "line" };

export type DslModuleParameter = {
  kind: "moduleParameter";
  name: string;
  nameSpan: DslSpan | null;
  type: DslModuleParameterType | null;
  typeSpan: DslSpan | null;
  choiceOptionSpans: readonly DslSpan[];
  numericTypeOptions?: DslNumericTypeOptions;
  /** Raw source after `=`. It is null when no default was written. */
  defaultValue: string | null;
  /** Empty when `=` was present without a default value. */
  defaultSpan: DslSpan | null;
  namePhysicalSpan?: DslPhysicalSpan | null;
  typePhysicalSpan?: DslPhysicalSpan | null;
  defaultPhysicalSpan?: DslPhysicalSpan | null;
};

export type DslModuleArgument = {
  kind: "moduleArgument";
  label: string | null;
  labelSpan: DslSpan | null;
  value: string;
  valueSpan: DslSpan;
  rawValueSpan?: DslSpan;
  labelPhysicalSpan?: DslPhysicalSpan | null;
  valuePhysicalSpan?: DslPhysicalSpan | null;
};

export type DslModuleInstanceOption = {
  kind: "moduleInstanceOption";
  name: string;
  nameSpan: DslSpan | null;
  value: string;
  valueSpan: DslSpan;
  rawValueSpan?: DslSpan;
  namePhysicalSpan?: DslPhysicalSpan | null;
  valuePhysicalSpan?: DslPhysicalSpan | null;
};

export type DslStatementBase = {
  line: number;
  /** Final physical source line belonging to this logical statement. */
  endLine: number;
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  opensBlock: boolean;
  payloadSpans: Record<string, DslSpan>;
  enclosing: DslEnclosing | null;
  attrs: DslAttribute[];
  /** Snapshot identity is mandatory for any projection back to an editor. */
  sourceRevision: SourceRevision;
  documentRange: DocumentRange;
  physicalSpan: DslPhysicalSpan;
  namePhysicalSpan?: DslPhysicalSpan | null;
  keywordPhysicalSpan?: DslPhysicalSpan | null;
  payloadPhysicalSpans?: Record<string, DslPhysicalSpan | null>;
  /** Structural lines are deliberately separate from the header source. */
  openBraceLine?: number;
};

// v2: 旧要素 kind(freePoint/offsetPoint/polarOffsetPoint/line/angleLengthLine/
// arcLine/text の7種)はすべて category/construction を持つ "element" へ統合。
export type DslStatement =
  | (DslStatementBase & { kind: "role" })
  | (DslStatementBase & { kind: "view" })
  | (DslStatementBase & { kind: "activeView" })
  | (DslStatementBase & { kind: "printLayout" })
  | (DslStatementBase & {
      kind: "moduleDefinition";
      parameters: readonly DslModuleParameter[];
    })
  | (DslStatementBase & {
      kind: "moduleInstance";
      moduleName: string;
      moduleNameSpan: DslSpan | null;
      moduleNamePhysicalSpan?: DslPhysicalSpan | null;
      options: readonly DslModuleInstanceOption[];
      arguments: readonly DslModuleArgument[];
    })
  | (DslStatementBase & { kind: "group" })
  | (DslStatementBase & {
      kind: "element";
      type: CadElementType | null;
      category: string;
      construction: string;
      exported: boolean;
      exportSpan?: DslSpan | null;
      exportPhysicalSpan?: DslPhysicalSpan | null;
    })
  | (DslStatementBase & { kind: "version"; value: string })
  | (DslStatementBase & { kind: "color"; hex: string; isDefault: boolean })
  | (DslStatementBase & { kind: "atStop" })
  | (DslStatementBase & { kind: "activePrintLayout" })
  | (DslStatementBase & { kind: "place"; group: string })
  | (DslStatementBase & {
      kind: "typedDeclaration";
      bindingKind: "const" | "let";
      /** `null` when the type annotation itself failed to parse. */
      declaredType: ScalarType | null;
      /** Per-option spans, index-aligned with `declaredType.options` when it is a choice type. */
      choiceOptionSpans: readonly DslSpan[];
      /** Optional source-owned step/bounds metadata for a `number(...)` type annotation. */
      numericTypeOptions?: DslNumericTypeOptions;
      /** Raw, unparsed initializer source text - never evaluated or re-quoted (Task 14 owns that). */
      initializer: string;
    })
  | (DslStatementBase & {
      kind: "set";
      /** Raw, unparsed RHS source text - never evaluated or re-quoted here
       * (Task 14/15 own that), mirroring typedDeclaration.initializer. Target
       * name/span reuse the base `name`/`nameSpan` fields, same convention
       * typedDeclaration uses for its own declared name. */
      expression: string;
    })
  | (DslStatementBase & { kind: "blockEnd" })
  | (DslStatementBase & { kind: "blockElse" });

export type ParseDslResult = {
  statements: DslStatement[];
  diagnostics: DslDiagnostic[];
  sourceRevision: SourceRevision;
  sourceMap: LogicalStatementSourceMap;
  /** statement.documentRange.from -> the LogicalStatement it was decorated
   * from. Built once per parse (see dslParser.ts's parseDslSnapshot); the
   * only lookup any later exact-span diagnostic projection needs, so no
   * caller ever re-scans sourceMap.statements per issue. */
  logicalStatementByRangeFrom: ReadonlyMap<number, LogicalStatement>;
};

export type CompileDslContext = {
  elements: CadElement[];
  /** 省略時は `NEW_DOCUMENT_DSL_MAJOR_VERSION`(v2)として扱う。version非依存の
   * 既存呼び出し元(numeric expression/creation recipeテスト等)を壊さないための
   * 既定であり、実文書のcompileは常に実際のmajorVersionを明示で渡す。 */
  majorVersion?: DslMajorVersion;
  visibilityRoles?: VisibilityRole[];
  visibilityProfiles?: VisibilityProfile[];
  activeVisibilityProfileId?: string;
  printLayouts?: PrintLayout[];
  palette?: DocumentPalette;
  activePrintLayoutId?: string;
  insertionIndex?: number;
  mode?: "edit" | "document";
  selectedElementIds?: ElementId[];
  /** `source` を事前パースした結果。指定時はコンパイラ内部の parseDsl を省略する(同一ソース前提)。 */
  preparsed?: ParseDslResult;
  /**
   * 文index(全文配列基準)→ 割当済み実行時要素ID。statementReconciler の照合結果を
   * 再コンパイルへ引き渡すための注入口。`id=` 属性 > 本マップ > 新規生成 の優先順。
   */
  assignedElementIds?: ReadonlyMap<number, ElementId>;
};

export type CompileDslResult = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  visibilityRoles?: VisibilityRole[];
  visibilityProfiles?: VisibilityProfile[];
  activeVisibilityProfileId?: string;
  printLayouts?: PrintLayout[];
  palette?: DocumentPalette;
  activePrintLayoutId?: string;
  evaluationLimitIndex?: number;
  diagnostics: DslDiagnostic[];
  changedCount: number;
  /** 文index(全文配列基準)→ コンパイルされた要素のID。パースエラーの早期returnでは付与されない。 */
  elementIdsByStatementIndex?: Map<number, ElementId>;
  /** printLayout文のindex(全文配列基準)→ 解決後の PrintLayout.id。 */
  printLayoutIdsByStatementIndex?: Map<number, string>;
};

export type SerializeDslOptions = {
  visibilityRoles?: VisibilityRole[];
  visibilityProfiles?: VisibilityProfile[];
  activeVisibilityProfileId?: string;
  printLayouts?: PrintLayout[];
};

export type DslTokenKind =
  | "attributeKey"
  | "comment"
  | "elementType"
  | "keyword"
  | "number"
  | "operator"
  | "plain"
  | "reference"
  | "string";

export type DslHighlightToken = {
  kind: DslTokenKind;
  text: string;
};

export type DslHighlightLine = {
  lineNumber: number;
  tokens: DslHighlightToken[];
};
