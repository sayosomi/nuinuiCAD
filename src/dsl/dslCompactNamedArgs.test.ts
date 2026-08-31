import { describe, expect, it } from "vitest";
import { queryDslCompletion } from "./dslCompletionQuery";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { dslLineLabeledValueSpans } from "./dslValueSpans";

const errors = (source: string) =>
  parseDsl(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("compact named arguments", () => {
  it("compiles compact nui1 element arguments without whitespace diagnostics", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x:10,y:-20,state:hidden)"
    ].join("\n");
    const compiled = compileDslDocument(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements[0]).toMatchObject({
      type: "freePoint",
      x: 10,
      y: -20,
      activity: "hidden"
    });
  });

  it("keeps missing compact values invalid", () => {
    const compact = errors("nui 1\npoint A = coordinate(x:10,y:)");
    const spaced = errors("nui 1\npoint A = coordinate(x:10,y:   )");

    expect(compact).toContainEqual(expect.objectContaining({ code: "missing-attribute-value" }));
    expect(spaced).toContainEqual(expect.objectContaining({ code: "missing-attribute-value" }));
  });

  it("parses compact module parameters, instance options, and instance arguments", () => {
    const source = [
      "nui 1",
      "module M(value?:number, flag:boolean = false) {",
      "}",
      "instance X(state:hidden) = M(value:1,flag:true)"
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[1]).toMatchObject({
      kind: "moduleDefinition",
      parameters: [
        { name: "value", optional: true, type: { kind: "number" } },
        { name: "flag", optional: false, type: { kind: "boolean" }, defaultValue: "false" }
      ]
    });
    expect(parsed.statements[3]).toMatchObject({
      kind: "moduleInstance",
      options: [{ name: "state", value: "hidden" }],
      arguments: [
        { label: "value", value: "1" },
        { label: "flag", value: "true" }
      ]
    });
  });

  it("keeps editor value spans exact for compact named values", () => {
    const source = "point A = coordinate(x:0,y:10,state:hidden)";
    const spans = dslLineLabeledValueSpans(source);
    const state = spans.find((span) => span.key === "state");
    const valueStart = source.indexOf("hidden");

    expect(state).toMatchObject({
      source: "attr",
      key: "state",
      start: valueStart,
      end: valueStart + "hidden".length
    });
    expect(source.slice(state!.start, state!.end)).toBe("hidden");
  });

  it("replaces only the compact value token during completion", () => {
    const source = "nui 1\nline L = offset(sources:[A],distance:1,side:le)";
    const position = source.indexOf("side:le") + "side:le".length;
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision: 1 },
      position
    });

    expect(result?.category).toBe("parameter");
    expect(result?.candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining(["left", "right"])
    );
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("le");
  });
});
