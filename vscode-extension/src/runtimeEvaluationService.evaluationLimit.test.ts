import { describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { createNuiRuntimeEvaluationService } from "./runtimeEvaluationService";

const source = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "stop",
  "point B = coordinate(x: 1, y: 1)"
].join("\n");

describe("VS Code current runtime evaluation stop boundary", () => {
  it("preserves the compiled evaluation limit so post-stop geometry is not evaluated", async () => {
    const session = createLanguageAnalysisSession(source);
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: {
        get: () => ({ request: vi.fn().mockRejectedValue(new Error("stdio unavailable")) })
      } as never,
      isDocumentCurrent: () => true
    });

    const snapshot = await service.evaluateCurrent({
      documentKey: "file:///pattern.nui",
      documentVersion: 1,
      source: {
        normalizedSource: source,
        sourceRevision: session.getSourceRevision()
      },
      session
    });
    if (!snapshot) throw new Error("expected current evaluation snapshot");
    const beforeStop = snapshot.compiled.document.elements.find((element) => element.name === "A");
    const afterStop = snapshot.compiled.document.elements.find((element) => element.name === "B");
    if (!beforeStop || !afterStop) throw new Error("expected both compiled point declarations");

    expect(snapshot.compiled.document.evaluationLimitIndex).toBeTypeOf("number");
    expect(snapshot.evaluation.evaluatedElementIds?.has(beforeStop.id)).toBe(true);
    expect(snapshot.evaluation.evaluatedElementIds?.has(afterStop.id)).toBe(false);
    expect(snapshot.evaluation.computedGeometry.has(afterStop.id)).toBe(false);
  });
});
