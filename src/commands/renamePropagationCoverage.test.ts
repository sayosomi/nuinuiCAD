import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { analyzeRename, validateRenameReferenceStability } from "../document/renameAnalysis";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { renameElementWithPropagation } from "./renameElementWithPropagation";

const seed = (sourceText: string) => {
  useCadDocumentStore.getState().commitText(sourceText, "test");
  useCadDocumentStore.setState({ past: [], future: [], dirtySinceSave: false });
};

const elementId = (name: string) =>
  useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;

const changedLines = (before: string, after: string) => before.split("\n").flatMap((line, index) =>
  line === after.split("\n")[index] ? [] : [index + 1]
);

const unchangedMutationState = () => {
  const state = useCadDocumentStore.getState();
  return {
    sourceText: state.sourceText,
    past: state.past,
    sourceRevision: state.sourceRevision,
    sourceUpdate: state.sourceUpdate,
    selection: useCadUiStore.getState().selectedElementIds
  };
};

const expectRejectedWithoutMutation = (run: () => boolean) => {
  const before = unchangedMutationState();
  expect(run()).toBe(false);
  const after = unchangedMutationState();
  expect(after).toEqual(before);
};

const expectSuccessfulRename = ({
  source,
  targetName,
  newName,
  changedLineNumbers
}: {
  source: string;
  targetName: string;
  newName: string;
  changedLineNumbers: number[];
}) => {
  seed(source);
  const id = elementId(targetName);
  useCadUiStore.getState().setSelectedElementIds([id]);
  const before = useCadDocumentStore.getState();

  expect(renameElementWithPropagation(id, newName)).toBe(true);

  const after = useCadDocumentStore.getState();
  expect(changedLines(before.sourceText, after.sourceText)).toEqual(changedLineNumbers);
  expect(validateRenameReferenceStability({ before: before.doc, after: after.doc })).toEqual({ verdict: "ok" });
  expect(after.past).toHaveLength(1);
  expect(useCadUiStore.getState().selectedElementIds).toEqual([id]);

  useCadDocumentStore.getState().undo();
  expect(useCadDocumentStore.getState().sourceText).toBe(source);
  useCadDocumentStore.getState().redo();
  expect(useCadDocumentStore.getState().sourceText).toBe(after.sourceText);
  return after.sourceText;
};

const denseCleanSource = () => {
  const generatedReferenceCount = 992;
  return [
    "nui 1",
    "point Target = (0, 0)",
    "group Front {",
    "  point Shared = (1, 0)",
    "  point FrontUser = offset Target dx=1 dy=0",
    "}",
    "group Back {",
    "  point Shared = (2, 0)",
    "  point Qualified = offset Front::Shared dx=1 dy=0",
    "  point TargetUser = offset Target dx=1 dy=0",
    "}",
    ...Array.from({ length: generatedReferenceCount }, (_, index) =>
      `point P${index} = offset Target dx=${index + 1} dy=0`
    )
  ].join("\n");
};

describe("rename propagation reference-form coverage", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("propagates direct, start/end, point-key, property, and function-argument references", () => {
    const source = [
      "nui 1",
      "# unchanged comment",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line L = A -> B # target comment",
      "",
      "point StartUser = offset L.start dx=1 dy=0",
      "point EndUser = offset L.end dx=1 dy=0",
      "point OnUser = on L.end distance=1",
      "var Property = L.length",
      "var Endpoint = distance(L:start, B)",
      "# untouched tail"
    ].join("\n");
    const after = expectSuccessfulRename({
      source,
      targetName: "L",
      newName: "Seam",
      changedLineNumbers: [5, 7, 8, 9, 10, 11]
    });

    expect(after).toContain("# unchanged comment");
    expect(after).toContain("# untouched tail");
    expect(after).toContain("distance(Seam:start, B)");
  });

  it("propagates a group-scoped @variable reference", () => {
    const source = [
      "nui 1",
      "group G {",
      "  var Width = 10 scope=group",
      "  point User = (@Width, 0)",
      "}"
    ].join("\n");
    const after = expectSuccessfulRename({
      source,
      targetName: "Width",
      newName: "Depth",
      changedLineNumbers: [3, 4]
    });

    expect(after).toContain("var Depth = 10 scope=group");
    expect(after).toContain("point User = (@Depth, 0)");
  });

  it("propagates qualified group references and place while leaving role/view records unchanged", () => {
    const source = [
      "nui 1",
      "role seam name=\"Seam\"",
      "view Draft default=true seam=true",
      "activeView Draft",
      "",
      "group G roles=[seam] {",
      "  point P = (0, 0)",
      "}",
      "group Consumer {",
      "  point User = offset G::P dx=1 dy=0",
      "}",
      "printLayout Layout output=pdf paper=a4 orientation=portrait columns=1 rows=1 overlap=0 scale=1 canvas=(100, 100) {",
      "  place G at=(0, 0) angle=0 mirrorX=false",
      "}"
    ].join("\n");
    const after = expectSuccessfulRename({
      source,
      targetName: "G",
      newName: "Pattern",
      changedLineNumbers: [6, 10, 13]
    });

    expect(after).toContain("role seam name=\"Seam\"");
    expect(after).toContain("view Draft default=true seam=true");
    expect(after).toContain("activeView Draft");
    expect(after).toContain("offset Pattern::P");
    expect(after).toContain("place Pattern at=(0, 0)");
  });

  it("names an explicit-id unnamed element, propagates its raw reference, and reloads cleanly", () => {
    const source = [
      "nui 1",
      "point = (0, 0) id=unnamed",
      "point User = offset unnamed dx=1 dy=0"
    ].join("\n");
    seed(source);
    const unnamed = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;
    const before = useCadDocumentStore.getState();

    expect(renameElementWithPropagation(unnamed.id, "Named")).toBe(true);

    const after = useCadDocumentStore.getState().sourceText;
    expect(changedLines(source, after)).toEqual([2, 3]);
    expect(after).toContain("point Named = (0, 0)");
    expect(after).toContain("offset Named dx=1 dy=0");
    expect(validateRenameReferenceStability({ before: before.doc, after: useCadDocumentStore.getState().doc }))
      .toEqual({ verdict: "ok" });

    const reloaded = compileDslDocument(after);
    expect(reloaded.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reloaded.document?.elements.find((element) => element.name === "Named")).toBeDefined();
  });

  it("rejects an absolute-path rename when serializer output would resolve to a shadowing element", () => {
    const source = [
      "nui 1",
      "group A {",
      "  point Target = (0, 0)",
      "}",
      "group B {",
      "  group A {",
      "    point Renamed = (1, 0)",
      "  }",
      "  point User = offset ::A::Target dx=1 dy=0",
      "}"
    ].join("\n");
    seed(source);

    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("Target"), "Renamed"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("参照先が変わる");
  });

  it("rejects same-scope explicit-id duplicates even though the DSL parser accepts them", () => {
    const source = [
      "nui 1",
      "point A = (0, 0) id=a1",
      "point A = (1, 0) id=a2",
      "point B = (2, 0) id=b"
    ].join("\n");
    expect(compileDslDocument(source).diagnostics).toEqual([]);
    seed(source);

    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("B"), "A"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("同じ名前");
  });

  it("rejects a shadowing resolution change and an invalid name without mutation", () => {
    const source = [
      "nui 1",
      "point Outer = (0, 0)",
      "group G {",
      "  point Inner = (1, 0)",
      "  point User = offset Outer dx=1 dy=0",
      "}"
    ].join("\n");
    seed(source);
    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("Inner"), "Outer"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("参照先が変わる");

    seed("nui 1\npoint A = (0, 0)");
    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("A"), "A::B"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("`::`");
  });

  it("rejects an existing dangling document at the clean-source gate", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint User = offset Missing dx=1 dy=0";
    seed(source);
    expect(useCadDocumentStore.getState().diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("参照先が見つかりません") })
    ]);

    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("A"), "Renamed"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("未解決参照");
  });

  it("rejects dangling capture in 5d analysis before bridge execution", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint User = offset NewName dx=1 dy=0";
    const compiled = compileDslDocument(source);
    const target = compiled.document!.elements.find((element) => element.name === "A")!;

    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("renames a clean, reference-dense 1,000-element document within the loose command guard", () => {
    seed(denseCleanSource());
    const before = useCadDocumentStore.getState();
    expect(before.elements).toHaveLength(1000);
    const startedAt = performance.now();

    expect(renameElementWithPropagation(elementId("Target"), "Renamed")).toBe(true);

    const elapsed = performance.now() - startedAt;
    const after = useCadDocumentStore.getState();
    expect(elapsed).toBeLessThan(5000);
    expect(validateRenameReferenceStability({ before: before.doc, after: after.doc })).toEqual({ verdict: "ok" });
    expect(after.sourceText).toContain("point P991 = offset Renamed dx=992 dy=0");
  });
});
