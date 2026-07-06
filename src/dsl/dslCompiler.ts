import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createCadElement } from "../model/elementFactory";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import type {
  CadElement,
  CadElementType,
  ElementId
} from "../types/geometry";
import { parseDsl } from "./dslParser";
import {
  createNameIndex,
  resolveAnchor,
  resolveEndpoint,
  resolveId,
  type NameIndex
} from "./dslReferences";
import type { CompileDslContext, CompileDslResult, DslAttribute, DslDiagnostic, DslStatement } from "./dslTypes";

const attr = (attrs: DslAttribute[], key: string) =>
  attrs.find((item) => item.key === key)?.value;

const statementType = (statement: DslStatement): CadElementType => {
  if (statement.kind === "element") return statement.type ?? "group";
  if (statement.kind === "variable") return "variable";
  return statement.kind;
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

const booleanValue = (value: string) =>
  ["true", "1", "yes", "on"].includes(value.toLowerCase())
    ? true
    : ["false", "0", "no", "off"].includes(value.toLowerCase())
      ? false
      : null;

const splitList = (value: string) => {
  const trimmed = value.trim();
  const content = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return content.split(",").map((item) => item.trim()).filter(Boolean);
};

const normalizeExpression = (source: string, elements: CadElement[]) =>
  makeNumericExpression(normalizeNumericExpressionInput(source, elements));

const applyCommonAttributes = (
  element: CadElement,
  attrs: DslAttribute[],
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[]
) => {
  let next = element;
  const numeric = (source: string) => normalizeExpression(source, elementsForExpressions);
  const skip = new Set(["id", "type", "angle", "at", "center", "end", "size", "start"]);

  for (const { key, value } of attrs) {
    if (skip.has(key)) continue;
    if (key === "parent") {
      next = { ...next, parentGroupId: resolveId(value, index, line, diagnostics) };
      continue;
    }
    if (key === "branch") {
      next = { ...next, conditionalBranch: value === "else" ? "else" : "then" };
      continue;
    }
    if (key === "color") {
      next = { ...next, colorId: value };
      continue;
    }

    const definition = findParameterDefinition(next, key);
    if (definition?.kind === "boolean") {
      const parsed = booleanValue(value);
      if (parsed === null) diagnostics.push(diagnostic(line, `${key} は true/false で指定してください。`));
      next = setParameterValue(next, key, parsed ?? false);
      continue;
    }
    if (definition?.kind === "number") {
      next = setParameterValue(next, key, numeric(value));
      continue;
    }
    if (definition?.kind === "reference") {
      next = setParameterValue(next, key, value === "none" ? null : resolveAnchor(value, index, line, diagnostics, numeric));
      continue;
    }
    if (definition?.kind === "lineEndpointReference") {
      next = setParameterValue(next, key, resolveEndpoint(value, index, line, diagnostics));
      continue;
    }
    if (definition?.kind === "lineReference") {
      next = setParameterValue(next, key, resolveId(value, index, line, diagnostics));
      continue;
    }
    if (definition?.kind === "lineReferenceList") {
      next = setParameterValue(next, key, splitList(value).map((item) => resolveId(item, index, line, diagnostics)));
      continue;
    }
    if (definition?.kind === "choice" || definition?.kind === "text" || definition?.kind === "color") {
      next = setParameterValue(next, key, value);
      continue;
    }

    const parsedBoolean = booleanValue(value);
    const rawValue = parsedBoolean ?? (/^-?\d+(\.\d+)?$/.test(value) ? numeric(value) : value);
    next = { ...next, [key]: rawValue } as CadElement;
  }
  return next;
};

const applyStatement = (
  element: CadElement,
  statement: DslStatement,
  index: NameIndex,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[]
) => {
  const numeric = (source: string) => normalizeExpression(source, elementsForExpressions);
  const anchor = (source: string) => resolveAnchor(source, index, statement.line, diagnostics, numeric);
  let next = { ...element, name: attr(statement.attrs, "name") ?? statement.name };

  if (statement.kind === "variable" && next.type === "variable") {
    next = { ...next, valueMode: "expression", expression: numeric(statement.expression) };
  }
  if (statement.kind === "freePoint" && next.type === "freePoint") {
    next = { ...next, x: numeric(statement.x), y: numeric(statement.y) };
  }
  if (statement.kind === "offsetPoint" && next.type === "offsetPoint") {
    next = { ...next, fromPoint: anchor(statement.from), dx: numeric(attr(statement.attrs, "dx") ?? "0"), dy: numeric(attr(statement.attrs, "dy") ?? "0") };
  }
  if (statement.kind === "polarOffsetPoint" && next.type === "polarOffsetPoint") {
    next = {
      ...next,
      fromPoint: anchor(statement.from),
      angleDeg: numeric(attr(statement.attrs, "angle") ?? attr(statement.attrs, "angleDeg") ?? "0"),
      distance: numeric(attr(statement.attrs, "distance") ?? "0")
    };
  }
  if (statement.kind === "line" && next.type === "line") {
    next = { ...next, startPoint: anchor(statement.start), endPoint: anchor(statement.end) };
  }
  if (statement.kind === "angleLengthLine" && next.type === "angleLengthLine") {
    next = {
      ...next,
      startPoint: anchor(statement.start),
      angleDeg: numeric(attr(statement.attrs, "angle") ?? attr(statement.attrs, "angleDeg") ?? "0"),
      length: numeric(attr(statement.attrs, "length") ?? "0")
    };
  }
  if (statement.kind === "arcLine" && next.type === "arcLine") {
    next = {
      ...next,
      centerPoint: anchor(statement.center),
      radius: numeric(attr(statement.attrs, "radius") ?? "0"),
      startAngleDeg: numeric(attr(statement.attrs, "start") ?? attr(statement.attrs, "startAngleDeg") ?? "0"),
      endAngleDeg: numeric(attr(statement.attrs, "end") ?? attr(statement.attrs, "endAngleDeg") ?? "90")
    };
  }
  if (statement.kind === "text" && next.type === "text") {
    const at = attr(statement.attrs, "at") ?? attr(statement.attrs, "anchor");
    next = {
      ...next,
      text: statement.text,
      anchor: at ? anchor(at) : next.anchor,
      fontSize: numeric(attr(statement.attrs, "size") ?? attr(statement.attrs, "fontSize") ?? "3")
    };
  }

  return applyCommonAttributes(next, statement.attrs, index, statement.line, diagnostics, elementsForExpressions);
};

export const compileDslToElements = (source: string, context: CompileDslContext): CompileDslResult => {
  const parsed = parseDsl(source);
  if (parsed.diagnostics.some((item) => item.severity === "error")) {
    return {
      elements: context.elements,
      selectedElementId: null,
      selectedElementIds: [],
      diagnostics: parsed.diagnostics,
      changedCount: 0
    };
  }

  const diagnostics: DslDiagnostic[] = [...parsed.diagnostics];
  const existing = context.elements;
  const statementsWithIds = parsed.statements.map((statement) => {
    const type = statementType(statement);
    return {
      statement,
      type,
      id: attr(statement.attrs, "id") ?? existing.find((element) => element.name === statement.name && element.type === type)?.id
    };
  });
  const createdIds = new Map<DslStatement, ElementId>();
  for (const item of statementsWithIds) {
    createdIds.set(item.statement, item.id ?? createCadElement(item.type, existing).id);
  }

  const placeholderElements = statementsWithIds.map(({ statement, type }) => ({
    ...createCadElement(type, existing, { createId: () => createdIds.get(statement) ?? "" }),
    name: statement.name
  }));
  const index = createNameIndex([...existing, ...placeholderElements]);
  const elementsForExpressions = [...existing, ...placeholderElements];

  const updates = new Map<ElementId, CadElement>();
  const insertions: CadElement[] = [];
  for (const { statement, type } of statementsWithIds) {
    if (statement.kind === "element" && !statement.type) continue;
    const id = createdIds.get(statement) ?? createCadElement(type, existing).id;
    const current = existing.find((element) => element.id === id);
    const base = current ?? createCadElement(type, [...existing, ...insertions], { createId: () => id });
    const compiled = applyStatement(base, statement, index, diagnostics, elementsForExpressions);
    if (current) {
      updates.set(id, compiled);
    } else {
      insertions.push(compiled);
    }
  }

  const insertionIndex = Math.min(Math.max(context.insertionIndex ?? existing.length, 0), existing.length);
  const updatedExisting = existing.map((element) => updates.get(element.id) ?? element);
  const elements = [
    ...updatedExisting.slice(0, insertionIndex),
    ...insertions,
    ...updatedExisting.slice(insertionIndex)
  ];
  const selectedElementIds = [...updates.keys(), ...insertions.map((element) => element.id)];

  return {
    elements,
    selectedElementId: selectedElementIds[0] ?? null,
    selectedElementIds,
    diagnostics,
    changedCount: selectedElementIds.length
  };
};
