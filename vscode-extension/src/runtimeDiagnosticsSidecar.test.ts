import { describe, expect, it } from "vitest";
import type { RuntimeScalarDiagnostic } from "../../src/scalars/runtimeScalarDiagnostics";
import type { VscodeRuntimeDiagnosticsPublication } from "../../src/vscode/runtimeDiagnosticsProtocol";
import { createRuntimeDiagnosticsSidecar } from "./runtimeDiagnosticsSidecar";

const diagnostic = (bindingId: string): RuntimeScalarDiagnostic => ({
  severity: "error",
  line: 2,
  column: 1,
  code: "division-by-zero",
  message: "runtime failure",
  exactSpanOnly: true,
  physicalSpan: { segments: [{ from: 6, to: 12 }], sourceRevision: 1 },
  origin: "runtime",
  bindingId,
  navigationTarget: { kind: "binding", bindingId }
});

const publication = (
  documentVersion: number,
  diagnostics: readonly RuntimeScalarDiagnostic[]
): VscodeRuntimeDiagnosticsPublication => ({
  type: "runtimeDiagnosticsPublication",
  documentVersion,
  diagnostics
});

describe("VS Code runtime diagnostics sidecar", () => {
  it("accepts only an exact-current document version and preserves the structured payload", () => {
    const sidecar = createRuntimeDiagnosticsSidecar();
    const diagnostics = [diagnostic("binding:1")];

    expect(sidecar.accept(7, publication(7, diagnostics))).toBe(true);
    expect(sidecar.snapshotFor(7)).toEqual({
      documentVersion: 7,
      diagnostics
    });
    expect(sidecar.snapshotFor(7)?.diagnostics).toBe(diagnostics);
  });

  it("ignores an old publication without replacing the last accepted current snapshot", () => {
    const sidecar = createRuntimeDiagnosticsSidecar();
    const currentDiagnostics = [diagnostic("binding:current")];
    sidecar.accept(8, publication(8, currentDiagnostics));

    expect(sidecar.accept(8, publication(7, [diagnostic("binding:stale")]))).toBe(false);
    expect(sidecar.snapshotFor(8)?.diagnostics).toBe(currentDiagnostics);
  });

  it("treats a current empty publication as clearing runtime diagnostics for that version", () => {
    const sidecar = createRuntimeDiagnosticsSidecar();
    sidecar.accept(9, publication(9, [diagnostic("binding:old")]));

    expect(sidecar.accept(9, publication(9, []))).toBe(true);
    expect(sidecar.snapshotFor(9)).toEqual({ documentVersion: 9, diagnostics: [] });
  });

  it("fails closed when the accepted snapshot is queried against a different current version", () => {
    const sidecar = createRuntimeDiagnosticsSidecar();
    sidecar.accept(10, publication(10, [diagnostic("binding:1")]));

    expect(sidecar.snapshotFor(11)).toBeNull();
  });

  it("clears synchronously on source-change or document-close invalidation", () => {
    const sidecar = createRuntimeDiagnosticsSidecar();
    sidecar.accept(12, publication(12, [diagnostic("binding:1")]));

    sidecar.clear();

    expect(sidecar.snapshotFor(12)).toBeNull();
  });
});
