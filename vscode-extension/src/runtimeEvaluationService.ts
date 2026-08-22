import {
  isLastGoodDslDocument,
  type LastGoodDslDocument
} from "../../src/document/canonicalDocument";
import {
  evaluateElementsReference
} from "../../src/geometry/evaluationEngine";
import {
  ScalarOutputDecodeError,
  type EvaluationPayload
} from "../../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import {
  evaluatePreparedRust,
  prepareRustEvaluation,
  type RustEvaluationTransport
} from "../../src/geometry/rustEvaluationRunner";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { EvaluationResult } from "../../src/types/geometry";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import type { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";

export type NuiRuntimeEvaluationSource = "reference" | "rust" | "fallback";

export type NuiRuntimeEvaluationProof = {
  documentKey: string;
  documentVersion: number;
  sourceRevision: number;
  normalizedSource: string;
};

export type NuiRuntimeEvaluationSnapshot = {
  proof: NuiRuntimeEvaluationProof;
  compiled: LastGoodDslDocument;
  evaluation: EvaluationResult;
  source: NuiRuntimeEvaluationSource;
  rustEligible: boolean;
};

export type NuiRuntimeEvaluationRequest = {
  documentKey: string;
  documentVersion: number;
  source: SourceSnapshot;
  session: NuiLanguageAnalysisSession;
};

export type NuiRuntimeEvaluationServiceDependencies = {
  rustProcessOwner: Pick<RustEvaluationProcessOwner, "get">;
  isDocumentCurrent: (documentKey: string, documentVersion: number) => boolean;
};

type CapturedDocument = {
  proof: NuiRuntimeEvaluationProof;
  compiled: LastGoodDslDocument;
  session: NuiLanguageAnalysisSession;
};

type CachedDocument = {
  captured: CapturedDocument;
  snapshot: NuiRuntimeEvaluationSnapshot;
};

type InFlightDocument = {
  captured: CapturedDocument;
  promise: Promise<NuiRuntimeEvaluationSnapshot | undefined>;
};

type EvaluationAttempt = Pick<
  NuiRuntimeEvaluationSnapshot,
  "evaluation" | "source" | "rustEligible"
>;

const sameProof = (left: NuiRuntimeEvaluationProof, right: NuiRuntimeEvaluationProof): boolean =>
  left.documentKey === right.documentKey &&
  left.documentVersion === right.documentVersion &&
  left.sourceRevision === right.sourceRevision &&
  left.normalizedSource === right.normalizedSource;

const sameCapturedDocument = (left: CapturedDocument, right: CapturedDocument): boolean =>
  left.session === right.session && left.compiled === right.compiled && sameProof(left.proof, right.proof);

const mustFailClosedAfterRustError = (
  scalarProgram: ReturnType<typeof buildEvaluationOptions>["scalarProgram"],
  error: unknown
): boolean => scalarProgram !== undefined || error instanceof ScalarOutputDecodeError;

export class NuiRuntimeEvaluationService {
  private readonly cachedByDocument = new Map<string, CachedDocument>();
  private readonly inFlightByDocument = new Map<string, InFlightDocument>();
  private readonly epochByDocument = new Map<string, number>();
  private disposed = false;

  constructor(private readonly dependencies: NuiRuntimeEvaluationServiceDependencies) {}

  evaluateCurrent(
    request: NuiRuntimeEvaluationRequest
  ): Promise<NuiRuntimeEvaluationSnapshot | undefined> {
    if (this.disposed) return Promise.resolve(undefined);

    const captured = this.captureCurrentDocument(request);
    if (!captured) return Promise.resolve(undefined);

    const cached = this.cachedByDocument.get(request.documentKey);
    if (cached && sameCapturedDocument(cached.captured, captured)) {
      return Promise.resolve(cached.snapshot);
    }

    const inFlight = this.inFlightByDocument.get(request.documentKey);
    if (inFlight && sameCapturedDocument(inFlight.captured, captured)) {
      return inFlight.promise;
    }

    const capturedEpoch = this.epochFor(request.documentKey);
    let guardedPromise!: Promise<NuiRuntimeEvaluationSnapshot | undefined>;
    guardedPromise = this.evaluateCaptured(captured)
      .then((attempt) => {
        if (!attempt || !this.acceptsCompletion(request, captured, capturedEpoch)) return undefined;

        const snapshot: NuiRuntimeEvaluationSnapshot = {
          proof: captured.proof,
          compiled: captured.compiled,
          evaluation: attempt.evaluation,
          source: attempt.source,
          rustEligible: attempt.rustEligible
        };
        this.cachedByDocument.set(request.documentKey, { captured, snapshot });
        return snapshot;
      })
      .finally(() => {
        if (this.inFlightByDocument.get(request.documentKey)?.promise === guardedPromise) {
          this.inFlightByDocument.delete(request.documentKey);
        }
      });

    this.inFlightByDocument.set(request.documentKey, { captured, promise: guardedPromise });
    return guardedPromise;
  }

  invalidateDocument(documentKey: string): void {
    this.epochByDocument.set(documentKey, this.epochFor(documentKey) + 1);
    this.cachedByDocument.delete(documentKey);
    this.inFlightByDocument.delete(documentKey);
  }

  closeDocument(documentKey: string): void {
    this.invalidateDocument(documentKey);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cachedByDocument.clear();
    this.inFlightByDocument.clear();
    this.epochByDocument.clear();
  }

  private captureCurrentDocument(
    request: NuiRuntimeEvaluationRequest
  ): CapturedDocument | undefined {
    if (!this.dependencies.isDocumentCurrent(request.documentKey, request.documentVersion)) {
      return undefined;
    }

    // Reuse the language session's exact-current source/revision gate. The
    // returned compile attempt may be partial under fatal source, so runtime
    // evaluation additionally requires a complete current document here.
    const semantic = request.session.choiceQuickFixSemanticSnapshot(request.source);
    if (!semantic || !isLastGoodDslDocument(semantic.currentCompiled)) return undefined;
    if (
      semantic.sourceText !== request.source.normalizedSource ||
      semantic.currentCompiled.spans.sourceMap.source !== request.source.normalizedSource ||
      semantic.currentCompiled.spans.sourceMap.sourceRevision !== request.source.sourceRevision
    ) return undefined;

    return {
      proof: {
        documentKey: request.documentKey,
        documentVersion: request.documentVersion,
        sourceRevision: request.source.sourceRevision,
        normalizedSource: request.source.normalizedSource
      },
      compiled: semantic.currentCompiled,
      session: request.session
    };
  }

  private acceptsCompletion(
    request: NuiRuntimeEvaluationRequest,
    captured: CapturedDocument,
    capturedEpoch: number
  ): boolean {
    if (
      this.disposed ||
      this.epochFor(request.documentKey) !== capturedEpoch ||
      !this.dependencies.isDocumentCurrent(request.documentKey, request.documentVersion)
    ) return false;

    const current = this.captureCurrentDocument(request);
    return Boolean(current && sameCapturedDocument(current, captured));
  }

  private async evaluateCaptured(captured: CapturedDocument): Promise<EvaluationAttempt | undefined> {
    const elements = captured.compiled.document.elements;
    const options = buildEvaluationOptions({
      compiledDocument: captured.compiled,
      evaluationLimitIndex: undefined
    });
    const prepared = prepareRustEvaluation(elements, options);

    if (!prepared.rustEligible) {
      return {
        evaluation: evaluateElementsReference(elements, options),
        source: "reference",
        rustEligible: false
      };
    }

    const transport: RustEvaluationTransport = async (input) =>
      this.dependencies.rustProcessOwner.get().request(input) as Promise<EvaluationPayload>;

    try {
      return {
        evaluation: await evaluatePreparedRust(prepared, transport),
        source: "rust",
        rustEligible: true
      };
    } catch (error) {
      // Match the production compatibility policy: ordinary Rust transport
      // failures may use the TypeScript reference path, while scalar-program
      // or scalar-output failures must fail closed rather than inventing
      // current runtime values.
      if (mustFailClosedAfterRustError(options.scalarProgram, error)) return undefined;
      return {
        evaluation: evaluateElementsReference(elements, options),
        source: "fallback",
        rustEligible: true
      };
    }
  }

  private epochFor(documentKey: string): number {
    return this.epochByDocument.get(documentKey) ?? 0;
  }
}

export const createNuiRuntimeEvaluationService = (
  dependencies: NuiRuntimeEvaluationServiceDependencies
): NuiRuntimeEvaluationService => new NuiRuntimeEvaluationService(dependencies);
