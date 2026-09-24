import { derivedAnchor, isKnownDerivedPointKey, referenceAnchor } from "../model/pointAnchors";
import { createElementNameContext, resolveElementNamePath, type ElementNameContext } from "../model/elementNames";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import type { GeometryValueOccurrence } from "../model/cadDocumentTypes";
import type { DslDiagnostic, DslSpan } from "./dslTypes";
import {
  formatDslSourceReference,
  parseDslSourceReference,
  type DslSourceReference
} from "./dslReferenceTokens";
import { resolveSourceLexicalPath, type SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
import { dslRequiredValueTypeOf, isDslGeometryValueType } from "./dslValueTypes";
import { parseScalarExpression } from "../scalars/expressionParser";
import { isKnownNumericComputedGeometryProperty } from "../geometry/numericGeometryProperties";

export type NameIndex = {
  elements: CadElement[];
  elementsById: Map<ElementId, CadElement>;
  idsByName: Map<string, ElementId[]>;
  nameContext: ElementNameContext;
  sourceLexicalResolution?: {
    sourceNamespace: SourceLexicalNamespaceIndex;
    elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
    statementIndexByElementId: ReadonlyMap<ElementId, number>;
    geometryValueByStatementIndex?: ReadonlyMap<number, {
      kind: "value" | "drawable";
      occurrence?: GeometryValueOccurrence;
      declaredInterfaceType: "point" | "line" | "path";
      elementId?: ElementId;
    }>;
  };
};

export const createNameIndex = (
  elements: CadElement[],
  sourceLexicalResolution?: {
    sourceNamespace: SourceLexicalNamespaceIndex;
    elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
    geometryValueByStatementIndex?: ReadonlyMap<number, {
      kind: "value" | "drawable";
      occurrence?: GeometryValueOccurrence;
      declaredInterfaceType: "point" | "line" | "path";
      elementId?: ElementId;
    }>;
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
            statementIndexByElementId,
            ...(sourceLexicalResolution.geometryValueByStatementIndex
              ? { geometryValueByStatementIndex: sourceLexicalResolution.geometryValueByStatementIndex }
              : {})
          }
        }
      : {})
  };
};

const diagnostic = (
  line: number,
  message: string,
  options?: {
    code: string;
    parameters?: Readonly<Record<string, string | number | boolean>>;
    sourceSpan?: DslSpan;
    relativeSpan?: DslSpan;
    exactSpanOnly?: true;
  }
): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  message,
  ...(options ? {
    code: options.code,
    presentation: {
      key: `diagnostic.${options.code}`,
      ...(options.parameters ? { parameters: options.parameters } : {})
    },
    ...(options.exactSpanOnly ? { exactSpanOnly: options.exactSpanOnly } : {}),
    ...(options.sourceSpan && options.relativeSpan ? {
      logicalSpan: {
        start: options.sourceSpan.start + options.relativeSpan.start,
        end: options.sourceSpan.start + options.relativeSpan.end
      }
    } : {})
  } : {})
});

const undefinedGeometryReferenceDiagnostic = (
  line: number,
  message: string,
  reference: string,
  sourceSpan: DslSpan | undefined,
  relativeSpan: DslSpan
): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  code: "undefined-geometry-reference",
  message,
  presentation: { key: "diagnostic.undefined-geometry-reference", parameters: { reference } },
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
  presentation: { key: "diagnostic.invalid-source-reference", parameters: { reference } },
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
  // The preliminary compiler pass does not own source-aware collection
  // lowering. Preserve any typed collection-index expression for the
  // semantic Module/runtime pass, which records its resolved target sidecar.
  if (parseScalarExpression(token, { start: 0, end: token.length }).ast?.kind === "collectionIndex") {
    return token.trim();
  }
  const reference = sourceReference(token, line, diagnostics, sourceSpan);
  if (!reference) return token.trim();
  const path = reference.path;
  const unresolvedToken = formatDslSourceReference(reference);
  if (reference.property) {
    const firstProperty = reference.property.split(".")[0] ?? "";
    const isKnownGeometryProperty =
      isKnownNumericComputedGeometryProperty(reference.property) ||
      isKnownNumericComputedGeometryProperty(firstProperty) ||
      isKnownDerivedPointKey(firstProperty);
    if (isKnownGeometryProperty) {
      diagnostics.push(invalidReferenceDiagnostic(
        line,
        reference.source,
        "この geometry reference role では property を指定できません。",
        sourceSpan,
        reference.propertyRange ?? reference.fullRange
      ));
    }
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
      if (
        sourceResolution.declaration.kind === "typedDeclaration" &&
        sourceResolution.declaration.statement.kind === "typedDeclaration" &&
        isDslGeometryValueType(sourceResolution.declaration.statement.valueType)
      ) {
        // Single geometry values are source-only and are resolved by the
        // Module geometry runtime boundary. Keep the first compiler pass
        // fail-closed without inventing a drawable identity.
        return unresolvedToken;
      }
      if (
        sourceResolution.declaration.kind === "carry" &&
        sourceResolution.declaration.statement.kind === "element"
      ) {
        const carry = sourceResolution.declaration.statement.forCarries?.find(
          (candidate) => candidate.name === sourceResolution.declaration.name
        );
        // Carry geometry is resolved by the later semantic/runtime geometry
        // owners.  Keep the preliminary element compiler fail-closed without
        // inventing a drawable element identity or emitting a duplicate
        // scalar-value diagnostic.
        if (carry && isDslGeometryValueType(dslRequiredValueTypeOf(carry.valueType))) {
          return unresolvedToken;
        }
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
    if (sourceResolution.kind === "forward") {
      diagnostics.push(diagnostic(
        line,
        `参照先がこの位置より後で宣言されています: ${unresolvedToken}`,
        { code: "source-reference-forward", parameters: { reference: unresolvedToken } }
      ));
    } else if (sourceResolution.kind === "ambiguous") {
      diagnostics.push(diagnostic(
        line,
        `参照名が曖昧です: ${unresolvedToken}`,
        { code: "source-reference-ambiguous", parameters: { reference: unresolvedToken } }
      ));
    } else if (sourceResolution.kind === "invalidTraversal") {
      diagnostics.push(diagnostic(
        line,
        `参照先「${sourceResolution.declaration.name}」はnamespace/containerではありません: ${unresolvedToken}`,
        {
          code: "source-reference-invalid-traversal",
          parameters: {
            reference: unresolvedToken,
            declaration: sourceResolution.declaration.name
          }
        }
      ));
    }
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
    diagnostics.push(diagnostic(
      line,
      `参照名が曖昧です: ${unresolvedToken}`,
      { code: "source-reference-ambiguous", parameters: { reference: unresolvedToken } }
    ));
    return unresolvedToken;
  }
  // A bare unresolved geometry name keeps its geometry-specific identity so
  // the existing geometry typo query and exact token span remain available.
  // Qualified source paths use the source-reference catalog identity.
  if (sourceResolution?.kind === "undefined" && reference.path.segments.length > 1) {
    diagnostics.push(diagnostic(
      line,
      `参照先が見つかりません: ${unresolvedToken}`,
      {
        code: "source-reference-undefined",
        parameters: { reference: unresolvedToken },
        sourceSpan,
        relativeSpan: reference.pathRange,
        exactSpanOnly: true
      }
    ));
    return unresolvedToken;
  }
  diagnostics.push(undefinedGeometryReferenceDiagnostic(
    line,
    `参照先が見つかりません: ${unresolvedToken}`,
    unresolvedToken,
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
  // See resolveId: collection members are lowered only at the consumer
  // boundary once the typed index and collection target are available.
  if (parseScalarExpression(value, { start: 0, end: value.length }).ast?.kind === "collectionIndex") {
    return referenceAnchor(value.trim());
  }
  const reference = sourceReference(value, line, diagnostics, sourceSpan);
  if (!reference) return referenceAnchor(value.trim());
  const sourceResolution = index.sourceLexicalResolution && currentElement
    ? (() => {
        const statementIndex = index.sourceLexicalResolution!.statementIndexByElementId.get(currentElement.id);
        return statementIndex === undefined
          ? null
          : resolveSourceLexicalPath(
              index.sourceLexicalResolution!.sourceNamespace,
              statementIndex,
              reference.path
            );
      })()
    : null;
  if (sourceResolution?.kind === "resolved" &&
      sourceResolution.declaration.kind === "typedDeclaration" &&
      sourceResolution.declaration.statement.kind === "typedDeclaration" &&
      isDslGeometryValueType(sourceResolution.declaration.statement.valueType)) {
    const value = index.sourceLexicalResolution?.geometryValueByStatementIndex?.get(sourceResolution.declaration.statementIndex);
    if (value?.kind === "drawable" && value.elementId && (!reference.property || reference.property === "start" || reference.property === "end")) {
      return reference.property
        ? derivedAnchor(value.elementId, reference.property)
        : referenceAnchor(value.elementId);
    }
    if (value?.kind === "value" && value.occurrence && (!reference.property || reference.property === "start" || reference.property === "end")) {
      return {
        mode: "geometryValue",
        occurrence: value.occurrence,
        ...(reference.property ? { pointKey: reference.property } : {})
      };
    }
  }
  if (
    sourceResolution?.kind === "resolved" &&
    sourceResolution.declaration.kind === "carry" &&
    sourceResolution.declaration.statement.kind === "element"
  ) {
    const carry = sourceResolution.declaration.statement.forCarries?.find(
      (candidate) => candidate.name === sourceResolution.declaration.name
    );
    if (carry && isDslGeometryValueType(dslRequiredValueTypeOf(carry.valueType))) {
      // The geometry semantic pass owns the exact carry target.  This first
      // compiler pass must preserve the source token as an unresolved anchor
      // instead of reporting that it is not a drawable element.
      return referenceAnchor(value.trim());
    }
  }
  const pathToken = formatDslSourceReference({
    path: reference.path,
    occurrenceIndex: reference.occurrenceIndex,
    property: null
  });
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
  const lineName = formatDslSourceReference({
    path: reference.path,
    occurrenceIndex: reference.occurrenceIndex,
    property: null
  });
  const endpointKey = reference.property === "end" ? "end" : "start";
  return {
    lineId: resolveId(lineName, index, line, diagnostics, currentElement, sourceSpan),
    endpointKey
  };
};
