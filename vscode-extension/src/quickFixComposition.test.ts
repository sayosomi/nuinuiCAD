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
import {
  createNuiChoiceQuickFixApplyHandler,
  createNuiChoiceQuickFixProvider,
  NUI_CHOICE_QUICK_FIX_APPLY_COMMAND
} from "./choiceQuickFixProvider";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => vscode.Position;
};

const documentFor = (source: string, fileName = "/tmp/composite.nui"): TestDocument => ({
  fileName,
  version: 1,
  uri: { scheme: "file", toString: () => `file://${fileName}` },
  getText: () => source,
  positionAt: (offset) => {
    const before = source.slice(0, offset);
    const lines = before.split(/\r?\n/);
    return new vscode.Position(lines.length - 1, lines.at(-1)?.length ?? 0);
  }
});

const vscodeDiagnosticFor = (
  document: TestDocument,
  session: ReturnType<typeof createLanguageAnalysisSession>,
  code: string
): vscode.Diagnostic => {
  const compiler = session.getDiagnostics().find((diagnostic) => diagnostic.code === code);
  if (!compiler) throw new Error(`missing ${code}`);
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

const actionsFor = (
  document: TestDocument,
  provider: vscode.CodeActionProvider,
  diagnostic: vscode.Diagnostic
): vscode.CodeAction[] => provider.provideCodeActions(
  document as unknown as vscode.TextDocument,
  diagnostic.range,
  { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext,
  undefined as never
) as vscode.CodeAction[];

afterEach(() => {
  mocks.textDocuments.length = 0;
  mocks.applyEdit.mockReset();
  mocks.applyEdit.mockResolvedValue(true);
});

describe("native Quick Fix composition", () => {
  it("publishes the localized typo hint and routes typo actions through the existing internal command", async () => {
    const source = "nui 4\npont P = coordinate(x: 0, y: 0)\n";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    mocks.textDocuments.push(document);

    const provider = createNuiChoiceQuickFixProvider(() => session);
    const diagnostic = vscodeDiagnosticFor(document, session, "unknown-dsl-keyword");
    expect(diagnostic.message).toContain("Did you mean 'point'?");

    const actions = actionsFor(document, provider, diagnostic);
    expect(actions.map((action) => action.title)).toEqual(["Change to 'point'"]);
    expect(actions[0]?.command?.command).toBe(NUI_CHOICE_QUICK_FIX_APPLY_COMMAND);

    const apply = createNuiChoiceQuickFixApplyHandler(() => session);
    await apply(actions[0]?.command?.arguments?.[0]);
    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
  });

  it("leaves existing Choice Quick Fix behavior intact", () => {
    const source = "nui 4\nconst side: choice(left, right) = center\n";
    const document = documentFor(source, "/tmp/choice.nui");
    const session = createLanguageAnalysisSession(source);
    mocks.textDocuments.push(document);

    const provider = createNuiChoiceQuickFixProvider(() => session);
    const diagnostic = vscodeDiagnosticFor(document, session, "invalid-choice-literal");
    const actions = actionsFor(document, provider, diagnostic);

    expect(actions.map((action) => action.title)).toEqual([
      '"left" に置き換え',
      '"right" に置き換え'
    ]);
    expect(actions.every((action) => action.command?.command === NUI_CHOICE_QUICK_FIX_APPLY_COMMAND)).toBe(true);
  });
});
