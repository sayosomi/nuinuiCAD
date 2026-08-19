// Fail-closed JSON payload parsing for scalar type/value/evaluation
// contracts. This is the TS-side equivalent of the defensive validation the
// Rust evaluation core owns for its own payloads (D17): any structural
// mismatch throws rather than falling back to a best-effort guess.

import {
  scalarValueMatchesType,
  type ScalarEvaluation,
  type ScalarEvaluationErrorContext,
  type ScalarType,
  type ScalarValue
} from "./types";

const fail = (message: string): never => {
  throw new Error(`invalid scalar JSON payload: ${message}`);
};

const isPlainObject = (json: unknown): json is Record<string, unknown> =>
  typeof json === "object" && json !== null && !Array.isArray(json);

const parseOptionsArray = (json: unknown): readonly string[] => {
  if (!Array.isArray(json)) return fail("choice options must be an array");
  return json.map((option, index) => {
    if (typeof option !== "string" || option.length === 0) {
      return fail(`choice option at index ${index} must be a non-empty string`);
    }
    return option;
  });
};

export const parseScalarTypeJson = (json: unknown): ScalarType => {
  if (!isPlainObject(json)) return fail("scalar type must be a plain object");
  switch (json.kind) {
    case "number":
      return { kind: "number" };
    case "string":
      return { kind: "string" };
    case "boolean":
      return { kind: "boolean" };
    case "choice":
      return { kind: "choice", options: parseOptionsArray(json.options) };
    default:
      return fail(`unknown scalar type kind: ${String(json.kind)}`);
  }
};

export const parseScalarValueJson = (json: unknown): ScalarValue => {
  if (!isPlainObject(json)) return fail("scalar value must be a plain object");
  switch (json.kind) {
    case "number": {
      const value = json.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("number value must be a finite number");
      return { kind: "number", value };
    }
    case "string": {
      const value = json.value;
      if (typeof value !== "string") return fail("string value must be a string");
      return { kind: "string", value };
    }
    case "boolean": {
      const value = json.value;
      if (typeof value !== "boolean") return fail("boolean value must be a boolean");
      return { kind: "boolean", value };
    }
    case "choice": {
      const options = parseOptionsArray(json.options);
      const value = json.value;
      if (typeof value !== "string") return fail("choice value must be a string");
      if (!options.includes(value)) return fail(`choice value "${value}" is not a member of its declared options`);
      return { kind: "choice", value, options };
    }
    default:
      return fail(`unknown scalar value kind: ${String(json.kind)}`);
  }
};

const parseScalarEvaluationErrorContextJson = (json: unknown): ScalarEvaluationErrorContext => {
  if (!isPlainObject(json)) return fail("error context must be a plain object");
  for (const key of Object.keys(json)) {
    if (key !== "kind" && key !== "targetElementId" && key !== "pointKey") {
      return fail(`error context has unexpected field "${key}"`);
    }
  }
  if (json.kind !== "geometryBuiltinTarget") return fail(`unknown error context kind: ${String(json.kind)}`);
  if (typeof json.targetElementId !== "string") return fail("geometry builtin target context targetElementId must be a string");
  if (json.pointKey !== undefined && typeof json.pointKey !== "string") {
    return fail("geometry builtin target context pointKey, when present, must be a string");
  }
  return {
    kind: "geometryBuiltinTarget",
    targetElementId: json.targetElementId,
    ...(json.pointKey !== undefined ? { pointKey: json.pointKey } : {})
  };
};

export const parseScalarEvaluationJson = (json: unknown): ScalarEvaluation => {
  if (!isPlainObject(json)) return fail("scalar evaluation must be a plain object");
  const type = parseScalarTypeJson(json.type);

  if (json.status === "ok") {
    const value = parseScalarValueJson(json.value);
    if (!scalarValueMatchesType(type, value)) return fail("evaluation value does not match its declared type");
    return { status: "ok", type, value };
  }

  if (json.status === "error") {
    const issueCode = json.issueCode;
    if (typeof issueCode !== "string" || issueCode.length === 0) {
      return fail("error evaluation requires a non-empty issueCode");
    }
    const bindingId = json.bindingId;
    if (bindingId !== undefined && (typeof bindingId !== "string" || bindingId.length === 0)) {
      return fail("bindingId, when present, must be a non-empty string");
    }
    const context = json.context === undefined ? undefined : parseScalarEvaluationErrorContextJson(json.context);
    return {
      status: "error",
      type,
      issueCode,
      ...(bindingId !== undefined ? { bindingId } : {}),
      ...(context !== undefined ? { context } : {})
    };
  }

  return fail(`unknown scalar evaluation status: ${String(json.status)}`);
};
