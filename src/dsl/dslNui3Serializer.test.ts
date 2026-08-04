import { describe, expect, it } from "vitest";
import { applyLineSplices } from "../document/textPatch";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "./dslDocumentTestUtils";
import { documentDslRefs, serializedStatementLines } from "./dslSerializer";
import { serializeElementStatementBlock } from "./dslSerializeElement";
import { DSL_INDENT } from "./dslTokens";
import {
  buildNui3StatementPatch,
  serializeNui3Document,
  type Nui3CanonicalSource
} from "./dslNui3Serializer";

const currentFor = (sourceText: string) => {
  const base = regenerateCanonicalFromModel(emptyDocument(), 3);
  const current = compileCanonicalText(base, sourceText);
  if (current.status === "fatal") throw new Error(current.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return current;
};

const statementIdFor = (current: ReturnType<typeof currentFor>, kind: string) => {
  const info = current.doc.statementMap.statements.find((candidate) => candidate.kind === kind);
  if (!info) throw new Error(`missing ${kind}`);
  const id = current.doc.statementMap.statementIdByStatementIndex?.get(info.statementIndex);
  if (!id) throw new Error(`missing identity for ${kind}`);
  return id;
};

describe("nui 3 serializer facade", () => {
  it("uses the Task 10/29 raw-source serializers without formatting expressions", () => {
    const source = [
      "nui 3",
      "const   note : string = 'brace: \\{'",
      "let   enabled: boolean = true",
      "set   enabled = false",
      'text label = label(text: "literal \\{ and {@note}")',
      "group G (printEnabled: @enabled) {",
      "}",
      "point A = coordinate(x: 0, y: 0, state: hidden)"
    ].join("\n");
    const current = currentFor(source);

    const result = serializeNui3Document(current);

    expect(result.status).toBe("serialized");
    if (result.status !== "serialized") return;
    expect(result.sourceText).toContain("const note: string = 'brace: \\{'");
    expect(result.sourceText).toContain("let enabled: boolean = true");
    expect(result.sourceText).toContain("set enabled = false");
    // Text templates are source-owned compiled metadata. The facade must not
    // turn their resolved holes back into a literal/runtime value.
    expect(result.sourceText).toContain('text: "literal \\{ and {@note}"');
    expect(result.sourceText).toContain("printEnabled: @enabled");
    const reparsed = compileCanonicalText(current, result.sourceText);
    expect(reparsed.status).not.toBe("fatal");
    expect(reparsed.doc.scalarProgram?.statements.map((entry) => entry.declaration.declaredType.kind)).toEqual(["string", "boolean"]);
    expect(reparsed.doc.setStatements).toHaveLength(1);
    expect(reparsed.doc.propertyBindings).toHaveLength(1);
    expect(reparsed.doc.document.elements.find((element) => element.name === "A")).toMatchObject({ activity: "hidden" });
  });

  it("patches a complete multiline statement range and leaves all other bytes untouched", () => {
    const source = [
      "nui 3",
      "# before target",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  state: hidden",
      ")",
      "",
      "# after target",
      "const flag: boolean = true"
    ].join("\n");
    const current = currentFor(source);

    const patch = buildNui3StatementPatch(current, statementIdFor(current, "element"));

    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(patch.splices).toHaveLength(1);
    expect(patch.splices[0]).toMatchObject({ startLine: 3, endLine: 7 });
    const patched = applyLineSplices(current.sourceText, patch.splices);
    expect(patched.slice(patched.indexOf("# before target"))).toContain([
      "# before target",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  state: hidden",
      ")",
      "",
      "# after target",
      "const flag: boolean = true"
    ].join("\n"));
  });

  it("keeps a nested element at its parser-owned block depth and matches the Task 07 output", () => {
    const source = [
      "nui 3",
      "group Outer {",
      "  # unchanged before target",
      "  point A = coordinate(",
      "    x: 0,",
      "    y: 0,",
      "    state: hidden",
      "  )",
      "",
      "  # unchanged after target",
      "}",
      "let scope: number = 0"
    ].join("\n");
    const current = currentFor(source);
    const info = current.doc.statementMap.statements.find((candidate) => candidate.kind === "element");
    const element = current.doc.document.elements.find((candidate) => candidate.name === "A");
    if (!info || !element) throw new Error("missing nested point");

    const patch = buildNui3StatementPatch(current, statementIdFor(current, "element"));

    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    const expected = serializedStatementLines(
      serializeElementStatementBlock(element, documentDslRefs(current.doc.document.elements, 3)),
      DSL_INDENT.repeat(info.indentDepth)
    );
    expect(patch.splices[0]).toMatchObject({ startLine: 4, endLine: 8, replacementLines: expected });
    expect(applyLineSplices(current.sourceText, patch.splices)).toBe([
      "nui 3",
      "group Outer {",
      "  # unchanged before target",
      ...expected,
      "",
      "  # unchanged after target",
      "}",
      "let scope: number = 0"
    ].join("\n"));
  });

  it("keeps nested typed declarations and set statements at their statement depth", () => {
    const source = [
      "nui 3",
      "group Outer {",
      "  let   flag : boolean = true",
      "  set   flag = false",
      "}"
    ].join("\n");
    const current = currentFor(source);

    const declarationPatch = buildNui3StatementPatch(current, statementIdFor(current, "typedDeclaration"));
    const setPatch = buildNui3StatementPatch(current, statementIdFor(current, "set"));

    expect(declarationPatch).toMatchObject({
      status: "ready",
      splices: [{ startLine: 3, endLine: 3, replacementLines: ["  let flag: boolean = true"] }]
    });
    expect(setPatch).toMatchObject({
      status: "ready",
      splices: [{ startLine: 4, endLine: 4, replacementLines: ["  set flag = false"] }]
    });
  });

  it("serializes nested containers and their descendants with every parser-owned depth", () => {
    const source = [
      "nui 3",
      "group Outer {",
      "  group Inner {",
      "    point A = coordinate(x: 0, y: 0, state: hidden)",
      "  }",
      "}"
    ].join("\n");
    const current = currentFor(source);

    const result = serializeNui3Document(current);

    expect(result.status).toBe("serialized");
    if (result.status !== "serialized") return;
    expect(result.sourceText).toBe([
      "nui 3",
      "group Outer {",
      "  group Inner {",
      "    point A = coordinate(",
      "      x: 0,",
      "      y: 0,",
      "      state: hidden",
      "    )",
      "  }",
      "}"
    ].join("\n"));
  });

  it("keeps a target statement's trailing comment while canonicalizing its owner serializer output", () => {
    const current = currentFor(["nui 3", "const   flag : boolean = true # keep"].join("\n"));
    const patch = buildNui3StatementPatch(current, statementIdFor(current, "typedDeclaration"));

    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(applyLineSplices(current.sourceText, patch.splices)).toBe(["nui 3", "const flag: boolean = true # keep"].join("\n"));
  });

  it.each([
    ["inserted line before target", (source: string) => source.replace("nui 3\n", "nui 3\n# inserted\n")],
    ["removed line before target", (source: string) => source.replace("# before target\n", "")]
  ])("does not use a stale row after %s", (_label, mutate) => {
    const source = ["nui 3", "# before target", "const flag: boolean = true"].join("\n");
    const current = currentFor(source);
    const stale = { ...current, sourceText: mutate(current.sourceText) };

    const result = buildNui3StatementPatch(stale, statementIdFor(current, "typedDeclaration"));

    expect(result).toMatchObject({ status: "noop" });
    expect(stale.sourceText).not.toBe(current.docText);
  });

  it("fails closed for a dirty current source, missing identity, mismatched range, and last-good text", () => {
    const source = ["nui 3", "const flag: boolean = true"].join("\n");
    const current = currentFor(source);
    const statementId = statementIdFor(current, "typedDeclaration");
    const dirty = { ...current, sourceText: `${current.sourceText}\n# uncommitted valid source` };
    expect(buildNui3StatementPatch(dirty, statementId)).toMatchObject({ status: "noop" });
    expect(buildNui3StatementPatch(current, "missing-statement-id")).toMatchObject({ status: "noop" });

    const info = current.doc.statementMap.statements.find((candidate) => candidate.kind === "typedDeclaration");
    if (!info) throw new Error("missing declaration");
    const rangeMismatch: Nui3CanonicalSource = {
      ...current,
      doc: {
        ...current.doc,
        statementMap: {
          ...current.doc.statementMap,
          statements: current.doc.statementMap.statements.map((candidate) =>
            candidate === info ? { ...candidate, endLine: candidate.endLine + 1 } : candidate
          )
        }
      }
    };
    expect(buildNui3StatementPatch(rangeMismatch, statementId)).toMatchObject({ status: "noop" });

    const lastGood = { ...current, sourceText: "nui 3\nconst flag: boolean =" };
    expect(buildNui3StatementPatch(lastGood, statementId)).toMatchObject({ status: "noop" });
  });

  it("rejects every non-nui-3 serializer entry without a fallback rewrite", () => {
    // compileCanonicalText now rejects any non-nui-3 source outright, so a
    // majorVersion !== 3 `current` can no longer arise from real input; this
    // exercises the defensive guard directly against a still-valid nui 3
    // `current` with only its reported majorVersion overridden.
    const nui3Current = currentFor("nui 3\npoint A = coordinate(x: 0, y: 0)");
    const current = { ...nui3Current, doc: { ...nui3Current.doc, majorVersion: 2 as unknown as 3 } };
    expect(serializeNui3Document(current)).toMatchObject({ status: "noop" });
    expect(buildNui3StatementPatch(current, "anything")).toMatchObject({ status: "noop" });
  });
});
