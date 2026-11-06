import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, createLogicalStatementSourceMap } from "@nuinuicad/nui-language";

describe("#1535 current-source diagnostics and recovery", () => {
  it("maps an unresolved reference on a comment-separated RHS to its physical span", () => {
    const source = "nui 1\nconst result: number = // header\n// retained\n  8 + /* retained */ @missing\nconst intact: number = 20";
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1535 });
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: new Map(parsed.statements.map((_, i) => [i, `1535:${i}`])) });
    expect(parsed.diagnostics).toEqual([]);
    const diagnostic = [...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])].find(d => d.code === "undefined-binding")!;
    expect(diagnostic).toBeDefined();
    expect(diagnostic.physicalSpan).toEqual({ segments: [{ from: source.indexOf("@missing"), to: source.indexOf("@missing") + 8 }], sourceRevision: 1535 });
    expect(compiled.statements.at(-1)).toMatchObject({ kind: "typedDeclaration", name: "intact", line: 5, endLine: 5 });
  });
  it("leaves forward documentation comments outside an incomplete bare RHS", () => {
    const source = "const bad: number = 1 +\n/// @en\n/// Module docs\nmodule M() {\n}\n";
    const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 1535 });
    expect(map.statements[0].range.endLine).toBe(1);
    expect(map.lexicalLines[1].comments[0].text).toBe("/// @en");
    expect(map.statements.find(s => s.logicalText.startsWith("module"))?.range.startLine).toBe(4);
  });
});
