import { describe, expect, it } from "vitest";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { AutomationDocument } from "./automationDocument";

const pointSource = (name = "A", x = 0) => dslTextForElements([
  { id: "point", name, type: "freePoint", activity: "visible", x, y: 0 }
]);

const fatalSource = "nui 4\npoint Broken = coordinate(";

describe("AutomationDocument", () => {
  it("initializes a valid fresh document from source", () => {
    const source = pointSource();
    const document = AutomationDocument.fromSource(source);
    const state = document.getState();

    expect(document.getSource()).toBe(source);
    expect(state).toMatchObject({
      sourceText: source,
      docText: source,
      status: "valid",
      revision: 0,
      compiledRevision: 0
    });
  });

  it("keeps an empty last-good document for fatal fresh source", () => {
    const document = AutomationDocument.fromSource(fatalSource);
    const state = document.getState();

    expect(state.sourceText).toBe(fatalSource);
    expect(state.status).toBe("fatal");
    expect(state.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(state.doc.document.elements).toEqual([]);
    expect(state.docText).not.toBe(fatalSource);
    expect(state.revision).toBe(0);
    expect(state.compiledRevision).toBe(0);
  });

  it("keeps last-good identity across fatal edits and advances it on recovery", () => {
    const valid = pointSource();
    const recovered = pointSource("Recovered", 4);
    const document = AutomationDocument.fromSource(valid);
    const initialState = document.getState();

    document.replaceSource(fatalSource);
    const firstFatal = document.getState();
    document.replaceSource(`${fatalSource}\n# still broken`);
    const secondFatal = document.getState();

    expect(firstFatal.revision).toBe(1);
    expect(firstFatal.compiledRevision).toBe(0);
    expect(firstFatal.doc).toBe(initialState.doc);
    expect(secondFatal.revision).toBe(2);
    expect(secondFatal.compiledRevision).toBe(0);
    expect(secondFatal.doc).toBe(firstFatal.doc);

    document.replaceSource(recovered);
    const recoveredState = document.getState();
    expect(recoveredState.revision).toBe(3);
    expect(recoveredState.compiledRevision).toBe(1);
    expect(recoveredState.doc).not.toBe(secondFatal.doc);
    expect(recoveredState.docText).toBe(recovered);
  });

  it("does not compile or change revisions for the same source", () => {
    const source = pointSource();
    const document = AutomationDocument.fromSource(source);
    const state = document.getState();

    document.replaceSource(source);

    expect(document.getState()).toBe(state);
    expect(document.getState().revision).toBe(0);
    expect(document.getState().compiledRevision).toBe(0);
  });

  it("keeps element identity through statement reconciliation", () => {
    const source = pointSource();
    const document = AutomationDocument.fromSource(source);
    const originalId = document.getState().doc.document.elements[0].id;

    document.replaceSource(pointSource("Renamed", 12));

    expect(document.getState().doc.document.elements[0].id).toBe(originalId);
  });

  it("keeps typed binding identity through a declaration and reference rename", () => {
    const source = [
      "nui 4",
      "const base: number = 10",
      "const result: number = @base"
    ].join("\n");
    const renamed = source.replaceAll("base", "renamed");
    const document = AutomationDocument.fromSource(source);
    const originalBinding = document.getState().doc.bindingAnalysis?.catalog.bindings.find(
      (binding) => binding.name === "base"
    );

    expect(originalBinding).toBeDefined();
    document.replaceSource(renamed);

    const renamedBinding = document.getState().doc.bindingAnalysis?.catalog.bindings.find(
      (binding) => binding.name === "renamed"
    );
    expect(renamedBinding?.id).toBe(originalBinding?.id);
  });

  it("updates the typed dependency graph for fatal current source", () => {
    const document = AutomationDocument.fromSource("nui 4\nconst stable: number = 1");
    const lastGoodGraph = document.getState().typedDependencyGraph;
    const fatal = [
      "nui 4",
      "const missing: number = @unknown",
      "group G (printEnabled: @unknown) {",
      "}"
    ].join("\n");

    document.replaceSource(fatal);
    const state = document.getState();

    expect(state.status).toBe("fatal");
    expect(state.docText).not.toBe(fatal);
    expect(state.typedDependencyGraph).not.toBe(lastGoodGraph);
    expect(state.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "initializer", reason: "missing" })
    ]));
  });

  it("uses the production Module semantic and materialization path", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  group G {",
      "    point P = coordinate(x: 10, y: 20)",
      "  }",
      "}",
      "instance One = M()",
      "instance Two = M()"
    ].join("\n");

    const state = AutomationDocument.fromSource(source).getState();

    expect(state.status).toBe("valid");
    expect(state.doc.moduleMaterialization).toBeDefined();
    expect(state.doc.moduleMaterialization?.executionStatements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: expect.objectContaining({ kind: "moduleBody" }) })
      ])
    );
  });
});
