import { describe, expect, it } from "vitest";
import { createLanguageAnalysisSession } from "../../vscode-extension/src/languageAnalysisSession";
import {
  queryDslSignatureHelp,
  type DslSignatureHelpQueryResult
} from "./dslSignatureHelpQuery";

const snapshotFor = (source: string, sourceRevision = 1) => ({ normalizedSource: source, sourceRevision });

const queryAt = (source: string, position = source.length): DslSignatureHelpQueryResult | null =>
  queryDslSignatureHelp({ source: snapshotFor(source), position });

describe("DSL Signature Help query", () => {
  it("keeps builtin overloads in canonical definition order", () => {
    const result = queryAt("nui 4\nconst value: number = round(");

    expect(result?.signatures.map((signature) => signature.identity)).toEqual([
      "builtin:round:0",
      "builtin:round:1"
    ]);
    expect(result?.signatures.map((signature) => signature.returnType)).toEqual(["number", "number"]);
    expect(result?.activeSignature).toBe(0);
  });

  it("selects a uniquely active positional builtin overload and parameter", () => {
    const result = queryAt("nui 4\nconst value: number = round(1, ");

    expect(result?.activeSignature).toBe(1);
    expect(result?.activeParameter).toBe(1);
  });

  it("keeps named-only builtin parameter activation exact", () => {
    const known = queryAt("nui 4\nconst value: number = spreadAngle(spread: ");
    const comma = queryAt("nui 4\nconst value: number = spreadAngle(length: 100, ");
    const typo = queryAt("nui 4\nconst value: number = spreadAngle(sid: ");

    expect(known?.activeParameter).toBe(1);
    expect(comma?.activeParameter).toBeUndefined();
    expect(typo?.activeParameter).toBeUndefined();
  });

  it("projects construction and mutation arguments through the completion-owned projection", () => {
    const construction = queryAt("nui 4\npoint P = coordinate(y: ");
    const mutation = queryAt("nui 4\nmove(targets: @P, ");

    expect(construction?.signatures[0]?.parameters.map((parameter) => parameter.name)).toEqual([
      "x", "y", "state", "color", "steps"
    ]);
    expect(construction?.activeParameter).toBe(1);
    expect(construction?.signatures[0]?.parameters.some((parameter) => ["id", "roles", "parent", "branch"].includes(parameter.name))).toBe(false);
    expect(mutation?.signatures[0]?.parameters.map((parameter) => parameter.name)).toEqual([
      "targets", "from", "to", "scale", "angleDeg", "mirrorX", "state", "steps"
    ]);
    expect(mutation?.signatures[0]?.parameters[0]).toMatchObject({
      type: undefined,
      documentation: { key: "signatureHelp.parameter.lineReferenceList" }
    });
  });

  it("projects canonical construction defaults and boolean choices", () => {
    const result = queryAt("nui 4\nline L = offset(sources: ");
    const parameters = result?.signatures[0]?.parameters ?? [];
    const closed = parameters.find((parameter) => parameter.name === "closed");

    expect(closed).toMatchObject({
      type: "boolean",
      defaultValue: "false",
      allowedValues: ["true", "false"],
      documentation: { key: "signatureHelp.construction.line.offset.closed" }
    });
  });

  it("does not guess unknown construction names, comma gaps, or out-of-range arguments", () => {
    const typo = queryAt("nui 4\npoint P = coordinate(sid: ");
    const comma = queryAt("nui 4\npoint P = coordinate(x: 0, ");
    const outOfRange = queryAt("nui 4\nconst value: number = round(1, 2, ");

    expect(typo?.activeParameter).toBeUndefined();
    expect(comma?.activeParameter).toBeUndefined();
    expect(outOfRange?.activeSignature).toBe(0);
    expect(outOfRange?.activeParameter).toBeUndefined();
  });

  it("chooses the innermost nested callable and supports incomplete calls", () => {
    const nested = queryAt("nui 4\nconst value: number = round(abs(");
    const incomplete = queryAt("nui 4\nconst value: number = abs(");

    expect(nested?.signatures[0]?.name).toBe("abs");
    expect(incomplete?.signatures[0]?.name).toBe("abs");
  });

  it("keeps the enclosing construction active inside a text template hole", () => {
    const source = "nui 4\ntext Label = label(text: \"width=${@width}\", anchor: (0, 0))";
    const position = source.indexOf("${@width}") + 2;
    const result = queryAt(source, position);

    expect(result?.signatures[0]?.name).toBe("label");
    expect(result?.activeParameter).toBe(0);
  });

  it("reuses tolerant blank-line call contexts", () => {
    const source = "nui 4\npoint P = coordinate(\n\n)";
    const position = source.indexOf("\n\n") + 1;
    const result = queryAt(source, position);

    expect(result?.signatures[0]?.name).toBe("coordinate");
    expect(result?.activeParameter).toBeUndefined();
  });

  it("uses exact current Module semantics for names, defaults, optionality, and choices", () => {
    const source = [
      "nui 4",
      "module M(value: number, side?: choice(left, right), count: number = 2) {",
      "}",
      "instance Use = M(value: 1, ",
      ")"
    ].join("\n");
    const position = source.indexOf("instance Use") + "instance Use = M(value: 1, ".length;
    const session = createLanguageAnalysisSession(source);
    const sourceSnapshot = snapshotFor(source, session.getSourceRevision());
    const result = queryDslSignatureHelp({
      source: sourceSnapshot,
      position,
      semantic: session.signatureHelpSemanticSnapshot(sourceSnapshot)
    });

    expect(result?.signatures[0]?.parameters).toEqual([
      expect.objectContaining({ name: "value", type: "number", optional: false }),
      expect.objectContaining({ name: "side", type: "choice(left, right)", optional: true, allowedValues: ["left", "right"] }),
      expect.objectContaining({ name: "count", type: "number", defaultValue: "2" })
    ]);
    expect(result?.activeParameter).toBeUndefined();
  });

  it("does not use stale Module semantics", () => {
    const source = "nui 4\nmodule M(value: number) {\n}\ninstance Use = M(value: 1)";
    const session = createLanguageAnalysisSession(source);
    const oldSnapshot = snapshotFor(source, session.getSourceRevision());
    session.replaceSource("nui 4\nmodule Other(value: number) {\n}\ninstance Use = Other(value: 1)");

    expect(session.signatureHelpSemanticSnapshot(oldSnapshot)).toBeUndefined();
    expect(queryDslSignatureHelp({ source: oldSnapshot, position: source.length })).toBeNull();
  });
});
