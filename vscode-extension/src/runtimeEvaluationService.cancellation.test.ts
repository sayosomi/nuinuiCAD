import { describe, expect, it, vi } from "vitest";
import { isLastGoodDslDocument } from "../../src/document/canonicalDocument";
import { evaluateElementsReference } from "../../src/geometry/evaluationEngine";
import { evaluationResultToPayload, type EvaluationPayload } from "../../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { createNuiRuntimeEvaluationService } from "./runtimeEvaluationService";

const source = "nui 1\npoint A = coordinate(x: 0, y: 1)\n";
const sourceSnapshot = { normalizedSource: source, sourceRevision: 1 };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const payloadForCurrentSource = (): EvaluationPayload => {
  const session = createLanguageAnalysisSession(source);
  const semantic = session.choiceQuickFixSemanticSnapshot(sourceSnapshot);
  if (!semantic || !isLastGoodDslDocument(semantic.currentCompiled)) {
    throw new Error("expected current compiled document");
  }
  const options = buildEvaluationOptions({
    compiledDocument: semantic.currentCompiled,
    evaluationLimitIndex: undefined
  });
  return evaluationResultToPayload(
    evaluateElementsReference(semantic.currentCompiled.document.elements, options)
  );
};

describe("VS Code runtime evaluation cancellation", () => {
  it("cancels one caller without cancelling shared exact-current work for another caller", async () => {
    const session = createLanguageAnalysisSession(source);
    const pending = deferred<EvaluationPayload>();
    const requestRust = vi.fn().mockReturnValue(pending.promise);
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: () => true
    });
    const request = {
      documentKey: "file:///pattern.nui",
      documentVersion: 1,
      source: sourceSnapshot,
      session
    };
    let cancelled = false;

    const cancelledCaller = service.evaluateCurrent({
      ...request,
      isCancelled: () => cancelled
    });
    const liveCaller = service.evaluateCurrent(request);

    expect(requestRust).toHaveBeenCalledTimes(1);
    cancelled = true;
    pending.resolve(payloadForCurrentSource());

    expect(await cancelledCaller).toBeUndefined();
    const liveSnapshot = await liveCaller;
    expect(liveSnapshot).toMatchObject({ source: "rust", rustEligible: true });

    expect(await service.evaluateCurrent(request)).toBe(liveSnapshot);
    expect(requestRust).toHaveBeenCalledTimes(1);
  });
});
