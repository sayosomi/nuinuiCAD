import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  pickCreationCommand: vi.fn(),
  showQuickPick: vi.fn(),
  insertSnippet: vi.fn(),
  insertGeometryValueSnippet: vi.fn(),
  insertCalculationMeasurementSnippet: vi.fn(),
  insertControlFlowSnippet: vi.fn(),
  insertOutputSnippet: vi.fn(),
  showErrorMessage: vi.fn(),
  currentCompiledSemanticSnapshotFor: vi.fn()
}));

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    }
  },
  workspace: { fs: { isWritableFileSystem: () => true } },
  window: { showErrorMessage: mocks.showErrorMessage },
  Position: class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
}));
vi.mock("./languageAnalysisSession", () => ({
  currentCompiledSemanticSnapshotFor: mocks.currentCompiledSemanticSnapshotFor
}));
vi.mock("./creationCommandQuickPick", () => ({
  pickVscodeCreationCommand: mocks.pickCreationCommand
}));
vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.showQuickPick
}));
vi.mock("./sourceCreationSnippetAdapter", () => ({
  insertSourceCreationSnippet: mocks.insertSnippet,
  insertSourceGeometryValueSnippet: mocks.insertGeometryValueSnippet,
  insertSourceCalculationMeasurementSnippet: mocks.insertCalculationMeasurementSnippet,
  insertSourceControlFlowSnippet: mocks.insertControlFlowSnippet,
  insertSourceOutputTemplateSnippet: mocks.insertOutputSnippet
}));

import {
  registerVscodeSourceCreationCommandFeature,
  VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID
} from "./sourceCreationCommandFeature";
import { VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID } from "./sourceCreationCommandFeature";
import { createNuiLanguageSession } from "@nuinuicad/nui-language";
import {
  SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS,
  sourceTemplateRouteFor
} from "../../src/commands/sourceTemplateCatalog";
import { sourceGeometryValueTemplateGroups } from "../../src/commands/sourceGeometryValueTemplateCatalog";
import { sourceCalculationMeasurementTemplatePlans } from "../../src/commands/sourceCalculationMeasurementTemplateCatalog";
import {
  SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceControlFlowTemplateCatalog";

beforeEach(() => {
  mocks.commands.clear();
  mocks.pickCreationCommand.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.insertSnippet.mockReset();
  mocks.insertGeometryValueSnippet.mockReset();
  mocks.insertCalculationMeasurementSnippet.mockReset();
  mocks.insertControlFlowSnippet.mockReset();
  mocks.insertOutputSnippet.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.currentCompiledSemanticSnapshotFor.mockReset();
});

describe("Source Create Geometry command feature", () => {
  it("runs the one-form production command path through materialization and snippet insertion", async () => {
    const activePosition = { line: 4, character: 7 };
    const editor = { selection: { active: activePosition } };
    const activeSourceEditor = vi.fn(() => editor);
    const displayLanguageFor = vi.fn(() => "ja-JP");
    const insertionResult = Promise.resolve(true);
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockReturnValue(insertionResult);
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).toHaveBeenCalledTimes(1);
    expect(mocks.pickCreationCommand).toHaveBeenCalledTimes(1);
    expect(mocks.pickCreationCommand).toHaveBeenCalledWith({
      displayLanguage: "ja-JP",
      recentCommandIds: []
    });
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    const [insertedEditor, materialization, insertedPosition] = mocks.insertSnippet.mock.calls[0]!;
    expect(insertedEditor).toBe(editor);
    expect(insertedPosition).toBe(activePosition);
    expect(materialization).toMatchObject({
      commandId: "addLine",
      formIndex: 0
    });

    mocks.pickCreationCommand.mockResolvedValue("addBezierCurve");
    mocks.insertSnippet.mockReturnValue(Promise.resolve(true));
    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.pickCreationCommand).toHaveBeenLastCalledWith({
      displayLanguage: "ja-JP",
      recentCommandIds: ["addLine"]
    });
    feature.dispose();
  });

  it("starts a fresh in-memory MRU for a new feature registration", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockResolvedValue(true);

    const firstFeature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });
    await mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.();
    firstFeature.dispose();

    const secondFeature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });
    await mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.();

    expect(mocks.pickCreationCommand).toHaveBeenLastCalledWith({
      displayLanguage: "en",
      recentCommandIds: []
    });
    secondFeature.dispose();
  });

  it("does nothing when the Source owner has no supported active editor", async () => {
    const activeSourceEditor = vi.fn(() => undefined);
    const displayLanguageFor = vi.fn(() => "en");
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).not.toHaveBeenCalled();
    expect(mocks.pickCreationCommand).not.toHaveBeenCalled();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("stops at type cancellation without opening a form picker or inserting a snippet", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("stops at form cancellation after reaching the real form picker", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue("addDivisionPoint");
    mocks.showQuickPick.mockResolvedValue(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });
});

const sourceEditorFor = (source: string, version = 1, line = 1) => {
  const document = {
    languageId: "nui",
    fileName: "/tmp/example.nui",
    version,
    lineCount: source.split("\n").length,
    uri: { scheme: "file", toString: () => "file:///tmp/example.nui" },
    getText: () => source
  };
  const editor = { document, selection: { active: { line, character: 0 } } };
  const session = createNuiLanguageSession(source);
  const semantic = session.runtimeEvaluationSnapshot();
  if (!semantic) throw new Error("Expected a current test semantic snapshot");
  mocks.currentCompiledSemanticSnapshotFor.mockReturnValue({
    sourceRevision: semantic.sourceRevision,
    sourceText: semantic.sourceText,
    compiled: semantic.compiled
  });
  return { document, editor, session };
};

describe("Source Insert Template command feature", () => {
  it("keeps the fixed family order and explicit family routes", () => {
    expect(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS.map(({ label }) => label))
      .toEqual(["Geometry", "Geometry Value", "Calculation / Measurement", "Control Flow", "Output / Print"]);
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[0]!.id))
      .toEqual({ familyId: "geometry", kind: "geometry" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1]!.id))
      .toEqual({ familyId: "geometry-value", kind: "geometry-value" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[2]!.id))
      .toEqual({ familyId: "calculation-measurement", kind: "calculation-measurement" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[3]!.id))
      .toEqual({ familyId: "control-flow", kind: "control-flow" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4]!.id))
      .toEqual({ familyId: "output-print", kind: "output-print" });
  });

  it("captures the Source target before the fixed family picker and routes Output / Print in order", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce("Layout + Print");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.currentCompiledSemanticSnapshotFor.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.showQuickPick.mock.invocationCallOrder[0]);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(1, SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.insertOutputSnippet).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("keeps family cancellation and Output / Print cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects a document version change after family selection without opening a later picker or editing Source", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockImplementationOnce(async () => {
      document.version += 1;
      return SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4];
    });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("rejects Place at the top level while preserving the fixed Output / Print catalog", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce("Place");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("layout body"));
    feature.dispose();
  });

  it("accepts Place only at a direct layout-body boundary", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nlayout L {\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce("Place");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.insertOutputSnippet).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("rejects a top-level-only template in a nested group after the unchanged picker order", async () => {
    const { editor, session } = sourceEditorFor("nui 1\ngroup G {\n\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce("SVG");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("top level"));
    feature.dispose();
  });

  it("uses the complete logical-statement boundary instead of splitting a multiline declaration", async () => {
    const source = "nui 1\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\n";
    const { editor, session } = sourceEditorFor(source, 1, 1);
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce("Layout");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);
    const insertedPosition = mocks.insertOutputSnippet.mock.calls[0]?.[2];
    expect(insertedPosition).toMatchObject({ line: 5, character: 0 });
    feature.dispose();
  });

  it("routes Calculation / Measurement through one row picker and native snippet insertion", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const plans = sourceCalculationMeasurementTemplatePlans();
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[2])
      .mockResolvedValueOnce({ label: plans[0]!.label, plan: plans[0] });
    mocks.insertCalculationMeasurementSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      { label: "Distance between points", plan: plans[0] },
      { label: "Angle between points", plan: plans[1] },
      { label: "Point-to-line distance", plan: plans[2] },
      { label: "Angle between lines", plan: plans[3] },
      { label: "Spread angle", plan: plans[4] }
    ]);
    expect(mocks.insertCalculationMeasurementSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertCalculationMeasurementSnippet.mock.calls[0]?.[1]).toMatchObject({ plan: plans[0] });
    expect(mocks.pickCreationCommand).not.toHaveBeenCalled();
    expect(mocks.insertGeometryValueSnippet).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Calculation / Measurement row cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[2])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.insertCalculationMeasurementSnippet).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    expect(mocks.insertGeometryValueSnippet).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("routes Control Flow through one fixed row picker and linked-identity materialization", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[3])
      .mockResolvedValueOnce(SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS[4]);
    mocks.insertControlFlowSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(
      2,
      SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS
    );
    expect(mocks.insertControlFlowSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertControlFlowSnippet.mock.calls[0]?.[1]).toMatchObject({
      templateId: "for-range-carry"
    });
    expect(mocks.insertControlFlowSnippet.mock.calls[0]?.[3]).toEqual({ appendNewline: true });
    expect(mocks.insertCalculationMeasurementSnippet).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Control Flow cancellation and stale selection mutation-free", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[3])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertControlFlowSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[3])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS[0];
      });
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertControlFlowSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("routes Geometry Value through group, construction, and exclusive-form pickers", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const pointGroup = sourceGeometryValueTemplateGroups().find(({ id }) => id === "point")!;
    const between = pointGroup.plans.find(({ construction }) => construction === "between")!;
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1])
      .mockResolvedValueOnce({ label: "Point", group: pointGroup })
      .mockResolvedValueOnce({ label: "between", plan: between })
      .mockResolvedValueOnce({ label: "ratio", form: between.forms[1] });
    mocks.insertGeometryValueSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, expect.arrayContaining([
      expect.objectContaining({ label: "Point" }),
      expect.objectContaining({ label: "Line" }),
      expect.objectContaining({ label: "Path" })
    ]));
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(3, expect.arrayContaining([
      expect.objectContaining({ label: "coordinate" }),
      expect.objectContaining({ label: "between", plan: between })
    ]));
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(4, [
      expect.objectContaining({ label: "distance" }),
      expect.objectContaining({ label: "ratio" })
    ]);
    expect(mocks.insertGeometryValueSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertGeometryValueSnippet.mock.calls[0]?.[1]).toMatchObject({
      plan: between,
      form: between.forms[1]
    });
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Geometry Value group, construction, and form cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const pointGroup = sourceGeometryValueTemplateGroups().find(({ id }) => id === "point")!;
    const between = pointGroup.plans.find(({ construction }) => construction === "between")!;
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1])
      .mockResolvedValueOnce({ label: "Point", group: pointGroup })
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1])
      .mockResolvedValueOnce({ label: "Point", group: pointGroup })
      .mockResolvedValueOnce({ label: "between", plan: between })
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.insertGeometryValueSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects a stale Source after Geometry Value group selection before later picker work", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    const pointGroup = sourceGeometryValueTemplateGroups().find(({ id }) => id === "point")!;
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return { label: "Point", group: pointGroup };
      });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.insertGeometryValueSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("delegates the Geometry family to the existing Geometry chooser and keeps its MRU local", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[0]);
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.pickCreationCommand).toHaveBeenCalledWith({ displayLanguage: "en", recentCommandIds: [] });
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    feature.dispose();
  });
});
