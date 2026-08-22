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
      public message: string,
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
    env: { language: "en" },
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
  compilerDiagnosticsWithTypoSuggestions,
  createNuiTypoQuickFixApplyHandler,
  createNuiTypoQuickFixProvider,
  NUI_TYPO_QUICK_FIX_APPLY_COMMAND,
  nuiTypoQuickFixSelector
} from "./typoQuickFixProvider";

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
  fileName = "/tmp/typo.nui",
  uri = `file://${fileName}`
): TestDocument => {
  let currentSource = source;
  return {
    fileName,
    version: 1,
    uri: { scheme: uri.startsWith("file:") ? "file" : "untitled", toString: () => uri },
    getText: () => currentSource,
    positionAt: (offset) => {
      const starts = lineStartsFor(currentSource);
      const clampedOffset = Math.min(Math.max(offset, 0), currentSource.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      return new vscode.Position(line, clampedOffset - starts[line]!);
    },
    setSourceText: (nextSource) => { currentSource = nextSource; }
  };
};

const diagnosticFor = (
  document: TestDocument,
  code: string
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

const providerFor = (document: TestDocument, language = "en") => {
  const session = createLanguageAnalysisSession(document.getText());
  const provider = createNuiTypoQuickFixProvider(() => session, () => language);
  const apply = createNuiTypoQuickFixApplyHandler(() => session);
  return { session, provider, apply };
};

const actionsFor = (
  document: TestDocument,
  code: string,
  language = "en",
  diagnostics: vscode.Diagnostic[] = [diagnosticFor(document, code)]
) => {
  const { provider, ...rest } = providerFor(document, language);
  const actions = provider.provideCodeActions(
    document as unknown as vscode.TextDocument,
    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
    { diagnostics } as unknown as vscode.CodeActionContext,
    undefined as never
  ) as vscode.CodeAction[];
  return { actions, ...rest };
};

const payloadFor = (action: vscode.CodeAction): Record<string, unknown> => {
  if (!action.command || action.command.command !== NUI_TYPO_QUICK_FIX_APPLY_COMMAND) {
    throw new Error("expected internal typo Quick Fix command");
  }
  return action.command.arguments?.[0] as Record<string, unknown>;
};

afterEach(() => {
  mocks.textDocuments.length = 0;
  mocks.applyEdit.mockReset();
  mocks.applyEdit.mockResolvedValue(true);
});

describe("VS Code typo Quick Fix provider", () => {
  it("uses a file-backed selector and localized unique action without depending on diagnostic message", () => {
    const document = documentFor("nui 4\npont P = coordinate(x: 0, y: 0)\n");
    mocks.textDocuments.push(document);
    const diagnostic = diagnosticFor(document, "unknown-dsl-keyword");
    diagnostic.message = "localized or otherwise changed message";

    const en = actionsFor(document, "unknown-dsl-keyword", "en", [diagnostic]).actions;
    const ja = actionsFor(document, "unknown-dsl-keyword", "ja", [diagnostic]).actions;

    expect(nuiTypoQuickFixSelector).toEqual({ language: "nui", scheme: "file" });
    expect(en.map((action) => action.title)).toEqual(["Change to 'point'"]);
    expect(ja.map((action) => action.title)).toEqual(["「point」に変更"]);
    expect(en[0]?.isPreferred).toBe(true);
    expect(en[0]?.diagnostics).toEqual([diagnostic]);
  });

  it("returns every eligible candidate in query order and prefers none when multiple exist", () => {
    const source = [
      "nui 4",
      "const alpha: number = 1",
      "const alphi: number = 2",
      "const result: number = @alhpa"
    ].join("\n");
    const document = documentFor(source);
    mocks.textDocuments.push(document);

    const { actions } = actionsFor(document, "undefined-binding");

    expect(actions.map((action) => action.title)).toEqual([
      "Change to 'alpha'",
      "Change to 'alphi'"
    ]);
    expect(actions.every((action) => action.isPreferred === undefined)).toBe(true);
  });

  it("routes only by source, stable code, and exact range", () => {
    const document = documentFor("nui 4\npont P = coordinate(x: 0, y: 0)\n");
    mocks.textDocuments.push(document);

    const wrongSource = diagnosticFor(document, "unknown-dsl-keyword");
    wrongSource.source = "other";
    expect(actionsFor(document, "unknown-dsl-keyword", "en", [wrongSource]).actions).toEqual([]);

    const wrongCode = diagnosticFor(document, "unknown-dsl-keyword");
    wrongCode.code = "unknown-type";
    expect(actionsFor(document, "unknown-dsl-keyword", "en", [wrongCode]).actions).toEqual([]);

    const wrongRange = diagnosticFor(document, "unknown-dsl-keyword");
    wrongRange.range = new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 5));
    expect(actionsFor(document, "unknown-dsl-keyword", "en", [wrongRange]).actions).toEqual([]);
  });

  it("adds a localized diagnostic suffix only for a unique candidate", () => {
    const uniqueSource = "nui 4\npont P = coordinate(x: 0, y: 0)\n";
    const unique = createLanguageAnalysisSession(uniqueSource);
    const en = compilerDiagnosticsWithTypoSuggestions(uniqueSource, unique, "en")
      .find((diagnostic) => diagnostic.code === "unknown-dsl-keyword");
    const ja = compilerDiagnosticsWithTypoSuggestions(uniqueSource, unique, "ja")
      .find((diagnostic) => diagnostic.code === "unknown-dsl-keyword");
    expect(en?.message).toContain("Did you mean 'point'?");
    expect(ja?.message).toContain("「point」のことですか？");

    const multipleSource = [
      "nui 4",
      "const alpha: number = 1",
      "const alphi: number = 2",
      "const result: number = @alhpa"
    ].join("\n");
    const multiple = createLanguageAnalysisSession(multipleSource);
    const base = multiple.getDiagnostics().find((diagnostic) => diagnostic.code === "undefined-binding");
    const projected = compilerDiagnosticsWithTypoSuggestions(multipleSource, multiple, "en")
      .find((diagnostic) => diagnostic.code === "undefined-binding");
    expect(projected?.message).toBe(base?.message);
  });

  it("edits only the exact typo token, including inside an @ reference and CRLF document", async () => {
    const normalized = [
      "nui 4",
      "const seamAllowance: number = 10",
      "const result: number = @seamAlowance"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const document = documentFor(source, "/tmp/crlf.nui");
    mocks.textDocuments.push(document);
    const { actions, apply } = actionsFor(document, "undefined-binding");

    await apply(payloadFor(actions[0]!));

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    const edit = mocks.applyEdit.mock.calls[0]?.[0] as { edits: Array<{ range: vscode.Range; newText: string }> };
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.newText).toBe("seamAllowance");
    expect(edit.edits[0]?.range.start).toEqual({
      line: 2,
      character: "const result: number = @".length
    });
    expect(edit.edits[0]?.range.end).toEqual({
      line: 2,
      character: "const result: number = @seamAlowance".length
    });
  });

  it("fails closed for document version, raw source, source revision, diagnostic, range/text, and candidate staleness", async () => {
    const source = "nui 4\npont P = coordinate(x: 0, y: 0)\n";

    const versionDocument = documentFor(source, "/tmp/version.nui");
    mocks.textDocuments.push(versionDocument);
    const versionCase = actionsFor(versionDocument, "unknown-dsl-keyword");
    versionDocument.version = 2;
    await versionCase.apply(payloadFor(versionCase.actions[0]!));

    const rawDocument = documentFor(source, "/tmp/raw.nui");
    mocks.textDocuments.push(rawDocument);
    const rawCase = actionsFor(rawDocument, "unknown-dsl-keyword");
    rawDocument.setSourceText(source.replace("pont", "pomt"));
    await rawCase.apply(payloadFor(rawCase.actions[0]!));

    const revisionDocument = documentFor(source, "/tmp/revision.nui");
    mocks.textDocuments.push(revisionDocument);
    const revisionCase = actionsFor(revisionDocument, "unknown-dsl-keyword");
    const revisionPayload = payloadFor(revisionCase.actions[0]!);
    revisionPayload.sourceRevision = (revisionPayload.sourceRevision as number) + 1;
    await revisionCase.apply(revisionPayload);

    const diagnosticDocument = documentFor(source, "/tmp/diagnostic.nui");
    mocks.textDocuments.push(diagnosticDocument);
    const diagnosticCase = actionsFor(diagnosticDocument, "unknown-dsl-keyword");
    const semantic = diagnosticCase.session.completionSemanticSnapshot({
      normalizedSource: source,
      sourceRevision: diagnosticCase.session.getSourceRevision()
    });
    if (!semantic) throw new Error("expected semantic snapshot");
    vi.spyOn(diagnosticCase.session, "completionSemanticSnapshot").mockReturnValue({
      ...semantic,
      compiled: { ...semantic.compiled, diagnostics: [] }
    });
    await diagnosticCase.apply(payloadFor(diagnosticCase.actions[0]!));

    const tamperedDocument = documentFor(source, "/tmp/tampered.nui");
    mocks.textDocuments.push(tamperedDocument);
    const tamperedCase = actionsFor(tamperedDocument, "unknown-dsl-keyword");
    const rangePayload = payloadFor(tamperedCase.actions[0]!);
    (rangePayload.replacementRange as Record<string, number>).from += 1;
    await tamperedCase.apply(rangePayload);
    const textPayload = payloadFor(tamperedCase.actions[0]!);
    textPayload.expectedTypedText = "wrong";
    await tamperedCase.apply(textPayload);
    const candidatePayload = payloadFor(tamperedCase.actions[0]!);
    (candidatePayload.candidate as Record<string, unknown>).label = "not-canonical";
    await tamperedCase.apply(candidatePayload);

    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("ignores unsupported documents", () => {
    const document = documentFor("nui 4\npont P = coordinate(x: 0, y: 0)\n", "/tmp/typo.txt");
    mocks.textDocuments.push(document);
    expect(actionsFor(document, "unknown-dsl-keyword").actions).toEqual([]);
  });
});
