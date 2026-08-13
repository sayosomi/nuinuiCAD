import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { applyLineSplices } from "./textPatch";
import { buildTypedRenameSplices } from "./typedRenameSplice";
import { analyzeTypedBindingRenameInDocument } from "./typedRenameAnalysis";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:binding-module:${index}`]))
  });
};

describe("typed BindingId rename occurrences inside Module semantics", () => {
  it("patches module defaults and explicit scalar arguments through the existing atomic splice path", () => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "module M(width: number = @outer) {",
      "}",
      "instance I = M(width: @outer)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "outer")!;
    const analysis = analyzeTypedBindingRenameInDocument({ compiled, targetBindingId: target.id, newName: "outside" });
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences.map((occurrence) => occurrence.oldName)).toEqual(["outer", "outer"]);
    const splice = buildTypedRenameSplices(source, compiled, [
      { statementIndex: target.statementIndex, span: analysis.declarationSpan!, oldName: target.name, newName: analysis.newName },
      ...analysis.occurrences
    ]);
    expect(splice.ok).toBe(true);
    if (splice.ok) expect(applyLineSplices(source, splice.splices)).toContain("@outside");
  });
});
