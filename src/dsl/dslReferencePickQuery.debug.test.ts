import { describe, it } from "vitest";
import { dslCallAuthoringContextAt } from "./dslCallAuthoringContext";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslReferencePickTarget } from "./dslReferencePickQuery";

const inspect = (source: string, marker: string) => {
  const sourceRevision = 17;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `debug:${index}`]))
  });
  const position = source.indexOf(marker) + marker.length;
  const call = dslCallAuthoringContextAt({ normalizedSource: source, sourceRevision }, position);
  const query = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision },
    position,
    semantic: { sourceRevision, compiled }
  });
  console.log(JSON.stringify({
    marker,
    position,
    parsedDiagnostics: parsed.diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, statementIndex: diagnostic.statementIndex })),
    parsedStatements: parsed.statements.map((statement, index) => ({
      index,
      kind: statement.kind,
      name: statement.name,
      type: statement.kind === "element" ? statement.type : undefined,
      construction: statement.kind === "element" ? statement.construction : undefined,
      range: statement.documentRange
    })),
    compiledDiagnostics: compiled.diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, statementIndex: diagnostic.statementIndex })),
    statementMap: Boolean(compiled.statementMap),
    namespaceDeclarations: compiled.sourceLexicalNamespace?.allDeclarations.map((declaration) => ({
      statementIndex: declaration.statementIndex,
      statementId: declaration.statementId,
      scopeId: declaration.scopeId,
      kind: declaration.kind,
      name: declaration.name
    })),
    scopeOfStatement: compiled.sourceLexicalNamespace
      ? [...compiled.sourceLexicalNamespace.scopeIndex.scopeOfStatement.entries()]
      : null,
    call: call ? {
      kind: call.kind,
      callee: call.callee,
      argument: call.argument,
      logicalCursorPosition: call.logicalCursorPosition,
      logicalText: call.logicalText,
      sourceOrderAnchor: call.sourceOrderAnchor
    } : null,
    query
  }));
};

describe("SAY-106 debug", () => {
  it("prints empty construction contexts", () => {
    inspect([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: , dx: 0, dy: 0)"
    ].join("\n"), "from: ");

    inspect([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: @A, dx: , dy: 0)"
    ].join("\n"), "dx: ");
  });
});
