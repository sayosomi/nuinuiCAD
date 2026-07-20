import { describe, expect, it } from "vitest";
import { buildTextPatch } from "../document/textPatch";
import { compileDslDocument, serializeDocumentToDsl, type CompiledDslDocument, type DslDocumentData } from "./dslDocument";

const ELEMENT_COUNT = 1_000;
const MEASURED_RUNS = 3;
const EXTREME_REGRESSION_LIMIT_MS = 5_000;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const measureMedian = (name: string, measure: () => void) => {
  measure(); // warm-up is deliberately outside the three measured runs.
  const durations: number[] = [];
  for (let run = 0; run < MEASURED_RUNS; run += 1) {
    const startedAt = performance.now();
    measure();
    durations.push(performance.now() - startedAt);
  }
  const value = median(durations);
  console.log(`[DSL v2 perf] ${name}: median=${value.toFixed(2)}ms (${MEASURED_RUNS} runs, warm-up excluded)`);
  expect(Number.isFinite(value)).toBe(true);
  // This only catches pathological, seconds-long regressions; it is not a
  // machine-independent performance guarantee.
  expect(value).toBeLessThan(EXTREME_REGRESSION_LIMIT_MS);
  return value;
};

const verticalPointLines = (index: number) => [
  `point P${index} = coordinate(`,
  `  x: ${index}`,
  `  y: ${index + 1}`,
  "  visible: true",
  "  enabled: true",
  "  vars: [local: 1]",
  ")",
];

const fixtureSource = () => ["nui 2", ...Array.from({ length: ELEMENT_COUNT }, (_, index) => verticalPointLines(index))
  .flat()].join("\n");

const complete = (source: string) => {
  const compiled = compileDslDocument(source);
  if (!compiled.document || !compiled.statementMap) throw new Error("performance fixture must compile");
  return compiled as CompiledDslDocument & { document: DslDocumentData; statementMap: NonNullable<CompiledDslDocument["statementMap"]> };
};

const changedMiddleElement = (document: DslDocumentData): DslDocumentData => ({
  ...document,
  elements: document.elements.map((element, index) =>
    index === Math.floor(ELEMENT_COUNT / 2) ? { ...element, enabled: false } : element
  ),
});

describe("DSL v2 large-document performance sanity", () => {
  it("measures compile, full serialize, and one-element patch separately", () => {
    const source = fixtureSource();
    expect(source.split("\n")).toHaveLength(ELEMENT_COUNT * 7 + 1);
    const compiled = complete(source);
    const afterDocument = changedMiddleElement(compiled.document);

    measureMedian("1000 elements / ~8000 lines compileDslDocument", () => {
      complete(source);
    });
    measureMedian("1000 elements full serializeDocumentToDsl", () => {
      serializeDocumentToDsl(compiled.document);
    });
    measureMedian("1000 elements one-element buildTextPatch", () => {
      const patch = buildTextPatch({ old: compiled, newDocument: afterDocument });
      if (patch.length !== 1) throw new Error(`expected one splice, received ${patch.length}`);
    });
  }, 20_000);
});
