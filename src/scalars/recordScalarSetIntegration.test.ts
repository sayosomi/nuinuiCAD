import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";

describe("SAY-128 record scalar set integration", () => {
  it("resolves a record scalar field in set RHS to its hidden scalar backing binding", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
    const result = compileCanonicalText(baseline, [
      "nui 1",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      "let x: number = 0",
      "set x = @config.amount"
    ].join("\n"));

    expect(result.status).not.toBe("fatal");
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const compiled = result.doc;
    const amount = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "config.amount")!;
    const setStatementIndex = compiled.statements.findIndex((statement) => statement.kind === "set");
    const set = compiled.setStatements?.get(setStatementIndex);

    expect(set).toBeDefined();
    expect(set?.expression).toMatchObject({
      kind: "reference",
      name: "config.amount",
      bindingId: amount.id,
      type: { kind: "number" }
    });
  });
});
