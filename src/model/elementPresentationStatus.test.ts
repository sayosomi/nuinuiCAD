import { describe, expect, it } from "vitest";
import { buildConditionalGroupConditionsByElementId } from "../geometry/controlBooleanRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import { initialCadDocumentState, useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { createElementPresentationStatusIndex } from "./elementPresentationStatus";

const commit = (source: string) => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadDocumentStore.getState().commitText(source, "test");
  return useCadDocumentStore.getState();
};

const optionsFor = (state: CadDocumentState): EvaluateElementsOptions => ({
  evaluationLimitIndex: state.doc.document.evaluationLimitIndex,
  scalarProgram: state.doc.scalarProgram,
  bindingVersions: state.doc.bindingVersions,
  statementInfoByElementId: state.doc.statementMap.byElementId,
  statementIdByStatementIndex: state.doc.statementMap.statementIdByStatementIndex,
  conditionalOwnerStatementIdByElementId: state.doc.bindingVersions
    ? conditionalOwnerIdByElementId(buildConditionalMutationOwners(
        state.doc.bindingVersions, state.doc.document.elements, state.doc.statementMap.byElementId,
        state.doc.statementMap.statementIdByStatementIndex
      ))
    : undefined,
  forGroupMutationOwnerByElementId: state.doc.bindingVersions
    ? forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
        state.doc.bindingVersions, state.doc.document.elements, state.doc.statementMap.byElementId,
        state.doc.statementMap.statementIdByStatementIndex
      ))
    : undefined,
  conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
    state.doc.conditionalGroupConditions ?? new Map(),
    state.doc.statementMap.elementIdByStatementIndex
  )
});

const groupNamed = (elements: readonly CadElement[], name: string) =>
  elements.find((element) => element.type === "group" && element.name === name)!;

const statusIndexFor = (state: CadDocumentState, evaluation: EvaluationResult, freshLookup: boolean) =>
  createElementPresentationStatusIndex({
    elements: state.elements,
    evaluation,
    groupFoldById: new Map(),
    palette: state.palette,
    visibilityProfiles: state.visibilityProfiles,
    activeVisibilityProfileId: state.activeVisibilityProfileId,
    groupPrintEnabledLookup: freshLookup
      ? { propertyBindings: state.doc.propertyBindings, byElementId: state.doc.statementMap.byElementId }
      : undefined
  });

describe("createElementPresentationStatusIndex: printEnabled", () => {
  it("resolves a bound printEnabled through the runtime binding when a lookup is supplied (fresh)", () => {
    const state = commit(["nui 3", "let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"].join("\n"));
    const evaluation = evaluateElements(state.elements, optionsFor(state));
    const status = statusIndexFor(state, evaluation, true);
    expect(status.get(groupNamed(state.elements, "G").id)?.printEnabled).toBe(true);
  });

  it("resolves a bound printEnabled: false through the runtime binding", () => {
    const state = commit(["nui 3", "let 印刷: boolean = false", "group G (printEnabled: @印刷) {", "}"].join("\n"));
    const evaluation = evaluateElements(state.elements, optionsFor(state));
    const status = statusIndexFor(state, evaluation, true);
    expect(status.get(groupNamed(state.elements, "G").id)?.printEnabled).toBe(false);
  });

  it("falls back to the literal field when no lookup is supplied - the unchanged default contract", () => {
    const state = commit(["nui 3", "let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"].join("\n"));
    const evaluation = evaluateElements(state.elements, optionsFor(state));
    const status = statusIndexFor(state, evaluation, false);
    // Literal field on a bound group defaults to false regardless of the binding's value.
    expect(status.get(groupNamed(state.elements, "G").id)?.printEnabled).toBe(false);
  });

  it("a literal printEnabled: true still resolves true with no lookup at all", () => {
    const state = commit(["nui 3", "group G (printEnabled: true) {", "}"].join("\n"));
    const evaluation = evaluateElements(state.elements, optionsFor(state));
    const status = statusIndexFor(state, evaluation, false);
    expect(status.get(groupNamed(state.elements, "G").id)?.printEnabled).toBe(true);
  });
});
