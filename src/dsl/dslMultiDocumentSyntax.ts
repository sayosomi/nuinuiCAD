import { parseDslSourceReference, readDslReferencePathSegments } from "./dslReferenceTokens";
import { isBareDslIdentifierChar, splitDslTerms, unquoteDslString } from "./dslTokens";
import type { DslAttribute, DslSpan } from "./dslTypes";

export type DslMultiDocumentSyntaxDiagnostic = {
  message: string;
  span: DslSpan;
  code: string;
};

type ParsedStatementBase = {
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  opensBlock: false;
  payloadSpans: Record<string, DslSpan>;
  attrs: DslAttribute[];
};

export type DslImportParsedStatement = ParsedStatementBase & {
  kind: "import";
  importPath: string;
  importPathSpan: DslSpan;
  alias: string;
  aliasSpan: DslSpan;
};

export type DslFileReExportParsedStatement = ParsedStatementBase & {
  kind: "fileReExport";
  targetReference: string;
  targetSpan: DslSpan;
  importAlias: string;
  importAliasSpan: DslSpan;
  exportedName: string;
  exportedNameSpan: DslSpan;
};

export type DslImportParseResult = {
  statement: DslImportParsedStatement | null;
  diagnostics: DslMultiDocumentSyntaxDiagnostic[];
};

export type DslFileReExportParseResult = {
  statement: DslFileReExportParsedStatement | null;
  diagnostics: DslMultiDocumentSyntaxDiagnostic[];
};

const spanAtEnd = (source: string): DslSpan => ({ start: source.length, end: source.length });

const quotedValue = (raw: string): string | null => {
  if (raw.length < 2) return null;
  const quote = raw[0];
  if ((quote !== "\"" && quote !== "'") || raw.at(-1) !== quote) return null;
  return unquoteDslString(raw);
};

const validAliasToken = (raw: string) => {
  const quoted = quotedValue(raw);
  if (quoted !== null) return quoted.length > 0 ? quoted : null;
  return raw.length > 0 && [...raw].every(isBareDslIdentifierChar) ? raw : null;
};

/**
 * Parses the v1 source-only import declaration. Resolution/loading deliberately
 * stays outside this parser: SAY-112 only establishes syntax and exact spans.
 */
export const parseDslImportStatement = (logicalText: string): DslImportParseResult => {
  const terms = splitDslTerms(logicalText);
  const diagnostics: DslMultiDocumentSyntaxDiagnostic[] = [];
  const keyword = terms[0];
  if (!keyword || keyword.text !== "import") {
    return {
      statement: null,
      diagnostics: [{
        code: "invalid-import-syntax",
        message: "import 文は `import \"./file.nui\" as alias` の形式で指定してください。",
        span: keyword ? { start: keyword.start, end: keyword.end } : spanAtEnd(logicalText)
      }]
    };
  }

  const pathTerm = terms[1];
  if (!pathTerm) {
    return {
      statement: null,
      diagnostics: [{
        code: "invalid-import-path",
        message: "import には引用符で囲んだ相対 `.nui` path が必要です。",
        span: spanAtEnd(logicalText)
      }]
    };
  }

  const importPath = quotedValue(pathTerm.text);
  if (importPath === null) {
    diagnostics.push({
      code: "invalid-import-path",
      message: "import path は引用符で囲んで指定してください。",
      span: { start: pathTerm.start, end: pathTerm.end }
    });
  } else if (!(importPath.startsWith("./") || importPath.startsWith("../")) || !importPath.endsWith(".nui")) {
    diagnostics.push({
      code: "invalid-import-path",
      message: "import path は `./` または `../` で始まり `.nui` で終わる相対 path にしてください。",
      span: { start: pathTerm.start, end: pathTerm.end }
    });
  }

  const asTerm = terms[2];
  const aliasTerm = terms[3];
  if (!asTerm || asTerm.text !== "as" || !aliasTerm) {
    const span = asTerm && asTerm.text !== "as"
      ? { start: asTerm.start, end: asTerm.end }
      : spanAtEnd(logicalText);
    return {
      statement: null,
      diagnostics: [
        ...diagnostics,
        {
          code: "missing-import-alias",
          message: "import には `as alias` が必要です。filename から alias は推測しません。",
          span
        }
      ]
    };
  }

  const alias = validAliasToken(aliasTerm.text);
  if (alias === null) {
    diagnostics.push({
      code: "invalid-import-alias",
      message: "import alias が不正です。通常の nui4 name を指定してください。",
      span: { start: aliasTerm.start, end: aliasTerm.end }
    });
  }
  if (terms.length > 4) {
    diagnostics.push({
      code: "invalid-import-syntax",
      message: "import alias の後に余分な token があります。",
      span: { start: terms[4]!.start, end: terms.at(-1)!.end }
    });
  }

  if (importPath === null || alias === null) return { statement: null, diagnostics };
  const importPathSpan = { start: pathTerm.start, end: pathTerm.end };
  const aliasSpan = { start: aliasTerm.start, end: aliasTerm.end };
  return {
    statement: {
      kind: "import",
      name: alias,
      nameSpan: aliasSpan,
      keywordSpan: { start: keyword.start, end: keyword.end },
      opensBlock: false,
      payloadSpans: { path: importPathSpan, alias: aliasSpan },
      attrs: [],
      importPath,
      importPathSpan,
      alias,
      aliasSpan
    },
    diagnostics
  };
};

/**
 * Parses the v1 generic file re-export spelling `export @alias::Name`.
 * Whether alias resolves to an import and Name is public is graph-semantic work
 * owned by later SAY-79 children; this function only proves the source shape.
 */
export const parseDslFileReExportStatement = (logicalText: string): DslFileReExportParseResult => {
  const terms = splitDslTerms(logicalText);
  const diagnostics: DslMultiDocumentSyntaxDiagnostic[] = [];
  const keyword = terms[0];
  const targetTerm = terms[1];
  if (!keyword || keyword.text !== "export" || !targetTerm) {
    return {
      statement: null,
      diagnostics: [{
        code: "invalid-file-reexport",
        message: "re-export は `export @alias::Name` の形式で指定してください。",
        span: targetTerm ? { start: targetTerm.start, end: targetTerm.end } : spanAtEnd(logicalText)
      }]
    };
  }
  if (terms.length > 2) {
    diagnostics.push({
      code: "invalid-file-reexport",
      message: "re-export target の後に余分な token があります。",
      span: { start: terms[2]!.start, end: terms.at(-1)!.end }
    });
  }

  const parsed = parseDslSourceReference(targetTerm.text);
  if (
    parsed.kind !== "valid" ||
    parsed.reference.property !== null ||
    parsed.reference.path.absolute ||
    parsed.reference.path.segments.length !== 2
  ) {
    diagnostics.push({
      code: "invalid-file-reexport",
      message: "re-export target は property を持たない `@alias::Name` 参照にしてください。",
      span: { start: targetTerm.start, end: targetTerm.end }
    });
    return { statement: null, diagnostics };
  }

  const pathSegments = readDslReferencePathSegments(
    targetTerm.text,
    parsed.reference.pathRange.start,
    parsed.reference.pathRange.end
  );
  if (pathSegments.kind !== "valid" || pathSegments.segments.length !== 2) {
    diagnostics.push({
      code: "invalid-file-reexport",
      message: "re-export target の qualified name が不正です。",
      span: { start: targetTerm.start, end: targetTerm.end }
    });
    return { statement: null, diagnostics };
  }

  const [aliasSegment, nameSegment] = pathSegments.segments;
  const importAliasSpan = {
    start: targetTerm.start + aliasSegment.start,
    end: targetTerm.start + aliasSegment.end
  };
  const exportedNameSpan = {
    start: targetTerm.start + nameSegment.start,
    end: targetTerm.start + nameSegment.end
  };
  const targetSpan = { start: targetTerm.start, end: targetTerm.end };
  return {
    statement: {
      kind: "fileReExport",
      name: nameSegment.name,
      nameSpan: exportedNameSpan,
      keywordSpan: { start: keyword.start, end: keyword.end },
      opensBlock: false,
      payloadSpans: {
        target: targetSpan,
        importAlias: importAliasSpan,
        exportedName: exportedNameSpan
      },
      attrs: [],
      targetReference: parsed.reference.source,
      targetSpan,
      importAlias: aliasSegment.name,
      importAliasSpan,
      exportedName: nameSegment.name,
      exportedNameSpan
    },
    diagnostics
  };
};
