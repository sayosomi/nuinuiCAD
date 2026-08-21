import { describe, expect, it } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";
import type { DslDiagnostic } from "../../src/dsl/dslTypes";
import {
  compilerDiagnosticsForState,
  toCompilerDiagnostic
} from "./compilerDiagnostics";

const diagnostic = (overrides: Partial<DslDiagnostic> = {}): DslDiagnostic => ({
  severity: "error",
  line: 1,
  column: 1,
  message: "production message",
  ...overrides
});

describe("VS Code compiler diagnostics adapter", () => {
  it("uses current-source production compiler errors", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: )\n";
    const document = AutomationDocument.fromSource(source);

    expect(compilerDiagnosticsForState(document.getSource(), document.getState())).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "引数「y」の値がありません。",
        code: "missing-attribute-value",
        source: "nuinuiCAD",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 }
        }
      })
    ]);
  });

  it("publishes non-gating bindingIssueDiagnostics after compiler diagnostics", () => {
    const source = "nui 4\nconst x: number = 1\nconst x: number = 2\n";
    const state = AutomationDocument.fromSource(source).getState();
    const diagnostics = compilerDiagnosticsForState(source, state);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((item) => item.code === "duplicate-binding")).toBe(true);
    expect(diagnostics.every((item) => item.severity === "error")).toBe(true);
  });

  it("maps severity, message, code, and source without rewriting production data", () => {
    expect(toCompilerDiagnostic("abc", diagnostic({ severity: "error", message: "そのまま", code: "E" }))).toEqual({
      severity: "error",
      message: "そのまま",
      code: "E",
      source: "nuinuiCAD",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
    });
    expect(toCompilerDiagnostic("abc", diagnostic({ severity: "warning", message: "warning" }))).toEqual({
      severity: "warning",
      message: "warning",
      source: "nuinuiCAD",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
    });
  });

  it("uses a single exact physical span", () => {
    expect(toCompilerDiagnostic("nui 4\npoint A", diagnostic({
      physicalSpan: { segments: [{ from: 6, to: 11 }], sourceRevision: 1 },
      exactSpanOnly: true
    }))).toMatchObject({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }
    });
  });

  it("uses the first valid segment for an exact multi-segment span", () => {
    expect(toCompilerDiagnostic("abc\ndef", diagnostic({
      physicalSpan: {
        segments: [
          { from: -1, to: 0 },
          { from: 4, to: 5 }
        ],
        sourceRevision: 1
      },
      exactSpanOnly: true
    }))).toMatchObject({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }
    });
  });

  it("drops exact diagnostics without a usable physical span", () => {
    expect(toCompilerDiagnostic("abc", diagnostic({
      line: 1,
      column: 1,
      physicalSpan: { segments: [{ from: 20, to: 21 }], sourceRevision: 1 },
      exactSpanOnly: true
    }))).toBeNull();
  });

  it("falls back to a minimal legacy line/column range", () => {
    expect(toCompilerDiagnostic("abc\n日本語", diagnostic({ line: 2, column: 2 }))).toMatchObject({
      range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }
    });
    expect(toCompilerDiagnostic("abc\n日本語", diagnostic({ line: 2, column: 4 }))).toMatchObject({
      range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } }
    });
  });

  it("projects normalized CRLF offsets without shifting later lines", () => {
    const source = "nui 4\r\npoint 日本 = coordinate(x: 0, y: 1)\r\n";
    const normalized = source.replace(/\r\n/g, "\n");
    const from = normalized.indexOf("日本");
    expect(toCompilerDiagnostic(source, diagnostic({
      physicalSpan: { segments: [{ from, to: from + 2 }], sourceRevision: 1 },
      exactSpanOnly: true
    }))).toMatchObject({
      range: { start: { line: 1, character: 6 }, end: { line: 1, character: 8 } }
    });
  });

  it("keeps UTF-16 character positions for Japanese identifiers", () => {
    const source = "nui 4\nconst 日本: number = 1\n";
    const from = source.indexOf("日本");
    expect(toCompilerDiagnostic(source, diagnostic({
      physicalSpan: { segments: [{ from, to: from + 2 }], sourceRevision: 1 },
      exactSpanOnly: true
    }))).toMatchObject({
      range: { start: { line: 1, character: 6 }, end: { line: 1, character: 8 } }
    });
  });

  it("fails closed for invalid spans without throwing", () => {
    expect(() => toCompilerDiagnostic("abc", diagnostic({
      physicalSpan: { segments: [{ from: Number.NaN, to: Number.POSITIVE_INFINITY }], sourceRevision: 1 },
      exactSpanOnly: true
    }))).not.toThrow();
    expect(toCompilerDiagnostic("abc", diagnostic({
      physicalSpan: { segments: [{ from: Number.NaN, to: Number.POSITIVE_INFINITY }], sourceRevision: 1 },
      exactSpanOnly: true
    }))).toBeNull();
  });

  it("projects related ranges with CRLF/UTF-16 semantics and drops only invalid related entries", () => {
    const source = "nui 4\r\n😀required\r\n";
    const normalized = source.replace(/\r\n/g, "\n");
    const from = normalized.indexOf("required");
    const projected = toCompilerDiagnostic(source, diagnostic({
      physicalSpan: { segments: [{ from: 0, to: 5 }], sourceRevision: 1 },
      exactSpanOnly: true,
      relatedInformation: [
        {
          message: "invalid cause",
          physicalSpan: { segments: [{ from: 999, to: 1000 }], sourceRevision: 1 }
        },
        {
          message: "valid cause",
          physicalSpan: {
            segments: [{ from, to: from + "required".length }],
            sourceRevision: 1
          }
        }
      ]
    }));

    expect(projected).not.toBeNull();
    expect(projected?.message).toBe("production message");
    expect(projected?.relatedInformation).toEqual([
      {
        message: "valid cause",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 10 }
        }
      }
    ]);
  });

});
