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
import { sourceCalculationMeasurementTemplatePlans } from "../../src/commands/sourceCalculationMeasurementTemplateCatalog";
import { SOURCE_OUTPUT_TEMPLATE_DEFINITIONS } from "../../src/commands/sourceOutputTemplateCatalog";
import {
  sourceCalculationMeasurementPickerItemsFor,
  sourceControlFlowPickerItemsFor,
  sourceGeometryValueGroupPickerItemsFor,
  sourceModulePickerItemsFor,
  sourceOutputPrintPickerItemsFor,
  sourceStyleProfilePickerItemsFor,
  sourceTemplateFamilyPickerItemsFor,
  sourceValueMatchPickerItemsFor,
  sourceCreationMessageFor
} from "./sourceCreationPresentationLocalization";

const familyPickerItemsEn = sourceTemplateFamilyPickerItemsFor("en");
const controlFlowPickerItemsEn = sourceControlFlowPickerItemsFor("en");
const valueMatchPickerItemsEn = sourceValueMatchPickerItemsFor("en");
const modulePickerItemsEn = sourceModulePickerItemsFor("en");
const styleProfilePickerItemsEn = sourceStyleProfilePickerItemsFor("en");
const outputPrintPickerItemsEn = sourceOutputPrintPickerItemsFor("en");
const familyPickerItemsJa = sourceTemplateFamilyPickerItemsFor("ja-JP");
const modulePickerItemsJa = sourceModulePickerItemsFor("ja-JP");
const styleProfilePickerItemsJa = sourceStyleProfilePickerItemsFor("ja-JP");
const outputPrintPickerItemsJa = sourceOutputPrintPickerItemsFor("ja-JP");

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
      insertionOrigin: "document-end",
      preselectedFamilyId: "output-print"
    })).resolves.toBeUndefined();

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it.each([
    { documentUri: "file:///tmp/example.nui", expectedDocumentVersion: 1, insertionOrigin: "document-end" },
    { documentUri: "file:///tmp/example.nui", expectedDocumentVersion: 1, insertionOrigin: "document-end", preselectedFamilyId: "geometry" }
  ])("fails closed for malformed internal invocations", async (invocation) => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.(invocation)).resolves.toBeUndefined();

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("preselects Output / Print internally while keeping the canonical document-end insertion", async () => {
    const { editor, session } = sourceEditorFor("nui 1");
    mocks.showQuickPick.mockResolvedValueOnce(outputPrintPickerItemsEn[1]);
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      documentUri: "file:///tmp/example.nui",
      expectedDocumentVersion: 1,
      insertionOrigin: "document-end",
      preselectedFamilyId: "output-print"
    })).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.map(({ label }) => label)).toEqual([
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(outputPrintPickerItemsEn.map(({ label }) => label)).toEqual([
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.showQuickPick).toHaveBeenCalledWith(outputPrintPickerItemsEn);
    expect(mocks.showQuickPick).not.toHaveBeenCalledWith(familyPickerItemsEn);
    expect(mocks.insertOutputSnippet).toHaveBeenCalledWith(
      editor,
      expect.anything(),
      { line: 0, character: 5 },
      { prefixText: "\n" }
    );
    feature.dispose();
  });

  it("opens the localized family picker first and routes localized Output / Print by stable ID", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsJa[7])
      .mockResolvedValueOnce(outputPrintPickerItemsJa[1]);
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "ja-JP",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(1, familyPickerItemsJa);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, outputPrintPickerItemsJa);
    expect(mocks.showQuickPick.mock.calls[1]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "layout", label: "Layout（レイアウト）" })
    ]));
    expect(mocks.insertOutputSnippet.mock.calls[0]?.[1]).toMatchObject({ templateId: "layout" });
    feature.dispose();
  });

  it("keeps SAY-344 preselected Output / Print on the localized canonical list without the family picker", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockResolvedValueOnce(outputPrintPickerItemsJa[0]);
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "ja-JP",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      documentUri: "file:///tmp/example.nui",
      expectedDocumentVersion: 1,
      insertionOrigin: "document-end",
      preselectedFamilyId: "output-print"
    })).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.showQuickPick).toHaveBeenCalledWith(outputPrintPickerItemsJa);
    expect(outputPrintPickerItemsJa.map(({ id }) => id)).toEqual([
      "layout-print", "layout", "place", "print", "svg"
    ]);
    expect(mocks.insertOutputSnippet.mock.calls[0]?.[1]).toMatchObject({ templateId: "layout-print" });
    feature.dispose();
  });

  it("shows stale and unsafe Source messages in the supplied display language", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockImplementationOnce(async () => {
      document.version += 1;
      return familyPickerItemsJa[7];
    });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "ja-JP",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(sourceCreationMessageFor("stale", "ja-JP"));
    feature.dispose();

    const unsafe = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockClear();
    mocks.showErrorMessage.mockClear();
    const unsafeFeature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => unsafe.editor,
      displayLanguageFor: () => "ja-JP"
    });
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(sourceCreationMessageFor("unsafeInsertion", "ja-JP"));
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    unsafeFeature.dispose();
  });

  it.each([
    {
      label: "Module candidate",
      source: "nui 1\nmodule Wrapper() {\n}\n",
      line: 2,
      familyIndex: 5,
      row: "module",
      rowIndex: 2,
      messageId: "moduleNoCandidates" as const
    },
    {
      label: "Export Module",
      source: "nui 1\nlayout L {\n}\n",
      line: 2,
      familyIndex: 5,
      row: "module",
      rowIndex: 1,
      messageId: "exportModuleTopLevel" as const
    },
    {
      label: "Profile",
      source: "nui 1\nlayout L {\n}\n",
      line: 2,
      familyIndex: 6,
      row: "style",
      rowIndex: 0,
      messageId: "profileTopLevel" as const
    },
    {
      label: "Place",
      source: "nui 1\n",
      line: 1,
      familyIndex: 7,
      row: "output",
      rowIndex: 2,
      messageId: "placeScope" as const
    },
    {
      label: "other Output / Print template",
      source: "nui 1\ngroup G {\n\n}\n",
      line: 2,
      familyIndex: 7,
      row: "output",
      rowIndex: 4,
      messageId: "outputTopLevel" as const
    }
  ])("localizes $label legality feedback for Japanese", async ({ source, line, familyIndex, row, rowIndex, messageId }) => {
    const { editor, session } = sourceEditorFor(source, 1, line);
    const selectedRow = row === "module"
      ? modulePickerItemsJa[rowIndex]
      : row === "style"
        ? styleProfilePickerItemsJa[rowIndex]
        : outputPrintPickerItemsJa[rowIndex];
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsJa[familyIndex])
      .mockResolvedValueOnce(selectedRow);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "ja-JP",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(sourceCreationMessageFor(messageId, "ja-JP"));
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.insertStyleProfileTemplateSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps internal Output / Print cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      documentUri: "file:///tmp/example.nui",
      expectedDocumentVersion: 1,
      insertionOrigin: "document-end",
      preselectedFamilyId: "output-print"
    })).resolves.toBeUndefined();

    expect(mocks.showQuickPick).toHaveBeenCalledWith(outputPrintPickerItemsEn);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects a stale internal Output / Print target after the canonical picker", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockImplementationOnce(async () => {
      document.version += 1;
      return outputPrintPickerItemsEn[1];
    });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      documentUri: "file:///tmp/example.nui",
      expectedDocumentVersion: 1,
      insertionOrigin: "document-end",
      preselectedFamilyId: "output-print"
    })).resolves.toBeUndefined();

    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("keeps the fixed family order and explicit family routes", () => {
    expect(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS.map(({ label }) => label))
      .toEqual(["Geometry", "Geometry Value", "Calculation / Measurement", "Control Flow", "Value / Match", "Module", "Style / Profile", "Output / Print"]);
    expect(sourceTemplateRouteFor(familyPickerItemsEn[0]!.id))
      .toEqual({ familyId: "geometry", kind: "geometry" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[1]!.id))
      .toEqual({ familyId: "geometry-value", kind: "geometry-value" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[2]!.id))
      .toEqual({ familyId: "calculation-measurement", kind: "calculation-measurement" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[3]!.id))
      .toEqual({ familyId: "control-flow", kind: "control-flow" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[4]!.id))
      .toEqual({ familyId: "value-match", kind: "value-match" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[5]!.id))
      .toEqual({ familyId: "module", kind: "module" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[6]!.id))
      .toEqual({ familyId: "style-profile", kind: "style-profile" });
    expect(sourceTemplateRouteFor(familyPickerItemsEn[7]!.id))
      .toEqual({ familyId: "output-print", kind: "output-print" });
  });

  it("captures the Source target before the fixed family picker and routes Output / Print in order", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[7])
      .mockResolvedValueOnce(outputPrintPickerItemsEn[0]);
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.currentCompiledSemanticSnapshotFor.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.showQuickPick.mock.invocationCallOrder[0]);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(1, familyPickerItemsEn);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, outputPrintPickerItemsEn);
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
      .mockResolvedValueOnce(familyPickerItemsEn[7])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("routes Style / Profile through exactly one fixed row picker without candidate or property pickers", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[6])
      .mockResolvedValueOnce(styleProfilePickerItemsEn[2]);
    mocks.insertStyleProfileTemplateSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, styleProfilePickerItemsEn);
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
      .mockResolvedValueOnce(familyPickerItemsEn[6])
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
      .mockResolvedValueOnce(familyPickerItemsEn[6])
      .mockResolvedValueOnce(styleProfilePickerItemsEn[0]);
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
      .mockResolvedValueOnce(familyPickerItemsEn[6])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return styleProfilePickerItemsEn[1];
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
      .mockResolvedValueOnce(familyPickerItemsEn[5])
      .mockResolvedValueOnce(modulePickerItemsEn[2])
      .mockResolvedValueOnce(selectedCandidate);
    mocks.insertModuleTemplateSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, modulePickerItemsEn);
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
      .mockResolvedValueOnce(familyPickerItemsEn[5])
      .mockResolvedValueOnce(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, modulePickerItemsEn);
    expect(mocks.insertModuleTemplateSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Module candidate-picker cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nmodule Existing() {\n}\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[5])
      .mockResolvedValueOnce(modulePickerItemsEn[2])
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
      .mockResolvedValueOnce(familyPickerItemsEn[5])
      .mockResolvedValueOnce(modulePickerItemsEn[1]);
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
      .mockResolvedValueOnce(familyPickerItemsEn[5])
      .mockResolvedValueOnce(modulePickerItemsEn[2]);
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
      .mockResolvedValueOnce(familyPickerItemsEn[5])
      .mockResolvedValueOnce(modulePickerItemsEn[2])
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
      return familyPickerItemsEn[7];
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
      .mockResolvedValueOnce(familyPickerItemsEn[7])
      .mockResolvedValueOnce(outputPrintPickerItemsEn[2]);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, outputPrintPickerItemsEn);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("layout body"));
    feature.dispose();
  });

  it("accepts Place only at a direct layout-body boundary", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nlayout L {\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[7])
      .mockResolvedValueOnce(outputPrintPickerItemsEn[2]);
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
      .mockResolvedValueOnce(familyPickerItemsEn[7])
      .mockResolvedValueOnce(outputPrintPickerItemsEn[4]);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, outputPrintPickerItemsEn);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("top level"));
    feature.dispose();
  });

  it("uses the complete logical-statement boundary instead of splitting a multiline declaration", async () => {
    const source = "nui 1\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\n";
    const { editor, session } = sourceEditorFor(source, 1, 1);
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[7])
      .mockResolvedValueOnce(outputPrintPickerItemsEn[1]);
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
      .mockResolvedValueOnce(familyPickerItemsEn[2])
      .mockResolvedValueOnce(sourceCalculationMeasurementPickerItemsFor("en")[0]);
    mocks.insertCalculationMeasurementSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, sourceCalculationMeasurementPickerItemsFor("en"));
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
      .mockResolvedValueOnce(familyPickerItemsEn[2])
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
      .mockResolvedValueOnce(familyPickerItemsEn[3])
      .mockResolvedValueOnce(controlFlowPickerItemsEn[4]);
    mocks.insertControlFlowSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(
      2,
      controlFlowPickerItemsEn
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
      .mockResolvedValueOnce(familyPickerItemsEn[3])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertControlFlowSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[3])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return controlFlowPickerItemsEn[0];
      });
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertControlFlowSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("routes Value / Match through one fixed row picker in order and native snippet insertion", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[4])
      .mockResolvedValueOnce(valueMatchPickerItemsEn[4]);
    mocks.insertValueMatchSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(
      2,
      valueMatchPickerItemsEn
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
      .mockResolvedValueOnce(familyPickerItemsEn[4])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertValueMatchSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[4])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return valueMatchPickerItemsEn[0];
      });
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertValueMatchSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("routes Geometry Value through group, construction, and exclusive-form pickers", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const pointGroupItem = sourceGeometryValueGroupPickerItemsFor("en").find(({ id }) => id === "point")!;
    const pointGroup = pointGroupItem.group;
    const between = pointGroup.plans.find(({ construction }) => construction === "between")!;
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[1])
      .mockResolvedValueOnce(pointGroupItem)
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
      expect.objectContaining({ id: "point", label: "Point", group: pointGroup }),
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
    const pointGroupItem = sourceGeometryValueGroupPickerItemsFor("en").find(({ id }) => id === "point")!;
    const pointGroup = pointGroupItem.group;
    const between = pointGroup.plans.find(({ construction }) => construction === "between")!;
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[1])
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[1])
      .mockResolvedValueOnce(pointGroupItem)
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[1])
      .mockResolvedValueOnce(pointGroupItem)
      .mockResolvedValueOnce({ label: "between", plan: between })
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.insertGeometryValueSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects a stale Source after Geometry Value group selection before later picker work", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    const pointGroupItem = sourceGeometryValueGroupPickerItemsFor("en").find(({ id }) => id === "point")!;
    mocks.showQuickPick
      .mockResolvedValueOnce(familyPickerItemsEn[1])
      .mockImplementationOnce(async () => {
        document.version += 1;
        return pointGroupItem;
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
    mocks.showQuickPick.mockResolvedValueOnce(familyPickerItemsEn[0]);
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
