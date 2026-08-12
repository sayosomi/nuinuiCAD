import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
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

// Generator-built (not hand-written): renameElementWithPropagation's dev
// assertion requires an in-place line patch, which requires every affected
// statement's source to already be in v2's canonical vertical-call shape -
// impractical to hand-write for 1000 elements, so this uses the same
// generator as regular production text (dslTextForElements).
const denseCleanSource = () => {
  const generatedReferenceCount = 992;
  const elements: DslDocumentData["elements"] = [
    { id: "target", name: "Target", type: "freePoint", activity: "visible", x: 0, y: 0 },
    { id: "front", name: "Front", type: "group", activity: "visible" },
    { id: "front-shared", name: "Shared", type: "freePoint", activity: "visible", x: 1, y: 0, parentGroupId: "front" },
    {
      id: "front-user",
      name: "FrontUser",
      type: "offsetPoint",
      activity: "visible",
      fromPoint: { mode: "reference", pointId: "target" },
      dx: 1,
      dy: 0,
      parentGroupId: "front"
    },
    { id: "back", name: "Back", type: "group", activity: "visible" },
    { id: "back-shared", name: "Shared", type: "freePoint", activity: "visible", x: 2, y: 0, parentGroupId: "back" },
    {
      id: "qualified",
      name: "Qualified",
      type: "offsetPoint",
      activity: "visible",
      fromPoint: { mode: "reference", pointId: "front-shared" },
      dx: 1,
      dy: 0,
      parentGroupId: "back"
    },
    {
      id: "target-user",
      name: "TargetUser",
      type: "offsetPoint",
      activity: "visible",
      fromPoint: { mode: "reference", pointId: "target" },
      dx: 1,
      dy: 0,
      parentGroupId: "back"
    },
    ...Array.from({ length: generatedReferenceCount }, (_, index) => ({
      id: `p${index}`,
      name: `P${index}`,
      type: "offsetPoint" as const,
      activity: "visible" as const,
      fromPoint: { mode: "reference" as const, pointId: "target" },
      dx: index + 1,
      dy: 0
    }))
  ];
  return dslTextForElements(elements);
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

  it("propagates direct, start/end, point-key, and typed-property references", () => {
    // Canonical nui 3 vertical-call shape throughout (see the in-place-patch
    // note in renameElementWithPropagation.test.ts).
    const source = [
      "nui 3",
      "# unchanged comment",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0",
      ")",
      "point B = coordinate(",
      "  x: 10,",
      "  y: 0",
      ")",
      "line L = segment(",
      "  start: @A,",
      "  end: @B",
      ") # target comment",
      "",
      "point StartUser = offset(",
      "  from: @L.start,",
      "  dx: 1,",
      "  dy: 0",
      ")",
      "point EndUser = offset(",
      "  from: @L.end,",
      "  dx: 1,",
      "  dy: 0",
      ")",
      "point OnUser = onLine(",
      "  from: @L.end,",
      "  distance: 1,",
      "  steps: [ratio: 0.01]",
      ")",
      "point PropertyUser = offset(",
      "  from: @A,",
      "  dx: @L.length,",
      "  dy: 0",
      ")",
      "# untouched tail"
    ].join("\n");
    const after = expectSuccessfulRename({
      source,
      targetName: "L",
      newName: "Seam",
      changedLineNumbers: [11, 17, 22, 27, 33]
    });

    expect(after).toContain("# unchanged comment");
    expect(after).toContain("# untouched tail");
    expect(after).toContain("@Seam.length");
  });

  it("propagates qualified group references and place while leaving role/view records unchanged", () => {
    // role/view/group(roles:)/place stay single-line canonically (only
    // printLayout's own header goes vertical), matching serializeDocumentToDsl.
    const source = [
      "nui 3",
      "role seam (name: \"Seam\")",
      "view Draft (default: true, seam: true)",
      "activeView Draft",
      "",
      "group G (roles: [seam]) {",
      "  point P = coordinate(",
      "    x: 0,",
      "    y: 0",
      "  )",
      "}",
      "group Consumer {",
      "  point User = offset(",
      "    from: @G::P,",
      "    dx: 1,",
      "    dy: 0",
      "  )",
      "}",
      "printLayout Layout (",
      "  output: pdf,",
      "  paper: a4,",
      "  orientation: portrait,",
      "  columns: 1,",
      "  rows: 1,",
      "  overlap: 0,",
      "  scale: 1,",
      "  canvas: (100, 100)",
      ") {",
      "  place G (at: (0, 0), angle: 0, mirrorX: false)",
      "}"
    ].join("\n");
    const after = expectSuccessfulRename({
      source,
      targetName: "G",
      newName: "Pattern",
      changedLineNumbers: [6, 14, 29]
    });

    expect(after).toContain("role seam (name: \"Seam\")");
    expect(after).toContain("view Draft (default: true, seam: true)");
    expect(after).toContain("activeView Draft");
    expect(after).toContain("from: @Pattern::P");
    expect(after).toContain("place Pattern (at: (0, 0), angle: 0, mirrorX: false)");
  });

  it("names an explicit-id unnamed element, propagates its raw reference, and reloads cleanly", () => {
    const source = [
      "nui 3",
      "point = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  id: unnamed",
      ")",
      "point User = offset(",
      "  from: @unnamed,",
      "  dx: 1,",
      "  dy: 0",
      ")"
    ].join("\n");
    seed(source);
    const unnamed = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;
    const before = useCadDocumentStore.getState();

    expect(renameElementWithPropagation(unnamed.id, "Named")).toBe(true);

    const after = useCadDocumentStore.getState().sourceText;
    // The id: arg only exists to persist a stable identity for the unnamed
    // element; a first-ever name makes it redundant, so the statement's own
    // line count shrinks and everything after it shifts up by one line.
    expect(after).toContain("point Named = coordinate(");
    expect(after).toContain("from: @Named");
    expect(after).not.toContain("id: unnamed");
    expect(validateRenameReferenceStability({ before: before.doc, after: useCadDocumentStore.getState().doc }))
      .toEqual({ verdict: "ok" });

    const reloaded = compileDslDocument(after);
    expect(reloaded.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reloaded.document?.elements.find((element) => element.name === "Named")).toBeDefined();
  });

  it("rejects an absolute-path rename when serializer output would resolve to a shadowing element", () => {
    const source = [
      "nui 3",
      "group A {",
      "  point Target = coordinate(x: 0, y: 0)",
      "}",
      "group B {",
      "  group A {",
      "    point Renamed = coordinate(x: 1, y: 0)",
      "  }",
      "  point User = offset(from: @::A::Target, dx: 1, dy: 0)",
      "}"
    ].join("\n");
    seed(source);

    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("Target"), "Renamed"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("参照先が変わる");
  });

  it("rejects same-scope explicit-id duplicates even though the DSL parser accepts them", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0, id: a1)",
      "point A = coordinate(x: 1, y: 0, id: a2)",
      "point B = coordinate(x: 2, y: 0, id: b)"
    ].join("\n");
    expect(compileDslDocument(source).diagnostics).toEqual([]);
    seed(source);

    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("B"), "A"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("同じ名前");
  });

  it("rejects a shadowing resolution change and an invalid name without mutation", () => {
    const source = [
      "nui 3",
      "point Outer = coordinate(x: 0, y: 0)",
      "group G {",
      "  point Inner = coordinate(x: 1, y: 0)",
      "  point User = offset(from: @Outer, dx: 1, dy: 0)",
      "}"
    ].join("\n");
    seed(source);
    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("Inner"), "Outer"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("参照先が変わる");

    seed("nui 3\npoint A = coordinate(x: 0, y: 0)");
    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("A"), "A::B"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("`::`");
  });

  it("rejects an existing dangling document at the clean-source gate", () => {
    const source = "nui 3\npoint A = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)";
    seed(source);
    expect(useCadDocumentStore.getState().diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("参照先が見つかりません") })
    ]);

    expectRejectedWithoutMutation(() => renameElementWithPropagation(elementId("A"), "Renamed"));
    expect(useCadUiStore.getState().commandErrorMessage).toContain("未解決参照");
  });

  it("rejects dangling capture in 5d analysis before bridge execution", () => {
    const source = "nui 3\npoint A = coordinate(x: 0, y: 0)\npoint User = offset(from: @NewName, dx: 1, dy: 0)";
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
    expect(after.sourceText).toContain("point P991 = offset(\n  from: @Renamed,\n  dx: 992,\n  dy: 0\n)");
  });
});
