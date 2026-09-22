import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  language: "en",
  activeTextEditor: null as TestEditor | null,
  writable: true,
  collectExtract: vi.fn(),
  collectInline: vi.fn(),
  geometryTarget: vi.fn(),
  coordinateAvailable: vi.fn()
}));

vi.mock("vscode", () => {
  class CodeAction {
    command?: { title: string; command: string; arguments?: unknown[] };

    constructor(public readonly title: string, public readonly kind: string) {}
  }
  return {
    env: {
      get language() {
        return mocks.language;
      }
    },
    window: {
      get activeTextEditor() {
        return mocks.activeTextEditor;
      }
    },
    workspace: {
      fs: {
        isWritableFileSystem: () => mocks.writable
      }
    },
    CodeActionKind: {
      Refactor: "refactor",
      RefactorExtract: "refactor.extract",
      RefactorInline: "refactor.inline",
      RefactorRewrite: "refactor.rewrite",
      QuickFix: "quickfix"
    },
    CodeAction
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

vi.mock("./extractModuleCommandFeature", () => ({
  collectExtractModuleSourceTargets: mocks.collectExtract,
  VSCODE_EXTRACT_MODULE_COMMAND_ID: "nuinuiCAD.extractModule"
}));

vi.mock("./inlineModuleCommandFeature", () => ({
  collectInlineModuleSourceTargets: mocks.collectInline,
  VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID: "nuinuiCAD.inlineModuleInstance"
}));

vi.mock("./geometryReferenceRetargetCommandFeature", () => ({
  geometryReferenceRetargetTargetForEditor: mocks.geometryTarget,
  VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID: "nuinuiCAD.replaceGeometryReferences"
}));

import * as vscode from "vscode";
import {
  createNuiRefactorCodeActionProvider,
  nuiRefactorCodeActionKinds,
  nuiRefactorCodeActionSelector
} from "./refactorCodeActionProvider";

type TestDocument = {
  languageId: string;
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
};

type TestEditor = {
  document: TestDocument;
  selection: { active: { line: number; character: number } };
};

const documentFor = (
  fileName = "/tmp/refactor.nui",
  scheme = "file",
  languageId = "nui"
): TestDocument => ({
  languageId,
  fileName,
  uri: { scheme, toString: () => `${scheme}://${fileName}` },
  getText: () => "nui 1\n"
});

const editorFor = (document: TestDocument): TestEditor => ({
  document,
  selection: { active: { line: 1, character: 0 } }
});

const providerFor = (language = "en") => {
  mocks.language = language;
  return createNuiRefactorCodeActionProvider({
    languageAnalysisSessionFor: vi.fn(() => ({}) as never),
    coordinatePointConversionFeature: {
      sourceTargetAvailableForEditor: mocks.coordinateAvailable
    }
  });
};

const actionsFor = async (
  provider: vscode.CodeActionProvider,
  document: TestDocument,
  only?: string
) => provider.provideCodeActions(
  document as unknown as vscode.TextDocument,
  undefined as never,
  { only: only as unknown as vscode.CodeActionKind } as vscode.CodeActionContext,
  undefined as never
) as Promise<readonly vscode.CodeAction[]>;

afterEach(() => {
  mocks.language = "en";
  mocks.activeTextEditor = null;
  mocks.writable = true;
  mocks.collectExtract.mockReset();
  mocks.collectInline.mockReset();
  mocks.geometryTarget.mockReset();
  mocks.coordinateAvailable.mockReset();
  mocks.collectExtract.mockReturnValue({ targets: [] });
  mocks.collectInline.mockReturnValue({ targets: [] });
  mocks.geometryTarget.mockReturnValue(null);
  mocks.coordinateAvailable.mockResolvedValue(false);
});

describe("VS Code Refactor Code Action provider", () => {
  it("uses the file-backed selector and the three concrete provided child kinds", () => {
    expect(nuiRefactorCodeActionSelector).toEqual({ language: "nui", scheme: "file" });
    expect(nuiRefactorCodeActionKinds).toEqual([
      "refactor.extract",
      "refactor.inline",
      "refactor.rewrite"
    ]);
  });

  it("projects all five canonical Source transformations with localized titles and commands", async () => {
    const document = documentFor();
    mocks.activeTextEditor = editorFor(document);
    mocks.collectExtract.mockReturnValue({ targets: ["statement"] });
    mocks.collectInline.mockReturnValue({ targets: ["module-instance"] });
    mocks.geometryTarget.mockReturnValue({ candidates: [] });
    mocks.coordinateAvailable.mockResolvedValue(true);

    const english = await actionsFor(providerFor("en"), document);
    expect(english.map((action) => [action.title, action.kind, action.command?.command])).toEqual([
      ["Extract Module", "refactor.extract", "nuinuiCAD.extractModule"],
      ["Inline Module Instance", "refactor.inline", "nuinuiCAD.inlineModuleInstance"],
      ["nuinuiCAD: Replace Geometry References", "refactor.rewrite", "nuinuiCAD.replaceGeometryReferences"],
      ["XY Offset…", "refactor.rewrite", "nuinuiCAD.convertPointToXYOffset"],
      ["Angle-Distance Offset…", "refactor.rewrite", "nuinuiCAD.convertPointToAngleDistanceOffset"]
    ]);
    expect(english.every((action) => action.edit === undefined)).toBe(true);

    const japanese = await actionsFor(providerFor("ja"), document);
    expect(japanese.map((action) => action.title)).toEqual([
      "Moduleを抽出",
      "Module instanceをインライン化",
      "nuinuiCAD: ジオメトリ参照を置換",
      "XYオフセット…",
      "角度と距離のオフセット…"
    ]);
    expect(mocks.collectExtract).toHaveBeenCalledWith(mocks.activeTextEditor, expect.any(Function));
    expect(mocks.collectInline).toHaveBeenCalledWith(mocks.activeTextEditor, expect.any(Function));
    expect(mocks.geometryTarget).toHaveBeenCalledWith(mocks.activeTextEditor, expect.anything());
    expect(mocks.coordinateAvailable).toHaveBeenCalledWith(mocks.activeTextEditor);
  });

  it("only exposes actions whose canonical current Source targets are eligible", async () => {
    const document = documentFor();
    mocks.activeTextEditor = editorFor(document);
    mocks.collectExtract.mockReturnValue({ targets: ["statement"] });
    mocks.collectInline.mockReturnValue({ targets: [] });
    mocks.geometryTarget.mockReturnValue(null);
    mocks.coordinateAvailable.mockResolvedValue(false);

    const actions = await actionsFor(providerFor(), document);
    expect(actions.map((action) => action.command?.command)).toEqual(["nuinuiCAD.extractModule"]);
  });

  it("respects Refactor, Extract, Inline, Rewrite, and unrelated context.only requests", async () => {
    const document = documentFor();
    mocks.activeTextEditor = editorFor(document);
    mocks.collectExtract.mockReturnValue({ targets: ["statement"] });
    mocks.collectInline.mockReturnValue({ targets: ["module-instance"] });
    mocks.geometryTarget.mockReturnValue({ candidates: [] });
    mocks.coordinateAvailable.mockResolvedValue(true);
    const provider = providerFor();

    expect((await actionsFor(provider, document, "refactor")).map((action) => action.kind)).toEqual([
      "refactor.extract",
      "refactor.inline",
      "refactor.rewrite",
      "refactor.rewrite",
      "refactor.rewrite"
    ]);
    expect((await actionsFor(provider, document, "refactor.extract")).map((action) => action.command?.command))
      .toEqual(["nuinuiCAD.extractModule"]);
    expect((await actionsFor(provider, document, "refactor.inline")).map((action) => action.command?.command))
      .toEqual(["nuinuiCAD.inlineModuleInstance"]);
    expect((await actionsFor(provider, document, "refactor.rewrite")).map((action) => action.command?.command))
      .toEqual([
        "nuinuiCAD.replaceGeometryReferences",
        "nuinuiCAD.convertPointToXYOffset",
        "nuinuiCAD.convertPointToAngleDistanceOffset"
      ]);
    expect(await actionsFor(provider, document, "quickfix")).toEqual([]);
  });

  it("fails closed for unsupported, read-only, and non-current Source contexts", async () => {
    const supported = documentFor();
    const provider = providerFor();

    mocks.activeTextEditor = editorFor(supported);
    mocks.writable = false;
    expect(await actionsFor(provider, supported)).toEqual([]);

    mocks.writable = true;
    expect(await actionsFor(provider, documentFor("/tmp/refactor.txt"))).toEqual([]);
    expect(await actionsFor(provider, documentFor("/tmp/refactor.nui", "untitled"))).toEqual([]);
    expect(await actionsFor(provider, documentFor("/tmp/refactor.nui", "file", "plaintext"))).toEqual([]);

    const otherDocument = documentFor("/tmp/other.nui");
    mocks.activeTextEditor = editorFor(otherDocument);
    expect(await actionsFor(provider, supported)).toEqual([]);
  });
});
