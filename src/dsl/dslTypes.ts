import type { CadElement, CadElementType, ElementId } from "../types/geometry";

export type DslDiagnostic = {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
};

export type DslAttribute = {
  key: string;
  value: string;
};

export type DslStatement =
  | {
      kind: "variable";
      line: number;
      name: string;
      expression: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "freePoint";
      line: number;
      name: string;
      x: string;
      y: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "offsetPoint";
      line: number;
      name: string;
      from: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "polarOffsetPoint";
      line: number;
      name: string;
      from: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "line";
      line: number;
      name: string;
      start: string;
      end: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "angleLengthLine";
      line: number;
      name: string;
      start: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "arcLine";
      line: number;
      name: string;
      center: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "text";
      line: number;
      name: string;
      text: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "group";
      line: number;
      name: string;
      attrs: DslAttribute[];
    }
  | {
      kind: "element";
      line: number;
      name: string;
      type: CadElementType | null;
      attrs: DslAttribute[];
    };

export type ParseDslResult = {
  statements: DslStatement[];
  diagnostics: DslDiagnostic[];
};

export type CompileDslContext = {
  elements: CadElement[];
  insertionIndex?: number;
  mode?: "edit" | "document";
  selectedElementIds?: ElementId[];
};

export type CompileDslResult = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  diagnostics: DslDiagnostic[];
  changedCount: number;
};

export type SerializeDslOptions = {
  includeIds?: boolean;
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
