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
  code = "invalid-choice-literal",
  session = createLanguageAnalysisSession(document.getText())
): vscode.Diagnostic => {
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

  it("matches a Choice diagnostic by source, code, and range even when its message differs", async () => {
    const source = "nui 4\nconst side: choice(left, right) = center\n";
    const document = documentFor(source, "/tmp/context-message.nui");
    mocks.textDocuments.push(document);
    const compilerDiagnostic = diagnosticFor(document);
    const contextDiagnostic = new vscode.Diagnostic(
      compilerDiagnostic.range,
      "localized context message",
      0
    );
    contextDiagnostic.code = compilerDiagnostic.code;
    contextDiagnostic.source = compilerDiagnostic.source;

    const { actions, apply } = actionsFor(document, [contextDiagnostic]);
    expect(actions).toHaveLength(2);
    expect(payloadFor(actions[0]!).targetDiagnostic).not.toHaveProperty("message");

    await apply(payloadFor(actions[0]!));
    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
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

  it("offers the missing-declared-type skeleton without preferring it", async () => {
    const source = "nui 4\nlet width = 10\n";
    const document = documentFor(source, "/tmp/missing-type.nui");
    mocks.textDocuments.push(document);
    const { actions, apply } = actionsFor(document, [diagnosticFor(document, "missing-declared-type")]);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("型注釈 (: 型) を追加");
    expect(actions[0]?.isPreferred).toBeUndefined();
    const payload = payloadFor(actions[0]!);
    const descriptor = payload.descriptor as Record<string, unknown>;
    const action = descriptor.action as Record<string, unknown>;
    expect(descriptor.id).toMatch(/^missing-declared-type:/);
    expect(action).toMatchObject({
      from: "nui 4\nlet width".length,
      to: "nui 4\nlet width".length,
      insert: ": ",
      expectedOldText: ""
    });

    await apply(payload);

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    const edit = mocks.applyEdit.mock.calls[0]?.[0] as { edits: Array<{ range: vscode.Range; newText: string }> };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.newText).toBe(": ");
    expect(edit.edits[0]?.range).toMatchObject({
      start: { line: 1, character: "let width".length },
      end: { line: 1, character: "let width".length }
    });
    const insertion = action.from as number;
    expect(`${source.slice(0, insertion)}${edit.edits[0]?.newText}${source.slice(insertion)}`).toBe(
      "nui 4\nlet width:  = 10\n"
    );
  });

  it("offers a native category repair for a known construction mismatch", () => {
    const source = "nui 4\npoint P = segment(start: @A, end: @B)\n";
    const document = documentFor(source, "/tmp/category-mismatch.nui");
    mocks.textDocuments.push(document);
    const diagnostic = diagnosticFor(document, "construction-category-mismatch");
    const { actions } = actionsFor(document, [diagnostic]);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("Change category to 'line'");
    expect(actions[0]?.diagnostics).toEqual([diagnostic]);
    expect(actions[0]?.isPreferred).toBeUndefined();
    expect(payloadFor(actions[0]!)).toMatchObject({ targetCategory: "line" });
  });

  it("matches a category diagnostic by source, code, and range even when its message differs", () => {
    const source = "nui 4\npoint P = segment(start: @A, end: @B)\n";
    const document = documentFor(source, "/tmp/category-context-message.nui");
    mocks.textDocuments.push(document);
    const compilerDiagnostic = diagnosticFor(document, "construction-category-mismatch");
    const contextDiagnostic = new vscode.Diagnostic(
      compilerDiagnostic.range,
      "localized category mismatch",
      0
    );
    contextDiagnostic.code = compilerDiagnostic.code;
    contextDiagnostic.source = compilerDiagnostic.source;

    const { actions } = actionsFor(document, [contextDiagnostic]);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.diagnostics).toEqual([contextDiagnostic]);
  });

  it("preserves canonical order and never prefers multiple category repairs", () => {
    const source = "nui 4\narc P = offset(sources: [@A], distance: 2)\n";
    const document = documentFor(source, "/tmp/category-multiple.nui");
    mocks.textDocuments.push(document);
    const diagnostic = diagnosticFor(document, "construction-category-mismatch");
    const { actions } = actionsFor(document, [diagnostic]);

    expect(actions.map((action) => action.title)).toEqual([
      "Change category to 'point'",
      "Change category to 'line'"
    ]);
    expect(actions.every((action) => action.isPreferred === undefined)).toBe(true);
  });

  it("does not expose category repairs for wrong source or code", () => {
    const document = documentFor("nui 4\npoint P = segment(start: @A, end: @B)\n", "/tmp/category-context.nui");
    mocks.textDocuments.push(document);
    const matching = diagnosticFor(document, "construction-category-mismatch");

    const wrongCode = new vscode.Diagnostic(matching.range, matching.message, 0);
    wrongCode.code = "unknown-construction";
    wrongCode.source = "nuinuiCAD";
    expect(actionsFor(document, [wrongCode]).actions).toEqual([]);

    const wrongSource = new vscode.Diagnostic(matching.range, matching.message, 0);
    wrongSource.code = matching.code;
    wrongSource.source = "other";
    expect(actionsFor(document, [wrongSource]).actions).toEqual([]);
  });

  it("applies only the category token through the composed handler", async () => {
    const source = "nui 4\npoint P = segment(start: @A, end: @B)\n";
    const document = documentFor(source, "/tmp/category-apply.nui");
    mocks.textDocuments.push(document);
    const { actions, apply } = actionsFor(
      document,
      [diagnosticFor(document, "construction-category-mismatch")]
    );

    await apply(payloadFor(actions[0]!));

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    const edit = mocks.applyEdit.mock.calls[0]?.[0] as {
      edits: Array<{ range: vscode.Range; newText: string }>;
    };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.newText).toBe("line");
    expect(edit.edits[0]?.range).toMatchObject({
      start: { line: 1, character: 0 },
      end: { line: 1, character: "point".length }
    });
    const categoryFrom = source.indexOf("point");
    const categoryTo = categoryFrom + "point".length;
    expect(`${source.slice(0, categoryFrom)}${edit.edits[0]?.newText}${source.slice(categoryTo)}`).toBe(
      "nui 4\nline P = segment(start: @A, end: @B)\n"
    );
  });

  it("applies category repairs with the shared CRLF normalized/raw adapter", async () => {
    const normalized = [
      "nui 4",
      "// 😀 前置",
      "point P = segment(start: @A, end: @B)"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const document = documentFor(source, "/tmp/category-crlf.nui");
    mocks.textDocuments.push(document);
    const { actions, apply } = actionsFor(
      document,
      [diagnosticFor(document, "construction-category-mismatch")]
    );

    await apply(payloadFor(actions[0]!));

    const edit = mocks.applyEdit.mock.calls[0]?.[0] as {
      edits: Array<{ range: vscode.Range; newText: string }>;
    };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.newText).toBe("line");
    expect(edit.edits[0]?.range).toMatchObject({
      start: { line: 2, character: 0 },
      end: { line: 2, character: "point".length }
    });
  });

  it("fails closed for stale category payload state and non-current target categories", async () => {
    const source = "nui 4\npoint P = segment(start: @A, end: @B)\n";

    const versionDocument = documentFor(source, "/tmp/category-version.nui");
    mocks.textDocuments.push(versionDocument);
    const versionCase = actionsFor(versionDocument, [diagnosticFor(versionDocument, "construction-category-mismatch")]);
    versionDocument.version = 2;
    await versionCase.apply(payloadFor(versionCase.actions[0]!));

    const rawDocument = documentFor(source, "/tmp/category-raw.nui");
    mocks.textDocuments.push(rawDocument);
    const rawCase = actionsFor(rawDocument, [diagnosticFor(rawDocument, "construction-category-mismatch")]);
    rawDocument.setSourceText(source.replace("point", "arc"));
    await rawCase.apply(payloadFor(rawCase.actions[0]!));

    const semanticDocument = documentFor(source, "/tmp/category-semantic.nui");
    mocks.textDocuments.push(semanticDocument);
    const semanticCase = actionsFor(semanticDocument, [diagnosticFor(semanticDocument, "construction-category-mismatch")]);
    vi.spyOn(semanticCase.session, "choiceQuickFixSemanticSnapshot").mockReturnValue(undefined);
    await semanticCase.apply(payloadFor(semanticCase.actions[0]!));

    const missingDiagnosticDocument = documentFor(source, "/tmp/category-missing-diagnostic.nui");
    mocks.textDocuments.push(missingDiagnosticDocument);
    const missingDiagnosticCase = actionsFor(missingDiagnosticDocument, [diagnosticFor(missingDiagnosticDocument, "construction-category-mismatch")]);
    const missingCurrent = missingDiagnosticCase.session.choiceQuickFixSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: missingDiagnosticCase.session.getSourceRevision()
    });
    if (!missingCurrent) throw new Error("expected current semantic snapshot");
    vi.spyOn(missingDiagnosticCase.session, "choiceQuickFixSemanticSnapshot").mockReturnValue({
      ...missingCurrent,
      currentCompiled: { ...missingCurrent.currentCompiled, diagnostics: [] }
    });
    await missingDiagnosticCase.apply(payloadFor(missingDiagnosticCase.actions[0]!));

    const forgedDocument = documentFor(source, "/tmp/category-forged.nui");
    mocks.textDocuments.push(forgedDocument);
    const forgedCase = actionsFor(forgedDocument, [diagnosticFor(forgedDocument, "construction-category-mismatch")]);
    const forgedPayload = payloadFor(forgedCase.actions[0]!);
    forgedPayload.targetCategory = "point";
    await forgedCase.apply(forgedPayload);

    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("rejects a stale missing-declared-type descriptor through the composed provider", async () => {
    const source = "nui 4\nlet width = 10\n";
    const document = documentFor(source, "/tmp/missing-descriptor-payload.nui");
    mocks.textDocuments.push(document);
    const { actions, apply } = actionsFor(document, [diagnosticFor(document, "missing-declared-type")]);

    const payload = payloadFor(actions[0]!);
    const descriptor = payload.descriptor as Record<string, unknown>;
    (descriptor.action as Record<string, unknown>).expectedOldText = "stale";

    await apply(payload);

    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("routes the existing typo Quick Fix through the composed provider and apply handler", async () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @widht"
    ].join("\n");
    const document = documentFor(source, "/tmp/composed-typo.nui");
    const session = createLanguageAnalysisSession(source);
    mocks.textDocuments.push(document);
    const diagnostic = diagnosticFor(document, "undefined-binding", session);
    const provider = createNuiChoiceQuickFixProvider(() => session);
    const actions = provider.provideCodeActions(
      document as unknown as vscode.TextDocument,
      diagnostic.range,
      { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext,
      undefined as never
    ) as vscode.CodeAction[];

    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("Change to 'width'");
    expect(actions[0]?.diagnostics).toEqual([diagnostic]);
    expect(actions[0]?.command?.command).toBe(NUI_CHOICE_QUICK_FIX_APPLY_COMMAND);

    const apply = createNuiChoiceQuickFixApplyHandler(() => session);
    await apply(actions[0]?.command?.arguments?.[0]);

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    const edit = mocks.applyEdit.mock.calls[0]?.[0] as {
      edits: Array<{ range: vscode.Range; newText: string }>;
    };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.newText).toBe("width");
    expect(edit.edits[0]?.range).toMatchObject({
      start: { line: 2, character: "const result: number = @".length },
      end: { line: 2, character: "const result: number = @widht".length }
    });
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

  it("does not expose the missing-type action for wrong source/code or unsupported documents", () => {
    const document = documentFor("nui 4\nlet width = 10\n", "/tmp/missing-context.nui");
    mocks.textDocuments.push(document);
    const matching = diagnosticFor(document, "missing-declared-type");

    const wrongCode = new vscode.Diagnostic(matching.range, matching.message, 0);
    wrongCode.code = "other";
    wrongCode.source = "nuinuiCAD";
    expect(actionsFor(document, [wrongCode]).actions).toEqual([]);

    const wrongSource = new vscode.Diagnostic(matching.range, matching.message, 0);
    wrongSource.code = matching.code;
    wrongSource.source = "other";
    expect(actionsFor(document, [wrongSource]).actions).toEqual([]);

    const unsupported = documentFor(document.getText(), "/tmp/missing-context.txt");
    mocks.textDocuments.push(unsupported);
    expect(actionsFor(unsupported, [diagnosticFor(unsupported, "missing-declared-type")]).actions).toEqual([]);
  });

  it.each([
    ["scalar-type-mismatch", "nui 4\nlet x: number = \"hello\"\nlet y: number = 1\n"],
    ["unexpected-token", "nui 4\nlet x: number = 1 $\n"]
  ])("does not expose %s recovery descriptors as native actions", (code, source) => {
    const document = documentFor(source, `/tmp/${code}.nui`);
    mocks.textDocuments.push(document);
    expect(actionsFor(document, [diagnosticFor(document, code)]).actions).toEqual([]);
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

  it("fails closed for stale missing-declared-type payload state", async () => {
    const source = "nui 4\nlet width = 10\n";

    const versionDocument = documentFor(source, "/tmp/missing-version.nui");
    mocks.textDocuments.push(versionDocument);
    const versionCase = actionsFor(versionDocument, [diagnosticFor(versionDocument, "missing-declared-type")]);
    versionDocument.version = 2;
    await versionCase.apply(payloadFor(versionCase.actions[0]!));

    const rawDocument = documentFor(source, "/tmp/missing-raw.nui");
    mocks.textDocuments.push(rawDocument);
    const rawCase = actionsFor(rawDocument, [diagnosticFor(rawDocument, "missing-declared-type")]);
    rawDocument.setSourceText("nui 4\nlet width = 20\n");
    await rawCase.apply(payloadFor(rawCase.actions[0]!));

    const semanticDocument = documentFor(source, "/tmp/missing-semantic.nui");
    mocks.textDocuments.push(semanticDocument);
    const semanticCase = actionsFor(semanticDocument, [diagnosticFor(semanticDocument, "missing-declared-type")]);
    vi.spyOn(semanticCase.session, "choiceQuickFixSemanticSnapshot").mockReturnValue(undefined);
    await semanticCase.apply(payloadFor(semanticCase.actions[0]!));

    const descriptorDocument = documentFor(source, "/tmp/missing-descriptor.nui");
    mocks.textDocuments.push(descriptorDocument);
    const descriptorCase = actionsFor(descriptorDocument, [diagnosticFor(descriptorDocument, "missing-declared-type")]);
    const current = descriptorCase.session.choiceQuickFixSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: descriptorCase.session.getSourceRevision()
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
      "// 😀 前置",
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
