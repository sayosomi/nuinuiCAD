import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import { createElementNameContext, resolveElementNamePath, type ElementNameContext } from "../model/elementNames";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import type { DslDiagnostic, DslSpan } from "./dslTypes";
import {
  formatDslReferencePath,
  formatDslSourceReference,
  parseDslSourceReference,
  type DslSourceReference
} from "./dslReferenceTokens";

export type NameIndex = {
  elements: CadElement[];
  elementsById: Map<ElementId, CadElement>;
  idsByName: Map<string, ElementId[]>;
  nameContext: ElementNameContext;
};

export const createNameIndex = (elements: CadElement[]): NameIndex => {
  const idsByName = new Map<string, ElementId[]>();
  for (const element of elements) {
    if (!element.name.trim()) continue;
    idsByName.set(element.name, [...(idsByName.get(element.name) ?? []), element.id]);
  }
  const nameContext = createElementNameContext(elements);
  return {
    elements,
    elementsById: nameContext.elementsById,
    idsByName,
    nameContext
  };
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  message
});

const invalidReferenceDiagnostic = (
  line: number,
  reference: string,
  message: string,
  sourceSpan?: DslSpan,
  relativeSpan?: DslSpan
): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  code: "invalid-source-reference",
  message: `${message} (${reference})`,
  ...(sourceSpan && relativeSpan ? {
    logicalSpan: {
      start: sourceSpan.start + relativeSpan.start,
      end: sourceSpan.start + relativeSpan.end
    }
  } : {})
});

const sourceReference = (
  token: string,
  line: number,
  diagnostics: DslDiagnostic[],
  sourceSpan?: DslSpan
): DslSourceReference | null => {
  if (!token.trim()) return null;
  const parsed = parseDslSourceReference(token);
  if (parsed.kind === "valid") return parsed.reference;
  diagnostics.push(invalidReferenceDiagnostic(line, token.trim(), parsed.message, sourceSpan, parsed.range));
  return null;
};

export const resolveId = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => {
  const reference = sourceReference(token, line, diagnostics, sourceSpan);
  if (!reference) return token.trim();
  const path = reference.path;
  const unresolvedToken = formatDslSourceReference(reference);
  const resolution = resolveElementNamePath({
    path: { absolute: path.absolute, parts: path.segments },
    elements: index.elements,
    currentElement,
    context: index.nameContext
  });
  if (resolution.status === "resolved") return resolution.element.id;
  if (resolution.status === "ambiguous") {
    diagnostics.push(diagnostic(line, `参照名が曖昧です: ${unresolvedToken}`));
    return unresolvedToken;
  }
  diagnostics.push(diagnostic(line, `参照先が見つかりません: ${unresolvedToken}`));
  return unresolvedToken;
};

const coordinateAnchor = (value: string, numeric: (source: string) => NumericValue): PointAnchor | null => {
  const match = value.trim().match(/^\((.*),(.*)\)$/);
  return match ? { mode: "coordinate", x: numeric(match[1].trim()), y: numeric(match[2].trim()) } : null;
};

export const resolveAnchor = (
  value: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  numeric: (source: string) => NumericValue,
  currentElement?: CadElement,
  sourceSpan?: DslSpan
): PointAnchor => {
  const coordinate = coordinateAnchor(value, numeric);
  if (coordinate) return coordinate;
  const reference = sourceReference(value, line, diagnostics, sourceSpan);
  if (!reference) return referenceAnchor(value.trim());
  const pathToken = `@${formatDslReferencePath(reference.path)}`;
  const elementId = resolveId(pathToken, index, line, diagnostics, currentElement);
  return reference.property
    ? derivedAnchor(elementId, reference.property)
    : referenceAnchor(elementId);
};

export const resolveEndpoint = (
  value: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
): LineEndpointReference => {
  const reference = sourceReference(value, line, diagnostics, sourceSpan);
  if (!reference) return { lineId: value.trim(), endpointKey: "start" };
  const lineName = `@${formatDslReferencePath(reference.path)}`;
  const endpointKey = reference.property === "end" ? "end" : "start";
  return {
    lineId: resolveId(lineName, index, line, diagnostics, currentElement),
    endpointKey
  };
};
