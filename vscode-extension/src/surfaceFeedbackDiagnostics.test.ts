import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: null as null | {
    entries: Map<string, readonly unknown[]>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  },
  provider: null as null | { provideTextDocumentContent: (uri: { toString: () => string }) => string },
  registration: { dispose: vi.fn() }
}));

vi.mock("vscode", () => {
  class Uri {
    private constructor(private readonly value: string) {}
    static parse(value: string) { return new Uri(value); }
    toString() { return this.value; }
  }
  class Range {
    readonly start: { line: number; character: number };
    readonly end: { line: number; character: number };
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }
  class Diagnostic {
    source?: string;
    code?: string | number;
    constructor(
      public readonly range: Range,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class EventEmitter {
    event = vi.fn();
    fire = vi.fn(() => undefined);
    dispose = vi.fn();
  }
  const collection = {
    entries: new Map<string, readonly unknown[]>(),
    set: vi.fn((uri: Uri, diagnostics: readonly unknown[]) => collection.entries.set(uri.toString(), diagnostics)),
    delete: vi.fn((uri: Uri) => collection.entries.delete(uri.toString())),
    clear: vi.fn(() => collection.entries.clear()),
    dispose: vi.fn()
  };
  mocks.collection = collection;
  return {
    Uri,
    Range,
    Diagnostic,
    EventEmitter,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    languages: { createDiagnosticCollection: vi.fn(() => collection) },
    workspace: {
      registerTextDocumentContentProvider: vi.fn((_scheme: string, provider: typeof mocks.provider) => {
        mocks.provider = provider;
        return mocks.registration;
      })
    }
  };
});

import { SurfaceFeedbackDiagnostics } from "./surfaceFeedbackDiagnostics";

const publication = (
  surface: "canvas" | "outputPreview",
  presentationId: number,
  diagnostics: readonly { id: string; severity: "error" | "warning" | "info"; message: string }[]
) => ({ type: "surfaceDiagnosticsPublication" as const, surface, documentVersion: 5, presentationId, diagnostics });

describe("session scoped surface Problems", () => {
  beforeEach(() => {
    mocks.collection?.entries.clear();
    mocks.provider = null;
    mocks.registration.dispose.mockReset();
  });

  it("registers one virtual read-only provider and gives each session a navigable resource", () => {
    const feedback = new SurfaceFeedbackDiagnostics();
    const canvas = feedback.createSession("canvas", "file:///a.nui");
    const output = feedback.createSession("outputPreview", "file:///a.nui");
    const diagnostic = { id: "stale", severity: "warning" as const, message: "Canvas geometry is stale" };

    expect(canvas.uri.toString()).not.toBe(output.uri.toString());
    expect(feedback.accept(canvas, publication("canvas", 1, [diagnostic]))).toBe(true);
    const problems = mocks.collection?.entries.get(canvas.uri.toString()) as Array<{
      source: string;
      message: string;
      range: { start: { line: number }; end: { line: number } };
    }>;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ source: "nuinuiCAD / Canvas", message: diagnostic.message });
    expect(problems[0]?.range).toMatchObject({ start: { line: 2 }, end: { line: 2 } });
    expect(mocks.provider?.provideTextDocumentContent(canvas.uri)).toContain(diagnostic.message);
    expect(mocks.provider?.provideTextDocumentContent(canvas.uri).split("\n")[2]).toContain(diagnostic.message);
    expect(mocks.provider?.provideTextDocumentContent(output.uri)).toBe("No current surface diagnostics.");
    feedback.dispose();
  });

  it("replaces resolved problems and preserves other documents and surfaces", () => {
    const feedback = new SurfaceFeedbackDiagnostics();
    const canvasA = feedback.createSession("canvas", "file:///a.nui");
    const canvasB = feedback.createSession("canvas", "file:///b.nui");
    const outputA = feedback.createSession("outputPreview", "file:///a.nui");
    feedback.accept(canvasA, publication("canvas", 1, [{ id: "one", severity: "error", message: "first" }]));
    feedback.accept(canvasB, publication("canvas", 1, [{ id: "two", severity: "warning", message: "second" }]));
    feedback.accept(outputA, publication("outputPreview", 1, [{ id: "three", severity: "info", message: "third" }]));

    expect(feedback.accept(canvasA, publication("canvas", 2, []))).toBe(true);
    expect(mocks.collection?.entries.has(canvasA.uri.toString())).toBe(false);
    expect(mocks.collection?.entries.get(canvasB.uri.toString())).toHaveLength(1);
    expect(mocks.collection?.entries.get(outputA.uri.toString())).toHaveLength(1);
    feedback.disposeSession(canvasB);
    expect(mocks.collection?.entries.has(canvasB.uri.toString())).toBe(false);
    expect(mocks.collection?.entries.has(outputA.uri.toString())).toBe(true);
    feedback.dispose();
  });

  it("accepts duplicate delivery idempotently, rejects older or conflicting presentations, and blocks late disposal", () => {
    const feedback = new SurfaceFeedbackDiagnostics();
    const session = feedback.createSession("outputPreview", "file:///a.nui");
    const current = publication("outputPreview", 8, [{ id: "warn", severity: "warning", message: "current" }]);
    expect(feedback.accept(session, current)).toBe(true);
    const writeCount = mocks.collection?.set.mock.calls.length;
    expect(feedback.accept(session, current)).toBe(true);
    expect(mocks.collection?.set.mock.calls).toHaveLength(writeCount);
    expect(feedback.accept(session, publication("outputPreview", 7, []))).toBe(false);
    expect(feedback.accept(session, publication("outputPreview", 8, []))).toBe(false);
    feedback.disposeSession(session);
    expect(feedback.accept(session, publication("outputPreview", 9, []))).toBe(false);
    expect(mocks.collection?.entries.has(session.uri.toString())).toBe(false);
    feedback.dispose();
  });
});
