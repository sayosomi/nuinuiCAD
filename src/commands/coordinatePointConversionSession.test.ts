import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText, type CanonicalDocumentValue } from "../document/canonicalDocument";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  coordinatePointConversionBaseForInput,
  coordinatePointConversionBaseSuggestions,
  coordinatePointConversionSelectedBase,
  selectCoordinatePointConversionBase,
  setCoordinatePointConversionQuery,
  startCoordinatePointConversionSession
} from "./coordinatePointConversionSession";
import type { CoordinatePointConversionSnapshot } from "./coordinatePointConversion";

const compile = (source: string): CanonicalDocumentValue => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result;
};

const snapshotFor = (document: CanonicalDocumentValue): CoordinatePointConversionSnapshot => ({
  document,
  evaluation: evaluateElements(document.doc.document.elements, buildEvaluationOptions({
    compiledDocument: document.doc,
    evaluationLimitIndex: undefined
  }))
});

const elementId = (document: CanonicalDocumentValue, name: string): string =>
  document.doc.document.elements.find((element) => element.name === name)!.id;

describe("coordinate point conversion session", () => {
  it("starts with the exact target context and exposes searchable shared bases", () => {
    const document = compile([
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "point Target = coordinate(x: 30, y: 5)"
    ].join("\n"));
    const targetId = elementId(document, "Target");
    const result = startCoordinatePointConversionSession({
      requestId: 4,
      documentUri: "file:///tmp/pattern.nui",
      documentVersion: 8,
      mode: "xy",
      origin: "source",
      targetIds: [targetId, targetId],
      snapshot: snapshotFor(document)
    });

    expect(result.status).toBe("started");
    if (result.status !== "started") return;
    expect(result.session).toMatchObject({
      requestId: 4,
      documentUri: "file:///tmp/pattern.nui",
      documentVersion: 8,
      mode: "xy",
      origin: "source",
      targetIds: [targetId]
    });
    expect(result.session.targets).toHaveLength(1);

    const withQuery = setCoordinatePointConversionQuery(result.session, "@base");
    const suggestions = coordinatePointConversionBaseSuggestions(withQuery);
    expect(suggestions[0]).toMatchObject({
      canonicalToken: "@Base",
      displayLabel: "@Base"
    });
    expect(coordinatePointConversionBaseForInput(withQuery, "@BASE")?.sourceElementId)
      .toBe(elementId(document, "Base"));
  });

  it("selects only legal shared candidates and keeps the selected base in the session", () => {
    const document = compile([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point First = coordinate(x: 3, y: 4)",
      "point Second = coordinate(x: 5, y: 6)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const targetIds = [elementId(document, "First"), elementId(document, "Second")];
    const result = startCoordinatePointConversionSession({
      requestId: 5,
      documentUri: "file:///tmp/pattern.nui",
      documentVersion: 9,
      mode: "angle-distance",
      origin: "canvas",
      targetIds,
      snapshot
    });

    expect(result.status).toBe("started");
    if (result.status !== "started") return;
    const base = result.session.baseCandidates.find((candidate) => candidate.sourceElementId === elementId(document, "Base"));
    expect(base).toBeDefined();
    if (!base) return;
    const selected = selectCoordinatePointConversionBase(result.session, base.key);
    expect(selected.query).toBe("@Base");
    expect(coordinatePointConversionSelectedBase(selected)).toEqual(base);
  });

  it("rejects an empty or wholly ineligible target set before opening the session", () => {
    const document = compile([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Relational = offset(from: @Base, dx: 1, dy: 2)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const relationalId = elementId(document, "Relational");

    expect(startCoordinatePointConversionSession({
      requestId: 6,
      documentUri: "file:///tmp/pattern.nui",
      documentVersion: 10,
      mode: "xy",
      origin: "explorer",
      targetIds: [],
      snapshot
    })).toMatchObject({ status: "rejected", reason: { code: "target-not-found" } });
    expect(startCoordinatePointConversionSession({
      requestId: 7,
      documentUri: "file:///tmp/pattern.nui",
      documentVersion: 10,
      mode: "xy",
      origin: "explorer",
      targetIds: [relationalId],
      snapshot
    })).toMatchObject({ status: "rejected", reason: { code: "target-not-eligible" } });
  });
});
