import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";
import { sourceEditSession } from "./sourceEditSession";

/**
 * Phase 2e integration performance guard. Unlike codemirrorFoundationCost.test.ts
 * (pure EditorState/pure-function costs), this drives the production
 * SourceEditorController: real EditorView transactions, evaluation decoration
 * updates, and store→controller model-patch reflection.
 *
 * Budgets (phase-2e doc): typing transaction median ≤16ms / p95 ≤32ms,
 * external 1-line model patch CM reflection median ≤16ms (CAD compile measured
 * separately), 1000-element commit median ≤300ms vs the ~222ms compile baseline.
 * The assertions below are deliberately looser than the budgets to keep CI
 * stable across machines; budget compliance is judged from the logged medians
 * on the development machine, and an over-budget local measurement must be
 * profiled and fixed even while these loose guards pass.
 */

const source = (count: number) => ["nui 3", ...Array.from({ length: count }, (_, index) =>
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
  expect(Number.isFinite(median)).toBe(true);
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

describe("Phase 2e source editor integration performance", () => {
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

  it("keeps controller typing transactions, model patches, and 1000-element commits within guard limits", () => {
    const store = useCadDocumentStore;

    for (const count of [500, 1000]) {
      store.setState(initialCadDocumentState());
      store.getState().commitText(source(count), "test");
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const controller = new SourceEditorController(parent);
      const internals = controller as unknown as ControllerInternals;

      // Publish a real evaluation so decoration updates run against populated indexes.
      controller.setEvaluation({
        evaluation: evaluateElements(store.getState().elements),
        compiledDocumentRevision: store.getState().compiledDocumentRevision,
        evaluationRequestRevision: 1
      });

      const typing = measure(`${count}行 controller typing transaction`, () => {
        const middle = internals.view.state.doc.line(Math.floor(internals.view.state.doc.lines / 2));
        internals.view.dispatch({
          changes: { from: middle.to, to: middle.to, insert: " " },
          userEvent: "input.type"
        });
      });
      expect(typing.median).toBeLessThan(64);
      expect(typing.p95).toBeLessThan(128);

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
      expect(patchWithController.median).toBeLessThan(1000);

      if (count === 1000) {
        // The 1000-element commit budget: the store-only patch commit above is the
        // full text commit cycle (serialize + parse + compile + reconcile).
        expect(patchWithoutController.median).toBeLessThan(1200);
      }
    }
  }, 120_000);
});
