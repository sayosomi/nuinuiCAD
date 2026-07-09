import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  ElementId,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";

export type DslDiagnostic = {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
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
};

export type DslEnclosing = {
  statementIndex: number;
  branch: "then" | "else";
};

export type DslStatementBase = {
  line: number;
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  opensBlock: boolean;
  payloadSpans: Record<string, DslSpan>;
  enclosing: DslEnclosing | null;
  attrs: DslAttribute[];
};

export type DslStatement =
  | (DslStatementBase & { kind: "role" })
  | (DslStatementBase & { kind: "view" })
  | (DslStatementBase & { kind: "activeView" })
  | (DslStatementBase & { kind: "printLayout" })
  | (DslStatementBase & { kind: "variable"; expression: string })
  | (DslStatementBase & { kind: "freePoint"; x: string; y: string })
  | (DslStatementBase & { kind: "offsetPoint"; from: string })
  | (DslStatementBase & { kind: "polarOffsetPoint"; from: string })
  | (DslStatementBase & { kind: "line"; start: string; end: string })
  | (DslStatementBase & { kind: "angleLengthLine"; start: string })
  | (DslStatementBase & { kind: "arcLine"; center: string })
  | (DslStatementBase & { kind: "text"; text: string })
  | (DslStatementBase & { kind: "group" })
  | (DslStatementBase & { kind: "element"; type: CadElementType | null })
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
};

export type SerializeDslOptions = {
  includeIds?: boolean;
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
