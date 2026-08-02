import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { currentDiagnosticsWithActions, type DiagnosticsExtensionSource } from "./sourceEditorDiagnosticsExtension";

let liveViews: EditorView[] = [];
afterEach(() => {
  for (const view of liveViews) view.destroy();
  liveViews = [];
});

const makeView = (doc: string) => {
  const view = new EditorView({ state: EditorState.create({ doc }) });
  liveViews.push(view);
  return view;
};

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
};

const baseSource = (compiled: ReturnType<typeof compile>, overrides: Partial<DiagnosticsExtensionSource> = {}): DiagnosticsExtensionSource => ({
  isComposing: () => false,
  hasPendingText: () => false,
  committedDiagnostics: () => compiled.diagnostics,
  runtimeDiagnostics: () => [],
  staleBaseline: () => [],
  upgradeDslMajorVersion: vi.fn(() => ({ status: "applied" }) as const),
  ...overrides
});

describe("currentDiagnosticsWithActions", () => {
  it("attaches an action for a fixable diagnostic, even though the error makes the compiled document non-last-good", () => {
    const source = ["nui 2", "const x: number = 1"].join("\n");
    const compiled = compile(source);
    // The version-gate error is itself what nulls `document`/`statementMap` -
    // this is the exact case that previously (before routing statements
    // through a fresh parseDsl instead of a last-good `doc`) silently
    // produced zero actions for every one of this module's target codes.
    expect(compiled.document).toBeNull();
    const view = makeView(source);
    const diagnostics = currentDiagnosticsWithActions(view, baseSource(compiled));
    const conflict = diagnostics.find((d) => d.message.includes("nui 3"));
    expect(conflict?.actions?.length).toBeGreaterThan(0);
  });

  it("passes the live deps through so a click on the resulting action still no-ops mid-composition", () => {
    const source = ["nui 2", "const x: number = 1"].join("\n");
    const compiled = compile(source);
    const view = makeView(source);
    let composing = false;
    const diagnostics = currentDiagnosticsWithActions(view, baseSource(compiled, { isComposing: () => composing }));
    const conflict = diagnostics.find((d) => d.message.includes("nui 3"));
    const action = conflict?.actions?.[0];
    expect(action).toBeTruthy();

    composing = true;
    action?.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("produces plain (action-less) diagnostics for an unrelated, non-fixable error", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "bogus statement here"].join("\n");
    const compiled = compile(source);
    const view = makeView(source);
    const diagnostics = currentDiagnosticsWithActions(view, baseSource(compiled));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => !d.actions || d.actions.length === 0)).toBe(true);
  });

  it("Task 48: merges a fresh runtime diagnostic in, positioned exactly, with no Quick Fix action", () => {
    const source = ["nui 3", "const x: number = 1"].join("\n");
    const compiled = compile(source);
    const view = makeView(source);
    const xOffset = source.indexOf("x:");
    const runtime = [{
      severity: "error" as const,
      line: 2,
      column: 7,
      message: "評価に失敗し無効化されています。",
      code: "poisoned-binding",
      origin: "runtime" as const,
      exactSpanOnly: true as const,
      physicalSpan: { segments: [{ from: xOffset, to: xOffset + 1 }], sourceRevision: 0 }
    }];
    const diagnostics = currentDiagnosticsWithActions(view, baseSource(compiled, { runtimeDiagnostics: () => runtime }));
    const runtimeResult = diagnostics.find((d) => d.message === "評価に失敗し無効化されています。");
    expect(runtimeResult).toBeDefined();
    expect(runtimeResult!.from).toBe(xOffset);
    expect(runtimeResult!.to).toBe(xOffset + 1);
    expect(runtimeResult!.actions ?? []).toHaveLength(0);
  });

  it("Task 48: drops (never mispositions) an exactSpanOnly diagnostic whose exact span never resolved", () => {
    const source = ["nui 3", "const x: number = 1"].join("\n");
    const compiled = compile(source);
    const view = makeView(source);
    const unresolved = [{
      severity: "error" as const,
      line: 2,
      column: 1,
      message: "位置解決に失敗しました。",
      code: "duplicate-binding",
      exactSpanOnly: true as const
      // No physicalSpan - simulates a failed logical->physical projection.
    }];
    const diagnostics = currentDiagnosticsWithActions(view, baseSource(compiled, { committedDiagnostics: () => unresolved }));
    expect(diagnostics.some((d) => d.message === "位置解決に失敗しました。")).toBe(false);
  });
});
