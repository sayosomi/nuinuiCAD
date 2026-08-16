import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import {
  evaluationPayloadToResult,
  type EvaluationPayload
} from "./evaluationPayload";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import {
  buildRustEvaluationInput,
  type EvaluateDocumentInput
} from "./rustEvaluationInput";

export type RustEvaluationTransport = (
  input: EvaluateDocumentInput
) => Promise<EvaluationPayload>;

export type PreparedRustEvaluation = {
  rustEligible: boolean;
  input: EvaluateDocumentInput;
};

export const prepareRustEvaluation = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): PreparedRustEvaluation => {
  const rustEligible = canUseRustEvaluationForElements(elements, options);
  const input = buildRustEvaluationInput(elements, options, {
    includeBindingVersions: rustEligible
  });
  return { rustEligible, input };
};

export const evaluatePreparedRust = async (
  prepared: PreparedRustEvaluation,
  transport: RustEvaluationTransport
): Promise<EvaluationResult> => {
  const payload = await transport(prepared.input);
  return evaluationPayloadToResult(payload);
};
