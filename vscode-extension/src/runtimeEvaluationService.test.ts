import { describe, expect, it, vi } from "vitest";
import { isLastGoodDslDocument } from "../../src/document/canonicalDocument";
import { evaluateElementsReference } from "../../src/geometry/evaluationEngine";
import { evaluationResultToPayload, type EvaluationPayload } from "../../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import { createLanguageAnalysisSession, type NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { createNuiRuntimeEvaluationService } from "./runtimeEvaluationService";

const sourceSnapshotFor = (source: string, sourceRevision: number): SourceSnapshot => ({
  normalizedSource: source.replace(/\r\n/g, "\n"),
  sourceRevision
});

const validSource = "nui 1\npoint A = coordinate(x: 0, y: 1)\n";
const nextSource = "nui 1\npoint B = coordinate(x: 2, y: 3)\n";
const fatalSource = "nui 1\npoint A = coordinate(";
const scalarSource = "nui 1\nconst x: number = 1\npoint A = coordinate(x: @x, y: 0)\n";

const payloadFor = (
  session: NuiLanguageAnalysisSession,
  source: SourceSnapshot
): EvaluationPayload => {
  const semantic = session.choiceQuickFixSemanticSnapshot(source);
  if (!semantic || !isLastGoodDslDocument(semantic.currentCompiled)) {
    throw new Error("expected a complete exact-current compiled document");
  }
  const options = buildEvaluationOptions({
    compiledDocument: semantic.currentCompiled,
    evaluationLimitIndex: undefined
  });
  return evaluationResultToPayload(
    evaluateElementsReference(semantic.currentCompiled.document.elements, options)
  );
};

const requestFor = ({
  session,
  source = validSource,
  sourceRevision = 1,
  documentVersion = 1,
  documentKey = "file:///pattern.nui"
}: {
  session: NuiLanguageAnalysisSession;
  source?: string;
  sourceRevision?: number;
  documentVersion?: number;
  documentKey?: string;
}) => ({
  documentKey,
  documentVersion,
  source: sourceSnapshotFor(source, sourceRevision),
  session
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("VS Code current runtime evaluation service", () => {
  it("evaluates an exact-current document through the shared Rust process owner", async () => {
    const session = createLanguageAnalysisSession(validSource);
    const source = sourceSnapshotFor(validSource, 1);
    const requestRust = vi.fn().mockResolvedValue(payloadFor(session, source));
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: (_documentKey, documentVersion) => documentVersion === 1
    });

    const snapshot = await service.evaluateCurrent(requestFor({ session }));

    expect(requestRust).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      proof: {
        documentKey: "file:///pattern.nui",
        documentVersion: 1,
        sourceRevision: 1,
        normalizedSource: validSource
      },
      source: "rust",
      rustEligible: true,
      compiled: expect.any(Object),
      evaluation: expect.any(Object)
    });
    expect(snapshot?.evaluation.computedGeometry.size).toBe(1);
  });

  it("fails closed for stale source, stale document version, and fatal current source", async () => {
    const session = createLanguageAnalysisSession(validSource);
    const requestRust = vi.fn();
    let currentVersion = 1;
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: (_documentKey, documentVersion) => documentVersion === currentVersion
    });

    expect(await service.evaluateCurrent(requestFor({
      session,
      source: nextSource,
      sourceRevision: 1
    }))).toBeUndefined();

    currentVersion = 2;
    expect(await service.evaluateCurrent(requestFor({ session, documentVersion: 1 }))).toBeUndefined();

    session.replaceSource(fatalSource);
    expect(await service.evaluateCurrent(requestFor({
      session,
      source: fatalSource,
      sourceRevision: 2,
      documentVersion: 2
    }))).toBeUndefined();
    expect(requestRust).not.toHaveBeenCalled();
  });

  it("shares matching in-flight work and reuses the exact-proof cache", async () => {
    const session = createLanguageAnalysisSession(validSource);
    const source = sourceSnapshotFor(validSource, 1);
    const pending = deferred<EvaluationPayload>();
    const requestRust = vi.fn().mockReturnValue(pending.promise);
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: () => true
    });
    const request = requestFor({ session });

    const first = service.evaluateCurrent(request);
    const second = service.evaluateCurrent(request);

    expect(second).toBe(first);
    expect(requestRust).toHaveBeenCalledTimes(1);

    pending.resolve(payloadFor(session, source));
    const firstSnapshot = await first;
    expect(await second).toBe(firstSnapshot);

    const cachedSnapshot = await service.evaluateCurrent(request);
    expect(cachedSnapshot).toBe(firstSnapshot);
    expect(requestRust).toHaveBeenCalledTimes(1);
  });

  it("discards an old completion after text invalidation and accepts the new exact proof", async () => {
    const session = createLanguageAnalysisSession(validSource);
    const oldSource = sourceSnapshotFor(validSource, 1);
    const pending = deferred<EvaluationPayload>();
    const requestRust = vi.fn().mockReturnValueOnce(pending.promise);
    let currentVersion = 1;
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: (_documentKey, documentVersion) => documentVersion === currentVersion
    });

    const oldRequest = service.evaluateCurrent(requestFor({ session }));
    session.replaceSource(nextSource);
    currentVersion = 2;
    service.invalidateDocument("file:///pattern.nui");
    pending.resolve(payloadFor(createLanguageAnalysisSession(validSource), oldSource));

    expect(await oldRequest).toBeUndefined();

    const newSource = sourceSnapshotFor(nextSource, 2);
    requestRust.mockResolvedValueOnce(payloadFor(session, newSource));
    const current = await service.evaluateCurrent(requestFor({
      session,
      source: nextSource,
      sourceRevision: 2,
      documentVersion: 2
    }));

    expect(current?.proof).toMatchObject({ documentVersion: 2, sourceRevision: 2 });
    expect(requestRust).toHaveBeenCalledTimes(2);
  });

  it("drops a completion when the host document version changes while Rust is running", async () => {
    const session = createLanguageAnalysisSession(validSource);
    const source = sourceSnapshotFor(validSource, 1);
    const pending = deferred<EvaluationPayload>();
    const requestRust = vi.fn().mockReturnValue(pending.promise);
    let currentVersion = 1;
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: (_documentKey, documentVersion) => documentVersion === currentVersion
    });

    const result = service.evaluateCurrent(requestFor({ session }));
    currentVersion = 2;
    pending.resolve(payloadFor(session, source));

    expect(await result).toBeUndefined();
  });

  it("invalidates document work on close and all work on dispose", async () => {
    const session = createLanguageAnalysisSession(validSource);
    const source = sourceSnapshotFor(validSource, 1);
    const pending = deferred<EvaluationPayload>();
    const requestRust = vi.fn().mockReturnValue(pending.promise);
    const service = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: requestRust }) } as never,
      isDocumentCurrent: () => true
    });

    const result = service.evaluateCurrent(requestFor({ session }));
    service.closeDocument("file:///pattern.nui");
    pending.resolve(payloadFor(session, source));
    expect(await result).toBeUndefined();

    service.dispose();
    expect(await service.evaluateCurrent(requestFor({ session }))).toBeUndefined();
  });

  it("uses the TypeScript compatibility fallback only for ordinary Rust failures", async () => {
    const plainSession = createLanguageAnalysisSession(validSource);
    const plainRequestRust = vi.fn().mockRejectedValue(new Error("stdio unavailable"));
    const plainService = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: plainRequestRust }) } as never,
      isDocumentCurrent: () => true
    });

    const fallback = await plainService.evaluateCurrent(requestFor({ session: plainSession }));
    expect(fallback).toMatchObject({ source: "fallback", rustEligible: true });
    expect(fallback?.evaluation.computedGeometry.size).toBe(1);

    const scalarSession = createLanguageAnalysisSession(scalarSource);
    const scalarRequestRust = vi.fn().mockRejectedValue(new Error("stdio unavailable"));
    const scalarService = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request: scalarRequestRust }) } as never,
      isDocumentCurrent: () => true
    });

    expect(await scalarService.evaluateCurrent(requestFor({
      session: scalarSession,
      source: scalarSource
    }))).toBeUndefined();
    expect(scalarRequestRust).toHaveBeenCalledTimes(1);
  });
});
