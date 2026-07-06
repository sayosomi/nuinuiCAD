import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import type { DslDiagnostic } from "./dslTypes";

export type NameIndex = {
  elementsById: Map<ElementId, CadElement>;
  idsByName: Map<string, ElementId[]>;
};

export const createNameIndex = (elements: CadElement[]): NameIndex => {
  const idsByName = new Map<string, ElementId[]>();
  for (const element of elements) {
    if (!element.name.trim()) continue;
    idsByName.set(element.name, [...(idsByName.get(element.name) ?? []), element.id]);
  }
  return {
    elementsById: new Map(elements.map((element) => [element.id, element])),
    idsByName
  };
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

export const resolveId = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[]
) => {
  if (index.elementsById.has(token)) return token;
  const ids = index.idsByName.get(token) ?? [];
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) {
    diagnostics.push(diagnostic(line, `参照名が曖昧です: ${token}`));
    return token;
  }
  diagnostics.push(diagnostic(line, `参照先が見つかりません: ${token}`));
  return token;
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
  numeric: (source: string) => NumericValue
): PointAnchor => {
  const coordinate = coordinateAnchor(value, numeric);
  if (coordinate) return coordinate;
  const dotIndex = value.lastIndexOf(".");
  if (dotIndex > 0) {
    const elementId = resolveId(value.slice(0, dotIndex), index, line, diagnostics);
    return derivedAnchor(elementId, value.slice(dotIndex + 1));
  }
  return referenceAnchor(resolveId(value, index, line, diagnostics));
};

export const resolveEndpoint = (
  value: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[]
): LineEndpointReference => {
  const dotIndex = value.lastIndexOf(".");
  const lineName = dotIndex > 0 ? value.slice(0, dotIndex) : value;
  const endpointKey = dotIndex > 0 && value.slice(dotIndex + 1) === "end" ? "end" : "start";
  return {
    lineId: resolveId(lineName, index, line, diagnostics),
    endpointKey
  };
};
