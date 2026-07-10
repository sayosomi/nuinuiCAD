import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type DslDocumentData } from "../dsl/dslDocument";
import { advanceShadow, type ShadowState } from "./shadowText";
import { assertReconcileSane, assertShadowEquivalent } from "./shadowTextAssert";

// O(n^3)退行検出用の緩い性能ガード。細かい性能目標ではなく、
// 1000要素コンパイルが秒単位を大きく超える状態に戻ったら落とす。

const buildLargeSource = (count: number): string => {
  const lines = ["nui 1"];
  for (let index = 0; index < count; index += 1) {
    lines.push(`point P${index} = (${index}, ${index % 97})`);
  }
  return lines.join("\n");
};

const buildExpressionSource = (count: number): string => {
  const lines = ["nui 1", "point P0 = (0, 0)"];
  for (let index = 1; index < count; index += 1) {
    lines.push(`point P${index} = (P${index - 1}.x + 1, P${index - 1}.y + 1)`);
  }
  return lines.join("\n");
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const measureMedian = (name: string, runs: number, measure: () => void) => {
  measure(); // warm-up
  const durations: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now();
    measure();
    durations.push(performance.now() - startedAt);
  }
  const value = median(durations);
  console.log(`[shadowText perf] ${name}: 中央値=${value.toFixed(2)}ms (${runs}回、warm-up後)`);
  return value;
};

const buildCommitFixture = (elementCount: number) => {
  const source = buildExpressionSource(elementCount);
  const compiled = compileDslDocument(source);
  if (!compiled.document) throw new Error("fixture must compile");
  const prev: ShadowState = { text: source, compiled };
  const afterDoc: DslDocumentData = {
    ...compiled.document,
    elements: compiled.document.elements.map((element, index) =>
      index === Math.floor(elementCount / 2) ? ({ ...element, locked: true } as typeof element) : element
    )
  };
  return { source, compiled, prev, afterDoc };
};

const measureCommitCost = (elementCount: number, runs: number) => {
  const { prev, afterDoc } = buildCommitFixture(elementCount);
  const prodMedian = measureMedian(`${elementCount}要素 advanceShadow prod相当`, runs, () => {
    advanceShadow(prev, afterDoc);
  });
  const devMedian = measureMedian(`${elementCount}要素 advanceShadow dev相当`, runs, () => {
    const next = advanceShadow(prev, afterDoc);
    assertShadowEquivalent(afterDoc, next.compiled.document);
    assertReconcileSane(prev.compiled, next.text, afterDoc);
  });
  return { prodMedian, devMedian };
};

describe("shadowText 大規模文書コミットコスト計測", () => {
  it("100/1000要素のcompileDslDocument中央値を報告し、1000要素のO(n^3)退行を検出する", () => {
    measureMedian("100要素 compileDslDocument", 3, () => {
      const compiled = compileDslDocument(buildLargeSource(100));
      if (!compiled.document) throw new Error("100 element fixture must compile");
    });
    const compile1000Median = measureMedian("1000要素 compileDslDocument", 3, () => {
      const compiled = compileDslDocument(buildLargeSource(1000));
      if (!compiled.document) throw new Error("1000 element fixture must compile");
    });

    expect(compile1000Median).toBeLessThan(2000);
  }, 20_000);

  it("1000要素 advanceShadow のprod/dev相当中央値を報告する", () => {
    measureCommitCost(1000, 3);
  }, 20_000);

  it("1000要素 serializeDocumentToDsl（式入り）の中央値を報告する", () => {
    const { compiled } = buildCommitFixture(1000);
    if (!compiled.document) throw new Error("fixture must compile");
    measureMedian("1000要素 serializeDocumentToDsl（式入り）", 3, () => {
      serializeDocumentToDsl(compiled.document!);
    });
  }, 20_000);
});
