import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class SnippetString {
    constructor(public readonly value: string) {}
  }
  class MarkdownString {
    isTrusted: boolean | { enabledCommands: readonly string[] } = false;
    supportHtml = false;
    constructor(public readonly value = "") {}
  }
  class CompletionItem {
    detail?: string;
    documentation?: MarkdownString;
    range?: Range;
    insertText?: string | SnippetString;
    constructor(public readonly label: string, public readonly kind: number) {}
  }
  class ParameterInformation {
    constructor(public readonly label: string | [number, number], public readonly documentation?: string | MarkdownString) {}
  }
  class SignatureInformation {
    parameters: ParameterInformation[] = [];
    constructor(public readonly label: string, public readonly documentation?: string | MarkdownString) {}
  }
  class SignatureHelp {
    signatures: SignatureInformation[] = [];
    activeSignature = 0;
    activeParameter = 0;
  }
  return {
    CompletionItemKind: {
      Keyword: 1,
      Function: 2,
      Property: 3,
      Variable: 4,
      Reference: 5,
      Module: 6,
      Value: 7,
      Operator: 8
    },
    Position,
    Range,
    SnippetString,
    MarkdownString,
    CompletionItem,
    ParameterInformation,
    SignatureInformation,
    SignatureHelp,
    env: { language: "en" }
  };
// @ts-expect-error Vitest supports virtual-module mocking.
}, { virtual: true });

import * as vscode from "vscode";
import type { DslCompletionQueryResult } from "@nuinuicad/nui-language";
import type { DslSignatureHelpQueryResult } from "@nuinuicad/nui-language";
import { projectDslCompletionItems } from "./completionProvider";
import { projectDslSignatureHelp } from "./signatureHelpProvider";

const documentation = {
  variants: [
    { locale: "ja", markdown: "**日本語**" },
    { locale: "en", markdown: "**English**" }
  ]
};

describe("VS Code Module documentation projection", () => {
  it("uses exact authored locale then English without base-language fallback", () => {
    const result = {
      context: { kind: "moduleCallee", from: 0, to: 1 },
      category: "moduleCallee",
      replacementRange: { from: 0, to: 1 },
      candidates: [{ kind: "module", label: "M", documentation }]
    } as unknown as DslCompletionQueryResult;

    const exact = projectDslCompletionItems("M", result, "ja")[0]!.documentation as vscode.MarkdownString;
    const regional = projectDslCompletionItems("M", result, "ja-JP")[0]!.documentation as vscode.MarkdownString;

    expect(exact.value).toBe("**日本語**");
    expect(regional.value).toBe("**English**");
    expect(exact.isTrusted).toBe(false);
    expect(exact.supportHtml).toBe(false);
  });

  it("projects authored Module and parameter docs as untrusted Markdown", () => {
    const result: DslSignatureHelpQueryResult = {
      signatures: [{
        identity: "module:m",
        name: "M",
        callingStyle: "module",
        documentation: { key: "signatureHelp.module" },
        authoredDocumentation: documentation,
        parameters: [{
          identity: "module:m:0",
          name: "value",
          optional: false,
          documentation: { key: "signatureHelp.module.parameter" },
          authoredDocumentation: documentation
        }]
      }],
      activeSignature: 0,
      activeParameter: 0
    };

    const help = projectDslSignatureHelp(result, "ja");
    const callable = help.signatures[0]!.documentation as vscode.MarkdownString;
    const parameter = help.signatures[0]!.parameters[0]!.documentation as vscode.MarkdownString;

    expect(callable.value).toBe("**日本語**");
    expect(parameter.value).toBe("**日本語**");
    expect(callable.isTrusted).toBe(false);
    expect(callable.supportHtml).toBe(false);
    expect(parameter.isTrusted).toBe(false);
    expect(parameter.supportHtml).toBe(false);
  });
});
