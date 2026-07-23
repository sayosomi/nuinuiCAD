import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import type { ScalarEvaluation, ScalarType } from "../scalars/types";
import type { ScalarValueSource } from "../scalars/propertyBindingCompiler";
import {
  buildPropertyBindingRuntimeEntries,
  groupPropertyBindingRuntimeEntriesByElement,
  materializePropertyBoundElement,
  type PropertyBindingRuntimeSource
} from "./propertyBindingRuntime";

const offsetLine = (overrides: Partial<CadElement & { type: "offsetLine" }> = {}): CadElement => ({
  id: "offset",
  name: "オフセット",
  type: "offsetLine",
  visible: true,
  enabled: true,
  baseLineIds: ["line"],
  offset: 10,
  side: "right",
  closed: false,
  ...overrides
});

const intersectionPoint = (): CadElement => ({
  id: "isect",
  name: "交点",
  type: "intersectionPoint",
  visible: true,
  enabled: true,
  line1Id: "line1",
  line2Id: "line2",
  intersectionIndex: 0,
  useExtensions: false
});

const copyLine = (): CadElement => ({
  id: "copy",
  name: "複写",
  type: "copyLine",
  visible: true,
  enabled: true,
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  endPoint: { mode: "coordinate", x: 1, y: 1 },
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
  baseLineIds: ["line"]
});

const textElement = (): CadElement => ({
  id: "label",
  name: "ラベル",
  type: "text",
  visible: true,
  enabled: true,
  text: "hello",
  anchor: null,
  fontSize: 10
});

const groupElement = (): CadElement => ({
  id: "grp",
  name: "グループ",
  type: "group",
  visible: true,
  enabled: true
});

const bindingSource = (
  entries: ReadonlyArray<{ statementIndex: number; parameterKey: string; source: ScalarValueSource }>,
  elementIdByStatementIndex: ReadonlyMap<number, string>
): PropertyBindingRuntimeSource => {
  const propertyBindings = new Map<string, ScalarValueSource>();
  for (const entry of entries) {
    propertyBindings.set(`${entry.statementIndex}:${entry.parameterKey}`, entry.source);
  }
  return { propertyBindings, elementIdByStatementIndex };
};

const bindingSourceValue = (bindingId: string, type: ScalarType): ScalarValueSource => ({
  kind: "binding",
  bindingId,
  type,
  span: { start: 0, end: 0 },
  nameSpan: { start: 0, end: 0 },
  name: "方向"
});

describe("buildPropertyBindingRuntimeEntries", () => {
  it("builds an entry for a bound standard property", () => {
    const element = offsetLine();
    const source = bindingSource(
      [{ statementIndex: 0, parameterKey: "side", source: bindingSourceValue("binding:a", { kind: "choice", options: ["right", "left"] }) }],
      new Map([[0, element.id]])
    );
    const entries = buildPropertyBindingRuntimeEntries(source, [element]);
    expect(entries).toEqual([
      {
        elementId: "offset",
        parameterKey: "side",
        bindingId: "binding:a",
        expectedType: { kind: "choice", options: ["right", "left"] }
      }
    ]);
  });

  it("never emits an entry for text.text / group.printEnabled / forGroup.showGenerated, even if propertyBindings somehow contained one", () => {
    const text = textElement();
    const group = groupElement();
    const source = bindingSource(
      [
        { statementIndex: 0, parameterKey: "text", source: bindingSourceValue("binding:t", { kind: "string" }) },
        { statementIndex: 1, parameterKey: "printEnabled", source: bindingSourceValue("binding:p", { kind: "boolean" }) }
      ],
      new Map([
        [0, text.id],
        [1, group.id]
      ])
    );
    const entries = buildPropertyBindingRuntimeEntries(source, [text, group]);
    expect(entries).toEqual([]);
  });

  it("ignores a literal (non-binding) occurrence", () => {
    const element = offsetLine();
    const source: PropertyBindingRuntimeSource = {
      propertyBindings: new Map([["0:side", { kind: "literal" } as ScalarValueSource]]),
      elementIdByStatementIndex: new Map([[0, element.id]])
    };
    expect(buildPropertyBindingRuntimeEntries(source, [element])).toEqual([]);
  });
});

describe("materializePropertyBoundElement", () => {
  const sideEntry = (bindingId: string) => [
    { elementId: "offset", parameterKey: "side", bindingId, expectedType: { kind: "choice" as const, options: ["right", "left"] } }
  ];

  it("returns the original element unchanged when it has no bound properties", () => {
    const element = offsetLine();
    const result = materializePropertyBoundElement(element, undefined, () => {
      throw new Error("should not resolve anything");
    });
    expect(result).toEqual({ ok: true, element });
  });

  it("overrides a bound choice property with the resolved literal value", () => {
    const element = offsetLine({ side: "right" });
    const evaluation: ScalarEvaluation = {
      status: "ok",
      type: { kind: "choice", options: ["right", "left"] },
      value: { kind: "choice", value: "left", options: ["right", "left"] }
    };
    const result = materializePropertyBoundElement(element, sideEntry("binding:a"), () => evaluation);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.element).toMatchObject({ side: "left" });
    expect(result.element).not.toBe(element);
  });

  it("accepts a runtime value from a binding whose declared type is a narrower choice subset than the property (D07)", () => {
    const element = offsetLine();
    const evaluation: ScalarEvaluation = {
      status: "ok",
      type: { kind: "choice", options: ["right"] },
      value: { kind: "choice", value: "right", options: ["right"] }
    };
    const result = materializePropertyBoundElement(element, sideEntry("binding:a"), () => evaluation);
    expect(result.ok).toBe(true);
  });

  it("fails closed when the binding is poisoned", () => {
    const element = offsetLine();
    const evaluation: ScalarEvaluation = {
      status: "error",
      type: { kind: "choice", options: ["right", "left"] },
      issueCode: "evaluation-external-binding-unavailable"
    };
    const result = materializePropertyBoundElement(element, sideEntry("binding:a"), () => evaluation);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.elementId).toBe(element.id);
    expect(result.error.missingDependencyId).toBe(element.id);
  });

  it("fails closed on a runtime type mismatch", () => {
    const element = offsetLine();
    const evaluation: ScalarEvaluation = {
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: true }
    };
    const result = materializePropertyBoundElement(element, sideEntry("binding:a"), () => evaluation);
    expect(result.ok).toBe(false);
  });

  it("fails closed when the resolved choice value is not one of the property's own options", () => {
    const element = offsetLine();
    const evaluation: ScalarEvaluation = {
      status: "ok",
      type: { kind: "choice", options: ["right", "left", "center"] },
      value: { kind: "choice", value: "center", options: ["right", "left", "center"] }
    };
    const result = materializePropertyBoundElement(element, sideEntry("binding:a"), () => evaluation);
    expect(result.ok).toBe(false);
  });

  it("resolves each bound property exactly once (never re-resolves after the first ok/fail)", () => {
    const element = offsetLine();
    let lookups = 0;
    const evaluation: ScalarEvaluation = {
      status: "ok",
      type: { kind: "choice", options: ["right", "left"] },
      value: { kind: "choice", value: "left", options: ["right", "left"] }
    };
    materializePropertyBoundElement(element, sideEntry("binding:a"), () => {
      lookups += 1;
      return evaluation;
    });
    expect(lookups).toBe(1);
  });

  it.each(["intersectionPoint.useExtensions", "copyLine.mirrorX"] as const)(
    "materializes %s from a boolean binding",
    (label) => {
      const element = label === "intersectionPoint.useExtensions" ? intersectionPoint() : copyLine();
      const parameterKey = label === "intersectionPoint.useExtensions" ? "useExtensions" : "mirrorX";
      const entries = [{ elementId: element.id, parameterKey, bindingId: "binding:b", expectedType: { kind: "boolean" as const } }];
      const evaluation: ScalarEvaluation = { status: "ok", type: { kind: "boolean" }, value: { kind: "boolean", value: true } };
      const result = materializePropertyBoundElement(element, entries, () => evaluation);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect((result.element as Record<string, unknown>)[parameterKey]).toBe(true);
    }
  );
});

describe("groupPropertyBindingRuntimeEntriesByElement", () => {
  it("groups entries by elementId", () => {
    const entries = [
      { elementId: "a", parameterKey: "side", bindingId: "binding:1", expectedType: { kind: "choice" as const, options: ["right", "left"] } },
      { elementId: "a", parameterKey: "closed", bindingId: "binding:2", expectedType: { kind: "boolean" as const } },
      { elementId: "b", parameterKey: "mirrorX", bindingId: "binding:3", expectedType: { kind: "boolean" as const } }
    ];
    const grouped = groupPropertyBindingRuntimeEntriesByElement(entries);
    expect(grouped.get("a")).toHaveLength(2);
    expect(grouped.get("b")).toHaveLength(1);
    expect(grouped.get("missing")).toBeUndefined();
  });
});
