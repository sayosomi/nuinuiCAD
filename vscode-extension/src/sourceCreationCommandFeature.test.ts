import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  pickCreationCommand: vi.fn(),
  showQuickPick: vi.fn(),
  insertSnippet: vi.fn(),
  insertGeometryValueSnippet: vi.fn(),
  insertCalculationMeasurementSnippet: vi.fn(),
  insertControlFlowSnippet: vi.fn(),
  insertValueMatchSnippet: vi.fn(),
  insertModuleTemplateSnippet: vi.fn(),
  insertStyleProfileTemplateSnippet: vi.fn(),
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
  insertSourceValueMatchSnippet: mocks.insertValueMatchSnippet,
  insertSourceModuleTemplateSnippet: mocks.insertModuleTemplateSnippet,
  insertSourceStyleProfileTemplateSnippet: mocks.insertStyleProfileTemplateSnippet,
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
import {
  SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceValueMatchTemplateCatalog";
import {
  SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceModuleTemplateCatalog";
import {
  SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceStyleProfileTemplateCatalog";

beforeEach(() => {
  mocks.commands.clear();
  mocks.pickCreationCommand.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.insertSnippet.mockReset();
  mocks.insertGeometryValueSnippet.mockReset();
  mocks.insertCalculationMeasurementSnippet.mockReset();
  mocks.insertControlFlowSnippet.mockReset();
  mocks.insertValueMatchSnippet.mockReset();
  mocks.insertModuleTemplateSnippet.mockReset();
  mocks.insertStyleProfileTemplateSnippet.mockReset();
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
    getText: () => source,
    positionAt: (offset: number) => ({ line: 0, character: offset })
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
  it.each([
    { documentUri: "file:///tmp/other.nui", expectedDocumentVersion: 1 },
    { documentUri: "file:///tmp/example.nui", expectedDocumentVersion: 2 }
  ])("fails closed when an internal exact-document invocation is stale or mismatched", async (invocation) => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      ...invocation,
      insertionOrigin: "document-end"
    })).resolves.toBeUndefined();

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("uses the canonical document-end insertion and keeps a required separator in one Output snippet", async () => {
    const { editor, session } = sourceEditorFor("nui 1");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
      .mockResolvedValueOnce("Layout");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      documentUri: "file:///tmp/example.nui",
      expectedDocumentVersion: 1,
      insertionOrigin: "document-end"
    })).resolves.toBe(true);

    expect(mocks.insertOutputSnippet).toHaveBeenCalledWith(
      editor,
      expect.anything(),
      { line: 0, character: 5 },
      { prefixText: "\n" }
    );
    feature.dispose();
  });

  it("keeps the fixed family order and explicit family routes", () => {
    expect(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS.map(({ label }) => label))
      .toEqual(["Geometry", "Geometry Value", "Calculation / Measurement", "Control Flow", "Value / Match", "Module", "Style / Profile", "Output / Print"]);
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[0]!.id))
      .toEqual({ familyId: "geometry", kind: "geometry" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[1]!.id))
      .toEqual({ familyId: "geometry-value", kind: "geometry-value" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[2]!.id))
      .toEqual({ familyId: "calculation-measurement", kind: "calculation-measurement" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[3]!.id))
      .toEqual({ familyId: "control-flow", kind: "control-flow" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4]!.id))
      .toEqual({ familyId: "value-match", kind: "value-match" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5]!.id))
      .toEqual({ familyId: "module", kind: "module" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[6]!.id))
      .toEqual({ familyId: "style-profile", kind: "style-profile" });
    expect(sourceTemplateRouteFor(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7]!.id))
      .toEqual({ familyId: "output-print", kind: "output-print" });
  });

  it("captures the Source target before the fixed family picker and routes Output / Print in order", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
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
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("routes Style / Profile through exactly one fixed row picker without candidate or property pickers", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[6])
      .mockResolvedValueOnce(SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS[2]);
    mocks.insertStyleProfileTemplateSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS);
    expect(mocks.insertStyleProfileTemplateSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertStyleProfileTemplateSnippet.mock.calls[0]?.[1]).toMatchObject({
      templateId: "style-profile-override"
    });
    expect(mocks.insertStyleProfileTemplateSnippet.mock.calls[0]?.[3]).toEqual({ appendNewline: true });
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Style / Profile row cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[6])
      .mockResolvedValueOnce(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.insertStyleProfileTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects Profile outside the top level without relocation or extra pickers", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nlayout L {\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[6])
      .mockResolvedValueOnce(SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS[0]);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.insertStyleProfileTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("top level"));
    feature.dispose();
  });

  it("rejects stale Source after the Style / Profile row picker", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[6])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS[1];
      });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.insertStyleProfileTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("routes Module rows through the semantic candidate picker and one snippet insertion", async () => {
    const { editor, session } = sourceEditorFor([
      "nui 1",
      "module Existing(value: number) {",
      "}",
      ""
    ].join("\n"));
    const selectedCandidate = {
      kind: "module" as const,
      label: "Existing",
      sourceCallee: "Existing",
      identity: "source-module-existing",
      parameters: []
    };
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5])
      .mockResolvedValueOnce(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS[2])
      .mockResolvedValueOnce(selectedCandidate);
    mocks.insertModuleTemplateSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(3, expect.arrayContaining([
      expect.objectContaining({ sourceCallee: "Existing", identity: expect.any(String) })
    ]));
    expect(mocks.insertModuleTemplateSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertModuleTemplateSnippet.mock.calls[0]?.[1]).toMatchObject({
      templateId: "module-instance",
      candidate: selectedCandidate
    });
    expect(mocks.insertModuleTemplateSnippet.mock.calls[0]?.[3]).toEqual({ appendNewline: true });
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Module row-picker cancellation mutation-free without opening a candidate picker", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5])
      .mockResolvedValueOnce(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS);
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Module candidate-picker cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nmodule Existing() {\n}\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5])
      .mockResolvedValueOnce(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS[2])
      .mockResolvedValueOnce(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(3);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(3, expect.arrayContaining([
      expect.objectContaining({ sourceCallee: "Existing" })
    ]));
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects Export Module outside the top-level without editing Source", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nlayout L {\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5])
      .mockResolvedValueOnce(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS[1]);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("top level"));
    feature.dispose();
  });

  it("reports no legal Module candidates without editing Source", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nmodule Wrapper() {\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5])
      .mockResolvedValueOnce(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS[2]);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("No legal Module"));
    feature.dispose();
  });

  it("rejects stale Source after the Module candidate Quick Pick", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\nmodule Existing() {\n}\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[5])
      .mockResolvedValueOnce(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS[2])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return {
          kind: "module" as const,
          label: "Existing",
          sourceCallee: "Existing",
          identity: "source-module-existing",
          parameters: []
        };
      });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("rejects a document version change after family selection without opening a later picker or editing Source", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockImplementationOnce(async () => {
      document.version += 1;
      return SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7];
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
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
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
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
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
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
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
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[7])
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

  it("routes Value / Match through one fixed row picker in order and native snippet insertion", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce(SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS[4]);
    mocks.insertValueMatchSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(
      2,
      SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS
    );
    expect(mocks.insertValueMatchSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertValueMatchSnippet.mock.calls[0]?.[1]).toMatchObject({
      templateId: "optional-match"
    });
    expect(mocks.insertValueMatchSnippet.mock.calls[0]?.[3]).toEqual({ appendNewline: true });
    expect(mocks.insertControlFlowSnippet).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Value / Match row cancellation and stale selection mutation-free", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertValueMatchSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick
      .mockResolvedValueOnce(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS[4])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS[0];
      });
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertValueMatchSnippet).not.toHaveBeenCalled();
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
