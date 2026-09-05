import { describe, expect, it, vi } from "vitest";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor
} from "./languageAnalysisSession";

const sourceSnapshotFor = (source: string, sourceRevision: number) => ({
  normalizedSource: source.replace(/\r\n/g, "\n"),
  sourceRevision
});

const validSource = "nui 1\npoint A = coordinate(x: 0, y: 1)\n";
const fatalSource = "nui 1\npoint A = coordinate(";

describe("VS Code document-scoped language analysis session", () => {
  it("is a thin host composition over one package session", () => {
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    const session = createLanguageAnalysisSession(validSource);
    const diagnostics = vi.spyOn(session, "diagnostics");

    session.getDiagnostics();
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(session.completion(validSource.length)).toBeDefined();
    expect(session.documentSymbols().length).toBeGreaterThan(0);
    expect(currentCompiledSemanticSnapshotFor(session, sourceSnapshotFor(validSource, session.getSourceRevision()))).toMatchObject({
      sourceText: validSource,
      sourceRevision: session.getSourceRevision()
    });

    const surfaceNames = [
      ...Object.keys(session),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(session))
    ];
    expect(surfaceNames.filter((name) => /(SemanticSnapshot|RecoverySnapshot|SyntaxSnapshot)$/.test(name))).toEqual([]);
    expect(fromSource).toHaveBeenCalledTimes(1);
  });

  it("owns exact-current structured runtime diagnostics inside the host session", () => {
    const session = createLanguageAnalysisSession(validSource);
    const diagnostics = [{
      severity: "error" as const,
      line: 2,
      column: 1,
      code: "geometry-builtin-target-unavailable",
      message: "runtime failure",
      exactSpanOnly: true as const,
      physicalSpan: { segments: [{ from: 6, to: 7 }], sourceRevision: 1 },
      origin: "runtime" as const,
      bindingId: "binding:runtime",
      navigationTarget: { kind: "binding" as const, bindingId: "binding:runtime" },
      runtimeContext: { kind: "geometryBuiltinTarget" as const, targetElementId: "Target", pointKey: "center" }
    }];

    expect(session.acceptRuntimeDiagnostics(3, {
      type: "runtimeDiagnosticsPublication",
      documentVersion: 3,
      diagnostics
    })).toBe(true);
    expect(session.runtimeDiagnosticsSnapshotFor(3)?.diagnostics).toBe(diagnostics);
  });

  it("rejects stale runtime publications and clears the runtime layer on source change", () => {
    const session = createLanguageAnalysisSession(validSource);
    const diagnostics = [{
      severity: "error" as const,
      line: 2,
      column: 1,
      code: "runtime-test",
      message: "runtime failure",
      exactSpanOnly: true as const,
      physicalSpan: { segments: [{ from: 6, to: 7 }], sourceRevision: 1 },
      origin: "runtime" as const,
      bindingId: "binding:runtime",
      navigationTarget: { kind: "binding" as const, bindingId: "binding:runtime" }
    }];
    expect(session.acceptRuntimeDiagnostics(5, {
      type: "runtimeDiagnosticsPublication",
      documentVersion: 5,
      diagnostics
    })).toBe(true);
    expect(session.acceptRuntimeDiagnostics(5, {
      type: "runtimeDiagnosticsPublication",
      documentVersion: 4,
      diagnostics: []
    })).toBe(false);

    session.replaceSource("nui 1\npoint B = coordinate(x: 0, y: 1)\n");
    expect(session.runtimeDiagnosticsSnapshotFor(5)).toBeNull();
  });

  it("uses direct package diagnostics and source lifecycle while keeping the semantic snapshot source-proofed", () => {
    const session = createLanguageAnalysisSession(fatalSource);
    expect(session.getDiagnostics().length).toBeGreaterThan(0);

    session.replaceSource(validSource);
    expect(session.getSource()).toBe(validSource);
    expect(session.getDiagnostics()).toEqual([]);

    const current = sourceSnapshotFor(validSource, session.getSourceRevision());
    expect(currentCompiledSemanticSnapshotFor(session, current)).toMatchObject({
      sourceText: validSource,
      sourceRevision: current.sourceRevision,
      compiled: expect.any(Object)
    });
    expect(currentCompiledSemanticSnapshotFor(session, sourceSnapshotFor(validSource, current.sourceRevision + 1))).toBeUndefined();
    expect(currentCompiledSemanticSnapshotFor(session, sourceSnapshotFor("nui 1\npoint Other = coordinate(x: 0, y: 1)\n", current.sourceRevision))).toBeUndefined();
  });
});
