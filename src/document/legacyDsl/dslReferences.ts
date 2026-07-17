// 凍結コピー。編集禁止。削除条件は docs/dsl2/tasks/f4-legacy-removal.md 参照。

import { derivedAnchor, referenceAnchor } from "../../model/pointAnchors";
import { createElementNameContext, resolveElementNamePath, type ElementNameContext } from "../../model/elementNames";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../../types/geometry";
import type { DslDiagnostic } from "./dslTypes";
import { formatDslReferenceToken, parseDslReferenceToken } from "./dslReferenceTokens";
import { lastIndexOfDslOutsideQuotes } from "./dslTokens";

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

export const resolveId = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement
) => {
  const path = parseDslReferenceToken(token);
  const unresolvedToken = formatDslReferenceToken(token);
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
  currentElement?: CadElement
): PointAnchor => {
  const coordinate = coordinateAnchor(value, numeric);
  if (coordinate) return coordinate;
  const dotIndex = lastIndexOfDslOutsideQuotes(value, ".");
  if (dotIndex > 0) {
    const elementId = resolveId(value.slice(0, dotIndex), index, line, diagnostics, currentElement);
    return derivedAnchor(elementId, value.slice(dotIndex + 1));
  }
  return referenceAnchor(resolveId(value, index, line, diagnostics, currentElement));
};

export const resolveEndpoint = (
  value: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement
): LineEndpointReference => {
  const dotIndex = lastIndexOfDslOutsideQuotes(value, ".");
  const lineName = dotIndex > 0 ? value.slice(0, dotIndex) : value;
  const endpointKey = dotIndex > 0 && value.slice(dotIndex + 1) === "end" ? "end" : "start";
  return {
    lineId: resolveId(lineName, index, line, diagnostics, currentElement),
    endpointKey
  };
};
