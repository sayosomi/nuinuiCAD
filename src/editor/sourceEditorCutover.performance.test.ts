import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";
import { sourceEditSession } from "./sourceEditSession";

/**
 * Phase 2e integration scaling smoke regression. Unlike codemirrorFoundationCost.test.ts
 * (pure EditorState/pure-function costs), this drives the production
 * SourceEditorController: real EditorView transactions, evaluation decoration
 * updates, && store→controller model-patch reflection.
 *
 * The timings are logged for local profiling only. Normal correctness runs do
 * not use absolute wall-clock thresholds because Vitest worker contention,
 * garbage collection, JIT warm-up, && OS scheduling can vary substantially.
 */

const source = (count: number) => ["nui 1", ...Array.from({ length: count }, (_, index) =>
  `point P${index} = coordinate(x: ${index}, y: ${index + 1})`
)].join("\n");

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
  };
};

const RUNS = 21;

const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

const measure = (name: string, run: () => void, { runs = RUNS }: { runs?: number } = {}) => {
  run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    run();
    durations.push(performance.now() - started);
  }
  const { median, p95 } = stats(durations);
  console.log(
    `[Phase 2e perf] ${name}: median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms (${runs} runs, warm-up)`
  );
  return { median, p95 };
};

type ControllerInternals = {
  view: {
    state: {
      doc: { length: number; lines: number; line: (n: number) => { from: number; to: number } };
    };
    dispatch: (spec: unknown) => void;
  };
};

describePerformanceGates("Phase 2e source editor integration performance", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => []
    });
  });

  afterEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("handles controller transactions, model patches, and 1000-element commits as a scaling smoke test", () => {
    const store = useCadDocumentStore;

    for (const count of [500, 1000]) {
      store.setState(initialCadDocumentState());
      const sourceText = source(count);
      store.getState().commitText(sourceText, "test");
      expect(store.getState().sourceText).toBe(sourceText);
      expect(store.getState().elements).toHaveLength(count);
      expect(store.getState().elements[count - 1]?.name).toBe(`P${count - 1}`);
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const controller = new SourceEditorController(parent);
      const internals = controller as unknown as ControllerInternals;
      expect(internals.view.state.doc.lines).toBe(count + 1);

      // Publish a real evaluation so decoration updates run against populated indexes.
      controller.setEvaluation({
        evaluation: evaluateElements(store.getState().elements),
        compiledDocumentRevision: store.getState().compiledDocumentRevision,
        evaluationRequestRevision: 1
      });

      measure(`${count}行 controller typing transaction`, () => {
        const middle = internals.view.state.doc.line(Math.floor(internals.view.state.doc.lines / 2));
        internals.view.dispatch({
          changes: { from: middle.to, to: middle.to, insert: " " },
          userEvent: "input.type"
        });
      });

      // Commit the typing burst so external model patches are accepted.
      expect(sourceEditSession.flush("command")).toBe("flushed");

      const patchWithController = measure(`${count}行 external 1-line model patch (store+CM)`, () => {
        const elements = store.getState().elements;
        const middleElement = elements[Math.floor(elements.length / 2)];
        const patched = elements.map((element) =>
          element.id === middleElement.id
            ? { ...element, activity: element.activity === "disabled" ? "visible" as const : "disabled" as const }
            : element
        );
        const result = store.getState().commitDocumentChange({ elements: patched });
        if (result.status !== "applied") throw new Error(`patch rejected: ${JSON.stringify(result)}`);
      });

      controller.destroy();
      parent.remove();

      const patchWithoutController = measure(`${count}行 external 1-line model patch (store only)`, () => {
        const elements = store.getState().elements;
        const middleElement = elements[Math.floor(elements.length / 2)];
        const patched = elements.map((element) =>
          element.id === middleElement.id
            ? { ...element, activity: element.activity === "disabled" ? "visible" as const : "disabled" as const }
            : element
        );
        const result = store.getState().commitDocumentChange({ elements: patched });
        if (result.status !== "applied") throw new Error(`patch rejected: ${JSON.stringify(result)}`);
      });

      const cmReflection = Math.max(0, patchWithController.median - patchWithoutController.median);
      console.log(
        `[Phase 2e perf] ${count}行 model patch CM反映分 (差分): ${cmReflection.toFixed(2)}ms`
      );
    }
  }, 120_000);
});
