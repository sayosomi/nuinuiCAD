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
import { resolveSourceLexicalPath, type SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";

export type NameIndex = {
  elements: CadElement[];
  elementsById: Map<ElementId, CadElement>;
  idsByName: Map<string, ElementId[]>;
  nameContext: ElementNameContext;
  sourceLexicalResolution?: {
    sourceNamespace: SourceLexicalNamespaceIndex;
    elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
    statementIndexByElementId: ReadonlyMap<ElementId, number>;
  };
};

export const createNameIndex = (
  elements: CadElement[],
  sourceLexicalResolution?: {
    sourceNamespace: SourceLexicalNamespaceIndex;
    elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  }
): NameIndex => {
  const idsByName = new Map<string, ElementId[]>();
  for (const element of elements) {
    if (!element.name.trim()) continue;
    idsByName.set(element.name, [...(idsByName.get(element.name) ?? []), element.id]);
  }
  const nameContext = createElementNameContext(elements);
  const statementIndexByElementId = new Map<ElementId, number>();
  for (const [statementIndex, elementId] of sourceLexicalResolution?.elementIdByStatementIndex ?? []) {
    statementIndexByElementId.set(elementId, statementIndex);
  }
  return {
    elements,
    elementsById: nameContext.elementsById,
    idsByName,
    nameContext,
    ...(sourceLexicalResolution
      ? {
          sourceLexicalResolution: {
            sourceNamespace: sourceLexicalResolution.sourceNamespace,
            elementIdByStatementIndex: sourceLexicalResolution.elementIdByStatementIndex,
            statementIndexByElementId
          }
        }
      : {})
  };
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  message
});

const undefinedGeometryReferenceDiagnostic = (
  line: number,
  message: string,
  sourceSpan: DslSpan | undefined,
  relativeSpan: DslSpan
): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  code: "undefined-geometry-reference",
  message,
  presentation: { key: "diagnostic.undefined-geometry-reference" },
  exactSpanOnly: true,
  ...(sourceSpan ? {
    logicalSpan: {
      start: sourceSpan.start + relativeSpan.start,
      end: sourceSpan.start + relativeSpan.end
    }
  } : {})
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
  presentation: { key: "diagnostic.invalid-source-reference" },
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
  if (reference.property) {
    diagnostics.push(invalidReferenceDiagnostic(
      line,
      reference.source,
      "この geometry reference role では property を指定できません。",
      sourceSpan,
      reference.propertyRange ?? reference.fullRange
    ));
    return unresolvedToken;
  }
  const sourceResolution = index.sourceLexicalResolution && currentElement
    ? (() => {
        const statementIndex = index.sourceLexicalResolution!.statementIndexByElementId.get(currentElement.id);
        return statementIndex === undefined
          ? null
          : resolveSourceLexicalPath(index.sourceLexicalResolution!.sourceNamespace, statementIndex, path);
      })()
    : null;
  // An undefined source name may still be an explicit runtime element id for
  // an unnamed legacy statement (`id: unnamed`). Preserve that established
  // identity bridge; all named source outcomes remain authoritative below.
  if (sourceResolution && sourceResolution.kind !== "undefined") {
    if (sourceResolution.kind === "resolved") {
      if (sourceResolution.declaration.kind === "geometry" || sourceResolution.declaration.kind === "group" || sourceResolution.declaration.kind === "conditionalGroup" || sourceResolution.declaration.kind === "forGroup") {
        const resolvedId = index.sourceLexicalResolution!.elementIdByStatementIndex.get(sourceResolution.declaration.statementIndex);
        if (resolvedId) return resolvedId;
      }
      diagnostics.push(invalidReferenceDiagnostic(
        line,
        reference.source,
        `参照先「${sourceResolution.declaration.name}」はgeometryではありません。`,
        sourceSpan,
        reference.pathRange
      ));
      return unresolvedToken;
    }
    const sourceMessage = sourceResolution.kind === "forward"
      ? `参照先がこの位置より後で宣言されています: ${unresolvedToken}`
      : sourceResolution.kind === "ambiguous"
        ? `参照名が曖昧です: ${unresolvedToken}`
        : sourceResolution.kind === "invalidTraversal"
          ? `参照先「${sourceResolution.declaration.name}」はnamespace/containerではありません: ${unresolvedToken}`
          : `参照先が見つかりません: ${unresolvedToken}`;
    diagnostics.push(diagnostic(line, sourceMessage));
    return unresolvedToken;
  }
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
  diagnostics.push(undefinedGeometryReferenceDiagnostic(
    line,
    `参照先が見つかりません: ${unresolvedToken}`,
    sourceSpan,
    reference.pathRange
  ));
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
  const elementId = resolveId(pathToken, index, line, diagnostics, currentElement, sourceSpan);
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
    lineId: resolveId(lineName, index, line, diagnostics, currentElement, sourceSpan),
    endpointKey
  };
};
