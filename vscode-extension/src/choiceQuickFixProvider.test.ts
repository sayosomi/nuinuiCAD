import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  applyEdit: vi.fn()
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class Diagnostic {
    code?: string | number;
    source?: string;

    constructor(
      public readonly range: Range,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class CodeAction {
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
    command?: { command: string; title: string; arguments?: unknown[] };

    constructor(public readonly title: string, public readonly kind: string) {}
  }
  class WorkspaceEdit {
    readonly edits: Array<{ uri: unknown; range: Range; newText: string }> = [];

    replace(uri: unknown, range: Range, newText: string): void {
      this.edits.push({ uri, range, newText });
    }
  }
  return {
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      applyEdit: mocks.applyEdit
    },
    CodeActionKind: { QuickFix: "quickfix" },
    Position,
    Range,
    Diagnostic,
    CodeAction,
    WorkspaceEdit
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiChoiceQuickFixApplyHandler,
  createNuiChoiceQuickFixProvider,
  NUI_CHOICE_QUICK_FIX_APPLY_COMMAND,
  nuiChoiceQuickFixSelector
} from "./choiceQuickFixProvider";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => vscode.Position;
  setSourceText: (source: string) => void;
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (const match of source.matchAll(/\r?\n/g)) starts.push((match.index ?? 0) + match[0].length);
  return starts;
};

const documentFor = (
  source: string,
  fileName = "/tmp/pattern.nui",
  uri = `file://${fileName}`
): TestDocument => {
  let currentSource = source;
  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { scheme: uri.startsWith("file:") ? "file" : "untitled", toString: () => uri },
    getText: () => currentSource,
    positionAt: (offset) => {
      const starts = lineStartsFor(currentSource);
      const clampedOffset = Math.min(Math.max(offset, 0), currentSource.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      const lineStart = starts[line]!;
      const lineEnd = line + 1 < starts.length ? starts[line + 1]! : currentSource.length;
      const separatorLength = currentSource.slice(lineEnd - 2, lineEnd) === "\r\n" ? 2 : 1;
      const contentEnd = line + 1 < starts.length ? lineEnd - separatorLength : lineEnd;
      return new vscode.Position(line, Math.min(clampedOffset, contentEnd) - lineStart);
    },
    setSourceText: (nextSource) => { currentSource = nextSource; }
  };
  return document;
};

const diagnosticFor = (
  document: TestDocument,
  code = "invalid-choice-literal"
): vscode.Diagnostic => {
  const session = createLanguageAnalysisSession(document.getText());
  const compiler = session.getDiagnostics().find((diagnostic) => diagnostic.code === code);
  if (!compiler) throw new Error(`missing ${code} diagnostic`);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(
      new vscode.Position(compiler.range.start.line, compiler.range.start.character),
      new vscode.Position(compiler.range.end.line, compiler.range.end.character)
    ),
    compiler.message,
    0
  );
  diagnostic.code = compiler.code;
  diagnostic.source = compiler.source;
  return diagnostic;
};

const providerFor = (document: TestDocument) => {
  const session = createLanguageAnalysisSession(document.getText());
  const provider = createNuiChoiceQuickFixProvider(() => session);
  const apply = createNuiChoiceQuickFixApplyHandler(() => session);
  return { session, provider, apply };
};

const actionsFor = (
  document: TestDocument,
  diagnostics: vscode.Diagnostic[] = [diagnosticFor(document)]
) => {
  const { provider, ...rest } = providerFor(document);
  const actions = provider.provideCodeActions(
    document as unknown as vscode.TextDocument,
    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
    { diagnostics } as unknown as vscode.CodeActionContext,
    undefined as never
  ) as vscode.CodeAction[];
  return { actions, ...rest };
};

const payloadFor = (action: vscode.CodeAction): Record<string, unknown> => {
  if (!action.command || action.command.command !== NUI_CHOICE_QUICK_FIX_APPLY_COMMAND) {
    throw new Error("expected internal choice Quick Fix command");
  }
  return action.command.arguments?.[0] as Record<string, unknown>;
};

afterEach(() => {
  mocks.textDocuments.length = 0;
  mocks.applyEdit.mockReset();
  mocks.applyEdit.mockResolvedValue(true);
});

describe("VS Code choice Quick Fix provider", () => {
  it("uses the file-scoped selector and offers one action per valid const choice", () => {
    const document = documentFor("nui 4\nconst side: choice(left, right) = center\n");
    mocks.textDocuments.push(document);
    const { actions } = actionsFor(document);

    expect(nuiChoiceQuickFixSelector).toEqual({ language: "nui", scheme: "file" });
    expect(actions).toHaveLength(2);
    expect(actions.map((action) => action.title)).toEqual([
      '"left" に置き換え',
      '"right" に置き換え'
    ]);
    expect(actions.every((action) => action.kind === vscode.CodeActionKind.QuickFix)).toBe(true);
    expect(actions.every((action) => action.diagnostics?.length === 1)).toBe(true);
    expect(actions.every((action) => action.isPreferred === undefined)).toBe(true);
  });

  it("filters let recovery descriptors and prefers a single valid option", () => {
    const letDocument = documentFor("nui 4\nlet side: choice(left, right) = center\n");
    mocks.textDocuments.push(letDocument);
    const letActions = actionsFor(letDocument).actions;
    expect(letActions).toHaveLength(2);
    expect(letActions.every((action) => !action.title.includes("set"))).toBe(true);

    const singleDocument = documentFor("nui 4\nconst side: choice(left) = center\n");
    mocks.textDocuments.push(singleDocument);
    const singleActions = actionsFor(singleDocument).actions;
    expect(singleActions).toHaveLength(1);
    expect(singleActions[0]?.isPreferred).toBe(true);
  });

  it("does not attach actions to unrelated, wrong-code, or unsupported diagnostics", () => {
    const document = documentFor("nui 4\nconst side: choice(left, right) = center\n");
    mocks.textDocuments.push(document);
    const unrelated = new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 1)),
      "unrelated",
      0
    );
    unrelated.code = "other";
    unrelated.source = "nuinuiCAD";
    expect(actionsFor(document, [unrelated]).actions).toEqual([]);

    const wrongSource = diagnosticFor(document);
    wrongSource.source = "other";
    expect(actionsFor(document, [wrongSource]).actions).toEqual([]);

    const unsupported = documentFor(document.getText(), "/tmp/pattern.txt");
    mocks.textDocuments.push(unsupported);
    expect(actionsFor(unsupported).actions).toEqual([]);
  });

  it("does not repair an invalid choice on a set RHS in v1", () => {
    const document = documentFor([
      "nui 4",
      "let side: choice(left, right) = left",
      "set side = center"
    ].join("\n"));
    mocks.textDocuments.push(document);

    const session = createLanguageAnalysisSession(document.getText());
    const diagnostic = session.getDiagnostics().find((item) => item.code === "invalid-choice-literal");
    expect(diagnostic).toBeDefined();
    const vscodeDiagnostic = diagnosticFor(document);
    const provider = createNuiChoiceQuickFixProvider(() => session);
    expect(provider.provideCodeActions(
      document as unknown as vscode.TextDocument,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      { diagnostics: [vscodeDiagnostic] } as unknown as vscode.CodeActionContext,
      undefined as never
    )).toEqual([]);
  });

  it("applies only the invalid literal through a WorkspaceEdit", async () => {
    const source = "nui 4\nconst side: choice(left, right) = center\n";
    const document = documentFor(source);
    mocks.textDocuments.push(document);
    const { actions, apply } = actionsFor(document);
    const payload = payloadFor(actions[0]!);

    await apply(payload);

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    const edit = mocks.applyEdit.mock.calls[0]?.[0] as { edits: Array<{ range: vscode.Range; newText: string }> };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.newText).toBe("left");
    expect(edit.edits[0]?.range).toMatchObject({
      start: { line: 1, character: source.split("\n")[1]!.indexOf("center") },
      end: { line: 1, character: source.split("\n")[1]!.indexOf("center") + "center".length }
    });
  });

  it("fails closed for version, raw-source, expected-text, semantic, and descriptor staleness", async () => {
    const source = "nui 4\nconst side: choice(left, right) = center\n";

    const versionDocument = documentFor(source);
    mocks.textDocuments.push(versionDocument);
    const versionCase = actionsFor(versionDocument);
    versionDocument.version = 2;
    await versionCase.apply(payloadFor(versionCase.actions[0]!));

    const rawDocument = documentFor(source, "/tmp/raw.nui");
    mocks.textDocuments.push(rawDocument);
    const rawCase = actionsFor(rawDocument);
    rawDocument.setSourceText(source.replace("center", "other"));
    await rawCase.apply(payloadFor(rawCase.actions[0]!));

    const expectedDocument = documentFor(source, "/tmp/expected.nui");
    mocks.textDocuments.push(expectedDocument);
    const expectedCase = actionsFor(expectedDocument);
    const expectedPayload = payloadFor(expectedCase.actions[0]!);
    const expectedDescriptor = expectedPayload.descriptor as Record<string, unknown>;
    (expectedDescriptor.action as Record<string, unknown>).expectedOldText = "wrong";
    await expectedCase.apply(expectedPayload);

    const semanticDocument = documentFor(source, "/tmp/semantic.nui");
    mocks.textDocuments.push(semanticDocument);
    const semanticCase = actionsFor(semanticDocument);
    vi.spyOn(semanticCase.session, "choiceQuickFixSemanticSnapshot").mockReturnValue(undefined);
    await semanticCase.apply(payloadFor(semanticCase.actions[0]!));

    const descriptorDocument = documentFor(source, "/tmp/descriptor.nui");
    mocks.textDocuments.push(descriptorDocument);
    const descriptorCase = actionsFor(descriptorDocument);
    const current = descriptorCase.session.choiceQuickFixSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: 1
    });
    if (!current) throw new Error("expected current semantic snapshot");
    vi.spyOn(descriptorCase.session, "choiceQuickFixSemanticSnapshot").mockReturnValue({
      ...current,
      currentCompiled: { ...current.currentCompiled, diagnostics: [] }
    });
    await descriptorCase.apply(payloadFor(descriptorCase.actions[0]!));

    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("projects CRLF and UTF-16 ranges and only edits the payload URI", async () => {
    const normalized = [
      "nui 4",
      "# 😀 前置",
      "const 前身頃: choice(left, right) = center"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const document = documentFor(source, "/tmp/crlf.nui");
    const other = documentFor("nui 4\nconst other: choice(a, b) = c\n", "/tmp/other.nui");
    mocks.textDocuments.push(other, document);
    const { actions, apply } = actionsFor(document);

    await apply(payloadFor(actions[1]!));

    const edit = mocks.applyEdit.mock.calls[0]?.[0] as { edits: Array<{ uri: TestDocument["uri"]; range: vscode.Range; newText: string }> };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.uri).toBe(document.uri);
    expect(edit.edits[0]?.newText).toBe("right");
    expect(edit.edits[0]?.range.start).toEqual({ line: 2, character: "const 前身頃: choice(left, right) = ".length });
  });
});
