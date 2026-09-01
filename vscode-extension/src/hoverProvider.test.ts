import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class MarkdownString {
    isTrusted: boolean | { enabledCommands: readonly string[] } | undefined;
    constructor(public readonly value: string) {}
  }
  class Hover {
    constructor(public readonly contents: MarkdownString, public readonly range?: Range) {}
  }
  return { Position, Range, MarkdownString, Hover };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import type { EvaluationResult } from "../../src/types/geometry";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiHoverProvider,
  currentNuiHoverReferenceRange,
  nuiHoverReferenceCommandUri,
  nuiHoverRevealSourceReferenceCommand,
  nuiHoverSelector,
  type NuiHoverRevealSourceReferenceArgs,
  type NuiHoverRuntimeEvaluationService
} from "./hoverProvider";
import type { NuiRuntimeEvaluationSnapshot } from "./runtimeEvaluationService";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: vscode.Position) => number;
  positionAt: (offset: number) => vscode.Position;
  setSource: (source: string) => void;
};

const documentFor = (
  initialSource: string,
  fileName = "/tmp/pattern.nui",
  scheme = "file"
): TestDocument => {
  let source = initialSource;
  const positionAt = (offset: number): vscode.Position => {
    const clamped = Math.min(Math.max(offset, 0), source.length);
    const before = source.slice(0, clamped);
    const lines = before.split(/\r\n|\n/);
    return new vscode.Position(lines.length - 1, lines.at(-1)?.length ?? 0);
  };
  const offsetAt = (position: vscode.Position): number => {
    const lines = source.split(/\r\n|\n/);
    const line = Math.min(Math.max(position.line, 0), lines.length - 1);
    let offset = 0;
    for (let index = 0; index < line; index += 1) {
      offset += lines[index]!.length;
      offset += source.slice(offset, offset + 2) === "\r\n" ? 2 : 1;
    }
    return offset + Math.min(Math.max(position.character, 0), lines[line]!.length);
  };

  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { scheme, toString: () => `${scheme}://${fileName}` },
    getText: () => source,
    offsetAt,
    positionAt,
    setSource: (nextSource) => {
      source = nextSource;
      document.version += 1;
    }
  };
  return document;
};

const sourceSnapshotFor = (session: ReturnType<typeof createLanguageAnalysisSession>, source: string) => ({
  normalizedSource: source.replace(/\r\n/g, "\n"),
  sourceRevision: session.getSourceRevision()
});

const runtimeSnapshotFor = (
  session: ReturnType<typeof createLanguageAnalysisSession>,
  source: string,
  elementName = "A"
): NuiRuntimeEvaluationSnapshot => {
  const semantic = session.runtimeEvaluationSemanticSnapshot(sourceSnapshotFor(session, source));
  if (!semantic) throw new Error("expected current runtime semantic snapshot");
  const element = semantic.compiled.document.elements.find((candidate) => candidate.name === elementName);
  if (!element) throw new Error(`expected ${elementName} element`);
  const evaluation: EvaluationResult = {
    computedGeometry: new Map([[element.id, {
      kind: "point",
      elementId: element.id,
      name: element.name,
      x: 1,
      y: 2
    }]]),
    errors: [],
    warnings: [],
    evaluatedElementIds: new Set([element.id]),
    effectiveEnabledElementIds: new Set([element.id]),
    effectiveVisibleElementIds: new Set([element.id]),
    conditionInactiveElementIds: new Set()
  };
  return {
    proof: {
      documentKey: "file:///tmp/pattern.nui",
      documentVersion: 1,
      sourceRevision: semantic.sourceRevision,
      normalizedSource: semantic.sourceText,
      documentRevision: semantic.documentRevision,
      compiledDocumentRevision: semantic.compiledDocumentRevision
    },
    compiled: semantic.compiled,
    evaluation,
    source: "reference",
    rustEligible: false
  };
};

const tokenFor = (state = { cancelled: false }): vscode.CancellationToken => ({
  get isCancellationRequested() {
    return state.cancelled;
  },
  onCancellationRequested: vi.fn()
}) as unknown as vscode.CancellationToken;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe("VS Code native nui Hover provider", () => {
  it("uses the file-scoped nui selector", () => {
    expect(nuiHoverSelector).toEqual({ language: "nui", scheme: "file" });
  });

  it("resolves a semantic reference first and anchors shared geometry to the exact identifier range", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const snapshot = runtimeSnapshotFor(session, source);
    const evaluateCurrent = vi.fn(async () => snapshot);
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent } as NuiHoverRuntimeEvaluationService
    );
    const line = source.split("\n")[2]!;
    const referenceStart = line.indexOf("@A") + 1;

    const hover = await provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(2, referenceStart),
      tokenFor()
    ) as vscode.Hover | undefined;

    expect(evaluateCurrent).toHaveBeenCalledTimes(1);
    expect(hover?.range).toMatchObject({
      start: { line: 2, character: referenceStart },
      end: { line: 2, character: referenceStart + 1 }
    });
    const markdown = hover?.contents as vscode.MarkdownString | undefined;
    expect(markdown?.value).toContain("A · free point");
    expect(markdown?.value).toContain("**座標:** \\(1, 2\\)");
    expect(markdown?.isTrusted).toEqual({
      enabledCommands: [nuiHoverRevealSourceReferenceCommand]
    });
  });

  it("encodes only the internal source-reference command and rejects stale navigation proof", () => {
    const source = "nui 1\npoint Base = coordinate(x: 1, y: 2)";
    const document = documentFor(source);
    const from = source.indexOf("Base");
    const args: NuiHoverRevealSourceReferenceArgs = {
      documentUri: document.uri.toString(),
      documentVersion: document.version,
      from,
      to: from + "Base".length,
      expectedText: "Base"
    };
    const commandUri = nuiHoverReferenceCommandUri(args);
    const encodedArgs = commandUri.slice(commandUri.indexOf("?") + 1);

    expect(commandUri.startsWith(`command:${nuiHoverRevealSourceReferenceCommand}?`)).toBe(true);
    expect(JSON.parse(decodeURIComponent(encodedArgs))).toEqual([args]);
    expect(currentNuiHoverReferenceRange(document as vscode.TextDocument, args)).not.toBeNull();

    document.setSource(source.replace("Base", "Changed"));
    expect(currentNuiHoverReferenceRange(document as vscode.TextDocument, args)).toBeNull();
  });

  it("does not start runtime evaluation outside a geometry semantic target", async () => {
    const source = "nui 1\npoint A = coordinate(x: 1, y: 2)";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const evaluateCurrent = vi.fn();
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent } as unknown as NuiHoverRuntimeEvaluationService
    );

    const hover = await provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(1, 1),
      tokenFor()
    );

    expect(hover).toBeUndefined();
    expect(evaluateCurrent).not.toHaveBeenCalled();
  });

  it("returns exact semantic theme-role Hover text without runtime evaluation", async () => {
    const source = ["nui 1", "modifier Guide {", "  color: accent,", "}"].join("\n");
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const evaluateCurrent = vi.fn();
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent } as unknown as NuiHoverRuntimeEvaluationService
    );
    const start = source.indexOf("accent");

    const hover = await provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(2, start - source.lastIndexOf("\n", start) - 1),
      tokenFor()
    ) as vscode.Hover | undefined;

    expect((hover?.contents as vscode.MarkdownString).value).toBe(
      "Theme role: accent\n\nFollows the current Canvas theme. This is a semantic color preview, not a fixed color. Color picker changes aren't applied; use #RRGGBB for a fixed color."
    );
    expect(hover?.range).toMatchObject({
      start: { line: 2, character: "  color: ".length },
      end: { line: 2, character: "  color: accent".length }
    });
    expect(evaluateCurrent).not.toHaveBeenCalled();
  });

  it("excludes fixed colors, comments, strings, lookalikes, and unrelated identifiers from theme-role Hover", async () => {
    const source = [
      "nui 1",
      "// color: accent",
      'modifier "accent" {',
      '  color: "accent",',
      "}",
      "modifier Fixed {",
      "  color: #112233,",
      "}",
      "modifier Lookalike {",
      "  color: primary,",
      "}",
      "modifier Actual {",
      "  color: accent,",
      "}"
    ].join("\n");
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const evaluateCurrent = vi.fn();
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent } as unknown as NuiHoverRuntimeEvaluationService
    );
    const roleStart = source.lastIndexOf("accent");
    const quotedColorStart = source.indexOf('color: "accent"') + 'color: "'.length;
    const positions = [
      source.indexOf("accent"),
      source.indexOf("#112233") + 1,
      source.indexOf('"accent"') + 1,
      quotedColorStart,
      source.indexOf("primary")
    ];

    for (const offset of positions) {
      const before = source.slice(0, offset);
      const line = before.split("\n").length - 1;
      const character = offset - (before.lastIndexOf("\n") + 1);
      const hover = await provider.provideHover(
        document as vscode.TextDocument,
        new vscode.Position(line, character),
        tokenFor()
      );
      expect(hover).toBeUndefined();
    }

    const roleBefore = source.slice(0, roleStart);
    const roleHover = await provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(
        roleBefore.split("\n").length - 1,
        roleStart - (roleBefore.lastIndexOf("\n") + 1)
      ),
      tokenFor()
    );
    expect(roleHover).toBeDefined();
    expect(evaluateCurrent).not.toHaveBeenCalled();
  });

  it("shows Geometry unavailable only for a still-current semantic target", async () => {
    const source = "nui 1\npoint A = coordinate(x: 1, y: 2)";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent: vi.fn(async () => undefined) } as NuiHoverRuntimeEvaluationService
    );

    const hover = await provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(1, "point ".length),
      tokenFor()
    ) as vscode.Hover | undefined;

    const markdown = hover?.contents as vscode.MarkdownString | undefined;
    expect(markdown?.value).toContain("A · free point");
    expect(markdown?.value).toContain("Geometry unavailable");
  });

  it("returns no Hover when cancelled while a shared evaluation is in flight", async () => {
    const source = "nui 1\npoint A = coordinate(x: 1, y: 2)";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const pending = deferred<NuiRuntimeEvaluationSnapshot | undefined>();
    const cancellation = { cancelled: false };
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent: vi.fn(() => pending.promise) } as NuiHoverRuntimeEvaluationService
    );

    const result = provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(1, "point ".length),
      tokenFor(cancellation)
    );
    cancellation.cancelled = true;
    pending.resolve(runtimeSnapshotFor(session, source));

    expect(await result).toBeUndefined();
  });

  it("drops a completion when the TextDocument changes while evaluation is in flight", async () => {
    const source = "nui 1\npoint A = coordinate(x: 1, y: 2)";
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const pending = deferred<NuiRuntimeEvaluationSnapshot | undefined>();
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent: vi.fn(() => pending.promise) } as NuiHoverRuntimeEvaluationService
    );

    const result = provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(1, "point ".length),
      tokenFor()
    );
    const snapshot = runtimeSnapshotFor(session, source);
    document.setSource("nui 1\npoint C = coordinate(x: 3, y: 4)");
    pending.resolve(snapshot);

    expect(await result).toBeUndefined();
  });

  it("keeps identifier ranges exact for CRLF and Japanese names", async () => {
    const normalized = [
      "nui 1",
      "point 前身頃 = coordinate(x: 1, y: 2)",
      "point B = offset(from: @前身頃, dx: 1, dy: 0)"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const snapshot = runtimeSnapshotFor(session, source, "前身頃");
    const provider = createNuiHoverProvider(
      () => session,
      { evaluateCurrent: vi.fn(async () => snapshot) } as NuiHoverRuntimeEvaluationService
    );
    const line = normalized.split("\n")[2]!;
    const start = line.indexOf("前身頃");

    const hover = await provider.provideHover(
      document as vscode.TextDocument,
      new vscode.Position(2, start + 1),
      tokenFor()
    ) as vscode.Hover | undefined;

    expect(hover?.range).toMatchObject({
      start: { line: 2, character: start },
      end: { line: 2, character: start + "前身頃".length }
    });
  });
});
