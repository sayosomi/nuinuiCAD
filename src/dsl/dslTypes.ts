import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  ElementId,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import type { DocumentRange, DslPhysicalSpan, LogicalStatementSourceMap, SourceRevision } from "./logicalStatementSourceMap";

export type DslDiagnostic = {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
  sourceRevision?: SourceRevision;
  physicalSpan?: DslPhysicalSpan;
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
};

export type DslEnclosing = {
  statementIndex: number;
  branch: "then" | "else";
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
  | (DslStatementBase & { kind: "variable"; expression: string })
  | (DslStatementBase & { kind: "group" })
  | (DslStatementBase & { kind: "element"; type: CadElementType | null; category: string; construction: string })
  | (DslStatementBase & { kind: "version"; value: string })
  | (DslStatementBase & { kind: "color"; hex: string; isDefault: boolean })
  | (DslStatementBase & { kind: "atStop" })
  | (DslStatementBase & { kind: "activePrintLayout" })
  | (DslStatementBase & { kind: "place"; group: string })
  | (DslStatementBase & { kind: "layoutVar"; expression: string })
  | (DslStatementBase & { kind: "blockEnd" })
  | (DslStatementBase & { kind: "blockElse" });

export type ParseDslResult = {
  statements: DslStatement[];
  diagnostics: DslDiagnostic[];
  sourceRevision: SourceRevision;
  sourceMap: LogicalStatementSourceMap;
};

export type CompileDslContext = {
  elements: CadElement[];
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
