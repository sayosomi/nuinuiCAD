import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { lineSplicesToSourceTextChanges } from "./lineSpliceChanges";

const source = (count: number) => ["nui 3", ...Array.from({ length: count }, (_, index) =>
  `point P${index} = coordinate(x: ${index}, y: ${index + 1})`
)].join("\n");

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

const measure = (name: string, run: () => void) => {
  run();
  const durations: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    run();
    durations.push(performance.now() - started);
  }
  const value = median(durations);
  console.log(`[CodeMirror Phase 2a perf] ${name}: median=${value.toFixed(2)}ms (7 runs, warm-up)`);
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeLessThan(1000);
  return value;
};

describePerformanceGates("CodeMirror Phase 2a performance baseline", () => {
  it("records 500/1000-line state creation, transaction, and LineSplice conversion separately from compile", () => {
    for (const count of [500, 1000]) {
      const text = source(count);
      measure(`${count} lines EditorState.create`, () => {
        EditorState.create({ doc: text });
      });
      const state = EditorState.create({ doc: text });
      const middle = state.doc.line(Math.floor(state.doc.lines / 2));
      measure(`${count} lines one transaction`, () => {
        state.update({ changes: { from: middle.to, to: middle.to, insert: " " } });
      });
      measure(`${count} lines one LineSplice conversion`, () => {
        lineSplicesToSourceTextChanges(text, [{
          startLine: Math.floor((count + 2) / 2),
          endLine: Math.floor((count + 2) / 2),
          replacementLines: ["point Changed = coordinate(x: 1 y: 2)"]
        }]);
      });
    }
    const compileText = source(1000);
    measure("1000 elements compileDslDocument", () => {
      const compiled = compileDslDocument(compileText);
      if (!compiled.document) throw new Error("benchmark fixture must compile");
    });
  }, 20_000);
});
