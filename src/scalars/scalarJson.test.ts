import { describe, expect, it } from "vitest";
import { parseScalarEvaluationJson, parseScalarTypeJson, parseScalarValueJson } from "./scalarJson";
import type { ScalarEvaluation, ScalarType, ScalarValue } from "./types";

describe("parseScalarTypeJson", () => {
  it("round-trips valid payloads for every kind", () => {
    const cases: ScalarType[] = [
      { kind: "number" },
      { kind: "string" },
      { kind: "boolean" },
      { kind: "choice", options: ["right", "left"] }
    ];
    for (const type of cases) {
      expect(parseScalarTypeJson(JSON.parse(JSON.stringify(type)))).toEqual(type);
    }
  });

  it("fails closed on structurally invalid payloads", () => {
    expect(() => parseScalarTypeJson(null)).toThrow();
    expect(() => parseScalarTypeJson("number")).toThrow();
    expect(() => parseScalarTypeJson([])).toThrow();
    expect(() => parseScalarTypeJson({})).toThrow();
    expect(() => parseScalarTypeJson({ kind: "integer" })).toThrow();
    expect(() => parseScalarTypeJson({ kind: "choice", options: "right,left" })).toThrow();
    expect(() => parseScalarTypeJson({ kind: "choice", options: ["right", 1] })).toThrow();
    expect(() => parseScalarTypeJson({ kind: "choice", options: ["right", ""] })).toThrow();
  });
});

describe("parseScalarValueJson", () => {
  it("round-trips valid payloads for every kind", () => {
    const cases: ScalarValue[] = [
      { kind: "number", value: 12 },
      { kind: "string", value: "前身頃" },
      { kind: "boolean", value: true },
      { kind: "choice", value: "right", options: ["right", "left"] }
    ];
    for (const value of cases) {
      expect(parseScalarValueJson(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
  });

  it("fails closed on invalid or non-finite values", () => {
    expect(() => parseScalarValueJson({ kind: "number", value: "12" })).toThrow();
    expect(() => parseScalarValueJson({ kind: "number", value: Number.NaN })).toThrow();
    expect(() => parseScalarValueJson({ kind: "number", value: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => parseScalarValueJson({ kind: "string", value: 12 })).toThrow();
    expect(() => parseScalarValueJson({ kind: "boolean", value: "true" })).toThrow();
    expect(() => parseScalarValueJson({ kind: "choice", value: "center", options: ["right", "left"] })).toThrow();
    expect(() => parseScalarValueJson({ kind: "choice", value: "right", options: [] })).toThrow();
    expect(() => parseScalarValueJson({ kind: "unknown", value: 1 })).toThrow();
    expect(() => parseScalarValueJson(undefined)).toThrow();
  });
});

describe("parseScalarEvaluationJson", () => {
  it("round-trips an ok evaluation whose value matches its declared type", () => {
    const evaluation: ScalarEvaluation = {
      status: "ok",
      type: { kind: "choice", options: ["right", "left"] },
      value: { kind: "choice", value: "left", options: ["right", "left"] }
    };
    expect(parseScalarEvaluationJson(JSON.parse(JSON.stringify(evaluation)))).toEqual(evaluation);
  });

  it("round-trips an error evaluation with and without bindingId", () => {
    const withoutBindingId: ScalarEvaluation = {
      status: "error",
      type: { kind: "number" },
      issueCode: "undefined-binding"
    };
    const withBindingId: ScalarEvaluation = {
      ...withoutBindingId,
      bindingId: "binding-1"
    };
    expect(parseScalarEvaluationJson(JSON.parse(JSON.stringify(withoutBindingId)))).toEqual(withoutBindingId);
    expect(parseScalarEvaluationJson(JSON.parse(JSON.stringify(withBindingId)))).toEqual(withBindingId);
  });

  it("fails closed when an ok evaluation's value does not match its declared type", () => {
    expect(() =>
      parseScalarEvaluationJson({
        status: "ok",
        type: { kind: "number" },
        value: { kind: "string", value: "12" }
      })
    ).toThrow();

    expect(() =>
      parseScalarEvaluationJson({
        status: "ok",
        type: { kind: "choice", options: ["right", "left"] },
        value: { kind: "choice", value: "right", options: ["left", "right"] }
      })
    ).toThrow();
  });

  it("fails closed on a missing or empty issueCode", () => {
    expect(() =>
      parseScalarEvaluationJson({ status: "error", type: { kind: "number" } })
    ).toThrow();
    expect(() =>
      parseScalarEvaluationJson({ status: "error", type: { kind: "number" }, issueCode: "" })
    ).toThrow();
  });

  it("fails closed when bindingId is present but not a non-empty string", () => {
    expect(() =>
      parseScalarEvaluationJson({
        status: "error",
        type: { kind: "number" },
        issueCode: "undefined-binding",
        bindingId: ""
      })
    ).toThrow();
    expect(() =>
      parseScalarEvaluationJson({
        status: "error",
        type: { kind: "number" },
        issueCode: "undefined-binding",
        bindingId: 42
      })
    ).toThrow();
  });

  it("fails closed on an unknown status", () => {
    expect(() =>
      parseScalarEvaluationJson({ status: "pending", type: { kind: "number" } })
    ).toThrow();
  });
});
