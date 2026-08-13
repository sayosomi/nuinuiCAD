import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import type { CadElement } from "../types/geometry";
import type { ScalarEvaluation } from "../scalars/types";
import type { BindingId } from "../scalars/bindingCatalog";
import {
  isGroupPrintEnabled,
  resolveGroupPrintEnabledBindingId,
  type GroupPrintEnabledLookup
} from "./groupPrintEnabledRuntime";

const compile = (statements: string[]): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
  const result = compileCanonicalText(baseline, ["nui 4", ...statements].join("\n"));
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

const lookupFor = (doc: LastGoodDslDocument): GroupPrintEnabledLookup => ({
  propertyBindings: doc.propertyBindings,
  byElementId: doc.statementMap.byElementId,
  materializedBindingsByElementId: doc.materializedGroupPrintEnabledBindings
});

const groupNamed = (doc: LastGoodDslDocument, name: string): Extract<CadElement, { type: "group" }> => {
  const group = doc.document.elements.find(
    (element): element is Extract<CadElement, { type: "group" }> =>
      element.type === "group" && element.name === name
  );
  if (!group) throw new Error(`group "${name}" not found`);
  return group;
};

const booleanEvaluation = (value: boolean): ScalarEvaluation => ({
  status: "ok",
  type: { kind: "boolean" },
  value: { kind: "boolean", value }
});

describe("isGroupPrintEnabled", () => {
  it("returns true for a literal printEnabled: true with no binding involved", () => {
    const doc = compile(["group G (printEnabled: true) {", "}"]);
    const group = groupNamed(doc, "G");
    expect(isGroupPrintEnabled(group, lookupFor(doc), undefined)).toBe(true);
  });

  it("returns false for a group with no printEnabled arg at all", () => {
    const doc = compile(["group G {", "}"]);
    const group = groupNamed(doc, "G");
    expect(isGroupPrintEnabled(group, lookupFor(doc), undefined)).toBe(false);
  });

  it("returns false for a literal printEnabled: false", () => {
    const doc = compile(["group G (printEnabled: false) {", "}"]);
    const group = groupNamed(doc, "G");
    expect(isGroupPrintEnabled(group, lookupFor(doc), undefined)).toBe(false);
  });

  it("resolves a bound printEnabled whose binding evaluates ok/true", () => {
    const doc = compile(["let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"]);
    const group = groupNamed(doc, "G");
    const lookup = lookupFor(doc);
    const bindingId = resolveGroupPrintEnabledBindingId(group.id, lookup);
    expect(bindingId).toBeDefined();
    const computedScalarBindings = new Map<BindingId, ScalarEvaluation>([[bindingId!, booleanEvaluation(true)]]);
    expect(isGroupPrintEnabled(group, lookup, computedScalarBindings)).toBe(true);
  });

  it("resolves a bound printEnabled whose binding evaluates ok/false", () => {
    const doc = compile(["let 印刷: boolean = false", "group G (printEnabled: @印刷) {", "}"]);
    const group = groupNamed(doc, "G");
    const lookup = lookupFor(doc);
    const bindingId = resolveGroupPrintEnabledBindingId(group.id, lookup);
    const computedScalarBindings = new Map<BindingId, ScalarEvaluation>([[bindingId!, booleanEvaluation(false)]]);
    expect(isGroupPrintEnabled(group, lookup, computedScalarBindings)).toBe(false);
  });

  it("evaluates a compound typed expression through the shared scalar evaluator", () => {
    const doc = compile([
      "let 印刷: boolean = true",
      "let 下書き: boolean = false",
      "group G (printEnabled: @印刷  and  not @下書き) {",
      "}"
    ]);
    const group = groupNamed(doc, "G");
    const computedScalarBindings = new Map<BindingId, ScalarEvaluation>();
    for (const binding of ["印刷", "下書き"]) {
      const bindingId = doc.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === binding)?.id;
      if (!bindingId) throw new Error(`binding "${binding}" not found`);
      computedScalarBindings.set(bindingId, booleanEvaluation(binding === "印刷"));
    }
    expect(isGroupPrintEnabled(group, lookupFor(doc), computedScalarBindings)).toBe(true);
  });

  it("fails closed to false when the bound binding evaluation is missing from computedScalarBindings", () => {
    const doc = compile(["let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"]);
    const group = groupNamed(doc, "G");
    const lookup = lookupFor(doc);
    expect(isGroupPrintEnabled(group, lookup, new Map())).toBe(false);
  });

  it("fails closed to false when the bound binding is poisoned (status: error)", () => {
    const doc = compile(["let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"]);
    const group = groupNamed(doc, "G");
    const lookup = lookupFor(doc);
    const bindingId = resolveGroupPrintEnabledBindingId(group.id, lookup);
    const computedScalarBindings = new Map<BindingId, ScalarEvaluation>([
      [bindingId!, { status: "error", type: { kind: "boolean" }, issueCode: "poisoned-binding" }]
    ]);
    expect(isGroupPrintEnabled(group, lookup, computedScalarBindings)).toBe(false);
  });

  it("fails closed to false when the resolved evaluation has an unexpected type", () => {
    const doc = compile(["let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"]);
    const group = groupNamed(doc, "G");
    const lookup = lookupFor(doc);
    const bindingId = resolveGroupPrintEnabledBindingId(group.id, lookup);
    const computedScalarBindings = new Map<BindingId, ScalarEvaluation>([
      [bindingId!, { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } }]
    ]);
    expect(isGroupPrintEnabled(group, lookup, computedScalarBindings)).toBe(false);
  });

  it("falls back to the literal field when no lookup is supplied", () => {
    const doc = compile(["group G (printEnabled: true) {", "}"]);
    const group = groupNamed(doc, "G");
    expect(isGroupPrintEnabled(group, undefined, undefined)).toBe(true);
  });
});

describe("resolveGroupPrintEnabledBindingId", () => {
  it("returns undefined when propertyBindings is absent (no typed declarations in the document)", () => {
    const doc = compile(["group G (printEnabled: true) {", "}"]);
    const group = groupNamed(doc, "G");
    expect(resolveGroupPrintEnabledBindingId(group.id, lookupFor(doc))).toBeUndefined();
  });

  it("returns undefined for a group whose printEnabled arg is a plain literal", () => {
    const doc = compile(["let 未使用: boolean = true", "group G (printEnabled: false) {", "}"]);
    const group = groupNamed(doc, "G");
    expect(resolveGroupPrintEnabledBindingId(group.id, lookupFor(doc))).toBeUndefined();
  });
});
