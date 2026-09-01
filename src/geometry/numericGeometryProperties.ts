import type {
  CadElement,
  ComputedGeometry
} from "../types/geometry";

/**
 * Canonical authored numeric geometry-property vocabulary.
 *
 * This list is deliberately limited to public nui1 property keys.  Internal
 * computed geometry fields such as `startTangentAngleDeg` remain implementation
 * details and must not be added here as compatibility aliases.
 */
export const NUMERIC_COMPUTED_GEOMETRY_PROPERTIES = [
  "length",
  "startAngleDeg",
  "endAngleDeg",
  "startPoint.x",
  "startPoint.y",
  "endPoint.x",
  "endPoint.y",
  "radius",
  "sweepAngleDeg",
  "startRadiusAngleDeg",
  "endRadiusAngleDeg",
  "centerPoint.x",
  "centerPoint.y",
  "startHandleAngleDeg",
  "startHandleLength",
  "endHandleAngleDeg",
  "endHandleLength",
  "x",
  "y",
  "originPoint.x",
  "originPoint.y",
  "widthMm",
  "heightMm",
  "scale",
  "angleDeg",
  "naturalWidthPx",
  "naturalHeightPx",
  "sourceDpi",
  "targetPixelsPerMm",
  "anchorPoint.x",
  "anchorPoint.y",
  "fontSize"
] as const;

/** Canonical measurement subset used by numeric-reference pickers. */
export const NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTIES = [
  "length",
  "startAngleDeg",
  "endAngleDeg",
  "radius",
  "sweepAngleDeg",
  "startRadiusAngleDeg",
  "endRadiusAngleDeg",
  "startHandleAngleDeg",
  "startHandleLength",
  "endHandleAngleDeg",
  "endHandleLength"
] as const;

type NumericComputedGeometryDynamicProperty = `intermediatePoints[${number}].${"x" | "y"}`;
export type NumericComputedGeometryProperty =
  | (typeof NUMERIC_COMPUTED_GEOMETRY_PROPERTIES)[number]
  | NumericComputedGeometryDynamicProperty;

const NUMERIC_COMPUTED_GEOMETRY_PROPERTY_SET = new Set<string>(NUMERIC_COMPUTED_GEOMETRY_PROPERTIES);
const NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTY_SET = new Set<string>(
  NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTIES
);

export const isKnownNumericComputedGeometryProperty = (property: string): boolean =>
  NUMERIC_COMPUTED_GEOMETRY_PROPERTY_SET.has(property) || /^intermediatePoints\[\d+\]\.(x|y)$/.test(property);

export const isNumericComputedGeometryProperty = (
  property: unknown
): property is NumericComputedGeometryProperty =>
  typeof property === "string" && isKnownNumericComputedGeometryProperty(property);

export type NumericGeometryPropertyFamily =
  | "point"
  | "line"
  | "arc"
  | "bezier"
  | "genericPath"
  | "polyline"
  | "image"
  | "text";

export type NumericGeometryStaticTarget =
  | {
      kind: "family";
      family: NumericGeometryPropertyFamily;
      /** Number of intermediate anchors proven by authored source geometry. */
      intermediatePointCount?: number;
      intermediatePointsProven?: boolean;
    }
  | {
      kind: "module";
      interfaceType: "point" | "line" | "path";
    };

const commonPathProperties: readonly NumericComputedGeometryProperty[] = [
  "length",
  "startAngleDeg",
  "endAngleDeg",
  "startPoint.x",
  "startPoint.y",
  "endPoint.x",
  "endPoint.y"
];

const familyProperties: Record<NumericGeometryPropertyFamily, readonly NumericComputedGeometryProperty[]> = {
  point: ["x", "y"],
  line: commonPathProperties,
  arc: [
    ...commonPathProperties,
    "radius",
    "sweepAngleDeg",
    "startRadiusAngleDeg",
    "endRadiusAngleDeg",
    "centerPoint.x",
    "centerPoint.y"
  ],
  bezier: [
    ...commonPathProperties,
    "startHandleAngleDeg",
    "startHandleLength",
    "endHandleAngleDeg",
    "endHandleLength"
  ],
  genericPath: commonPathProperties,
  polyline: commonPathProperties,
  image: [
    "originPoint.x",
    "originPoint.y",
    "widthMm",
    "heightMm",
    "scale",
    "angleDeg",
    "naturalWidthPx",
    "naturalHeightPx",
    "sourceDpi",
    "targetPixelsPerMm"
  ],
  text: ["anchorPoint.x", "anchorPoint.y", "fontSize"]
};

const withProvenIntermediatePoints = (
  properties: readonly NumericComputedGeometryProperty[],
  target: Extract<NumericGeometryStaticTarget, { kind: "family" }>
): readonly NumericComputedGeometryProperty[] => {
  if (target.family !== "bezier" || !target.intermediatePointsProven) return properties;
  const count = Math.max(0, target.intermediatePointCount ?? 0);
  return [
    ...properties,
    ...Array.from({ length: count }, (_, index) => [
      `intermediatePoints[${index + 1}].x` as NumericComputedGeometryProperty,
      `intermediatePoints[${index + 1}].y` as NumericComputedGeometryProperty
    ]).flat()
  ];
};

/** Returns the exact public property surface proven by a static target. */
export const numericGeometryPropertiesForStaticTarget = (
  target: NumericGeometryStaticTarget | null | undefined
): readonly NumericComputedGeometryProperty[] => {
  if (!target) return [];
  if (target.kind === "module") {
    return target.interfaceType === "point" ? familyProperties.point : commonPathProperties;
  }
  return withProvenIntermediatePoints(familyProperties[target.family], target);
};

export const numericGeometryPropertySupportedByStaticTarget = (
  target: NumericGeometryStaticTarget | null | undefined,
  property: string
): boolean => numericGeometryPropertiesForStaticTarget(target).includes(property as NumericComputedGeometryProperty);

const targetForFamily = (
  family: NumericGeometryPropertyFamily,
  options: { intermediatePointCount?: number; intermediatePointsProven?: boolean } = {}
): NumericGeometryStaticTarget => ({
  kind: "family",
  family,
  ...(options.intermediatePointCount === undefined ? {} : { intermediatePointCount: options.intermediatePointCount }),
  ...(options.intermediatePointsProven === undefined ? {} : { intermediatePointsProven: options.intermediatePointsProven })
});

/**
 * Maps the semantic construction/output family to its public property surface.
 * `split` deliberately receives its source proof separately: a broad path
 * interface may only expose common path properties, while a concrete source
 * can preserve its arc or Bezier family.
 */
export const numericGeometryStaticTargetForConstruction = (
  category: string,
  construction: string,
  options: {
    baseTarget?: NumericGeometryStaticTarget | null;
    intermediatePointCount?: number;
  } = {}
): NumericGeometryStaticTarget | null => {
  if (category === "point") return targetForFamily("point");
  if (category === "text") return targetForFamily("text");
  if (category === "image") return targetForFamily("image");
  if (category === "arc") return targetForFamily("arc");
  if (category === "curve" && construction === "bezier") {
    return targetForFamily("bezier", {
      intermediatePointCount: options.intermediatePointCount,
      intermediatePointsProven: true
    });
  }
  if (category !== "line") return null;

  if (construction === "segment" || construction === "polar" || construction === "commonTangent") {
    return targetForFamily("line");
  }
  if (construction === "offset" || construction === "transformCopy" || construction === "mirrorCopy") {
    return targetForFamily("genericPath");
  }
  if (construction === "polyline") return targetForFamily("polyline");
  if (construction === "split") {
    const base = options.baseTarget;
    if (!base) return targetForFamily("genericPath");
    if (base.kind === "module") return base;
    return targetForFamily(base.family);
  }
  return null;
};

/** Maps a direct authored CadElement to its static public property family. */
export const numericGeometryStaticTargetForElement = (
  element: CadElement,
  options: { baseTarget?: NumericGeometryStaticTarget | null } = {}
): NumericGeometryStaticTarget | null => {
  switch (element.type) {
    case "freePoint":
    case "offsetPoint":
    case "polarOffsetPoint":
    case "divisionPoint":
    case "lineDivisionPoint":
    case "intersectionPoint":
    case "lineTangentOffsetPoint":
    case "bezierExtremePoint":
    case "bezierBulgePoint":
      return targetForFamily("point");
    case "line":
    case "angleLengthLine":
    case "commonTangentLine":
      return targetForFamily("line");
    case "arcLine":
    case "threePointArcLine":
    case "cornerRadiusArcLine":
      return targetForFamily("arc");
    case "bezierCurve":
      return targetForFamily("bezier", {
        intermediatePointCount: element.intermediatePoints.length,
        intermediatePointsProven: true
      });
    case "offsetLine":
    case "copyLine":
    case "symmetricCopyLine":
      return targetForFamily("genericPath");
    case "polyline":
      return targetForFamily("polyline");
    case "splitLine": {
      const base = options.baseTarget;
      if (!base) return targetForFamily("genericPath");
      if (base.kind === "module") return base;
      return targetForFamily(base.family);
    }
    case "image":
      return targetForFamily("image");
    case "text":
      return targetForFamily("text");
    case "edge":
    case "extendTrim":
    case "pathReverse":
    case "move":
    case "symmetricMove":
      return targetForFamily("genericPath");
    case "group":
    case "conditionalGroup":
    case "forGroup":
    case "moduleInstance":
      return null;
  }
};

/** Resolves a direct split source when the document has enough static proof. */
export const numericGeometryStaticTargetForElementInDocument = (
  element: CadElement,
  elements: readonly CadElement[],
  visited: ReadonlySet<string> = new Set()
): NumericGeometryStaticTarget | null => {
  if (visited.has(element.id)) return numericGeometryStaticTargetForElement(element);
  if (element.type !== "splitLine") return numericGeometryStaticTargetForElement(element);
  const base = elements.find((candidate) => candidate.id === element.baseLineId);
  if (!base) return numericGeometryStaticTargetForElement(element);
  const nextVisited = new Set(visited);
  nextVisited.add(element.id);
  return numericGeometryStaticTargetForElement(element, {
    baseTarget: numericGeometryStaticTargetForElementInDocument(base, elements, nextVisited)
  });
};

export const numericGeometryStaticTargetForModuleInterface = (
  interfaceType: "point" | "line" | "path"
): NumericGeometryStaticTarget => ({ kind: "module", interfaceType });

/** Best-effort static target for a ComputedGeometry when no source statement is available. */
export const numericGeometryStaticTargetForComputedGeometry = (
  geometry: ComputedGeometry | undefined
): NumericGeometryStaticTarget | null => {
  if (!geometry) return null;
  if (geometry.kind === "point") return targetForFamily("point");
  if (geometry.kind === "line") return targetForFamily("line");
  if (geometry.kind === "arcLine") return targetForFamily("arc");
  if (geometry.kind === "bezierCurve") {
    return targetForFamily("bezier", {
      intermediatePointCount: geometry.segments.length - 1,
      intermediatePointsProven: false
    });
  }
  if (geometry.kind === "offsetLine") return targetForFamily("genericPath");
  if (geometry.kind === "polyline") return targetForFamily("polyline");
  if (geometry.kind === "image") return targetForFamily("image");
  return targetForFamily("text");
};

/** Numeric measurement properties used by canvas/reference-pick cycling. */
export const numericGeometryMeasurementPropertiesForStaticTarget = (
  target: NumericGeometryStaticTarget | null | undefined
): readonly NumericComputedGeometryProperty[] => numericGeometryPropertiesForStaticTarget(target).filter((property) =>
  NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTY_SET.has(property)
);
