import type { CadElement, CadElementType } from "../types/geometry";

export type DslArgSpecial =
  | "steps"
  | "roles"
  | "intermediates"
  | "points"
  | "id"
  | "parent"
  | "branch";

export type DslArgSpec = {
  arg: string;
  parameterKey?: string;
  required?: boolean;
  positional?: boolean;
  special?: DslArgSpecial;
};

export type DslPureValueInterface = "point" | "line" | "path";

export const DSL_GEOMETRY_DECLARATION_CATEGORIES = [
  "point",
  "line",
  "curve",
  "arc",
  "text",
  "image",
] as const;

export type DslGeometryDeclarationCategory = typeof DSL_GEOMETRY_DECLARATION_CATEGORIES[number];

export const DSL_CONTAINER_CATEGORIES = ["group", "if", "for"] as const;

export type DslConstructionCategory =
  | DslGeometryDeclarationCategory
  | typeof DSL_CONTAINER_CATEGORIES[number]
  | typeof MUTATION_CATEGORY;

export const isGeometryDeclarationCategory = (category: string): category is DslGeometryDeclarationCategory =>
  DSL_GEOMETRY_DECLARATION_CATEGORIES.some((candidate) => candidate === category);

/**
 * The category for a bare mutation statement - a statement that rewrites an
 * already-declared element's geometry in place instead of declaring its own
 * (edge/extend/move/mirrorMove/reverse). These have no `<category> <name> =`
 * head; the construction keyword itself leads the statement, && the
 * compiled element's name is always "" (see dslCallParser.ts's bare-call
 * branch && elementActivity.ts's elementTypesWithoutOwnDrawableGeometry).
 */
export const MUTATION_CATEGORY = "mutation" as const;

export type DslConstructionSpec = {
  category: DslConstructionCategory;
  construction: string;
  elementType: CadElementType;
  /** Immutable geometry interface supported when this construction is used
   * as a source value. Omitted constructions remain drawable-only here. */
  pureValueInterface?: DslPureValueInterface;
  preset?: Partial<CadElement>;
  exclusiveGroups?: string[][];
  args: DslArgSpec[];
};

const arg = (argName: string, parameterKey?: string): DslArgSpec =>
  parameterKey ? { arg: argName, parameterKey } : { arg: argName };

const required = (argName: string, parameterKey?: string): DslArgSpec => ({
  ...arg(argName, parameterKey),
  required: true,
});

const positional = (argName: string, parameterKey?: string): DslArgSpec => ({
  ...arg(argName, parameterKey),
  positional: true,
});

const special = (argName: string, value: DslArgSpecial, required = false): DslArgSpec => ({
  arg: argName,
  ...(required ? { required: true } : {}),
  special: value,
});

export const commonArgSpecs: DslArgSpec[] = [
  arg("state"),
  special("steps", "steps"),
  special("id", "id"),
  special("roles", "roles"),
  special("parent", "parent"),
  special("branch", "branch"),
];

const constructionSpecs: DslConstructionSpec[] = [
  { category: "point", construction: "coordinate", elementType: "freePoint", pureValueInterface: "point", args: [arg("x"), arg("y")] },
  { category: "point", construction: "offset", elementType: "offsetPoint", pureValueInterface: "point", args: [required("from", "fromPoint"), arg("dx"), arg("dy")] },
  { category: "point", construction: "polar", elementType: "polarOffsetPoint", pureValueInterface: "point", args: [required("from", "fromPoint"), arg("angle", "angleDeg"), arg("distance")] },
  {
    category: "point",
    construction: "between",
    elementType: "divisionPoint",
    pureValueInterface: "point",
    exclusiveGroups: [["distance", "ratio"]],
    args: [required("start", "startPoint"), required("end", "endPoint"), arg("distance"), arg("ratio")],
  },
  {
    category: "point",
    construction: "onLine",
    elementType: "lineDivisionPoint",
    pureValueInterface: "point",
    exclusiveGroups: [["distance", "ratio"]],
    args: [required("from", "endpoint"), arg("distance"), arg("ratio")],
  },
  {
    category: "point",
    construction: "intersection",
    elementType: "intersectionPoint",
    pureValueInterface: "point",
    args: [required("line1", "line1Id"), required("line2", "line2Id"), arg("index", "intersectionIndex"), arg("extensions", "useExtensions")],
  },
  {
    category: "point",
    construction: "tangentOffset",
    elementType: "lineTangentOffsetPoint",
    pureValueInterface: "point",
    exclusiveGroups: [["angle", "curveSide"]],
    args: [required("line", "baseLineId"), required("base", "basePoint"), arg("angle", "tangentAngleDeg"), arg("curveSide"), arg("distance")],
  },
  {
    category: "point",
    construction: "bezierExtremePoint",
    elementType: "bezierExtremePoint",
    pureValueInterface: "point",
    args: [required("source", "baseLineId"), arg("segmentIndex"), required("direction", "directionDeg")],
  },
  {
    category: "point",
    construction: "bezierBulgePoint",
    elementType: "bezierBulgePoint",
    pureValueInterface: "point",
    args: [required("source", "baseLineId"), arg("segmentIndex")],
  },
  { category: "line", construction: "segment", elementType: "line", pureValueInterface: "line", args: [required("start", "startPoint"), required("end", "endPoint")] },
  { category: "line", construction: "polar", elementType: "angleLengthLine", pureValueInterface: "line", args: [required("start", "startPoint"), arg("angle", "angleDeg"), arg("length")] },
  {
    category: "line",
    construction: "commonTangent",
    elementType: "commonTangentLine",
    pureValueInterface: "line",
    args: [required("first", "firstLineId"), required("second", "secondLineId"), required("kind"), required("side")],
  },
  {
    category: "line",
    construction: "offset",
    elementType: "offsetLine",
    pureValueInterface: "path",
    args: [required("sources", "baseLineIds"), arg("distance", "offset"), arg("side"), arg("closed"), arg("suppressTrimWarnings")],
  },
  {
    category: "line",
    construction: "polyline",
    elementType: "polyline",
    pureValueInterface: "path",
    args: [special("points", "points", true), arg("closed")],
  },
  { category: "line", construction: "split", elementType: "splitLine", args: [required("source", "baseLineId"), required("at", "splitPoint")] },
  {
    category: "line",
    construction: "transformCopy",
    elementType: "copyLine",
    args: [required("startPoint"), required("endPoint"), arg("scale"), arg("angleDeg"), arg("mirrorX"), required("baseLines", "baseLineIds")],
  },
  {
    category: "line",
    construction: "mirrorCopy",
    elementType: "symmetricCopyLine",
    args: [required("axis1", "axisPoint1"), required("axis2", "axisPoint2"), required("baseLines", "baseLineIds")],
  },
  {
    category: MUTATION_CATEGORY,
    construction: "edge",
    elementType: "edge",
    args: [required("end1", "endpoint1"), required("end2", "endpoint2"), arg("index", "intersectionIndex")],
  },
  {
    category: MUTATION_CATEGORY,
    construction: "extend",
    elementType: "extendTrim",
    args: [required("end", "endpoint"), required("to", "point")],
  },
  {
    category: MUTATION_CATEGORY,
    construction: "move",
    elementType: "move",
    args: [
      required("targets", "baseLineIds"),
      required("from", "startPoint"),
      required("to", "endPoint"),
      arg("scale"),
      arg("angleDeg"),
      arg("mirrorX"),
    ],
  },
  {
    category: MUTATION_CATEGORY,
    construction: "mirrorMove",
    elementType: "symmetricMove",
    args: [required("targets", "baseLineIds"), required("axis1", "axisPoint1"), required("axis2", "axisPoint2")],
  },
  {
    category: MUTATION_CATEGORY,
    construction: "reverse",
    elementType: "pathReverse",
    args: [required("target", "targetLineId")],
  },
  {
    category: "curve",
    construction: "bezier",
    elementType: "bezierCurve",
    pureValueInterface: "path",
    args: [
      required("start", "startPoint"),
      required("end", "endPoint"),
      arg("startAngle", "startHandleAngleDeg"),
      arg("startLength", "startHandleLength"),
      arg("endAngle", "endHandleAngleDeg"),
      arg("endLength", "endHandleLength"),
      special("intermediates", "intermediates"),
    ],
  },
  { category: "arc", construction: "arc", elementType: "arcLine", pureValueInterface: "path", args: [required("center", "centerPoint"), arg("radius"), arg("start", "startAngleDeg"), arg("end", "endAngleDeg"), arg("direction")] },
  { category: "arc", construction: "through", elementType: "threePointArcLine", pureValueInterface: "path", args: [required("point1"), required("point2"), required("point3"), arg("start", "startAngleDeg"), arg("end", "endAngleDeg")] },
  { category: "arc", construction: "corner", elementType: "cornerRadiusArcLine", args: [required("end1", "endpoint1"), required("end2", "endpoint2"), arg("radius"), arg("index", "intersectionIndex")] },
  { category: "text", construction: "label", elementType: "text", args: [required("text"), arg("anchor"), arg("size", "fontSize")] },
  {
    category: "image",
    construction: "image",
    elementType: "image",
    args: [
      required("source", "sourcePath"),
      required("origin", "originPoint"),
      arg("naturalWidthPx"),
      arg("naturalHeightPx"),
      arg("sourceDpi"),
      arg("targetPixelsPerMm"),
      arg("scale"),
      arg("angleDeg"),
      arg("mirrorX"),
    ],
  },
  { category: "group", construction: "", elementType: "group", args: [special("roles", "roles")] },
  { category: "if", construction: "", elementType: "conditionalGroup", args: [{ ...positional("condition"), required: true }] },
  {
    category: "for",
    construction: "",
    elementType: "forGroup",
    args: [{ ...positional("variable", "variableName"), required: true }, required("min"), required("max"), required("step"), arg("showGenerated")],
  },
];

const specsByCall = new Map(constructionSpecs.map((spec) => [`${spec.category}\u0000${spec.construction}`, spec]));
const specsByElementType = new Map<CadElementType, DslConstructionSpec>();

for (const spec of constructionSpecs) {
  if (!specsByElementType.has(spec.elementType)) specsByElementType.set(spec.elementType, spec);
}

export const constructionFor = (category: string, construction: string): DslConstructionSpec | null =>
  specsByCall.get(`${category}\u0000${construction}`) ?? null;

/** Read-only registry queries for parser diagnostics && completion. */
export const constructionCandidatesFor = (category: string): readonly DslConstructionSpec[] =>
  constructionSpecs.filter((spec) => spec.category === category);

/** All construction specs in registry order. Consumers filter this view by
 * semantic capability rather than maintaining a second construction list. */
export const allConstructionSpecs = (): readonly DslConstructionSpec[] => constructionSpecs;

/** All registry specs for one construction spelling, in registry order. */
export const constructionSpecsFor = (construction: string): readonly DslConstructionSpec[] =>
  constructionSpecs.filter((spec) => spec.construction === construction);

/** Categories that define a construction spelling, in registry declaration order.
 * A bare mutation construction has no `<category> <name> =` head to suggest a
 * category for, so it is deliberately excluded here - see bareConstructionFor. */
export const categoriesForConstruction = (construction: string): readonly DslConstructionCategory[] =>
  [...new Set(constructionSpecs
    .filter((spec) => spec.construction === construction && spec.category !== MUTATION_CATEGORY)
    .map((spec) => spec.category))];

const specsByBareConstruction = new Map(
  constructionSpecs
    .filter((spec) => spec.category === MUTATION_CATEGORY)
    .map((spec) => [spec.construction, spec])
);

/** The mutation-category spec for a bare statement's leading keyword
 * (`edge`/`extend`/`move`/`mirrorMove`/`reverse`), || null for every other
 * keyword. */
export const bareConstructionFor = (construction: string): DslConstructionSpec | null =>
  specsByBareConstruction.get(construction) ?? null;

export const constructionForElementType = (type: CadElementType): DslConstructionSpec => {
  const spec = specsByElementType.get(type);
  if (!spec) throw new Error(`Missing DSL construction for element type: ${type}`);
  return spec;
};

export const parameterKeyForArg = (type: CadElementType, argName: string): string => {
  const spec = constructionForElementType(type);
  const argSpec = [...spec.args, ...commonArgSpecs].find((item) => item.arg === argName);
  return argSpec?.parameterKey ?? argSpec?.arg ?? argName;
};

export const argNameForParameter = (type: CadElementType, parameterKey: string): string | null => {
  const specs = constructionSpecs.filter((spec) => spec.elementType === type);
  const match = [...specs.flatMap((spec) => spec.args), ...commonArgSpecs].find(
    (spec) => (spec.parameterKey ?? spec.arg) === parameterKey &&
      (!spec.special || spec.special === "points"),
  );
  return match?.arg ?? null;
};
