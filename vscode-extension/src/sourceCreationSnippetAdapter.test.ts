import { beforeEach, describe, expect, it, vi } from "vitest";

type SnippetEvent =
  | { kind: "text"; text: string }
  | { kind: "tabstop"; index: number }
  | { kind: "placeholder"; text: string; index: number }
  | { kind: "choice"; index: number; choices: readonly string[] };

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  activeEditorListeners: new Set<(editor: unknown) => void>(),
  documentListeners: new Set<(event: { document: unknown }) => void>(),
  selectionListeners: new Set<(event: { textEditor: unknown; selections: readonly unknown[] }) => void>()
}));

vi.mock("vscode", () => {
  class SnippetString {
    public readonly events: SnippetEvent[] = [];
    public value = "";

    appendText(text: string): this {
      this.events.push({ kind: "text", text });
      this.value += text;
      return this;
    }

    appendTabstop(index: number): this {
      this.events.push({ kind: "tabstop", index });
      this.value += "$" + index;
      return this;
    }

    appendPlaceholder(text: string, index: number): this {
      this.events.push({ kind: "placeholder", text, index });
      this.value += "${" + index + ":" + text + "}";
      return this;
    }

    appendChoice(choices: readonly string[], index?: number): this {
      const tabstopIndex = index ?? 1;
      this.events.push({ kind: "choice", index: tabstopIndex, choices });
      this.value += "${" + tabstopIndex + "|" + choices.join(",") + "|}";
      return this;
    }
  }

  return {
    SnippetString,
    commands: { executeCommand: mocks.executeCommand },
    window: {
      onDidChangeActiveTextEditor: (listener: (editor: unknown) => void) => {
        mocks.activeEditorListeners.add(listener);
        return { dispose: () => mocks.activeEditorListeners.delete(listener) };
      },
      onDidChangeTextEditorSelection: (listener: (event: { textEditor: unknown; selections: readonly unknown[] }) => void) => {
        mocks.selectionListeners.add(listener);
        return { dispose: () => mocks.selectionListeners.delete(listener) };
      }
    },
    workspace: {
      onDidChangeTextDocument: (listener: (event: { document: unknown }) => void) => {
        mocks.documentListeners.add(listener);
        return { dispose: () => mocks.documentListeners.delete(listener) };
      }
    }
  };
}, { virtual: true });

import * as vscode from "vscode";
import {
  createSourceCreationSnippet,
  createSourceOutputTemplateSnippet,
  insertSourceCreationSnippet,
  insertSourceExtractSnippet,
  openNativeSourceSnippetPicker
} from "./sourceCreationSnippetAdapter";
import { sourceCreationTemplatePlanForLegacyCommand } from "../../src/commands/sourceCreationTemplatePlan";
import { materializeSourceCreationTemplate } from "../../src/commands/sourceCreationTemplateMaterializer";
import { sourceExtractTemplate } from "../../src/commands/sourceExtractTemplate";
import { sourceOutputTemplateSnippetFor } from "../../src/commands/sourceOutputTemplateCatalog";

beforeEach(() => {
  mocks.executeCommand.mockReset();
  mocks.activeEditorListeners.clear();
  mocks.documentListeners.clear();
  mocks.selectionListeners.clear();
});

const materializeLine = () => {
  const plan = sourceCreationTemplatePlanForLegacyCommand("addLine");
  expect(plan).not.toBeNull();
  const materialization = materializeSourceCreationTemplate(plan!, 0);
  expect(materialization).not.toBeNull();
  return materialization!;
};

const materializeFor = (commandId: string, formIndex = 0) => {
  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  expect(plan, commandId).not.toBeNull();
  const materialization = materializeSourceCreationTemplate(plan!, formIndex);
  expect(materialization, `${commandId} form ${formIndex}`).not.toBeNull();
  return materialization!;
};

describe("Source snippet adapter", () => {
  it("keeps Create Geometry on the existing dynamic snippet insertion adapter", () => {
    const snippet = createSourceCreationSnippet(materializeLine(), {
      prefixText: "\n  ",
      appendNewline: true
    }) as unknown as { value: string; events: SnippetEvent[] };

    expect(snippet).toBeInstanceOf(vscode.SnippetString);
    expect(snippet.value.startsWith("\n  line $1 = segment(")).toBe(true);
    expect(snippet.value.endsWith(")\n")).toBe(true);
    expect(snippet.events.filter((event) => event.kind === "tabstop").length).toBeGreaterThan(0);
  });

  it("preserves selected construction forms and transformation target tabstops", () => {
    const tangent = createSourceCreationSnippet(materializeFor("addLineTangentOffsetPoint", 1)) as unknown as { value: string };
    expect(tangent.value).toBe([
      "point $1 = tangentOffset(",
      "  line: $2,",
      "  base: $3,",
      "  curveSide: $4,",
      "  distance: $5",
      ")"
    ].join("\n"));
    expect(tangent.value).not.toContain("angle:");

    const joinedPath = createSourceCreationSnippet(materializeFor("addJoinedPath")) as unknown as { value: string };
    expect(joinedPath.value).toBe([
      "line $1 = join(",
      "  paths: $2,",
      "  closed: false",
      ")"
    ].join("\n"));

    const move = createSourceCreationSnippet(materializeFor("addMove")) as unknown as { value: string };
    expect(move.value).toMatch(/^move \$1\(/);
    expect(move.value).toContain("angleDeg: $5");
  });

  it("inserts one dynamic Create Geometry snippet at the requested position", async () => {
    const insertSnippet = vi.fn().mockResolvedValue(true);
    const editor = { insertSnippet } as unknown as vscode.TextEditor;
    const position = { line: 4, character: 7 } as vscode.Position;

    await expect(insertSourceCreationSnippet(editor, materializeLine(), position)).resolves.toBe(true);

    expect(insertSnippet).toHaveBeenCalledOnce();
    expect(insertSnippet.mock.calls[0]?.[1]).toBe(position);
    expect((insertSnippet.mock.calls[0]?.[0] as unknown as { value: string }).value).toContain("line $1 = segment(");
  });

  it("retains the Extract placeholder adapter for Create Geometry", () => {
    const insertSnippet = vi.fn().mockResolvedValue(true);
    const editor = { insertSnippet } as unknown as vscode.TextEditor;
    const position = { line: 1, character: 3 } as vscode.Position;

    insertSourceExtractSnippet(editor, sourceExtractTemplate(1), position);

    const snippet = insertSnippet.mock.calls[0]?.[0] as unknown as { value: string };
    expect(snippet.value).toContain("extract ${1:Extract}(");
    expect(snippet.value).toContain("${3:middle}: @${4:Cut1}..@${5:Cut2}");
    expect(insertSnippet).toHaveBeenCalledWith(snippet, position);
  });

  it("retains Output Preview choices and linked tabstops", () => {
    const snippet = createSourceOutputTemplateSnippet(sourceOutputTemplateSnippetFor("layout-print")) as unknown as { value: string };

    expect(snippet.value).toContain("layout $1 {");
    expect(snippet.value).toContain("layout: @$1,");
    expect(snippet.value).toContain("layers: [@$3],");
    expect(snippet.value).toContain("paper: ${4|a4,a3|}");
    expect(snippet.value).toContain("orientation: ${5|portrait,landscape|}");
    expect(snippet.value).toContain("overlap: $6,");
  });

  it("keeps standalone Print and SVG Output Preview forms complete", () => {
    const print = createSourceOutputTemplateSnippet(sourceOutputTemplateSnippetFor("print")) as unknown as { value: string };
    expect(print.value).toContain("layers: [@$3],");
    expect(print.value).toContain("paper: ${4|a4,a3|}");

    const svg = createSourceOutputTemplateSnippet(sourceOutputTemplateSnippetFor("svg")) as unknown as { value: string };
    expect(svg.value).toContain("layers: [@$3],");
    expect(svg.value).not.toContain("margin:");
  });

  it("uses VS Code's native nui snippet picker without supplying a custom snippet", async () => {
    const document = { version: 4 };
    const editor = { document, selections: [] } as unknown as vscode.TextEditor;
    mocks.executeCommand.mockResolvedValue(undefined);

    await openNativeSourceSnippetPicker(editor, 4);

    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith("editor.action.insertSnippet", { langId: "nui" });
    expect(mocks.activeEditorListeners.size).toBe(0);
    expect(mocks.documentListeners.size).toBe(0);
  });

  it("closes the native picker when the Source document changes while it is open", async () => {
    const document = { version: 7 };
    const editor = { document, selections: [] } as unknown as vscode.TextEditor;
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "editor.action.insertSnippet") {
        document.version += 1;
        for (const listener of mocks.documentListeners) listener({ document });
      }
    });

    await openNativeSourceSnippetPicker(editor, 7);

    expect(mocks.executeCommand).toHaveBeenNthCalledWith(1, "editor.action.insertSnippet", { langId: "nui" });
    expect(mocks.executeCommand).toHaveBeenNthCalledWith(2, "workbench.action.closeQuickOpen");
    expect(mocks.activeEditorListeners.size).toBe(0);
    expect(mocks.documentListeners.size).toBe(0);
  });

  it("closes the native picker if VS Code changes the active editor", async () => {
    const editor = { document: { version: 2 }, selections: [] } as unknown as vscode.TextEditor;
    const otherEditor = { document: { version: 1 } } as unknown as vscode.TextEditor;
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "editor.action.insertSnippet") {
        for (const listener of mocks.activeEditorListeners) listener(otherEditor);
      }
    });

    await openNativeSourceSnippetPicker(editor, 2);

    expect(mocks.executeCommand).toHaveBeenNthCalledWith(2, "workbench.action.closeQuickOpen");
    expect(mocks.activeEditorListeners.size).toBe(0);
    expect(mocks.documentListeners.size).toBe(0);
    expect(mocks.selectionListeners.size).toBe(0);
  });

  it("closes the native picker if the active caret or selection changes", async () => {
    const selection = {
      anchor: { line: 3, character: 2 },
      active: { line: 3, character: 7 }
    };
    const editor = {
      document: { version: 2 },
      selection,
      selections: [selection]
    } as unknown as vscode.TextEditor;
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "editor.action.insertSnippet") {
        for (const listener of mocks.selectionListeners) listener({
          textEditor: editor,
          selections: [{ anchor: { line: 4, character: 0 }, active: { line: 4, character: 0 } }]
        });
      }
    });

    await openNativeSourceSnippetPicker(editor, 2);

    expect(mocks.executeCommand).toHaveBeenNthCalledWith(2, "workbench.action.closeQuickOpen");
    expect(mocks.activeEditorListeners.size).toBe(0);
    expect(mocks.documentListeners.size).toBe(0);
    expect(mocks.selectionListeners.size).toBe(0);
  });

  it("does not launch a picker for an already stale document version", async () => {
    const editor = { document: { version: 3 }, selections: [] } as unknown as vscode.TextEditor;

    await openNativeSourceSnippetPicker(editor, 2);

    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(mocks.activeEditorListeners.size).toBe(0);
    expect(mocks.documentListeners.size).toBe(0);
  });
});
