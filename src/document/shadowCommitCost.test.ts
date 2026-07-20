import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type DslDocumentData } from "../dsl/dslDocument";
import { advanceShadow, type ShadowState } from "./shadowText";
import { assertReconcileSane, assertShadowEquivalent } from "./shadowTextAssert";

// O(n^3)退行検出用の緩い性能ガード。細かい性能目標ではなく、
// 1000要素コンパイルが秒単位を大きく超える状態に戻ったら落とす。

const buildExpressionSource = (count: number): string => {
  const lines = ["nui 2", "point P0 = coordinate(x: 0 y: 0)"];
  for (let index = 1; index < count; index += 1) {
    lines.push(`point P${index} = coordinate(x: P${index - 1}.x + 1 y: P${index - 1}.y + 1)`);
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
      index === Math.floor(elementCount / 2) ? ({ ...element, enabled: !element.enabled } as typeof element) : element
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
  it("250/1000要素のcompileDslDocument中央値を報告し、規模比からO(n^2)/O(n^3)退行を検出する", () => {
    // 無名・無参照(buildLargeSource)ではなく、要素間参照を持つ
    // buildExpressionSource を使う。参照なしの文書は名前解決コストがほぼ
    // ゼロになり、resolveElementName系のO(n^2)/O(n^3)退行を検出できない
    // (このファイル自体が過去にそれで実文書の退行を見逃した反省)。
    const compile250Median = measureMedian("250要素 compileDslDocument(参照あり)", 3, () => {
      const compiled = compileDslDocument(buildExpressionSource(250));
      if (!compiled.document) throw new Error("250 element fixture must compile");
    });
    const compile1000Median = measureMedian("1000要素 compileDslDocument(参照あり)", 3, () => {
      const compiled = compileDslDocument(buildExpressionSource(1000));
      if (!compiled.document) throw new Error("1000 element fixture must compile");
    });

    // 絶対ms値ではなく、要素数を4倍(250→1000)にした際の所要時間の倍率で
    // 計算量オーダーの退行を検知する: 線形なら約4倍、O(n^2)なら約16倍、
    // O(n^3)なら約64倍。4倍という大きな規模差を取ることで、マシン差・GC・
    // JITノイズによる数倍程度の測定ブレと、真のO(n^2)以上の退行(16倍以上)を
    // 区別できる。現行実装は要素生成時のmakeUniqueElementName(こちらは
    // 今回のスコープ外の別のO(n^2)要因)により素の線形(4倍)より高い
    // 実測比(概ね10倍前後)を示すため、それに対して十分な余裕を持たせつつ
    // O(n^2)以上の退行(16倍以上)は確実に検出できるよう24倍を上限にする
    // (絶対時間非依存の緩いガード)。
    const scalingRatio = compile1000Median / Math.max(compile250Median, 0.01);
    expect(scalingRatio).toBeLessThan(24);
    // 想定外の壊れ方(無限ループに近い退行)を捉えるための、非常に緩い絶対時間の
    // 保険。通常値(現行200ms前後)の25倍というごく粗い上限。
    expect(compile1000Median).toBeLessThan(5000);
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
