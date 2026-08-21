import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class ParameterInformation {
    constructor(public readonly label: string | [number, number], public readonly documentation?: string) {}
  }
  class SignatureInformation {
    parameters: ParameterInformation[] = [];

    constructor(public readonly label: string, public readonly documentation?: string) {}
  }
  class SignatureHelp {
    signatures: SignatureInformation[] = [];
    activeSignature = 0;
    activeParameter = 0;
  }
  return {
    Position,
    ParameterInformation,
    SignatureInformation,
    SignatureHelp,
    env: { language: "en" }
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { queryDslSignatureHelp } from "../../src/dsl/dslSignatureHelpQuery";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiSignatureHelpProvider,
  nuiSignatureHelpSelector,
  nuiSignatureHelpTriggerCharacters
} from "./signatureHelpProvider";

type TestDocument = {
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
};

const documentFor = (
  source: string,
  fileName = "/tmp/pattern.nui",
  scheme = "file"
): TestDocument => ({
  fileName,
  uri: { scheme, toString: () => `${scheme}://${fileName}` },
  getText: () => source
});

const helpFor = (
  source: string,
  displayLanguage = "en",
  document = documentFor(source)
) => {
  return helpForAt(source, source.split("\n").length - 1, source.split("\n").at(-1)!.length, displayLanguage, document);
};

const helpForAt = (
  source: string,
  line: number,
  character: number,
  displayLanguage = "en",
  document = documentFor(source)
) => {
  const session = createLanguageAnalysisSession(source);
  const provider = createNuiSignatureHelpProvider(() => session, () => displayLanguage);
  return provider.provideSignatureHelp(
    document as vscode.TextDocument,
    new vscode.Position(line, character),
    undefined as never,
    undefined as never
  ) as vscode.SignatureHelp | undefined;
};

describe("VS Code native nui Signature Help provider", () => {
  it("uses the file-scoped selector and requested trigger characters", () => {
    expect(nuiSignatureHelpSelector).toEqual({ language: "nui", scheme: "file" });
    expect(nuiSignatureHelpTriggerCharacters).toEqual(["(", ",", ":"]);
  });

  it("projects a standard builtin Signature Help result with active overload and parameter", () => {
    const help = helpFor("nui 4\nconst value: number = round(1, ");

    expect(help?.signatures).toHaveLength(2);
    expect(help?.signatures.map((signature) => signature.label)).toEqual([
      "round(number) -> number",
      "round(number, number) -> number"
    ]);
    expect(help?.activeSignature).toBe(1);
    expect(help?.activeParameter).toBe(1);
    expect(help?.signatures[1]?.parameters[1]?.label).toEqual([14, 20]);
  });

  it("preserves named-only builtin parameters", () => {
    const help = helpFor("nui 4\nconst value: number = spreadAngle(length: ");

    expect(help?.signatures[0]?.label).toBe("spreadAngle(length: number, spread: number) -> number");
    expect(help?.activeParameter).toBe(0);
  });

  it("projects construction and mutation signatures without serializer arguments", () => {
    const construction = helpFor("nui 4\npoint P = coordinate(x: ");
    expect(construction?.signatures[0]?.label).toContain("coordinate(x?: number = 0, y?: number = 0");
    expect(construction?.signatures[0]?.label).not.toContain("id");
    expect(construction?.activeParameter).toBe(0);

    const mutation = helpFor("nui 4\nmove(targets: @P, ");
    expect(mutation?.signatures[0]?.label).toContain("targets:");
    expect(mutation?.signatures[0]?.label).not.toContain("targets: line");
    expect(mutation?.signatures[0]?.label).not.toContain("parent");
    expect(mutation?.activeParameter).toBe(mutation?.signatures[0]?.parameters.length);
  });

  it("projects exact Module defaults, optionality, and choices", () => {
    const source = [
      "nui 4",
      "module M(value: number, side?: choice(left, right), count: number = 2) {",
      "}",
      "instance Use = M(value: 1, ",
      ")"
    ].join("\n");
    const help = helpForAt(source, 3, source.split("\n")[3]!.length);

    expect(help?.signatures[0]?.label).toContain("value: number");
    expect(help?.signatures[0]?.label).toContain("side?: choice(left, right)");
    expect(help?.signatures[0]?.label).toContain("count: number = 2");
    expect(help?.activeParameter).toBe(help?.signatures[0]?.parameters.length);
  });

  it("localizes signature documentation and falls back to English", () => {
    const source = "nui 4\npoint P = coordinate(";
    expect(helpFor(source, "ja-JP")?.signatures[0]?.documentation).toBe("座標に点を作成します。");
    expect(helpFor(source, "ja")?.signatures[0]?.parameters[0]?.documentation).toBe("点のX座標です。");
    expect(helpFor(source, "en")?.signatures[0]?.documentation).toBe("Creates a point at coordinates.");
    expect(helpFor(source, "fr-FR")?.signatures[0]?.documentation).toBe("Creates a point at coordinates.");
  });

  it("projects unknown active parameters outside the active signature", () => {
    const cases = [
      helpFor("nui 4\nconst value: number = spreadAngle(length: 100, "),
      helpFor("nui 4\nconst value: number = spreadAngle(typo: "),
      helpFor("nui 4\nconst value: number = round(1, 2, ")
    ];

    for (const help of cases) {
      const activeSignature = help?.signatures[help.activeSignature ?? 0];
      expect(help?.activeParameter).toBe(activeSignature?.parameters.length);
      expect(help?.activeParameter).not.toBe(0);
    }
  });

  it("presents canonical construction defaults and boolean choices", () => {
    const help = helpFor("nui 4\nline L = offset(sources: ");
    const label = help?.signatures[0]?.label ?? "";

    expect(label).toContain("closed?: boolean = false");
    expect(label).toContain("[true / false]");
  });

  it("presents callable and active-parameter documentation from the catalog", () => {
    const segment = helpFor("nui 4\nline L = segment(start: ");
    expect(segment?.signatures[0]?.documentation).toBe("Creates a line segment.");
    expect(segment?.signatures[0]?.parameters[0]?.documentation).toBe("Start point of the segment.");

    const offset = helpFor("nui 4\nline L = offset(sources: @Base, closed: ");
    expect(offset?.signatures[0]?.documentation).toBe("Creates an offset line.");
    expect(offset?.activeParameter).toBe(3);
    expect(offset?.signatures[0]?.parameters[3]?.documentation).toBe("Whether the offset result is closed.");
  });

  it("supports incomplete and nested calls, selecting the innermost callable", () => {
    expect(helpFor("nui 4\nconst value: number = abs(")?.signatures[0]?.label).toBe("abs(number) -> number");
    expect(helpFor("nui 4\nconst value: number = round(abs(")?.signatures[0]?.label).toBe("abs(number) -> number");
  });

  it("gates non-file and non-nui documents", () => {
    const source = "nui 4\nconst value: number = abs(";
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiSignatureHelpProvider(() => session, () => "en");
    const position = new vscode.Position(1, source.split("\n")[1]!.length);

    expect(provider.provideSignatureHelp(documentFor(source, "/tmp/pattern.txt") as vscode.TextDocument, position, undefined as never, undefined as never)).toBeUndefined();
    expect(provider.provideSignatureHelp(documentFor(source, "/tmp/pattern.nui", "untitled") as vscode.TextDocument, position, undefined as never, undefined as never)).toBeUndefined();
  });

  it("does not expose stale Module semantic snapshots", () => {
    const source = "nui 4\nmodule M(value: number) {\n}\ninstance Use = M(value: 1)";
    const session = createLanguageAnalysisSession(source);
    const snapshot = { normalizedSource: source, sourceRevision: session.getSourceRevision() };
    session.replaceSource("nui 4\nmodule Other(value: number) {\n}\ninstance Use = Other(value: 1)");

    expect(session.signatureHelpSemanticSnapshot(snapshot)).toBeUndefined();
    expect(queryDslSignatureHelp({ source: snapshot, position: source.length, semantic: undefined })).toBeNull();
  });
});
