import { beforeEach, describe, expect, it } from "vitest";
import { buildNui3StatementPatch } from "../dsl/dslNui3Serializer";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

describe("nui 3 serializer patches through the canonical store boundary", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("uses commitLineSplices' model-patch and one document Undo step", () => {
    const source = ["nui 3", "const   flag : boolean = true", "# unchanged"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const before = useCadDocumentStore.getState();
    const statement = before.doc.statementMap.statements.find((info) => info.kind === "typedDeclaration");
    if (!statement) throw new Error("missing declaration");
    const statementId = before.doc.statementMap.statementIdByStatementIndex?.get(statement.statementIndex);
    if (!statementId) throw new Error("missing declaration identity");

    const patch = buildNui3StatementPatch(before, statementId);
    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(useCadDocumentStore.getState().commitLineSplices(patch.splices)).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceText).toBe(["nui 3", "const flag: boolean = true", "# unchanged"].join("\n"));
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("model-patch");
    expect(useCadDocumentStore.getState().past).toHaveLength(2);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(["nui 3", "const flag: boolean = true", "# unchanged"].join("\n"));
  });

  it("preserves nested declaration indentation, comments, and blank lines through Undo/Redo", () => {
    const source = [
      "nui 3",
      "group Outer {",
      "  # stays before",
      "  const   flag : boolean = true",
      "",
      "  # stays after",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const before = useCadDocumentStore.getState();
    const statement = before.doc.statementMap.statements.find((info) => info.kind === "typedDeclaration");
    if (!statement) throw new Error("missing nested declaration");
    const statementId = before.doc.statementMap.statementIdByStatementIndex?.get(statement.statementIndex);
    if (!statementId) throw new Error("missing nested declaration identity");

    const patch = buildNui3StatementPatch(before, statementId);
    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(useCadDocumentStore.getState().commitLineSplices(patch.splices)).toEqual({ status: "applied" });
    const expected = [
      "nui 3",
      "group Outer {",
      "  # stays before",
      "  const flag: boolean = true",
      "",
      "  # stays after",
      "}"
    ].join("\n");
    expect(useCadDocumentStore.getState().sourceText).toBe(expected);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(expected);
  });
});
